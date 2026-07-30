/**
 * GraviScan IPC Handler Registration
 *
 * Wraps pure handler functions with ipcMain.handle() for 20 IPC channels.
 * This is the ONLY file where ipcMain.handle() calls exist for GraviScan.
 *
 * This is also where coordinator-aware orchestration around the DB-only
 * `scanner-handlers.ts` functions lives (e.g. spawn-on-discovery and
 * orphan-worker cleanup around `save-scanners-db`): `scanner-handlers.ts`
 * is documented as "Pure async exports with db injection — no ipcMain
 * wrappers", and `getCoordinator()` is only available here.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IpcMain, BrowserWindow } from 'electron';
import type { PrismaClient } from '@prisma/client';
import * as scannerHandlers from './scanner-handlers';
import * as sessionHandlers from './session-handlers';
import * as imageHandlers from './image-handlers';
import * as scannerUpsert from './scanner-upsert';
import type { SessionFns, ScanCoordinatorLike } from './session-handlers';

let registered = false;

/**
 * Error returned to the renderer for any path that fails containment.
 * Deliberately uniform — it must not leak whether the rejected path
 * exists, nor where it actually resolved to.
 */
const OUTSIDE_SCAN_DIR = 'Path outside scan directory';

/**
 * Resolve `candidatePath` and confirm it is `baseDir` itself or lives beneath
 * it, following symlinks on both sides.
 *
 * Comparing the strings alone is not enough: a symlink inside the output
 * directory can point anywhere, so both sides go through `fs.realpathSync`
 * first. Callers should use the returned path rather than the original, so
 * the value that was checked is the value that gets used.
 *
 * Returns `null` when the path is not contained — including when it does not
 * exist on disk, since `realpathSync` throws for a missing path and a path
 * that cannot be resolved cannot be proven contained. Use
 * `resolveContainedPathAllowingMissing()` for handlers whose whole job is to
 * act on a path that isn't there yet.
 *
 * NOTE: a sibling change adds this same helper as
 * `src/main/graviscan/path-containment.ts` (shared with `verify-plates.ts`).
 * When that lands, delete these two local copies and import from there.
 */
function resolveContainedPath(
  baseDir: string,
  candidatePath: string
): string | null {
  let realBase: string;
  let realCandidate: string;

  try {
    realBase = fs.realpathSync(path.resolve(baseDir));
    realCandidate = fs.realpathSync(path.resolve(candidatePath));
  } catch {
    // File or directory doesn't exist — reject rather than guess.
    return null;
  }

  if (realCandidate === realBase) return realCandidate;
  if (realCandidate.startsWith(realBase + path.sep)) return realCandidate;

  return null;
}

/**
 * Same containment guarantee as `resolveContainedPath()`, but tolerates a
 * candidate that does not exist on disk yet — needed by `ensure-dir` (whose
 * entire purpose is creating a missing directory) and by `list-scan-files`
 * (whose contract answers a not-yet-created session directory with an empty
 * list, not an error).
 *
 * Walks up to the deepest ancestor that DOES exist, proves containment for
 * that ancestor with symlinks resolved, then re-appends the missing tail. A
 * path segment that does not exist cannot be a symlink, so nothing in the
 * tail can escape the checked ancestor.
 */
function resolveContainedPathAllowingMissing(
  baseDir: string,
  candidatePath: string
): string | null {
  const resolved = path.resolve(candidatePath);

  let existingAncestor = resolved;
  const missingSegments: string[] = [];
  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    // Reached the filesystem root without finding anything that exists.
    if (parent === existingAncestor) return null;
    missingSegments.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }

  const containedAncestor = resolveContainedPath(baseDir, existingAncestor);
  if (containedAncestor === null) return null;

  return missingSegments.length > 0
    ? path.join(containedAncestor, ...missingSegments)
    : containedAncestor;
}

export function registerGraviScanHandlers(
  ipcMain: IpcMain,
  db: PrismaClient,
  getMainWindow: () => BrowserWindow | null,
  sessionFns: SessionFns,
  getCoordinator: () => ScanCoordinatorLike | null,
  createCoordinator?: () => Promise<ScanCoordinatorLike>
): void {
  if (registered) {
    throw new Error('GraviScan IPC handlers are already registered');
  }
  registered = true;

  // Helper to wrap handlers with error handling
  function wrapHandler<T>(
    handler: () => Promise<T>
  ): () => Promise<
    { success: true; data: T } | { success: false; error: string }
  > {
    return async () => {
      try {
        const data = await handler();
        return { success: true, data };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[GraviScan IPC]', message);
        return { success: false, error: message };
      }
    };
  }

  // --- Scanner handlers ---
  ipcMain.handle('graviscan:detect-scanners', () =>
    wrapHandler(() => scannerHandlers.detectScanners(db))()
  );

  ipcMain.handle('graviscan:get-config', () =>
    wrapHandler(() => scannerHandlers.getConfig(db))()
  );

  ipcMain.handle('graviscan:save-config', (_event, config) =>
    wrapHandler(() => scannerHandlers.saveConfig(db, config))()
  );

  ipcMain.handle('graviscan:save-scanners-db', (_event, scanners) =>
    wrapHandler(async () => {
      const result = await scannerHandlers.saveScannersToDB(db, scanners);

      const coordinator = getCoordinator();
      if (coordinator && result.success) {
        // #20 (Copilot PR #237 review): stop worker subprocesses for any
        // scanner rows that were just disabled as stale, so they don't
        // keep holding USB / SANE resources after disable.
        if (result.disabled && result.disabled.length > 0) {
          await scannerUpsert.stopWorkersForDisabledScanners(
            coordinator,
            result.disabled
          );
        }

        // #234: spawn a worker for any saved, enabled scanner that
        // doesn't already have one running. Lets a newly-detected (or
        // re-enabled) scanner come online without an app restart.
        //
        // Final-review fix #5: do NOT await this chain before returning
        // the IPC response. When a scan is active, coordinator.addScanner()
        // doesn't resolve until the NEXT 'cycle-complete' event — awaiting
        // it here would hold this IPC response open for a full scan
        // interval per new scanner (potentially hours for a continuous
        // session).
        //
        // Second-round fix: the spawns themselves must still be
        // serialized among each other (NOT fired concurrently) — per
        // scan-coordinator.ts's own "Staggered initialization" doc
        // comment, spawning subprocesses one at a time prevents SANE
        // init contention, and parallel init is explicitly deferred to
        // a future increment. Build a promise chain so each addScanner()
        // call only starts after the previous one has settled, but
        // `void` only the tail of the chain — the handler's own return
        // never waits on it.
        let spawnChain: Promise<void> = Promise.resolve();
        for (const saved of result.scanners) {
          if (!saved.enabled || coordinator.hasWorker(saved.id)) continue;

          // Final-review fix #8: usb_bus/usb_device can be null right
          // after a reset-usb (which clears them pending re-detection).
          // Synthesizing a fake "000:000" saneName would pass
          // buildSubprocessEnv's /^\d{3}$/ validation and reach the
          // libusb shim as a bogus filter value instead of failing
          // loudly — skip spawning instead and log why.
          if (saved.usb_bus == null || saved.usb_device == null) {
            console.log(
              `[GraviScan:SAVE] Skipping spawn for ${saved.id}: missing usb_bus/usb_device (likely mid reset-usb)`
            );
            continue;
          }

          const saneName = `epkowa:interpreter:${String(saved.usb_bus).padStart(3, '0')}:${String(saved.usb_device).padStart(3, '0')}`;
          spawnChain = spawnChain.then(() => {
            console.log(
              `[GraviScan:SAVE] Spawning worker for newly-discovered scanner ${saved.id} (port ${saved.usb_port})`
            );
            return coordinator
              .addScanner({
                scannerId: saved.id,
                saneName,
                plates: [],
              })
              .catch((err: unknown) => {
                console.error(
                  `[GraviScan:SAVE] Failed to spawn worker for ${saved.id}:`,
                  err
                );
              });
          });
        }
        void spawnChain;
      }

      return result;
    })()
  );

  /**
   * Disable a single scanner row (per-row "Remove" action).
   * Sets enabled=false on the matching GraviScanner row and asks the
   * coordinator to stop the worker (if any). Returns { ok: true } /
   * { ok: false, error } rather than the generic wrapHandler shape, to
   * match the renderer contract for surfacing a success/failure toast.
   */
  ipcMain.handle(
    'graviscan:disable-scanner',
    async (_event, scannerId: string) => {
      try {
        const coordinator = getCoordinator();
        const result = await scannerUpsert.disableScannerById(
          db,
          coordinator,
          scannerId
        );
        if (result.ok) {
          console.log(`[GraviScan:DISABLE] Scanner ${scannerId} disabled`);
        } else {
          // Manual cast: this repo's tsconfig doesn't set strictNullChecks,
          // so control-flow narrowing on the `ok` discriminant doesn't
          // apply here (matches the reference implementation's workaround).
          const err = (result as { ok: false; error: string }).error;
          console.warn('[GraviScan:DISABLE]', err);
        }
        return result;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to disable scanner';
        console.error('[GraviScan:DISABLE] Error:', error);
        return { ok: false as const, error: message };
      }
    }
  );

  ipcMain.handle('graviscan:platform-info', () =>
    wrapHandler(() => scannerHandlers.getPlatformInfo())()
  );

  ipcMain.handle('graviscan:validate-scanners', (_event, cachedIds) =>
    wrapHandler(() =>
      scannerHandlers.runStartupScannerValidation(db, cachedIds)
    )()
  );

  ipcMain.handle('graviscan:validate-config', () =>
    wrapHandler(() => scannerHandlers.validateConfig(db))()
  );

  ipcMain.handle('graviscan:reset-usb', () =>
    wrapHandler(() => scannerHandlers.resetUsb(getCoordinator(), db))()
  );

  /**
   * Merge live coordinator subprocess status with saved DB scanner rows.
   * Called by the renderer on page mount to show which scanners are
   * ready/starting/error/disconnected. Returns the getScannerStatus()
   * result shape directly (not wrapped via wrapHandler) — matching
   * production's `{ success, scanners, error? }` contract, same as
   * `graviscan:disable-scanner` above.
   */
  ipcMain.handle('graviscan:get-scanner-status', () =>
    scannerHandlers.getScannerStatus(getCoordinator(), db)
  );

  // --- Session handlers ---
  ipcMain.handle('graviscan:start-scan', async (_event, params) => {
    // Reject if scan already in progress
    const current = sessionFns.getScanSession();
    if (current?.isActive) {
      return { success: false, error: 'Scan already in progress' };
    }
    // Lazy coordinator creation — first start-scan creates + wires the coordinator
    let coordinator = getCoordinator();
    if (!coordinator && createCoordinator) {
      try {
        coordinator = await createCoordinator();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[GraviScan IPC] Failed to create coordinator:', msg);
        return {
          success: false,
          error: `Failed to initialize scanner coordinator: ${msg}`,
        };
      }
    }
    return wrapHandler(() =>
      sessionHandlers.startScan(coordinator, params, sessionFns, (error) => {
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('graviscan:scan-error', {
            scannerId: null,
            plateIndex: null,
            error,
          });
        }
      })
    )();
  });

  ipcMain.handle('graviscan:get-scan-status', () =>
    wrapHandler(() =>
      Promise.resolve(sessionHandlers.getScanStatus(sessionFns))
    )()
  );

  ipcMain.handle('graviscan:mark-job-recorded', (_event, jobKey) =>
    wrapHandler(() => {
      sessionHandlers.markJobRecorded(sessionFns, jobKey);
      return Promise.resolve();
    })()
  );

  ipcMain.handle('graviscan:cancel-scan', () =>
    wrapHandler(() =>
      sessionHandlers.cancelScan(getCoordinator(), sessionFns)
    )()
  );

  // --- Image handlers ---
  ipcMain.handle('graviscan:get-output-dir', () =>
    wrapHandler(() => Promise.resolve(imageHandlers.getOutputDir()))()
  );

  ipcMain.handle(
    'graviscan:read-scan-image',
    async (_event, filePath, opts) => {
      // Path validation: ensure file is within scan output directory
      const outputDirResult = imageHandlers.getOutputDir();
      if (!outputDirResult.success || !outputDirResult.path) {
        return {
          success: false,
          error: 'Cannot determine scan directory for path validation',
        };
      }
      const realFile = resolveContainedPath(outputDirResult.path, filePath);
      if (realFile === null) {
        return { success: false, error: OUTSIDE_SCAN_DIR };
      }
      return wrapHandler(() => imageHandlers.readScanImage(realFile, opts))();
    }
  );

  ipcMain.handle('graviscan:upload-all-scans', () => {
    // Upload guard: reject when scanning
    const coordinator = getCoordinator();
    if (coordinator?.isScanning) {
      return {
        success: false,
        error: 'Cannot upload while scanning is in progress',
      };
    }
    // Check window at send-time, not registration-time (window may close mid-upload)
    const onProgress = (progress: unknown) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('graviscan:upload-progress', progress);
      }
    };
    return wrapHandler(() => imageHandlers.uploadAllScans(db, onProgress))();
  });

  /**
   * Create a directory recursively (idempotent). Used by the renderer to
   * create the per-session scan folder upfront, before any cycle begins.
   * Returns imageHandlers.ensureDir()'s result shape directly, matching
   * production's `{ success, path?, error? }` contract.
   *
   * The caller-supplied path is confined to the scan output directory, the
   * same guarantee `read-scan-image` above enforces — this handler calls
   * `fs.promises.mkdir(..., { recursive: true })`, so without the check any
   * renderer reaching this channel could create directory trees anywhere the
   * app user can write.
   */
  ipcMain.handle('graviscan:ensure-dir', (_event, dirPath: string) => {
    // Missing/non-string input goes straight through so image-handlers keeps
    // ownership of the 'dirPath is required' error (path.resolve would throw
    // on it here).
    if (!dirPath || typeof dirPath !== 'string') {
      return imageHandlers.ensureDir(dirPath);
    }

    const outputDirResult = imageHandlers.getOutputDir();
    if (!outputDirResult.success || !outputDirResult.path) {
      return Promise.resolve({
        success: false,
        error: 'Cannot determine scan directory for path validation',
      });
    }

    const realDir = resolveContainedPathAllowingMissing(
      outputDirResult.path,
      dirPath
    );
    if (realDir === null) {
      return Promise.resolve({ success: false, error: OUTSIDE_SCAN_DIR });
    }

    return imageHandlers.ensureDir(realDir);
  });

  /**
   * List image files in the scan output directory (or a given session
   * directory), sorted newest-first. Returns
   * imageHandlers.listScanFiles()'s result shape directly, matching
   * production's `{ success, files, error? }` contract.
   *
   * A caller-supplied `dirPath` is confined to the scan output directory
   * (`readdirSync`/`statSync` on an arbitrary path would otherwise let a
   * renderer enumerate the filesystem). No `dirPath` means base-dir mode,
   * where `listScanFiles()` resolves the output directory itself — nothing
   * untrusted to validate.
   */
  ipcMain.handle('graviscan:list-scan-files', (_event, dirPath?: string) => {
    if (dirPath === undefined || dirPath === null) {
      return Promise.resolve(imageHandlers.listScanFiles(undefined));
    }

    const outputDirResult = imageHandlers.getOutputDir();
    if (!outputDirResult.success || !outputDirResult.path) {
      return Promise.resolve({
        success: false,
        files: [],
        error: 'Cannot determine scan directory for path validation',
      });
    }

    // Allow a not-yet-created directory: listScanFiles() answers that with
    // `{ success: true, files: [] }`, and turning it into a containment
    // error would change the documented contract.
    const realDir = resolveContainedPathAllowingMissing(
      outputDirResult.path,
      dirPath
    );
    if (realDir === null) {
      return Promise.resolve({
        success: false,
        files: [],
        error: OUTSIDE_SCAN_DIR,
      });
    }

    return Promise.resolve(imageHandlers.listScanFiles(realDir));
  });

  ipcMain.handle('graviscan:download-images', (_event, params) => {
    // Check window at send-time, not registration-time
    const onProgress = (progress: unknown) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('graviscan:download-progress', progress);
      }
    };
    return wrapHandler(() =>
      imageHandlers.downloadImages(db, params, onProgress)
    )();
  });
}

/**
 * Reset registration state (for testing only).
 */
export function _resetRegistration(): void {
  registered = false;
}
