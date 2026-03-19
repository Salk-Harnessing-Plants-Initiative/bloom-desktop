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
// Types
// =============================================================================

export interface PlateConfig {
  plate_index: string;
  grid_mode: string;
  resolution: number;
  output_path: string;
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

    this.proc = spawn(this.pythonPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        // In dev: ensure `python/` is on PYTHONPATH so `-m graviscan.scan_worker` resolves
        PYTHONPATH: [path.join(process.cwd(), 'python'), process.env.PYTHONPATH]
          .filter(Boolean)
          .join(':'),
      },
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
