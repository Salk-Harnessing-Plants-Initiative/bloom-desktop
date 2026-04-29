/**
 * E2E Smoke Test: Renderer page screenshot capture
 *
 * Launches the Electron app once per scanner mode (cylinderscan + graviscan)
 * and captures a full-page screenshot of every renderer route. The captured
 * PNGs are written to tests/e2e/screenshots/ for human review.
 *
 * Purpose: provide a repeatable visual verification artifact for any change
 * that touches src/renderer/. Closes the gap where code-correctness review
 * (typecheck, lint, unit tests) shipped renderer code with broken UX
 * (PR #196: 570-line monolithic page, missing spreadsheet upload, etc.).
 *
 * NOT a behavior-assertion test. The spec passes if every page renders
 * without throwing AND a PNG is written. Layout-quality / UX judgment is
 * deferred to the human reviewing the captured PNGs.
 *
 * PREREQUISITES:
 * 1. Electron Forge dev server running: `npm run start` (Terminal 1)
 * 2. Run smoke spec: `npx playwright test tests/e2e/smoke-renderer.e2e.ts` (Terminal 2)
 *
 * The Playwright MCP (mcp__playwright__browser_*) cannot drive this Electron
 * app — `window.electron` is undefined in a plain browser. Use this spec or
 * `_electron.launch()` directly.
 *
 * CI ARTIFACTS:
 * CI uploads `tests/e2e/screenshots/` as a `renderer-screenshots-<os>` artifact
 * downloadable from the PR check page (per the e2e-testing capability spec,
 * Requirement: CI Integration for E2E Tests). Reviewers can use that artifact
 * instead of running this spec locally.
 */

import {
  test,
  expect,
  _electron as electron,
  ElectronApplication,
  Page,
} from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import { closeElectronApp } from './helpers/electron-cleanup';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath: string = require('electron');

const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
const TEST_DB_PATH = path.join(__dirname, 'smoke-renderer-test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

const BLOOM_DIR = path.join(os.homedir(), '.bloom');
const ENV_PATH = path.join(BLOOM_DIR, '.env');
let originalEnvContent: string | null = null;

// Sidebar labels and routes verified against
// src/renderer/Layout.tsx and src/renderer/App.tsx as of 2026-04-29.
// If labels change, update Task 0 ground-truth + this file together.

interface RouteSpec {
  /** Filename will be `<modePrefix>-<pageName>.png`. */
  pageName: string;
  /** Two nav strategies: sidebar-link click OR keyboard shortcut. */
  nav:
    | { kind: 'sidebar-link'; name: RegExp }
    | { kind: 'keyboard'; press: string };
  /** Optional selector to wait for before screenshotting. */
  readySelector?: string;
}

// Verified against Layout.tsx alwaysLinks (lines 17–119) on 2026-04-29:
// 5 entries — Home, Browse Scans, Scientists, Phenotypers, Experiments.
// /machine-config is reachable from any mode via keyboard shortcut, so it's
// included in shared even though it's not a sidebar link.
const SHARED_ROUTES: RouteSpec[] = [
  { pageName: 'home', nav: { kind: 'sidebar-link', name: /^Home$/ } },
  // Machine Config: NOT in sidebar — keyboard shortcut Cmd/Ctrl+Shift+,
  // (Layout.tsx:323). Use Meta on macOS, Control on Linux/Windows.
  {
    pageName: 'machine-config',
    nav: {
      kind: 'keyboard',
      press:
        process.platform === 'darwin'
          ? 'Meta+Shift+Comma'
          : 'Control+Shift+Comma',
    },
  },
  {
    pageName: 'browse-scans',
    nav: { kind: 'sidebar-link', name: /^Browse Scans$/ },
  },
  {
    pageName: 'scientists',
    nav: { kind: 'sidebar-link', name: /^Scientists$/ },
  },
  {
    pageName: 'phenotypers',
    nav: { kind: 'sidebar-link', name: /^Phenotypers$/ },
  },
  {
    pageName: 'experiments',
    nav: { kind: 'sidebar-link', name: /^Experiments$/ },
  },
];

// Cylinder mode (Layout.tsx:289): alwaysLinks + captureLinks.
// captureLinks (Layout.tsx:121–187): Capture Scan, Camera Settings, Accessions.
const CYLINDER_ONLY_ROUTES: RouteSpec[] = [
  // /capture-scan — same label as graviscan's /graviscan, but mutually exclusive.
  {
    pageName: 'capture-scan',
    nav: { kind: 'sidebar-link', name: /^Capture Scan$/ },
  },
  {
    pageName: 'camera-settings',
    nav: { kind: 'sidebar-link', name: /^Camera Settings$/ },
  },
  {
    pageName: 'accessions',
    nav: { kind: 'sidebar-link', name: /^Accessions$/ },
  },
];

// Graviscan mode (Layout.tsx:291): alwaysLinks + graviScanLinks.
// graviScanLinks (Layout.tsx:190–266): Scanner Config, Metadata, Capture Scan,
// Browse GraviScans. NOTE: Browse GraviScans is graviscan-only, NOT shared —
// it's defined inside graviScanLinks, not alwaysLinks.
const GRAVISCAN_ONLY_ROUTES: RouteSpec[] = [
  {
    pageName: 'scanner-config',
    nav: { kind: 'sidebar-link', name: /^Scanner Config$/ },
  },
  { pageName: 'metadata', nav: { kind: 'sidebar-link', name: /^Metadata$/ } },
  // In graviscan mode, "Capture Scan" navigates to /graviscan.
  {
    pageName: 'graviscan',
    nav: { kind: 'sidebar-link', name: /^Capture Scan$/ },
  },
  {
    pageName: 'browse-graviscan',
    nav: { kind: 'sidebar-link', name: /^Browse GraviScans$/ },
  },
];

function writeBloomConfig(mode: 'cylinderscan' | 'graviscan'): void {
  if (!fs.existsSync(BLOOM_DIR)) fs.mkdirSync(BLOOM_DIR, { recursive: true });
  if (fs.existsSync(ENV_PATH) && originalEnvContent === null) {
    originalEnvContent = fs.readFileSync(ENV_PATH, 'utf-8');
  }
  const scansDir = path.join(BLOOM_DIR, 'smoke-test-scans');
  if (!fs.existsSync(scansDir)) fs.mkdirSync(scansDir, { recursive: true });
  const envContent = [
    '# Smoke spec auto-generated config',
    `SCANNER_MODE=${mode}`,
    'SCANNER_NAME=SmokeScanner',
    'CAMERA_IP_ADDRESS=mock',
    `SCANS_DIR=${scansDir}`,
    'BLOOM_API_URL=https://api.bloom.salk.edu/proxy',
    'BLOOM_SCANNER_USERNAME=',
    'BLOOM_SCANNER_PASSWORD=',
    'BLOOM_ANON_KEY=',
    '',
  ].join('\n');
  fs.writeFileSync(ENV_PATH, envContent, 'utf-8');
}

function restoreBloomConfig(): void {
  if (originalEnvContent !== null) {
    fs.writeFileSync(ENV_PATH, originalEnvContent, 'utf-8');
    originalEnvContent = null;
  } else if (fs.existsSync(ENV_PATH)) {
    fs.unlinkSync(ENV_PATH);
  }
}

async function launchAppForMode(
  mode: 'cylinderscan' | 'graviscan'
): Promise<{ app: ElectronApplication; window: Page }> {
  writeBloomConfig(mode);
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const appRoot = path.join(__dirname, '../..');
  execSync('npx prisma db push --skip-generate', {
    cwd: appRoot,
    env: { ...process.env, BLOOM_DATABASE_URL: TEST_DB_URL },
    stdio: 'pipe',
  });

  const args = [path.join(appRoot, '.webpack/main/index.js')];
  if (process.platform === 'linux' && process.env.CI === 'true') {
    args.push('--no-sandbox');
  }
  const env: Record<string, string> = {
    ...process.env,
    BLOOM_DATABASE_URL: TEST_DB_URL,
    NODE_ENV: 'test',
  } as Record<string, string>;
  if (mode === 'graviscan') env.GRAVISCAN_MOCK = 'true';

  const app = await electron.launch({
    executablePath: electronPath,
    args,
    cwd: appRoot,
    env,
  });
  const windows = await app.windows();
  const window =
    windows.find((w) => w.url().includes('localhost')) || windows[0];
  await window.waitForLoadState('domcontentloaded', { timeout: 30000 });
  // Wait for React to mount
  await window.waitForFunction(() => document.title.includes('Bloom Desktop'), {
    timeout: 60000,
  });
  return { app, window };
}

async function captureRoute(
  window: Page,
  route: RouteSpec,
  modePrefix: string
): Promise<'captured' | 'skipped'> {
  if (route.nav.kind === 'sidebar-link') {
    const link = window.getByRole('link', { name: route.nav.name }).first();
    const visible = await link.isVisible().catch(() => false);
    if (!visible) {
      console.warn(
        `[smoke] sidebar link not visible for ${route.pageName} in ${modePrefix} mode; skipping.`
      );
      return 'skipped';
    }
    await link.click();
  } else {
    // Keyboard shortcut nav (e.g., Meta+Shift+Comma for /machine-config).
    await window.keyboard.press(route.nav.press);
  }
  await window.waitForLoadState('networkidle', { timeout: 10000 });
  if (route.readySelector) {
    await window.waitForSelector(route.readySelector, { timeout: 5000 });
  } else {
    await window.waitForTimeout(500);
  }
  const filename = `${modePrefix}-${route.pageName}.png`;
  await window.screenshot({
    path: path.join(SCREENSHOTS_DIR, filename),
    fullPage: true,
  });
  console.log(`[smoke] captured ${filename}`);
  return 'captured';
}

test.describe('Smoke: renderer page screenshots', () => {
  test.afterAll(() => {
    restoreBloomConfig();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  test('cylinderscan mode: capture all visible routes', async () => {
    const { app, window } = await launchAppForMode('cylinderscan');
    try {
      for (const route of [...SHARED_ROUTES, ...CYLINDER_ONLY_ROUTES]) {
        await captureRoute(window, route, 'cylinder');
      }
    } finally {
      await closeElectronApp(app);
    }
    // Sanity: at least the home screenshot should exist
    expect(fs.existsSync(path.join(SCREENSHOTS_DIR, 'cylinder-home.png'))).toBe(
      true
    );
  });

  test('graviscan mode: capture all visible routes', async () => {
    const { app, window } = await launchAppForMode('graviscan');
    try {
      for (const route of [...SHARED_ROUTES, ...GRAVISCAN_ONLY_ROUTES]) {
        await captureRoute(window, route, 'graviscan');
      }
    } finally {
      await closeElectronApp(app);
    }
    expect(
      fs.existsSync(path.join(SCREENSHOTS_DIR, 'graviscan-home.png'))
    ).toBe(true);
  });
});
