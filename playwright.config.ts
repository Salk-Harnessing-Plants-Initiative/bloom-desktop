import { defineConfig } from '@playwright/test';
import * as dotenv from 'dotenv';

// Load environment variables from .env.e2e
dotenv.config({ path: '.env.e2e' });

// CRITICAL: Clear ELECTRON_RUN_AS_NODE to fix Playwright Electron launch failures
//
// Root Cause: VS Code-based tools (Claude Code extension, VS Code tasks, etc.) set
// ELECTRON_RUN_AS_NODE=1 in their child process environment. This makes Electron run
// as plain Node.js instead of a full Electron app, causing it to reject Chromium-specific
// flags like --remote-debugging-port=0 that Playwright hardcodes.
//
// Symptoms: "bad option: --remote-debugging-port=0" error when running E2E tests
// from VS Code integrated terminal or VS Code extensions.
//
// This was previously misattributed to "packaged apps" or "CI environments" in docs,
// but the actual cause is this environment variable inheritance from VS Code.
//
// See: https://github.com/microsoft/playwright/issues/32027
// See: openspec/changes/archive/2025-11-05-add-e2e-testing-framework/design.md (Issue 12)
if (process.env.ELECTRON_RUN_AS_NODE) {
  delete process.env.ELECTRON_RUN_AS_NODE;
}

/**
 * Playwright configuration for E2E testing of Bloom Desktop Electron app.
 *
 * Based on bloom-desktop-pilot's Playwright setup:
 * - Tests run sequentially (1 worker) to avoid conflicts
 * - 60-second timeout per test for Electron app startup
 * - Failure artifacts (traces, screenshots, videos) captured
 * - Test file pattern: *.e2e.ts
 *
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  // Test directory configuration
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts', // Only run .e2e.ts files
  testIgnore: ['**/*.test.ts', '**/*.spec.ts'], // Exclude unit/integration test patterns

  // Execution configuration
  timeout: 60000, // 60 seconds per test (Electron app startup can be slow)
  fullyParallel: false, // Run tests sequentially
  workers: 1, // Single worker to avoid conflicts with Electron instances

  // Retry configuration
  retries: process.env.CI ? 1 : 0, // Retry once in CI, no retries locally

  // Reporter configuration
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'], // Console output
  ],

  // Global test configuration
  use: {
    // Capture failure artifacts
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    // Headless mode: true in CI for performance, false locally for debugging
    headless: process.env.CI ? true : false,
  },
});
