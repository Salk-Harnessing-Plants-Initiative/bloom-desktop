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
    sendSpy = vi.fn();

    // Replicate the onIdle closure from main.ts (using namespace so spies intercept)
    timer = new IdleTimer({
      timeoutMs: TIMEOUT_MS,
      onIdle: () => {
        if (!sessionStore.hasSessionData()) return;
        sessionStore.resetSessionState();
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
