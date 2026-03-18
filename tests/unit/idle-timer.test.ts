/**
 * Unit Tests: Idle Timer
 *
 * Tests the idle timer module that resets session state after
 * inactivity to prevent scan misattribution in shared labs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IdleTimer } from '../../src/main/idle-timer';

const DEFAULT_TIMEOUT = 600_000; // 10 minutes

describe('IdleTimer', () => {
  let timer: IdleTimer;
  let onIdleSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    onIdleSpy = vi.fn();
    timer = new IdleTimer({ onIdle: onIdleSpy });
  });

  afterEach(() => {
    timer.stop();
    vi.useRealTimers();
  });

  // 1.1.1 Timer starts on first activity event
  describe('start', () => {
    it('should start the timer on first activity event', () => {
      timer.start();

      // Advance just under the timeout — should NOT fire
      vi.advanceTimersByTime(DEFAULT_TIMEOUT - 1);
      expect(onIdleSpy).not.toHaveBeenCalled();

      // Advance past the timeout — should fire
      vi.advanceTimersByTime(1);
      expect(onIdleSpy).toHaveBeenCalledTimes(1);
    });
  });

  // 1.1.2 Timer resets when session:set is called
  describe('resetTimer', () => {
    it('should restart the countdown when resetTimer is called', () => {
      timer.start();

      // Advance halfway
      vi.advanceTimersByTime(DEFAULT_TIMEOUT / 2);
      expect(onIdleSpy).not.toHaveBeenCalled();

      // Reset the timer
      timer.resetTimer();

      // Advance another half — should NOT fire (timer was reset)
      vi.advanceTimersByTime(DEFAULT_TIMEOUT / 2);
      expect(onIdleSpy).not.toHaveBeenCalled();

      // Advance to full timeout from reset — should fire
      vi.advanceTimersByTime(DEFAULT_TIMEOUT / 2);
      expect(onIdleSpy).toHaveBeenCalledTimes(1);
    });
  });

  // 1.1.3 Timer resets when scanner:initialize is called
  it('should reset on scanner initialize (same as resetTimer)', () => {
    timer.start();

    vi.advanceTimersByTime(DEFAULT_TIMEOUT - 100);
    timer.resetTimer(); // simulates scanner:initialize call

    vi.advanceTimersByTime(DEFAULT_TIMEOUT - 1);
    expect(onIdleSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onIdleSpy).toHaveBeenCalledTimes(1);
  });

  // 1.1.4 Timer fires callback after configured timeout with no activity
  it('should fire onIdle after timeout with no activity', () => {
    timer.start();

    vi.advanceTimersByTime(DEFAULT_TIMEOUT);
    expect(onIdleSpy).toHaveBeenCalledTimes(1);
  });

  // 1.1.5 Timer does NOT fire during an active scan
  describe('pauseForScan / resumeAfterScan', () => {
    it('should NOT fire while paused for scan', () => {
      timer.start();
      timer.pauseForScan();

      // Advance well past timeout
      vi.advanceTimersByTime(DEFAULT_TIMEOUT * 3);
      expect(onIdleSpy).not.toHaveBeenCalled();
    });

    // 1.1.6 Timer resumes after scan completes
    it('should resume countdown after scan completes', () => {
      timer.start();
      timer.pauseForScan();

      // Advance past timeout while paused — should not fire
      vi.advanceTimersByTime(DEFAULT_TIMEOUT * 2);
      expect(onIdleSpy).not.toHaveBeenCalled();

      // Resume
      timer.resumeAfterScan();

      // Should now count down from fresh timeout
      vi.advanceTimersByTime(DEFAULT_TIMEOUT - 1);
      expect(onIdleSpy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(onIdleSpy).toHaveBeenCalledTimes(1);
    });
  });

  // 1.1.7 Timer does NOT reset on non-activity events
  it('should not provide any automatic reset for page navigation or polling', () => {
    // The timer only resets via explicit resetTimer() calls.
    // Non-activity events simply don't call resetTimer().
    // This test verifies the timer fires if no resetTimer() is called.
    timer.start();

    vi.advanceTimersByTime(DEFAULT_TIMEOUT);
    expect(onIdleSpy).toHaveBeenCalledTimes(1);
  });

  // 1.1.8 Configurable timeout duration
  describe('configurable timeout', () => {
    it('should default to 10 minutes (600000ms)', () => {
      timer.start();

      vi.advanceTimersByTime(599_999);
      expect(onIdleSpy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(onIdleSpy).toHaveBeenCalledTimes(1);
    });

    it('should respect custom timeout value', () => {
      const customTimer = new IdleTimer({
        onIdle: onIdleSpy,
        timeoutMs: 5000,
      });

      customTimer.start();

      vi.advanceTimersByTime(4999);
      expect(onIdleSpy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(onIdleSpy).toHaveBeenCalledTimes(1);

      customTimer.stop();
    });
  });

  // 1.1.9 Timer can be stopped and restarted
  describe('stop', () => {
    it('should cancel the timer when stopped', () => {
      timer.start();
      timer.stop();

      vi.advanceTimersByTime(DEFAULT_TIMEOUT * 5);
      expect(onIdleSpy).not.toHaveBeenCalled();
    });

    it('should be restartable after stop', () => {
      timer.start();
      timer.stop();
      timer.start();

      vi.advanceTimersByTime(DEFAULT_TIMEOUT);
      expect(onIdleSpy).toHaveBeenCalledTimes(1);
    });
  });

  // 1.1.10 Multiple rapid activity events only create one timer
  describe('debounce / reset behavior', () => {
    it('should only have one active timer after multiple rapid resets', () => {
      timer.start();

      // Rapid-fire resets
      timer.resetTimer();
      timer.resetTimer();
      timer.resetTimer();
      timer.resetTimer();

      // Only one callback should fire after timeout
      vi.advanceTimersByTime(DEFAULT_TIMEOUT);
      expect(onIdleSpy).toHaveBeenCalledTimes(1);
    });
  });

  // Edge case: calling methods before start
  describe('edge cases', () => {
    it('should not start the timer if resetTimer is called before start', () => {
      timer.resetTimer();

      vi.advanceTimersByTime(DEFAULT_TIMEOUT * 2);
      expect(onIdleSpy).not.toHaveBeenCalled();
    });

    it('should be a no-op when resetTimer is called while paused', () => {
      timer.start();
      timer.pauseForScan();
      timer.resetTimer();

      // Advance well past timeout — should not fire because still paused
      vi.advanceTimersByTime(DEFAULT_TIMEOUT * 3);
      expect(onIdleSpy).not.toHaveBeenCalled();

      // Resume and verify timer fires normally
      timer.resumeAfterScan();
      vi.advanceTimersByTime(DEFAULT_TIMEOUT);
      expect(onIdleSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle pauseForScan before start gracefully', () => {
      timer.pauseForScan();

      vi.advanceTimersByTime(DEFAULT_TIMEOUT * 2);
      expect(onIdleSpy).not.toHaveBeenCalled();
    });

    it('should handle stop before start gracefully', () => {
      timer.stop();

      vi.advanceTimersByTime(DEFAULT_TIMEOUT * 2);
      expect(onIdleSpy).not.toHaveBeenCalled();
    });

    it('should not fire callback after being stopped mid-countdown', () => {
      timer.start();
      vi.advanceTimersByTime(DEFAULT_TIMEOUT / 2);
      timer.stop();
      vi.advanceTimersByTime(DEFAULT_TIMEOUT);
      expect(onIdleSpy).not.toHaveBeenCalled();
    });

    it('should not schedule a timer when resumeAfterScan is called before start', () => {
      timer.resumeAfterScan();

      vi.advanceTimersByTime(DEFAULT_TIMEOUT * 2);
      expect(onIdleSpy).not.toHaveBeenCalled();
    });

    it('should not schedule a timer when resumeAfterScan is called after stop', () => {
      timer.start();
      timer.stop();
      timer.resumeAfterScan();

      vi.advanceTimersByTime(DEFAULT_TIMEOUT * 2);
      expect(onIdleSpy).not.toHaveBeenCalled();
    });

    // 6.6 Regression guard: onIdle fires exactly once per timeout cycle
    // Note: setTimeout is single-fire by design — this test documents that contract
    // and guards against future refactors to setInterval.
    it('6.6 onIdle fires exactly once even when time advances well past timeout', () => {
      timer.start();

      vi.advanceTimersByTime(DEFAULT_TIMEOUT * 3);
      expect(onIdleSpy).toHaveBeenCalledTimes(1);
    });

    // 6.7.1 Regression guard: pauseForScan before start, then start fires normally
    // Note: start() resets paused=false unconditionally, so the zombie state does
    // not exist — this test documents the contract and guards against future changes
    // to start() that might not reset the paused flag.
    it('6.7.1 pauseForScan() before start() does not prevent timer from firing after start()', () => {
      timer.pauseForScan();
      timer.start();

      vi.advanceTimersByTime(DEFAULT_TIMEOUT - 1);
      expect(onIdleSpy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(onIdleSpy).toHaveBeenCalledTimes(1);
    });

    // 3.4.1 / 9.5.1 constructor throws RangeError on invalid timeoutMs
    it('should throw RangeError on zero timeoutMs', () => {
      expect(() => new IdleTimer({ onIdle: onIdleSpy, timeoutMs: 0 })).toThrow(
        RangeError
      );
    });

    it('should throw RangeError on negative timeoutMs', () => {
      expect(
        () => new IdleTimer({ onIdle: onIdleSpy, timeoutMs: -1000 })
      ).toThrow(RangeError);
    });

    it('should throw RangeError on NaN timeoutMs', () => {
      expect(
        () => new IdleTimer({ onIdle: onIdleSpy, timeoutMs: NaN })
      ).toThrow(RangeError);
    });

    // 5.1.1 After stop(), resetTimer() is a no-op — timer does NOT restart.
    // This documents why session:reset must NOT call stop(): if it does, subsequent
    // session:set / scanner:initialize calls via resetTimer() will never restart the timer.
    it('5.1.1 resetTimer is a no-op after stop — timer does not restart', () => {
      timer.start();
      timer.stop();

      // Simulates session:set calling resetTimer() after session:reset called stop()
      timer.resetTimer();

      // Timer should NOT fire — it was stopped and resetTimer is a no-op when !started
      vi.advanceTimersByTime(DEFAULT_TIMEOUT * 2);
      expect(onIdleSpy).not.toHaveBeenCalled();
    });

    // 3.1.1 resumeAfterScan without prior pauseForScan must not reset countdown
    it('should not reset countdown when resumeAfterScan is called without pauseForScan', () => {
      timer.start();

      // Advance halfway through the timeout
      vi.advanceTimersByTime(DEFAULT_TIMEOUT / 2);
      expect(onIdleSpy).not.toHaveBeenCalled();

      // Call resumeAfterScan without a prior pauseForScan (simulates scanner:scan
      // throwing before pauseForScan, with finally calling resumeAfterScan)
      timer.resumeAfterScan();

      // The original countdown should NOT have been reset — it should fire
      // after the remaining half of the timeout, not a full timeout from now
      vi.advanceTimersByTime(DEFAULT_TIMEOUT / 2);
      expect(onIdleSpy).toHaveBeenCalledTimes(1);
    });
  });
});
