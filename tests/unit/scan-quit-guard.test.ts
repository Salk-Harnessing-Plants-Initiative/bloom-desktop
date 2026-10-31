import { describe, it, expect, vi } from 'vitest';
import { createScanQuitGuard } from '../../src/main/scan-quit-guard';

function setup(scanning: boolean, quitAnyway: boolean) {
  const askToQuit = vi.fn(() => quitAnyway);
  const guard = createScanQuitGuard({
    isScanInProgress: () => scanning,
    askToQuit,
  });
  return { guard, askToQuit };
}

describe('scan quit guard', () => {
  it('lets the app quit without asking when no scan is running', () => {
    const { guard, askToQuit } = setup(false, false);

    expect(guard.mayQuit()).toBe(true);
    expect(askToQuit).not.toHaveBeenCalled();
  });

  it('keeps the app open when the operator keeps scanning, and asks again next time', () => {
    const { guard, askToQuit } = setup(true, false);

    expect(guard.mayQuit()).toBe(false);
    expect(guard.mayQuit()).toBe(false);
    expect(askToQuit).toHaveBeenCalledTimes(2);
  });

  it('asks only once when the operator quits anyway', () => {
    const { guard, askToQuit } = setup(true, true);

    expect(guard.mayQuit()).toBe(true);
    expect(guard.mayQuit()).toBe(true);
    expect(askToQuit).toHaveBeenCalledTimes(1);
  });
});
