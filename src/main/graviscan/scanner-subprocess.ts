/**
 * Scanner Subprocess Manager
 *
 * Manages a single long-lived Python scan_worker.py subprocess.
 * Each physical scanner gets its own ScannerSubprocess instance with
 * an independent SANE context (sane.init/sane.open).
 *
 * Communication:
 *   - stdin: JSON commands (scan, cancel, quit)
 *   - stdout: EVENT: prefixed JSON events (ready, scan-started, scan-complete, etc.)
 *   - stderr: Debug logging (not parsed)
 *
 * Adapted from Ben's scanner-subprocess.ts (PR #138).
 */

import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import * as readline from 'readline';
import { scanLog } from './scan-logger';
import type { PlateConfig } from '../../types/graviscan';

/** Default graceful-quit budget before force-killing (matches every existing call site's prior literal default). */
export const SHUTDOWN_TIMEOUT_MS = 5_000;

/**
 * Bound on how long to wait, after force-killing, for the OS to actually
 * confirm the process exited. A live process is reaped within milliseconds
 * of SIGKILL; a longer wait doesn't help a genuinely stuck (D-state)
 * process, so this only needs to be long enough to observe a normal kill's
 * exit event.
 */
export const KILL_CONFIRM_TIMEOUT_MS = 2_000;

// =============================================================================
// Subprocess env construction (Task 4 #228 — testable pure function)
// =============================================================================

export interface BuildSubprocessEnvArgs {
  platform: NodeJS.Platform;
  mock: boolean;
  /** SANE name like "epkowa:interpreter:001:007". Used to derive
   *  SANE_USB_FILTER on Linux real-mode. */
  saneName: string;
  /** Additional path prepended to PYTHONPATH (dev: `<repo>/python`). */
  pythonExtraPath: string;
  /** Absolute path to the libusb-filter.so for LD_PRELOAD on Linux. */
  libusbFilterSoPath: string;
  /** Snapshot of the main-process env. Not mutated. */
  processEnv: Record<string, string | undefined>;
}

/**
 * Build the env object passed to `child_process.spawn()` for a scan
 * worker. Extracted from `ScannerSubprocess.spawn()` so the env
 * construction is unit-testable without spawning real processes.
 *
 * On Linux + real mode:
 *  - LD_PRELOAD = libusbFilterSoPath
 *  - SANE_USB_FILTER = "<bus>:<dev>" from saneName
 *  - LIBUSB_ENDPOINT_RECOVERY = "true" by default, or "false" if the
 *    main-process env has LIBUSB_ENDPOINT_RECOVERY=false
 *    (case-insensitive). Reads the C-shim's wrapper toggle per #228.
 *
 * On macOS/Windows or in mock mode: none of these are set (the shim
 * isn't loaded; recovery is irrelevant).
 */
export function buildSubprocessEnv(
  args: BuildSubprocessEnvArgs
): Record<string, string | undefined> {
  // Per Copilot PR #237 review (#16): derive the PYTHONPATH delimiter
  // from `args.platform` rather than the hardcoded ':' that breaks on
  // Windows. `path.delimiter` reads `process.platform` at runtime and
  // wouldn't honor the test fixture's `args.platform`.
  const pathDelimiter = args.platform === 'win32' ? ';' : ':';
  const env: Record<string, string | undefined> = {
    ...args.processEnv,
    PYTHONPATH: [args.pythonExtraPath, args.processEnv.PYTHONPATH]
      .filter(Boolean)
      .join(pathDelimiter),
  };

  if (args.platform === 'linux' && !args.mock) {
    // saneName looks like "epkowa:interpreter:001:007"; the 3rd and
    // 4th colon-separated tokens are the USB bus and address as
    // 3-digit zero-padded decimal. Validate before passing the values
    // through to SANE_USB_FILTER — a malformed DB value here could
    // misconfigure the libusb shim (it does substring match on the
    // filter), so we reject early rather than silently passing
    // garbage through.
    const parts = args.saneName.split(':');
    if (parts.length < 4) {
      throw new Error(
        `Invalid saneName format (expected at least 4 colon-separated tokens): ${args.saneName}`
      );
    }
    const usbBus = parts[2];
    const usbDev = parts[3];
    if (!/^\d{3}$/.test(usbBus) || !/^\d{3}$/.test(usbDev)) {
      throw new Error(
        `Invalid saneName USB bus/address (expected 3-digit decimal): ${args.saneName}`
      );
    }
    env.LD_PRELOAD = args.libusbFilterSoPath;
    env.SANE_USB_FILTER = `${usbBus}:${usbDev}`;
    const raw = args.processEnv.LIBUSB_ENDPOINT_RECOVERY;
    env.LIBUSB_ENDPOINT_RECOVERY =
      typeof raw === 'string' && raw.toLowerCase() === 'false'
        ? 'false'
        : 'true';
  } else {
    // On non-Linux or mock mode, the shim isn't loaded — strip these
    // vars from the inherited env so the subprocess sees a clean
    // environment. Avoids accidentally propagating a stale toggle.
    delete env.LD_PRELOAD;
    delete env.SANE_USB_FILTER;
    delete env.LIBUSB_ENDPOINT_RECOVERY;
  }

  return env;
}

// =============================================================================
// Types
// =============================================================================

export interface ScanWorkerEvent {
  type: string;
  scanner_id: string;
  plate_index?: string;
  job_id?: string;
  path?: string;
  duration_ms?: number;
  error?: string;
  cycle?: number;
  // Emitted by the Python worker on scan-error (see
  // python/graviscan/scan_worker.py) — raw RGB bytes received and wall-
  // clock seconds elapsed for the failed scan attempt. Feeds the
  // WedgeDetector's device_io_120s_zero_bytes signature (#236).
  bytes_received?: number;
  wall_seconds?: number;
  // Emitted by the Python worker on scan-complete (#232) — the
  // resolution the SANE device actually applied, read back after being
  // set and before scanning. May differ from the resolution the
  // coordinator originally requested (some backends silently round it).
  // A future caller writing GraviScan.resolution from a completed scan
  // MUST source it from this field, not the pre-scan requested value.
  achieved_resolution?: number;
  // Injected by ScanCoordinator for per-grid timestamp tracking
  cycle_number?: number;
  scan_started_at?: string | null;
  scan_ended_at?: string | null;
}

type SubprocessState = 'idle' | 'starting' | 'ready' | 'scanning' | 'dead';

// =============================================================================
// ScannerSubprocess
// =============================================================================

export class ScannerSubprocess extends EventEmitter {
  readonly scannerId: string;
  readonly saneName: string;
  private pythonPath: string;
  private isPackaged: boolean;
  private mock: boolean;
  private proc: ChildProcess | null = null;
  private state: SubprocessState = 'idle';
  private rl: readline.Interface | null = null;
  private stderrRl: readline.Interface | null = null;

  constructor(
    pythonPath: string,
    isPackaged: boolean,
    scannerId: string,
    saneName: string,
    mock = false
  ) {
    super();
    this.pythonPath = pythonPath;
    this.isPackaged = isPackaged;
    this.scannerId = scannerId;
    this.saneName = saneName;
    this.mock = mock;
  }

  get isReady(): boolean {
    return this.state === 'ready';
  }

  get isAlive(): boolean {
    return this.state !== 'dead' && this.state !== 'idle';
  }

  /**
   * Spawn the subprocess and wait for the EVENT:ready signal.
   * Resolves when the worker has completed sane.init() + sane.open().
   */
  async spawn(): Promise<void> {
    if (this.proc) {
      throw new Error(
        `Subprocess for scanner ${this.scannerId} already spawned`
      );
    }

    this.state = 'starting';

    // `pythonPath` is always the PyInstaller-built `bloom-hardware`
    // executable (see python-paths.ts#getPythonExecutablePath — it
    // returns the built exe in BOTH packaged and dev/E2E mode, never a
    // raw Python interpreter path), so the invocation style is the same
    // regardless of `isPackaged`. Bug found via E2E reproduction: this
    // used to branch on `isPackaged` and pass `-m graviscan.scan_worker`
    // in dev mode — a real-interpreter invocation the frozen exe's own
    // argparse rejects outright ("unrecognized arguments: -m
    // graviscan.scan_worker"), so every dev/E2E-mode subprocess spawn
    // failed immediately with exit code 2. `isPackaged` is still used
    // below for resource paths (e.g. libusbFilterSoPath), which
    // genuinely do differ between packaged and dev layouts.
    const args = ['--scan-worker', '--scanner-id', this.scannerId];
    if (this.mock) {
      args.push('--mock');
    } else {
      args.push('--device', this.saneName);
    }

    console.log(
      `[ScannerSubprocess:${this.scannerId}] Spawning: ${this.pythonPath} ${args.join(' ')}`
    );

    // Build environment variables for subprocess
    const libusbFilterSoPath = this.isPackaged
      ? path.join(process.resourcesPath, 'libusb-filter.so')
      : path.join(process.cwd(), 'src', 'main', 'native', 'libusb-filter.so');
    const env = buildSubprocessEnv({
      platform: process.platform,
      mock: this.mock,
      saneName: this.saneName,
      pythonExtraPath: path.join(process.cwd(), 'python'),
      libusbFilterSoPath,
      processEnv: process.env as Record<string, string | undefined>,
    });

    if (env.LD_PRELOAD) {
      console.log(
        `[ScannerSubprocess:${this.scannerId}] LD_PRELOAD=${env.LD_PRELOAD} SANE_USB_FILTER=${env.SANE_USB_FILTER} LIBUSB_ENDPOINT_RECOVERY=${env.LIBUSB_ENDPOINT_RECOVERY}`
      );
    }

    this.proc = spawn(this.pythonPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
      env,
    });

    // Parse stdout line-by-line for EVENT: messages
    this.rl = readline.createInterface({ input: this.proc.stdout! });
    this.rl.on('line', (line) => this.handleLine(line));

    // Log stderr to console + persistent log file
    this.stderrRl = readline.createInterface({ input: this.proc.stderr! });
    this.stderrRl.on('line', (line) => {
      console.log(`[ScanWorker:${this.scannerId}] ${line}`);
      scanLog(`[${this.scannerId}] ${line}`);
    });

    // Handle process exit
    this.proc.on('exit', (code, signal) => {
      console.log(
        `[ScannerSubprocess:${this.scannerId}] Exited: code=${code}, signal=${signal}`
      );
      this.state = 'dead';
      this.emit('exit', { scannerId: this.scannerId, code, signal });
    });

    // Use 'process-error' instead of 'error' to avoid Node's special
    // EventEmitter behavior that throws if no 'error' listener is attached.
    this.proc.on('error', (err) => {
      console.error(
        `[ScannerSubprocess:${this.scannerId}] Process error:`,
        err
      );
      this.state = 'dead';
      this.emit('process-error', {
        scannerId: this.scannerId,
        error: err.message,
      });
    });

    // Wait for ready signal (no timeout — SANE open can be slow with some backends)
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.removeListener('ready', onReady);
        this.removeListener('init-error', onInitError);
        this.removeListener('exit', onExit);
        this.removeListener('process-error', onProcessError);
      };

      const onReady = () => {
        cleanup();
        resolve();
      };

      const onInitError = (event: ScanWorkerEvent) => {
        cleanup();
        reject(
          new Error(`Scanner ${this.scannerId} init failed: ${event.error}`)
        );
      };

      const onExit = (info: { scannerId: string; code: number | null }) => {
        cleanup();
        reject(
          new Error(
            `Scanner ${this.scannerId} process exited (code ${info.code}) before becoming ready`
          )
        );
      };

      const onProcessError = (info: { scannerId: string; error: string }) => {
        cleanup();
        reject(
          new Error(`Scanner ${this.scannerId} spawn failed: ${info.error}`)
        );
      };

      this.on('ready', onReady);
      this.on('init-error', onInitError);
      this.on('exit', onExit);
      this.on('process-error', onProcessError);
    });
  }

  /**
   * Send a scan command for a batch of plates.
   * Returns immediately — listen for events to track progress.
   */
  scan(plates: PlateConfig[]): void {
    this.sendCommand({ action: 'scan', plates });
    this.state = 'scanning';
  }

  /**
   * Send cancel command — worker finishes current plate then returns to idle.
   */
  cancel(): void {
    this.sendCommand({ action: 'cancel' });
  }

  /**
   * Send quit command for clean shutdown.
   */
  quit(): void {
    this.sendCommand({ action: 'quit' });
  }

  /**
   * Force-kill the subprocess.
   */
  kill(): void {
    this.rl?.close();
    this.stderrRl?.close();
    if (this.proc && !this.proc.killed) {
      this.proc.kill('SIGKILL');
    }
    this.state = 'dead';
  }

  /**
   * Quit gracefully, then force-kill after timeout. Resolves `true` only
   * once the process's actual `exit` event was observed (directly, or
   * within a further bounded window after force-kill); resolves `false`
   * if a force-killed process still couldn't be confirmed to have exited
   * (e.g. stuck in an uninterruptible kernel wait) — callers must not
   * treat `false` as "freed the slot."
   */
  async shutdown(timeoutMs = SHUTDOWN_TIMEOUT_MS): Promise<boolean> {
    if (!this.proc || this.state === 'dead' || this.state === 'idle') {
      return true;
    }

    this.quit();
    this.rl?.close();
    this.stderrRl?.close();

    return new Promise<boolean>((resolve) => {
      const graceTimeout = setTimeout(() => {
        console.warn(
          `[ScannerSubprocess:${this.scannerId}] Force-killing after timeout`
        );
        this.kill();

        const confirmTimeout = setTimeout(() => {
          console.warn(
            `[ScannerSubprocess:${this.scannerId}] Could not confirm exit after force-kill`
          );
          resolve(false);
        }, KILL_CONFIRM_TIMEOUT_MS);

        this.proc!.once('exit', () => {
          clearTimeout(confirmTimeout);
          resolve(true);
        });
      }, timeoutMs);

      this.proc!.once('exit', () => {
        clearTimeout(graceTimeout);
        resolve(true);
      });
    });
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private sendCommand(cmd: Record<string, unknown>): void {
    if (!this.proc || !this.proc.stdin || this.proc.killed) {
      console.warn(
        `[ScannerSubprocess:${this.scannerId}] Cannot send command — process not running`
      );
      return;
    }
    this.proc.stdin.write(JSON.stringify(cmd) + '\n');
  }

  private handleLine(line: string): void {
    if (!line.startsWith('EVENT:')) {
      // Non-event stdout — log it
      console.log(`[ScanWorker:${this.scannerId}:stdout] ${line}`);
      return;
    }

    const jsonStr = line.substring(6);
    let event: ScanWorkerEvent;
    try {
      event = JSON.parse(jsonStr);
    } catch {
      scanLog(`[${this.scannerId}] Invalid EVENT JSON: ${jsonStr}`);
      return;
    }

    switch (event.type) {
      case 'ready':
        this.state = 'ready';
        this.emit('ready', event);
        break;

      case 'error':
        // Init-time error (before ready)
        if (this.state === 'starting') {
          this.emit('init-error', event);
        } else {
          this.emit('scan-error', event);
        }
        break;

      case 'scan-started':
        this.emit('scan-started', event);
        break;

      case 'scan-complete':
        this.emit('scan-complete', event);
        break;

      case 'scan-error':
        this.emit('scan-error', event);
        break;

      case 'scan-cancelled':
        this.emit('scan-cancelled', event);
        break;

      case 'cycle-done':
        this.state = 'ready';
        this.emit('cycle-done', event);
        break;

      default:
        console.log(
          `[ScannerSubprocess:${this.scannerId}] Unknown event: ${event.type}`
        );
        break;
    }

    // Also emit as a generic 'event' for the coordinator
    this.emit('event', event);
  }
}
