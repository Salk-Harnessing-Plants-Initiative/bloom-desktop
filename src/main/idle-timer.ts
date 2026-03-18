/**
 * Idle Timer
 *
 * Tracks inactivity in the main process and fires a callback
 * when the configured timeout expires. Used to reset session state
 * to prevent scan misattribution in shared lab environments.
 *
 * The timer:
 * - Resets on explicit activity events (session:set, scanner:initialize)
 * - Pauses during active scans (scanner:scan)
 * - Does NOT reset on page navigation or polling
 */

export interface IdleTimerOptions {
  onIdle: () => void;
  timeoutMs?: number;
}

// Default: 10 minutes. Chosen for shared-lab workflows where phenotypers stay
// near the scanner between plants. Adjust in main.ts if lab setup requires longer.
const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes

export class IdleTimer {
  private readonly onIdle: () => void;
  private readonly timeoutMs: number;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private paused = false;
  private started = false;

  constructor(options: IdleTimerOptions) {
    this.onIdle = options.onIdle;
    const t = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(t) || t <= 0) {
      throw new RangeError(
        `IdleTimer: timeoutMs must be a positive finite number, got ${t}`
      );
    }
    this.timeoutMs = t;
  }

  start(): void {
    this.started = true;
    this.paused = false;
    this.scheduleTimer();
  }

  stop(): void {
    this.clearTimer();
    this.paused = false;
    this.started = false;
  }

  resetTimer(): void {
    if (!this.started || this.paused) return;
    this.scheduleTimer();
  }

  pauseForScan(): void {
    if (!this.started) return;
    this.paused = true;
    this.clearTimer();
  }

  resumeAfterScan(): void {
    if (!this.started || !this.paused) return;
    this.paused = false;
    this.scheduleTimer();
  }

  private scheduleTimer(): void {
    this.clearTimer();
    this.timerId = setTimeout(() => {
      this.timerId = null;
      this.onIdle();
    }, this.timeoutMs);
  }

  private clearTimer(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
}
