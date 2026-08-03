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
  if (!win) return;
  if (win.isMinimized()) {
    win.restore();
  }
  win.focus();
}
