/**
 * E2E Test Helper: App Readiness
 *
 * ROOT CAUSE: `window.waitForLoadState('domcontentloaded')` only waits for
 * the renderer's HTML to parse. It says nothing about the main process's
 * async startup sequence (database connection + `registerDatabaseHandlers()`
 * + GraviScan's own handler registration), which runs concurrently after
 * `createWindow()` returns. A test that starts calling `window.electron.*`
 * IPC methods right after `domcontentloaded` can race a main process that
 * hasn't finished registering all its `ipcMain.handle()` channels yet,
 * surfacing as "No handler registered for '<channel>'" for whichever
 * channel just hadn't been reached — intermittent, and on a channel that
 * looks unrelated to whatever the test is actually about. Observed most
 * often on CI's macOS runners, where startup is slower/more variable, but
 * the race exists on every platform.
 *
 * SOLUTION: Await the main process's own definitive readiness signal
 * (`window.electron.waitUntilReady()`, backed by `app:wait-until-ready` in
 * main.ts) before letting a test proceed.
 */

import { Page } from '@playwright/test';

/**
 * Wait until the main process has finished its startup sequence
 * (database + GraviScan handler registration) before returning.
 *
 * Call this immediately after `window.waitForLoadState('domcontentloaded')`
 * in every E2E spec's app-launch helper — `domcontentloaded` alone is not
 * sufficient (see module doc comment above).
 *
 * @param window - The Playwright Page for the Electron app's main window
 * @param options.timeout - Max time to wait in ms (default: 30000)
 */
export async function waitForAppReady(
  window: Page,
  options: { timeout?: number } = {}
): Promise<void> {
  const { timeout = 30000 } = options;

  const result = await window.evaluate(
    ({ timeoutMs }) => {
      return Promise.race([
        (
          window as unknown as {
            electron: {
              waitUntilReady: () => Promise<{
                success: boolean;
                error?: string;
              }>;
            };
          }
        ).electron.waitUntilReady(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('waitUntilReady() timed out')),
            timeoutMs
          )
        ),
      ]);
    },
    { timeoutMs: timeout }
  );

  if (!result.success) {
    throw new Error(
      `App failed to initialize before tests started: ${result.error ?? 'unknown error'}`
    );
  }
}
