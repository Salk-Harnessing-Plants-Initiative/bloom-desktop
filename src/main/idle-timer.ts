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

const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes

export class IdleTimer {
  private readonly onIdle: () => void;
  private readonly timeoutMs: number;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private paused = false;
  private started = false;

  constructor(options: IdleTimerOptions) {
    this.onIdle = options.onIdle;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
