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
 */

import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import { scanLog } from './scan-logger';
import * as readline from 'readline';

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
  args: BuildSubprocessEnvArgs,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...args.processEnv,
    PYTHONPATH: [args.pythonExtraPath, args.processEnv.PYTHONPATH]
      .filter(Boolean)
      .join(':'),
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
        `Invalid saneName format (expected at least 4 colon-separated tokens): ${args.saneName}`,
      );
    }
    const usbBus = parts[2];
    const usbDev = parts[3];
    if (!/^\d{3}$/.test(usbBus) || !/^\d{3}$/.test(usbDev)) {
      throw new Error(
        `Invalid saneName USB bus/address (expected 3-digit decimal): ${args.saneName}`,
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

/**
 * Components from which the coordinator composes the per-cycle output path.
 * The renderer creates `output_dir` upfront via `graviscan:ensure-dir` and
 * passes these components — no pre-baked `output_path` string is mutated.
 */
export interface PlateConfig {
  plate_index: string;
  grid_mode: string;
  resolution: number;
  output_dir: string;
  exp_name: string;
  session_timestamp: string; // YYYYMMDDTHHmmss
  wave_number: number;
  scanner_tag: string; // e.g. "Sc1"
  system_prefix: string; // e.g. "" or "GS1_"
  phenotyper_name: string; // embedded in TIFF ImageDescription JSON
}

/**
 * Shape sent to the Python scan worker on stdin. Carries the same
 * components as PlateConfig plus the per-cycle `cycle` number and
 * `st_timestamp`. The Python worker composes the final filename
 * (including `_et_`) at save time — no path is ever pre-baked in TS.
 */
export interface ScanWorkerPlate {
  plate_index: string;
  grid_mode: string;
  resolution: number;
  output_dir: string;
  exp_name: string;
  st_timestamp: string;
  wave_number: number;
  scanner_tag: string;
  system_prefix: string;
  cycle: number;
  phenotyper_name: string;
}

export interface ScanWorkerEvent {
  type: string;
  scanner_id: string;
  plate_index?: string;
  job_id?: string;
  path?: string;
  duration_ms?: number;
  error?: string;
  cycle?: number;
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

    // In production (PyInstaller bundle): bloom-hardware --scan-worker --scanner-id ...
    // In development (Python interpreter): python -m graviscan.scan_worker --scanner-id ...
    const args = this.isPackaged
      ? ['--scan-worker', '--scanner-id', this.scannerId]
      : ['-m', 'graviscan.scan_worker', '--scanner-id', this.scannerId];
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
    const stderrRl = readline.createInterface({ input: this.proc.stderr! });
    stderrRl.on('line', (line) => {
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

    this.proc.on('error', (err) => {
      console.error(
        `[ScannerSubprocess:${this.scannerId}] Process error:`,
        err
      );
      this.state = 'dead';
      this.emit('error', { scannerId: this.scannerId, error: err.message });
    });

    // Wait for ready signal (no timeout — SANE open can be slow with some backends)
    return new Promise<void>((resolve, reject) => {
      const onReady = () => {
        this.removeListener('ready', onReady);
        this.removeListener('init-error', onError);
        this.removeListener('exit', onExit);
        resolve();
      };

      const onError = (event: ScanWorkerEvent) => {
        this.removeListener('ready', onReady);
        this.removeListener('init-error', onError);
        this.removeListener('exit', onExit);
        reject(
          new Error(`Scanner ${this.scannerId} init failed: ${event.error}`)
        );
      };

      const onExit = (info: { scannerId: string; code: number | null }) => {
        this.removeListener('ready', onReady);
        this.removeListener('init-error', onError);
        this.removeListener('exit', onExit);
        reject(
          new Error(
            `Scanner ${this.scannerId} process exited (code ${info.code}) before becoming ready`
          )
        );
      };

      this.on('ready', onReady);
      this.on('init-error', onError);
      this.on('exit', onExit);
    });
  }

  /**
   * Send a scan command for a batch of plates.
   * Plates already carry their final `output_path` for this cycle — composed
   * by the coordinator. Returns immediately — listen for events to track
   * progress.
   */
  scan(plates: ScanWorkerPlate[]): void {
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
    if (this.proc && !this.proc.killed) {
      this.proc.kill('SIGKILL');
    }
    this.state = 'dead';
  }

  /**
   * Quit gracefully, then force-kill after timeout.
   */
  async shutdown(timeoutMs = 5000): Promise<void> {
    if (!this.proc || this.state === 'dead') return;

    this.quit();

    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.warn(
          `[ScannerSubprocess:${this.scannerId}] Force-killing after timeout`
        );
        this.kill();
        resolve();
      }, timeoutMs);

      this.proc!.on('exit', () => {
        clearTimeout(timeout);
        resolve();
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
      console.error(
        `[ScannerSubprocess:${this.scannerId}] Invalid EVENT JSON: ${jsonStr}`
      );
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
