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
import {
  setSessionState,
  resetSessionState,
  hasSessionData,
} from '../../src/main/session-store';

const TIMEOUT_MS = 1000; // short timeout for tests

describe('Main process onIdle callback integration', () => {
  let sendSpy: ReturnType<typeof vi.fn>;
  let timer: IdleTimer;

  beforeEach(() => {
    vi.useFakeTimers();
    resetSessionState();
    sendSpy = vi.fn();

    // Replicate the onIdle closure from main.ts
    timer = new IdleTimer({
      timeoutMs: TIMEOUT_MS,
      onIdle: () => {
        if (!hasSessionData()) return;
        resetSessionState();
        sendSpy('session:idle-reset');
      },
    });
    timer.start();
  });

  afterEach(() => {
    timer.stop();
    vi.useRealTimers();
  });

  // 6.4.1 Failing test: onIdle with empty session → no reset, no IPC send
  it('6.4.1 onIdle does NOT call resetSessionState or send IPC when session is empty', () => {
    // Session is already empty (all null from beforeEach reset)
    expect(hasSessionData()).toBe(false);

    vi.advanceTimersByTime(TIMEOUT_MS);

    // Neither action should have been taken
    expect(sendSpy).not.toHaveBeenCalled();
    // Session is still empty (resetSessionState was not called)
    expect(hasSessionData()).toBe(false);
  });

  it('onIdle DOES call resetSessionState and send IPC when session has data', () => {
    setSessionState({ phenotyperId: 'pheno-1', experimentId: 'exp-1' });
    expect(hasSessionData()).toBe(true);

    vi.advanceTimersByTime(TIMEOUT_MS);

    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy).toHaveBeenCalledWith('session:idle-reset');
    // Session was reset
    expect(hasSessionData()).toBe(false);
  });
});
