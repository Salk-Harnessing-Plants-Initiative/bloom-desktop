/**
 * GraviScan Session Handlers
 *
 * Extracted from Ben's monolithic graviscan-handlers.ts.
 * Manages scan lifecycle: start, status, mark-recorded, cancel.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type {
  PlateConfig,
  ScannerConfig,
  ScanSessionJob,
} from '../../types/graviscan';
import { buildSaneName } from '../lsusb-detection';
import {
  refreshScannerUsbAddress,
  type ScannerUsbRefreshDb,
  type ScannerUsbRefreshOutcome,
} from './scanner-usb-refresh';
import { scanLog } from './scan-logger';

// ---------------------------------------------------------------------------
// Interface types
// ---------------------------------------------------------------------------

/**
 * Minimal shape `retryScanner()` needs to read a scanner's current USB
 * identity and enabled state. Deliberately narrower than `PrismaClient`
 * (design.md Decision 7) — `session-handlers.ts` otherwise has zero DB
 * dependency, matching `wiring.ts`'s `ScannerLookupDb` convention for the
 * same kind of "read one scanner row for a spawn-related decision" case.
 */
/**
 * Retry needs to *write* a corrected address, not only read one, so it
 * extends the refresh module's read+write interface.
 *
 * The extension is in this direction (retry extends refresh, not the
 * reverse) because TypeScript will not let a derived interface *narrow*
 * `graviScanner`'s shape — so the base row type declared in
 * `scanner-usb-refresh.ts` carries the union of the fields both need,
 * rather than each declaring a conflicting subset.
 */
export interface ScannerRetryLookupDb extends ScannerUsbRefreshDb {
  graviScanner: ScannerUsbRefreshDb['graviScanner'];
}

export interface ScanCoordinatorLike {
  readonly isScanning: boolean;
  initialize(scanners: ScannerConfig[]): Promise<void>;
  scanOnce(platesPerScanner: Map<string, PlateConfig[]>): Promise<void>;
  scanInterval(
    platesPerScanner: Map<string, PlateConfig[]>,
    intervalMs: number,
    durationMs: number
  ): Promise<void>;
  cancelAll(): void;
  shutdown(): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): this;
  // Task 7 (#234) — single-scanner spawn/stop, added for the
  // save-scanners-db / disable-scanner handlers (stage 3) so they can
  // bring a scanner online/offline without a full re-initialize().
  // Matching the concrete ScanCoordinator class's public signatures.
  hasWorker(scannerId: string): boolean;
  addScanner(config: ScannerConfig): Promise<void>;
  stopScanner(scannerId: string): Promise<void>;
  // Increment 4 — live subprocess status for the `graviscan:get-scanner-status`
  // handler (scanner-handlers.ts's getScannerStatus()). Matching the
  // concrete ScanCoordinator class's public signature.
  getScannerStatuses(): Array<{
    scannerId: string;
    status: 'ready' | 'starting' | 'error' | 'dead';
    error?: string;
  }>;
}

export interface SessionFns {
  getScanSession: () => any;
  setScanSession: (session: any) => void;
  markScanJobRecorded: (jobKey: string) => void;
}

// ---------------------------------------------------------------------------
// Param types
// ---------------------------------------------------------------------------

interface StartScanParams {
  scanners: Array<{
    scannerId: string;
    saneName: string;
    plates: (PlateConfig & { plate_barcode?: string | null })[];
  }>;
  interval?: { intervalSeconds: number; durationSeconds: number };
  metadata?: {
    experimentId: string;
    phenotyperId: string;
    resolution: number;
    sessionId?: string;
    waveNumber?: number;
  };
}

// ---------------------------------------------------------------------------
// startScan
// ---------------------------------------------------------------------------

export async function startScan(
  coordinator: ScanCoordinatorLike | null,
  params: StartScanParams,
  sessionFns: SessionFns,
  onError?: (error: string) => void,
  /**
   * Builds a spawn-time address resolver for one scanner.
   *
   * A **factory**, not a `db` handle, deliberately: `startScan` is the main
   * session entry point and this module carries almost no DB dependency by
   * design. `register-handlers.ts` already holds `db`, so it supplies the
   * factory and `startScan` never sees the database.
   *
   * Optional because an absent resolver is ordinary — `resetUsb` and the
   * save-scanners spawn-on-discovery path perform their own detection in the
   * same operation and must not resolve twice.
   *
   * Why session start needs this at all (`design.md` Decision 3, path 2 of
   * 3): `GraviScan.tsx` fetches the `saneNames` map once per page mount, so
   * cancel → power-cycle → start a new session without leaving the page —
   * the most plausible operator recovery — otherwise spawns on an address
   * captured before the power-cycle and fails with the identical error the
   * retry button used to.
   */
  makeSaneNameResolver?: (scannerId: string) => () => Promise<string>
): Promise<{ success: boolean; error?: string }> {
  let sessionSet = false;
  try {
    if (!coordinator) {
      return { success: false, error: 'ScanCoordinator not initialized' };
    }

    if (coordinator.isScanning) {
      return { success: false, error: 'Scan already in progress' };
    }

    if (params.interval) {
      if (
        params.interval.intervalSeconds <= 0 ||
        params.interval.durationSeconds <= 0
      ) {
        return {
          success: false,
          error: 'Interval and duration must be positive',
        };
      }
    }

    // Build jobs map. Imports the canonical `ScanSessionJob` type rather
    // than a locally-duplicated one — a prior inline copy of this type was
    // missing the `'recorded'` status literal that `markScanJobRecorded()`
    // (`wiring.ts`) makes a real, live value for the first time, and only
    // happened to compile because a narrower union is structurally
    // assignable to the wider one it was drifting from.
    const jobs: Record<string, ScanSessionJob> = {};

    for (const s of params.scanners) {
      for (const plate of s.plates) {
        const key = `${s.scannerId}:${plate.plate_index}`;
        jobs[key] = {
          scannerId: s.scannerId,
          plateIndex: plate.plate_index,
          outputPath: plate.output_path,
          plantBarcode: plate.plate_barcode ?? null,
          transplantDate: null,
          customNote: null,
          gridMode: plate.grid_mode,
          status: 'pending',
        };
      }
    }

    const sessIntervalMs = params.interval
      ? params.interval.intervalSeconds * 1000
      : 0;
    const sessDurationMs = params.interval
      ? params.interval.durationSeconds * 1000
      : 0;

    // Build scanner configs for coordinator initialization
    const scannerConfigs: ScannerConfig[] = params.scanners.map((s) => ({
      scannerId: s.scannerId,
      saneName: s.saneName,
      plates: s.plates,
      ...(makeSaneNameResolver
        ? { resolveSaneName: makeSaneNameResolver(s.scannerId) }
        : {}),
    }));

    await coordinator.initialize(scannerConfigs);

    // Final-review fix #3: initialize() no longer rejects on a
    // per-scanner spawn failure — stage 2 isolated those failures inside
    // spawnSingleScanner() so one bad USB port doesn't block the others
    // (they're recorded in initErrors and surfaced via a
    // 'scanner-init-status' event instead). That means a session could
    // otherwise start "active" with zero — or only some — scanners
    // actually working, with nothing telling the operator. Verify at
    // least one scanner came online before reporting success.
    const anyScannerReady = scannerConfigs.some((c) =>
      coordinator.hasWorker(c.scannerId)
    );
    if (!anyScannerReady) {
      return {
        success: false,
        error:
          'No scanners came online — check scanner-init-status events for per-scanner failures',
      };
    }

    // Only set session state AFTER initialize succeeds — avoids briefly
    // reporting an active scan while the coordinator is still starting up.
    sessionFns.setScanSession({
      isActive: true,
      isContinuous: !!params.interval,
      experimentId: params.metadata?.experimentId || '',
      phenotyperId: params.metadata?.phenotyperId || '',
      resolution: params.metadata?.resolution || 300,
      sessionId: params.metadata?.sessionId || null,
      jobs,
      currentCycle: 0,
      totalCycles:
        sessIntervalMs > 0 ? Math.ceil(sessDurationMs / sessIntervalMs) : 1,
      intervalMs: sessIntervalMs,
      scanStartedAt: Date.now(),
      scanEndedAt: null,
      scanDurationMs: sessDurationMs,
      coordinatorState: 'scanning',
      nextScanAt: null,
      waveNumber: params.metadata?.waveNumber || 0,
    });
    sessionSet = true;

    // Build plates map for scanning
    const platesPerScanner = new Map<string, PlateConfig[]>();
    for (const s of params.scanners) {
      platesPerScanner.set(s.scannerId, s.plates);
    }

    const handleError = (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      sessionFns.setScanSession(null);
      onError?.(message);
    };

    const handleComplete = () => {
      sessionFns.setScanSession(null);
    };

    if (params.interval) {
      const intervalMs = params.interval.intervalSeconds * 1000;
      const durationMs = params.interval.durationSeconds * 1000;
      coordinator
        .scanInterval(platesPerScanner, intervalMs, durationMs)
        .then(handleComplete)
        .catch(handleError);
    } else {
      coordinator
        .scanOnce(platesPerScanner)
        .then(handleComplete)
        .catch(handleError);
    }

    return { success: true };
  } catch (error) {
    if (sessionSet) {
      sessionFns.setScanSession(null);
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Start scan failed',
    };
  }
}

// ---------------------------------------------------------------------------
// getScanStatus
// ---------------------------------------------------------------------------

export function getScanStatus(sessionFns: SessionFns): Record<string, any> {
  const session = sessionFns.getScanSession();
  if (!session) {
    return { isActive: false };
  }
  return {
    isActive: session.isActive,
    experimentId: session.experimentId,
    phenotyperId: session.phenotyperId,
    resolution: session.resolution,
    sessionId: session.sessionId,
    jobs: session.jobs,
    isContinuous: session.isContinuous,
    currentCycle: session.currentCycle,
    totalCycles: session.totalCycles,
    intervalMs: session.intervalMs,
    scanStartedAt: session.scanStartedAt,
    scanDurationMs: session.scanDurationMs,
    coordinatorState: session.coordinatorState,
    nextScanAt: session.nextScanAt,
    waveNumber: session.waveNumber,
  };
}

// ---------------------------------------------------------------------------
// markJobRecorded
// ---------------------------------------------------------------------------

export function markJobRecorded(sessionFns: SessionFns, jobKey: string): void {
  sessionFns.markScanJobRecorded(jobKey);
}

// ---------------------------------------------------------------------------
// cancelScan
// ---------------------------------------------------------------------------

export async function cancelScan(
  coordinator: ScanCoordinatorLike | null,
  sessionFns: SessionFns
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!coordinator) {
      return { success: false, error: 'ScanCoordinator not initialized' };
    }

    coordinator.cancelAll();
    await coordinator.shutdown();
    sessionFns.setScanSession(null);

    return { success: true };
  } catch (error) {
    // Always clear session — even if shutdown fails, the scan is cancelled
    sessionFns.setScanSession(null);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Cancel failed',
    };
  }
}

// ---------------------------------------------------------------------------
// retryScanner
// ---------------------------------------------------------------------------

/**
 * Respawn a scanner after an operator confirms it has been physically
 * power-cycled following a wedge auto-pause (design.md Decisions 1, 2, 7).
 *
 * Stricter than `cancelScan`'s guard: requires an active session, not just
 * a live coordinator — respawning a worker with no active `scanInterval()`/
 * `scanOnce()` loop to schedule it into a cycle would just leak a
 * subprocess with nothing driving it (design.md Decision 8).
 *
 * Reads `usb_bus`/`usb_device`/`enabled` fresh from the database rather
 * than from any value cached at session start, since a `reset-usb`
 * performed after auto-pause would otherwise make a stale value wrong.
 */
// Tracks scanner_ids with a retryScanner() call currently in flight. A
// scanner can re-wedge (and its banner entry remount, resetting the UI's
// own `retrying` guard) before a prior retry's stopScanner()+addScanner()
// pair has resolved — without this guard, a second concurrent retry for
// the same scannerId could race the first (addScanner() only dedupes
// concurrent calls while a cycle is in flight; it does not when idle).
/**
 * Identify a scanner in an operator-facing message.
 *
 * Preference order: `display_name`, then `usb_port`, then the identifier.
 *
 * `name` is **deliberately excluded**. On the real rig it is
 * `'Perfection V600 Photo'` — the model string, identical across all five
 * production scanners — so including it would look informative while
 * distinguishing nothing. The rig's actual row has `display_name: null`,
 * which is why the `usb_port` tier exists: without it the message degrades
 * to a UUID on exactly the hardware this feature runs on.
 */
function describeScanner(
  row: { display_name?: string | null; usb_port?: string | null },
  scannerId: string
): string {
  if (row.display_name) return row.display_name;
  if (row.usb_port) return `The scanner on USB port ${row.usb_port}`;
  return `Scanner ${scannerId}`;
}

/**
 * True when `describeScanner` already identified the scanner *by its port*.
 *
 * Callers use this to avoid naming the same port twice in one sentence. The
 * rig's real row has `display_name: null`, so that redundancy is the
 * **default** phrasing in production, not an edge case — it read
 * "the scanner on USB port 1-14 is not connected at USB port 1-14" during
 * hardware validation (task 4.3), which is also why the unit tests could not
 * catch it: they assert the message *contains* the port, and it did. Twice.
 */
function describedByPort(row: {
  display_name?: string | null;
  usb_port?: string | null;
}): boolean {
  return !row.display_name && !!row.usb_port;
}

/**
 * Turn a non-`refreshed` outcome into an actionable operator message.
 *
 * **None of these may tell the operator to run Detect Scanners.** That path
 * is not gated on an active scan (unlike Reset USB), and `saveScannersToDB`
 * calls `disableStaleScannerRows`, which disables every enabled row whose
 * `usb_port` is absent from the current detection set — i.e. a powered-off
 * wedged scanner, which is the *likeliest* reason a retry fails. So the
 * prohibition covers `not-detected` as much as `no-stable-port`.
 */
function describeRefreshFailure(
  outcome: Exclude<ScannerUsbRefreshOutcome, { status: 'refreshed' }>,
  row: { display_name?: string | null; usb_port?: string | null },
  scannerId: string
): string {
  const who = describeScanner(row, scannerId);
  // Avoid "The scanner on USB port 1-8 is not connected at USB port 1-8".
  const byPort = describedByPort(row);
  switch (outcome.status) {
    case 'not-detected':
      return byPort
        ? `${who} is not connected. Check that it is powered on and its USB cable is connected, then try again.`
        : `${who} is not connected at USB port ${outcome.usbPort}. Check that it is powered on and its USB cable is connected, then try again.`;
    case 'no-stable-port':
      // Cannot be described by port here — this outcome *is* "no usable port".
      return `${who} has no recorded USB port, so its current address cannot be determined. Reset All USB Connections from the Configure Scanner page while no scan is running.`;
    case 'unusable-address':
      return `${who} has no usable USB address recorded. If a USB reset is in progress, wait for it to finish and try again.`;
    case 'row-missing':
      return `Scanner ${scannerId} no longer exists in the database.`;
    case 'detection-failed':
      // `who` is mid-sentence here, so the leading capital would be wrong.
      return `Could not read the USB bus to locate ${lowerFirst(who)} after ${outcome.attempts} attempts (${outcome.error}). Try again in a moment.`;
  }
}

/**
 * Lowercase the first character, for embedding `describeScanner`'s
 * sentence-initial output mid-sentence. Left alone when the identifier is a
 * `display_name`, which may legitimately be capitalised (e.g. "Scanner A").
 */
function lowerFirst(s: string): string {
  if (!s) return s;
  if (s.startsWith('The scanner ') || s.startsWith('Scanner ')) {
    return s.charAt(0).toLowerCase() + s.slice(1);
  }
  return s;
}

/**
 * Build a spawn-time resolver for one scanner.
 *
 * Returns the freshly-resolved name, or the click-time `fallback` when
 * resolution does not produce one. It never throws and never returns a
 * failure: resolution must not be able to fail a spawn
 * (`design.md` Decision 3a). The coordinator logs every failure-caused
 * fallback with its cause.
 */
export function makeSaneNameResolver(
  db: ScannerUsbRefreshDb,
  scannerId: string,
  fallback: string
): () => Promise<string> {
  return async () => {
    const outcome = await refreshScannerUsbAddress(db, scannerId);
    if (outcome.status !== 'refreshed') {
      throw new Error(
        `USB address re-resolution for ${scannerId} returned ${outcome.status}`
      );
    }
    const resolved = buildSaneName(outcome.usbBus, outcome.usbDevice);
    return resolved || fallback;
  };
}

const retriesInFlight = new Set<string>();

export async function retryScanner(
  coordinator: ScanCoordinatorLike | null,
  db: ScannerRetryLookupDb,
  sessionFns: SessionFns,
  scannerId: string
): Promise<{ success: boolean; error?: string }> {
  if (retriesInFlight.has(scannerId)) {
    return {
      success: false,
      error: `Retry already in progress for scanner ${scannerId}`,
    };
  }
  retriesInFlight.add(scannerId);
  let session: ReturnType<SessionFns['getScanSession']> | undefined;
  try {
    session = sessionFns.getScanSession();
    if (!session?.isActive) {
      return { success: false, error: 'No active scan session' };
    }
    if (!coordinator) {
      return { success: false, error: 'ScanCoordinator not initialized' };
    }

    const row = await db.graviScanner.findUnique({ where: { id: scannerId } });
    if (!row) {
      return { success: false, error: `Scanner ${scannerId} not found` };
    }
    // The row and `enabled` guards stay strictly BEFORE refresh, so neither
    // a deleted nor a disabled scanner costs a USB detection. The old
    // null-address guard that sat between them is gone: with refresh in
    // place those columns are recoverable from `usb_port`, so the condition
    // moves from "null ⇒ fail" to "no usable port ⇒ fail"
    // (design.md Decision 6).
    if (!row.enabled) {
      return { success: false, error: `Scanner ${scannerId} is disabled` };
    }

    // Re-resolve BEFORE stopping the scanner. A scanner that cannot be
    // re-resolved is then left running rather than stopped and
    // unrecoverable — the whole point of #182's fix is that the operator's
    // only recovery path must not make things worse when it fails.
    const refresh = await refreshScannerUsbAddress(db, scannerId);
    if (refresh.status !== 'refreshed') {
      const error = describeRefreshFailure(refresh, row, scannerId);
      scanLog(
        `[WedgeResponse] retry failed scanner=${scannerId} session=${session.sessionId ?? 'none'} usb_port=${row.usb_port ?? 'none'} outcome=${refresh.status} error=${error}`
      );
      return { success: false, error };
    }

    const saneName = buildSaneName(refresh.usbBus, refresh.usbDevice);
    await coordinator.stopScanner(scannerId);
    await coordinator.addScanner({
      scannerId,
      saneName,
      plates: [],
      // Resolve again at spawn time. `retryScanner` requires an active
      // session and `isScanning` is true for 'waiting' too, so this
      // addScanner takes the queued branch and runs on the next
      // cycle-complete — "potentially hours for a continuous session" in
      // register-handlers.ts's own words. Fixing the address here only
      // fixes it at click time, not at use time (design.md Decision 3).
      resolveSaneName: makeSaneNameResolver(db, scannerId, saneName),
    });

    // addScanner() never throws on spawn failure (see scan-coordinator.ts) —
    // a resolved promise alone doesn't mean the worker actually came online.
    const status = coordinator
      .getScannerStatuses()
      .find((s) => s.scannerId === scannerId);
    if (!status || status.status !== 'ready') {
      const message =
        status?.error ?? `Scanner ${scannerId} did not come online after retry`;
      scanLog(
        `[WedgeResponse] retry failed scanner=${scannerId} session=${session.sessionId ?? 'none'} error=${message}`
      );
      return { success: false, error: message };
    }

    // New fields are appended AFTER `session=<id>`: three existing tests
    // assert `stringContaining('scanner=… session=…')`, a contiguous
    // substring, so inserting between the two would break them for a reason
    // unrelated to any new behaviour.
    scanLog(
      `[WedgeResponse] retry succeeded scanner=${scannerId} session=${session.sessionId ?? 'none'} usb_port=${row.usb_port ?? 'none'} address=${refresh.previousUsbBus ?? 'none'}:${refresh.previousUsbDevice ?? 'none'}->${refresh.usbBus}:${refresh.usbDevice} changed=${refresh.changed}`
    );
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Retry failed';
    // `session?.sessionId` printed the literal 'undefined' when
    // `getScanSession()` itself threw — #279 item 8 recorded this line
    // emitting `session=null`. Normalised while rewriting it.
    scanLog(
      `[WedgeResponse] retry failed scanner=${scannerId} session=${session?.sessionId ?? 'none'} error=${message}`
    );
    return { success: false, error: message };
  } finally {
    retriesInFlight.delete(scannerId);
  }
}
