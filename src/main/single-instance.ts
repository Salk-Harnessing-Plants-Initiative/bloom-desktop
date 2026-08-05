/**
 * Single Instance Lock helpers (#249)
 *
 * Extracted as small pure/near-pure functions so main.ts's startup
 * sequence around `app.requestSingleInstanceLock()` is testable without
 * spinning up a real second Electron process.
 */

import type { BrowserWindow } from 'electron';

export function shouldQuitAsSecondInstance(hasLock: boolean): boolean {
  return !hasLock;
}

export function focusExistingWindow(win: BrowserWindow | null): void {
  // A destroyed-but-non-null mainWindow is a real state, not a
  // theoretical one: on macOS, window-all-closed does not quit the app
  // (main.ts), so mainWindow stays non-null after the user closes it.
  // isMinimized()/focus() throw on a destroyed BrowserWindow, so this
  // must be checked before either is called.
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) {
    win.restore();
  }
  win.focus();
}
