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
      isDestroyed: () => false,
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
      isDestroyed: () => false,
      isMinimized: () => false,
      restore,
      focus,
    } as unknown as import('electron').BrowserWindow;

    focusExistingWindow(win);

    expect(restore).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('does not throw and is a no-op when the window has been destroyed', () => {
    // On macOS, window-all-closed does not quit the app (main.ts), so
    // mainWindow stays non-null but destroyed after the user closes it.
    // A second launch attempt then fires second-instance against this
    // destroyed-but-non-null window — isMinimized()/focus() throw on a
    // destroyed BrowserWindow, so isDestroyed() must be checked first,
    // before either of them is ever called.
    const isMinimized = vi.fn(() => {
      throw new Error('Object has been destroyed');
    });
    const restore = vi.fn();
    const focus = vi.fn(() => {
      throw new Error('Object has been destroyed');
    });
    const win = {
      isDestroyed: () => true,
      isMinimized,
      restore,
      focus,
    } as unknown as import('electron').BrowserWindow;

    expect(() => focusExistingWindow(win)).not.toThrow();
    expect(isMinimized).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });
});
