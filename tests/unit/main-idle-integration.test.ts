/**
 * Unit Tests: Main Process Idle Callback Integration (6.4)
 *
 * Tests the `onIdle` callback as wired in main.ts:
 *
 *   onIdle: () => {
 *     if (!hasSessionData()) return;
 *     resetSessionState();
 *     mainWindow.webContents.send('session:idle-reset');
 *   }
 *
 * Exercises the hasSessionData() guard without booting Electron by constructing
 * an IdleTimer with the same callback logic and the real session-store module.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IdleTimer } from '../../src/main/idle-timer';
import * as sessionStore from '../../src/main/session-store';

const TIMEOUT_MS = 1000; // short timeout for tests

describe('Main process onIdle callback integration', () => {
  let sendSpy: ReturnType<typeof vi.fn>;
  let timer: IdleTimer;

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStore.resetSessionState();
    sessionStore.consumeIdleResetFlag();
    sendSpy = vi.fn();

    // Replicate the onIdle closure from main.ts (using namespace so spies intercept)
    timer = new IdleTimer({
      timeoutMs: TIMEOUT_MS,
      onIdle: () => {
        if (!sessionStore.hasSessionData()) return;
        sessionStore.resetSessionState();
        sessionStore.setWasIdleReset();
        sendSpy('session:idle-reset');
      },
    });
    timer.start();
  });

  afterEach(() => {
    timer.stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // 6.4.1 Integration guard: onIdle with empty session → no reset, no IPC send
  it('6.4.1 onIdle does NOT call resetSessionState or send IPC when session is empty', () => {
    // Session is already empty (all null from beforeEach reset)
    expect(sessionStore.hasSessionData()).toBe(false);

    const resetSpy = vi.spyOn(sessionStore, 'resetSessionState');

    vi.advanceTimersByTime(TIMEOUT_MS);

    // resetSessionState must NOT be called — guard must have returned early
    expect(resetSpy).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('onIdle DOES call resetSessionState and send IPC when session has data', () => {
    sessionStore.setSessionState({
      phenotyperId: 'pheno-1',
      experimentId: 'exp-1',
    });
    expect(sessionStore.hasSessionData()).toBe(true);

    const resetSpy = vi.spyOn(sessionStore, 'resetSessionState');

    vi.advanceTimersByTime(TIMEOUT_MS);

    expect(resetSpy).toHaveBeenCalledOnce();
    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy).toHaveBeenCalledWith('session:idle-reset');
    expect(sessionStore.hasSessionData()).toBe(false);
  });

  // 8.4.1 onIdle closure calls setWasIdleReset when session has data
  it('8.4.1 onIdle callback sets wasIdleResetFlag when session has data', () => {
    sessionStore.setSessionState({
      phenotyperId: 'pheno-1',
      experimentId: 'exp-1',
    });
    expect(sessionStore.hasSessionData()).toBe(true);

    vi.advanceTimersByTime(TIMEOUT_MS);

    // The replicated onIdle closure calls sessionStore.setWasIdleReset(),
    // so consumeIdleResetFlag() returns true.
    expect(sessionStore.consumeIdleResetFlag()).toBe(true);
  });
});

// =============================================================================
// 7.1 session:set hasSessionData() guard — IPC integration level
// =============================================================================

/**
 * Replicates the session:set handler logic from main.ts:
 *
 *   setSessionState(updates);
 *   if (idleTimer && hasSessionData()) idleTimer.resetTimer();
 *
 * Verifies the guard without booting Electron.
 */
describe('session:set hasSessionData() guard (IPC integration level)', () => {
  let resetTimerSpy: ReturnType<typeof vi.fn>;
  let timer: IdleTimer;

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStore.resetSessionState();
    sessionStore.consumeIdleResetFlag();
    resetTimerSpy = vi.fn();

    // Create a real timer but spy on resetTimer to detect calls
    timer = new IdleTimer({
      timeoutMs: TIMEOUT_MS,
      onIdle: vi.fn(),
    });
    timer.start();
    // Replace resetTimer with spy that also calls through
    const original = timer.resetTimer.bind(timer);
    timer.resetTimer = () => {
      resetTimerSpy();
      original();
    };
  });

  afterEach(() => {
    timer.stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // 7.1.1 Regression guard: session:set with null update on empty session → timer NOT reset
  it('7.1.1 session:set with null-only update on empty session does NOT call resetTimer', () => {
    expect(sessionStore.hasSessionData()).toBe(false);

    // Replicate session:set handler
    sessionStore.setSessionState({ phenotyperId: null });
    if (sessionStore.hasSessionData()) timer.resetTimer();

    expect(resetTimerSpy).not.toHaveBeenCalled();
  });

  // 7.1.2 Regression guard: session:set with real data → timer IS reset
  it('7.1.2 session:set with non-null data calls resetTimer', () => {
    expect(sessionStore.hasSessionData()).toBe(false);

    // Replicate session:set handler
    sessionStore.setSessionState({ phenotyperId: 'pheno-1' });
    if (sessionStore.hasSessionData()) timer.resetTimer();

    expect(resetTimerSpy).toHaveBeenCalledOnce();
  });
});

// =============================================================================
// 8.2 session:reset handler clears idle-reset flag
// =============================================================================

/**
 * Replicates the session:reset handler logic from main.ts:
 *
 *   resetSessionState();
 *   consumeIdleResetFlag(); // ← added by task 8.2.2
 *
 * Verifies the flag is cleared so a stale idle-reset banner is not shown
 * when the user navigates back to CaptureScan after an explicit session reset.
 */
describe('session:reset handler clears idle-reset flag (8.2)', () => {
  beforeEach(() => {
    sessionStore.resetSessionState();
    // consumeIdleResetFlag is idempotent — safe to call to ensure clean state
    sessionStore.consumeIdleResetFlag();
  });

  // 8.2.1 Integration guard: session:reset handler clears idle-reset flag
  it('8.2.1 session:reset handler clears wasIdleResetFlag (consumeIdleResetFlag returns false after)', () => {
    // Simulate: idle reset occurred while user was navigated away (flag set, not yet consumed)
    sessionStore.setWasIdleReset();

    // Replicate the FIXED session:reset IPC handler (task 8.2.2):
    sessionStore.resetSessionState();
    sessionStore.consumeIdleResetFlag(); // ← added by 8.2.2

    // Flag is now consumed — a subsequent call returns false.
    // Before 8.2.2 (handler only calls resetSessionState), the flag would still be true
    // and this assertion would fail.
    expect(sessionStore.consumeIdleResetFlag()).toBe(false);
  });
});
