/**
 * Unit Tests: Single Instance Lock helpers (#249)
 *
 * Extracted as small pure/near-pure functions so the single-instance-lock
 * startup logic is testable without spinning up a real second Electron
 * process.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  shouldQuitAsSecondInstance,
  focusExistingWindow,
} from '../../src/main/single-instance';

describe('shouldQuitAsSecondInstance', () => {
  it('returns true when the lock was not acquired', () => {
    expect(shouldQuitAsSecondInstance(false)).toBe(true);
  });

  it('returns false when the lock was acquired', () => {
    expect(shouldQuitAsSecondInstance(true)).toBe(false);
  });
});

describe('focusExistingWindow', () => {
  it('does not throw and is a no-op when the window is null', () => {
    expect(() => focusExistingWindow(null)).not.toThrow();
  });

  it('restores a minimized window, then focuses it', () => {
    const restore = vi.fn();
    const focus = vi.fn();
    const win = {
      isMinimized: () => true,
      restore,
      focus,
    } as unknown as import('electron').BrowserWindow;

    focusExistingWindow(win);

    expect(restore).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('focuses a non-minimized window without restoring it', () => {
    const restore = vi.fn();
    const focus = vi.fn();
    const win = {
      isMinimized: () => false,
      restore,
      focus,
    } as unknown as import('electron').BrowserWindow;

    focusExistingWindow(win);

    expect(restore).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledTimes(1);
  });
});
