import { defineConfig } from '@playwright/test';
import * as dotenv from 'dotenv';

// Load environment variables from .env.e2e
dotenv.config({ path: '.env.e2e' });

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
  timeout: 120000, // 120 seconds per test (Electron app startup can be slow, especially on Windows)
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
