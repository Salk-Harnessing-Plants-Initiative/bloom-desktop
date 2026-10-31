import { describe, it, expect, vi } from 'vitest';
import { createScanQuitGuard } from '../../src/main/scan-quit-guard';

function setup(scanning: boolean) {
  let answer: (quitAnyway: boolean) => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const askToQuit = vi.fn(
    () =>
      new Promise<boolean>((resolve, reject) => {
        answer = resolve;
        fail = reject;
      })
  );
  const quit = vi.fn();
  const log = vi.fn();
  const guard = createScanQuitGuard({
    isScanInProgress: () => scanning,
    askToQuit,
    quit,
    log,
  });
  return {
    guard,
    askToQuit,
    quit,
    log,
    answer: async (quitAnyway: boolean) => {
      answer(quitAnyway);
      await new Promise((resolve) => setImmediate(resolve));
    },
    fail: async (error: Error) => {
      fail(error);
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

describe('scan quit guard', () => {
  it('lets the app quit without asking when no scan is running', () => {
    const { guard, askToQuit } = setup(false);

    expect(guard.mayQuit()).toBe(true);
    expect(askToQuit).not.toHaveBeenCalled();
  });

  it('refuses at once during a scan, without waiting for the answer', () => {
    const { guard, askToQuit, quit } = setup(true);

    expect(guard.mayQuit()).toBe(false);
    expect(askToQuit).toHaveBeenCalledTimes(1);
    expect(quit).not.toHaveBeenCalled();
  });

  it('asks only once while the question is open', () => {
    const { guard, askToQuit } = setup(true);

    guard.mayQuit();
    guard.mayQuit();

    expect(askToQuit).toHaveBeenCalledTimes(1);
  });

  it('stays open when the operator keeps scanning, and asks again next time', async () => {
    const { guard, askToQuit, quit, answer } = setup(true);

    guard.mayQuit();
    await answer(false);

    expect(quit).not.toHaveBeenCalled();
    expect(guard.mayQuit()).toBe(false);
    expect(askToQuit).toHaveBeenCalledTimes(2);
  });

  it('quits when the operator says so, and lets that quit through', async () => {
    const { guard, askToQuit, quit, answer } = setup(true);

    guard.mayQuit();
    await answer(true);

    expect(quit).toHaveBeenCalledTimes(1);
    expect(guard.mayQuit()).toBe(true);
    expect(askToQuit).toHaveBeenCalledTimes(1);
  });

  it('stays open and logs it when the question fails', async () => {
    const { guard, askToQuit, quit, log, fail } = setup(true);

    guard.mayQuit();
    await fail(new Error('No dialog'));

    expect(quit).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('No dialog'));
    expect(guard.mayQuit()).toBe(false);
    expect(askToQuit).toHaveBeenCalledTimes(2);
  });
});
