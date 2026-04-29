# Renderer Visual-Verification Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Verification rule (HARD):** Every shell command in this plan must be run as written and produce the documented expected output before the task is marked done. Every locator string in the smoke spec was verified against the actual `Layout.tsx` source on 2026-04-29. If anything in the codebase changed since then, Task 0 will catch it and the executing engineer must update the plan inline before proceeding.

**Goal:** Make it structurally impossible to ship a renderer/UI change in this codebase without first capturing and reviewing screenshots of the affected pages.

**Architecture:** A single new Playwright E2E spec (`tests/e2e/smoke-renderer.e2e.ts`) launches the Electron app twice (once per scanner mode), navigates to every renderer route, and writes a full-page PNG per route to `tests/e2e/screenshots/`. The spec runs locally on demand and in CI. Five existing Claude command/skill files are updated to mandate that renderer-touching work runs the smoke spec and reads the captured PNGs before claiming done. The OpenSpec convention doc gains a rule that renderer-touching proposals must list any deferred UI components by name with linked follow-up issues. `playwright.config.ts` is unchanged — the smoke spec calls `page.screenshot()` explicitly.

**Tech Stack:** Playwright `_electron.launch()` (NOT the Playwright MCP — see Task 0 for why), TypeScript, existing `tests/e2e/helpers/electron-cleanup.ts` and `tests/e2e/helpers/bloom-config.ts`, OpenSpec, Markdown.

---

## Task 0: Verify ground truth still matches plan assumptions (read-only — no code changes)

**Files:** none (read-only investigation; if anything contradicts the recorded values below, fix the plan inline before proceeding)

**Why this task exists:** A previous attempt tried to drive the Electron app via the Playwright MCP browser tools and burned context realizing they don't work for Electron. The plan below is grounded in concrete values read from the codebase on 2026-04-29 — Task 0 confirms those values are still accurate.

- [ ] **Step 1: Confirm `_electron.launch()` is the right entry point**

Run:
```bash
grep -n "_electron as electron\|require('electron')" tests/e2e/app-launch.e2e.ts
```

Expected output includes:
```
33:  _electron as electron,
48:const electronPath: string = require('electron');
```

If line numbers shifted but the imports still exist, that's fine — the plan only depends on the existence of these imports.

- [ ] **Step 2: Confirm route map (verified 2026-04-29)**

Run:
```bash
grep -nE "<Route path=" src/renderer/App.tsx
```

Expected route table (this is the source of truth for the smoke spec's `RouteSpec` arrays in Task 3):

| Route | Mode | Page component | Sidebar label (verified) | Sidebar visible? |
|---|---|---|---|---|
| `/` | both | `Home` | `Home` | yes |
| `/machine-config` | both | `MachineConfiguration` | (none) | NO — accessed via Cmd+Shift+, keyboard shortcut |
| `/scientists` | both | `Scientists` | `Scientists` | yes |
| `/phenotypers` | both | `Phenotypers` | `Phenotypers` | yes |
| `/experiments` | both | `Experiments` | `Experiments` | yes |
| `/browse-scans` | both | `BrowseScans` | `Browse Scans` | yes |
| `/browse-graviscan` | both | `BrowseGraviScans` | `Browse GraviScans` | yes |
| `/camera-settings` | cylinder only | `CameraSettings` | `Camera Settings` | yes (cylinder mode) |
| `/capture-scan` | cylinder only | `CaptureScan` | `Capture Scan` | yes (cylinder mode) |
| `/accessions` | cylinder only | `Accessions` | `Accessions` | yes (cylinder mode) |
| `/scanner-config` | graviscan only | `ScannerConfig` | `Scanner Config` | yes (graviscan mode) |
| `/metadata` | graviscan only | `Metadata` | `Metadata` | yes (graviscan mode) |
| `/graviscan` | graviscan only | `GraviScanPage` | `Capture Scan` | yes (graviscan mode) — **NOTE: same label as cylinder's /capture-scan, mutually exclusive by mode** |
| `/scan/:scanId` | both | `ScanPreview` | (none) | parameterized — SKIP in smoke spec |

If `App.tsx` or `Layout.tsx` has changed labels or routes since 2026-04-29:
1. Update this table.
2. Update the `RouteSpec` arrays in Task 3 Step 2 to match.

- [ ] **Step 3: Verify sidebar link labels (verified 2026-04-29)**

Run:
```bash
grep -nE "label: '" src/renderer/Layout.tsx
```

Expected output (from the codebase as of 2026-04-29):
```
20:    label: 'Home',
40:    label: 'Browse Scans',
60:    label: 'Scientists',
80:    label: 'Phenotypers',
100:    label: 'Experiments',
124:    label: 'Capture Scan',
144:    label: 'Camera Settings',
169:    label: 'Accessions',
193:    label: 'Scanner Config',
218:    label: 'Metadata',
238:    label: 'Capture Scan',
258:    label: 'Browse GraviScans',
```

If any label has changed, update Task 3 Step 2's `navLocator` regexes accordingly.

**Critical gotcha:** lines 124 and 238 both have `label: 'Capture Scan'`. The cylinder version goes to `/capture-scan`; the graviscan version goes to `/graviscan`. They are mutually exclusive by mode, so `getByRole('link', { name: /capture scan/i })` is unambiguous within a single mode session. The smoke spec captures them as `cylinder-capture-scan.png` and `graviscan-graviscan.png` respectively.

- [ ] **Step 4: Verify helper APIs**

Run:
```bash
grep -nE "^export" tests/e2e/helpers/electron-cleanup.ts tests/e2e/helpers/bloom-config.ts
```

Expected:
- `tests/e2e/helpers/electron-cleanup.ts` exports `async function closeElectronApp(electronApp: ElectronApplication | undefined, options?: { timeout?: number; verbose?: boolean }): Promise<void>`. The smoke spec calls it with one arg.
- `tests/e2e/helpers/bloom-config.ts` exports `createTestBloomConfig(testScansDir?: string): void` (hard-codes `SCANNER_MODE=cylinderscan`) and `cleanupTestBloomConfig(): void`. The smoke spec writes its own `.env` inline because we need both modes — see Task 2's `writeBloomConfig()` helper.

If signatures differ, update Task 2's helper functions.

- [ ] **Step 5: Verify Playwright config**

Run:
```bash
grep -nE "projects:|testDir" playwright.config.ts
```

Expected: `testDir: './tests/e2e'` is set; there is **no** `projects: [...]` array. Therefore the smoke-spec npm script in Task 4 must NOT use `--project=electron`. It runs as plain `playwright test tests/e2e/smoke-renderer.e2e.ts`.

If `projects:` is now present, update Task 4 Step 2's npm script to include the appropriate `--project=<name>`.

- [ ] **Step 6: Verify dev server is running (smoke spec depends on it)**

Run:
```bash
lsof -iTCP -sTCP:LISTEN -P | grep -E ":3000|:9000"
```

Expected: at least one node process listening on port 9000 AND port 3000. If no listener, the engineer must run `npm run start` in another terminal before proceeding to Task 2.

- [ ] **Step 7: Verify webpack dev bundle exists**

Run:
```bash
test -f .webpack/main/index.js && echo "OK" || echo "MISSING"
```

Expected: `OK`. If `MISSING`, the dev server hasn't built yet — wait ~30 seconds after starting `npm run start` and try again.

- [ ] **Step 8: No commit (read-only task)**

Do NOT commit anything from this task. Proceed to Task 1.

---

## Task 1: Set up screenshots directory + .gitignore

**Files:**
- Create: `tests/e2e/screenshots/.gitkeep`
- Modify: `.gitignore`

- [ ] **Step 1: Create the directory with a `.gitkeep` so the structure exists in git but PNGs don't churn**

```bash
mkdir -p tests/e2e/screenshots
touch tests/e2e/screenshots/.gitkeep
```

- [ ] **Step 2: Add screenshot-output ignore rule to `.gitignore`**

Open `.gitignore`. Find the existing block:

```
playwright-report/
test-results/
```

Replace it with:

```
playwright-report/
test-results/

# E2E renderer smoke spec output — captured PNGs are reviewed locally and
# uploaded as CI artifacts; not committed to git.
tests/e2e/screenshots/*.png
!tests/e2e/screenshots/.gitkeep
```

- [ ] **Step 3: Verify the gitignore rule works**

Run:
```bash
touch tests/e2e/screenshots/test.png
git status tests/e2e/screenshots/
```
Expected: `test.png` does NOT appear in `git status` output. `.gitkeep` is already tracked (or stages cleanly).

Then clean up:
```bash
rm tests/e2e/screenshots/test.png
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore tests/e2e/screenshots/.gitkeep
git commit -m "chore(e2e): add tests/e2e/screenshots/ output directory + gitignore"
```

---

## Task 2: Write the smoke spec (full content, verified locators)

**Files:**
- Create: `tests/e2e/smoke-renderer.e2e.ts`

The spec uses the verified route map from Task 0 and the verified `RouteSpec` shape from Task 3 Step 2 below. Task 2 and Task 3 are sequential: Task 2 writes the spec; Task 3 runs it and captures screenshots; if any locator fails, Task 3 Step 6 records the failure and the engineer fixes the locator inline (it's a regex change, not a structural change).

- [ ] **Step 1: Create `tests/e2e/smoke-renderer.e2e.ts`**

Create the file with exactly this content:

```typescript
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
  { pageName: 'scientists', nav: { kind: 'sidebar-link', name: /^Scientists$/ } },
  { pageName: 'phenotypers', nav: { kind: 'sidebar-link', name: /^Phenotypers$/ } },
  { pageName: 'experiments', nav: { kind: 'sidebar-link', name: /^Experiments$/ } },
  { pageName: 'browse-scans', nav: { kind: 'sidebar-link', name: /^Browse Scans$/ } },
  { pageName: 'browse-graviscan', nav: { kind: 'sidebar-link', name: /^Browse GraviScans$/ } },
];

// Cylinder mode (Layout.tsx:289): alwaysLinks + captureLinks.
const CYLINDER_ONLY_ROUTES: RouteSpec[] = [
  // /capture-scan — same label as graviscan's /graviscan, but mutually exclusive.
  { pageName: 'capture-scan', nav: { kind: 'sidebar-link', name: /^Capture Scan$/ } },
  { pageName: 'camera-settings', nav: { kind: 'sidebar-link', name: /^Camera Settings$/ } },
  { pageName: 'accessions', nav: { kind: 'sidebar-link', name: /^Accessions$/ } },
];

// Graviscan mode (Layout.tsx:291): alwaysLinks + graviScanLinks.
const GRAVISCAN_ONLY_ROUTES: RouteSpec[] = [
  { pageName: 'scanner-config', nav: { kind: 'sidebar-link', name: /^Scanner Config$/ } },
  { pageName: 'metadata', nav: { kind: 'sidebar-link', name: /^Metadata$/ } },
  // In graviscan mode, "Capture Scan" navigates to /graviscan.
  { pageName: 'graviscan', nav: { kind: 'sidebar-link', name: /^Capture Scan$/ } },
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
  await window.waitForFunction(
    () => document.title.includes('Bloom Desktop'),
    { timeout: 60000 }
  );
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
    expect(
      fs.existsSync(path.join(SCREENSHOTS_DIR, 'cylinder-home.png'))
    ).toBe(true);
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
```

- [ ] **Step 2: Verify the spec compiles**

```bash
npx tsc --noEmit
```

Expected: clean exit. If the new spec has a TypeScript error, fix it before committing. Common issue: missing `import * as os from 'os'` or `import { execSync } from 'child_process'` — both are in the file content above.

- [ ] **Step 3: Commit the spec (defer running until Task 3)**

```bash
git add tests/e2e/smoke-renderer.e2e.ts
git commit -m "test(e2e): add smoke-renderer spec for visual verification of all renderer pages"
```

---

## Task 3: Run the smoke spec and verify every screenshot landed

**Files:**
- Possibly modify: `tests/e2e/smoke-renderer.e2e.ts` (only if a locator regex fails — see Step 6)

Task 2's spec uses verified locators. This task runs it, confirms all expected screenshots land, and provides the recovery path if any locator turns out to be wrong (e.g., Layout.tsx changed since 2026-04-29).

- [ ] **Step 1: Confirm dev server is up**

```bash
lsof -iTCP -sTCP:LISTEN -P | grep -E ":3000|:9000" | wc -l
```

Expected: `2` (both ports listening). If `0`, run `npm run start` in another terminal and wait ~30 seconds for the webpack bundle to build.

- [ ] **Step 2: Clear any stale screenshots**

```bash
rm -f tests/e2e/screenshots/*.png
ls tests/e2e/screenshots/
```

Expected: only `.gitkeep` remains.

- [ ] **Step 3: Run the smoke spec**

```bash
npx playwright test tests/e2e/smoke-renderer.e2e.ts
```

Expected: spec runs both `cylinderscan mode` and `graviscan mode` test cases. Each launches Electron, navigates through routes, captures PNGs. Total wall-clock: ~30–90 seconds depending on machine.

If Playwright fails with `Could not find Electron app` or similar, the dev bundle is missing. Run `npm run start` in another terminal, wait 30 seconds, retry.

If a navigation step fails with `expect(received).toBe(true)` on the home-screenshot assertion, that means the home page screenshot wasn't created — likely the `getByRole('link', { name: /^Home$/ })` locator didn't find the link. See Step 6.

- [ ] **Step 4: Confirm all 20 screenshots landed**

```bash
ls tests/e2e/screenshots/*.png | sort
```

Expected exactly 20 files (10 per mode: 7 shared + 3 mode-specific):

```
tests/e2e/screenshots/cylinder-accessions.png
tests/e2e/screenshots/cylinder-browse-graviscan.png
tests/e2e/screenshots/cylinder-browse-scans.png
tests/e2e/screenshots/cylinder-camera-settings.png
tests/e2e/screenshots/cylinder-capture-scan.png
tests/e2e/screenshots/cylinder-experiments.png
tests/e2e/screenshots/cylinder-home.png
tests/e2e/screenshots/cylinder-machine-config.png
tests/e2e/screenshots/cylinder-phenotypers.png
tests/e2e/screenshots/cylinder-scientists.png
tests/e2e/screenshots/graviscan-browse-graviscan.png
tests/e2e/screenshots/graviscan-browse-scans.png
tests/e2e/screenshots/graviscan-experiments.png
tests/e2e/screenshots/graviscan-graviscan.png
tests/e2e/screenshots/graviscan-home.png
tests/e2e/screenshots/graviscan-machine-config.png
tests/e2e/screenshots/graviscan-metadata.png
tests/e2e/screenshots/graviscan-phenotypers.png
tests/e2e/screenshots/graviscan-scanner-config.png
tests/e2e/screenshots/graviscan-scientists.png
```

If any are missing, scan the test output for `[smoke] sidebar link not visible for <pageName>` warnings — those are the routes whose locator regex didn't match the actual rendered link. Note them and proceed to Step 6.

- [ ] **Step 5: Verify the PNGs are non-trivial (not zero-byte, not blank)**

```bash
for f in tests/e2e/screenshots/*.png; do
  size=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f")
  printf "%8d  %s\n" "$size" "$f"
done
```

Expected: every file is > 10000 bytes. Anything smaller indicates a blank/broken render. If a file is suspiciously small, open it via the Read tool to confirm — sometimes the dev server returns a placeholder before the React app mounts.

- [ ] **Step 6: Recovery — fix any locator regex that failed**

ONLY do this step if Step 4 found missing PNGs.

For each missing screenshot's `pageName`, find the corresponding `RouteSpec` entry in `tests/e2e/smoke-renderer.e2e.ts`. Open the live app (or read `src/renderer/Layout.tsx`) and find the actual visible label for that link. Update the regex.

Common gotchas:
- Label has trailing/leading whitespace: relax the regex from `/^X$/` to `/^\s*X\s*$/`.
- Label uses an em-dash or other unicode: include it in the regex.
- The link is rendered conditionally (e.g., gated on `mode === 'graviscan'`) and your test launched the wrong mode — verify the test case matches the route's required mode.

After fixing, re-run Step 3 and re-confirm Step 4.

- [ ] **Step 7: Read 3 screenshots via the Read tool to actually look at them**

Use the Read tool on each of:
- `tests/e2e/screenshots/cylinder-home.png`
- `tests/e2e/screenshots/graviscan-scanner-config.png`
- `tests/e2e/screenshots/graviscan-graviscan.png`

The Read tool returns image data for PNG files. Confirm each looks like a real Electron page render (not blank, not an error boundary). If any is blank, the page failed to mount — that's a bug in the renderer or in the smoke spec's wait logic.

- [ ] **Step 8: Commit any spec changes from Step 6 (if applicable)**

```bash
git status tests/e2e/smoke-renderer.e2e.ts
# if dirty:
git add tests/e2e/smoke-renderer.e2e.ts
git commit -m "test(e2e): fix smoke-spec locators discovered during first run"
```

If Step 6 was a no-op, skip this commit.

---

## Task 4: Add npm script for the smoke spec

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Read current scripts**

```bash
grep -A2 '"test:e2e"' package.json
```

Record the existing `test:e2e` script. The new script will follow the same shape.

- [ ] **Step 2: Add `test:e2e:smoke` script**

Open `package.json`. In the `"scripts"` block, find `"test:e2e"`. Immediately after it, add:

```json
    "test:e2e:smoke": "playwright test tests/e2e/smoke-renderer.e2e.ts",
```

Make sure the line above (the `"test:e2e"` line) ends with a comma so JSON stays valid.

Note: no `--project=electron` flag because `playwright.config.ts` does NOT define a `projects` array (verified in Task 0 Step 5). If a future PR adds projects, this script must be updated accordingly.

- [ ] **Step 3: Verify the script works**

```bash
npm run test:e2e:smoke
```

Expected: same result as Task 3 Step 3 (PNGs in `tests/e2e/screenshots/`).

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add test:e2e:smoke npm script"
```

---

## Task 5: Document the workflow in the electron-playwright-workflow skill

**Files:**
- Modify: `.claude/skills/electron-playwright-workflow/SKILL.md`

- [ ] **Step 1: Read the existing skill to find the right insertion point**

```bash
grep -n "^##\|^###" .claude/skills/electron-playwright-workflow/SKILL.md | head -30
```

Find the section that talks about testing or before-claiming-done. Insertion point: after the existing "Before Making Changes" section.

- [ ] **Step 2: Insert a new section "Visual verification of renderer changes"**

Open `.claude/skills/electron-playwright-workflow/SKILL.md`. Find the line:

```
## Before Making Changes
```

Locate the next `##` heading after that section ends. Immediately before that next `##`, insert:

```markdown
## Visual verification of renderer changes (MANDATORY)

Any change that touches `src/renderer/`, a React component, a page route, or anything user-visible MUST be visually verified before being claimed done. Code-correctness review (typecheck, lint, unit tests) does not catch UX problems — monolithic 500-line forms, missing affordances, broken layouts, redundant pages, ugly defaults. Several incidents in this codebase shipped renderer code that compiled, passed all tests, and had unusable UX.

### How to verify

1. Make sure the dev server is running locally: `npm run start`. (CI runs it as part of the workflow.)
2. Run the smoke spec: `npm run test:e2e:smoke`.
3. The spec writes PNG screenshots of every renderer route to `tests/e2e/screenshots/`. Filenames are `<mode>-<page-name>.png` (e.g., `graviscan-scanner-config.png`).
4. Read every PNG affected by the change using the `Read` tool. Reading the PNG returns the image to you — actually look at it.
5. Use the visual-review checklist (next subsection) before claiming the change is done.

### Visual-review checklist (eyeball-only — no pixel-diff)

- Does the page render at all? (Easy to miss when a hook crashes silently — the page may appear blank or render an error boundary.)
- Is the primary action obvious? One Save button vs. several? Disabled-state distinguishable from enabled?
- Sensible defaults, or empty page? An empty form with no defaults is usually a bug.
- Are error / success / partial-failure states reachable? (Banners, toast, inline messages — visible? dismissable?)
- Layout coherent or 600-line scroll? If the page is one giant inline form, file a componentization follow-up.
- Compare against the pilot/reference design if one exists. **Different ≠ acceptable; degraded vs. reference IS a regression.**

### Why MCP Playwright cannot drive this app

The Playwright MCP tools (`mcp__playwright__browser_*`) drive Chrome via DevTools Protocol. This Electron app's renderer relies on `window.electron.*` injected by the preload script. That injection only happens inside Electron — pointing MCP Playwright at `http://localhost:3000/main_window` loads the HTML but every IPC call fails because `window.electron` is undefined.

To drive the actual app for UI work, use `@playwright/test`'s `_electron.launch()` API in an E2E spec. The smoke spec at `tests/e2e/smoke-renderer.e2e.ts` is the canonical pattern; mirror its `launchAppForMode()` helper for any new visual test.

Do NOT waste time trying to use the MCP browser to "look at" the app's renderer pages.

### When the smoke spec is insufficient

- New page added: extend `SHARED_ROUTES`, `CYLINDER_ONLY_ROUTES`, or `GRAVISCAN_ONLY_ROUTES` in `tests/e2e/smoke-renderer.e2e.ts` with the new `RouteSpec` entry.
- Route requires interaction before it's visually meaningful (e.g., a wizard step that needs prior input): write a focused E2E spec that drives the interaction and screenshots after each step. The smoke spec captures default state only.
- Pixel-diff regression suite: NOT in scope today. If someone proposes adding `toHaveScreenshot()` baseline assertions, treat that as a separate proposal.

```

- [ ] **Step 3: Verify the file still parses**

```bash
head -200 .claude/skills/electron-playwright-workflow/SKILL.md | tail -50
```

Confirm the new section appears in the right place and the markdown is well-formed.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/electron-playwright-workflow/SKILL.md
git commit -m "docs(skill): mandate visual verification for renderer changes via smoke spec"
```

---

## Task 6: Update the new-feature command

**Files:**
- Modify: `.claude/commands/new-feature.md`

- [ ] **Step 1: Read the file**

```bash
cat .claude/commands/new-feature.md
```

- [ ] **Step 2: Append a "Renderer / UI guardrails" section**

Open `.claude/commands/new-feature.md`. At the END of the file (after the last existing line), append:

```markdown

## Renderer / UI guardrails (MANDATORY for any change touching `src/renderer/`)

If the feature touches the renderer, the OpenSpec proposal MUST include the following in its task list:

1. **Visual verification task** in the proposal's Section "Manual verification" or equivalent: an explicit step that runs `npm run test:e2e:smoke` and reads each affected screenshot via the `Read` tool. The acceptance criterion is "every page touched by this change has been visually reviewed against the visual-review checklist in `.claude/skills/electron-playwright-workflow/SKILL.md`."

2. **Smoke-spec extension** (only if a new page is added): a task that adds the new page's `RouteSpec` entry to `tests/e2e/smoke-renderer.e2e.ts`. The proposal's `Impact` section must list this file as `MODIFIED`.

3. **Deferred-component disclosure** in the proposal's `Non-Goals` section: if any UI component, sub-page, or rich-interaction surface is being deferred to a follow-up, the proposal MUST list each by name AND link a filed GitHub issue for it. Vague language like "remaining components deferred" is not acceptable. The check: a future maintainer reading this proposal a year from now should be able to point to a tracked issue for every "we'll do that later" claim.

If the proposal is missing any of these for a renderer-touching change, the proposal review must fail.
```

- [ ] **Step 3: Verify**

```bash
tail -30 .claude/commands/new-feature.md
```

- [ ] **Step 4: Commit**

```bash
git add .claude/commands/new-feature.md
git commit -m "docs(commands): require renderer-touching proposals to include visual-verification + deferred-component tasks"
```

---

## Task 7: Update the review-pr command

**Files:**
- Modify: `.claude/commands/review-pr.md`

- [ ] **Step 1: Find the right insertion point**

```bash
grep -n "^### Subagent\|^## Step" .claude/commands/review-pr.md
```

Find Subagent 3 (Scientific Rigor, Metadata & UX). The new visual-review responsibility belongs there, since the scope is UI/UX regressions.

- [ ] **Step 2: Augment Subagent 3's prompt with a visual-review responsibility**

Open `.claude/commands/review-pr.md`. Find Subagent 3's prompt template (the heredoc block that starts with `> You are reviewing a pull request for bloom-desktop, a scientific imaging application`). Inside that block, find the bulleted "Check:" list. Add the following bullet at the end of the existing list (before the `**PR diff:**` placeholder):

```
> 11. **Visual / UX regression review** — if the PR touches `src/renderer/`, run `npm run test:e2e:smoke` locally (Bash tool) before reviewing. Then for each renderer file modified by the PR, read the corresponding screenshot at `tests/e2e/screenshots/<mode>-<page-name>.png` using the Read tool. For each screenshot, evaluate against the visual-review checklist in `.claude/skills/electron-playwright-workflow/SKILL.md` and report any layout, affordance, or default-state issues. A PR that touches the renderer but produces no captured screenshot for the affected page is a procedural failure and SHALL be flagged BLOCKING.
```

- [ ] **Step 3: Add a Step-3-prerequisite to the synthesis section**

Find the section "## Step 3: Synthesize and Post Review" or equivalent. Immediately before it, add:

```markdown
## Step 2.5: Visual review prerequisite (renderer-touching PRs only)

Before synthesizing, confirm that:

- [ ] The PR's file list (from Step 1's `gh pr view` output) includes at least one path under `src/renderer/`. If yes, the visual-review responsibility in Subagent 3 is mandatory.
- [ ] `tests/e2e/screenshots/` contains at least one PNG newer than the PR's branch creation date. If the directory is empty or all PNGs are stale, the smoke spec was not run; the synthesized review SHALL flag this as BLOCKING.
- [ ] Each renderer-page change has its corresponding screenshot read via the Read tool. Note in the synthesis section which pages were visually reviewed.

```

- [ ] **Step 4: Verify**

```bash
grep -n "Visual / UX regression\|Visual review prerequisite" .claude/commands/review-pr.md
```

Both should match. If either is missing, re-do the relevant insertion.

- [ ] **Step 5: Commit**

```bash
git add .claude/commands/review-pr.md
git commit -m "docs(commands): review-pr 5-agent team must read screenshot artifacts for renderer PRs"
```

---

## Task 8: Update the pre-merge command

**Files:**
- Modify: `.claude/commands/pre-merge.md`

- [ ] **Step 1: Find the existing checklist or final-verification section**

```bash
grep -nE "^- \[ \]|^### |^## " .claude/commands/pre-merge.md | head -30
```

Identify the most authoritative final-verification block.

- [ ] **Step 2: Add a renderer-screenshot checkbox**

Open `.claude/commands/pre-merge.md`. Find the final-verification checkbox list (the one that includes things like "tests pass", "lint clean", "tsc clean"). Add this line at the appropriate point in that list:

```markdown
- [ ] **Renderer screenshots captured + reviewed** (only required if the PR touches `src/renderer/`): run `npm run test:e2e:smoke` and read each affected `tests/e2e/screenshots/<mode>-<page>.png` via the Read tool. Apply the visual-review checklist in `.claude/skills/electron-playwright-workflow/SKILL.md`. Record findings in the PR description. If the PR doesn't touch `src/renderer/`, mark this checkbox N/A with a note.
```

- [ ] **Step 3: Verify**

```bash
grep -n "Renderer screenshots captured" .claude/commands/pre-merge.md
```

- [ ] **Step 4: Commit**

```bash
git add .claude/commands/pre-merge.md
git commit -m "docs(commands): pre-merge requires renderer screenshot capture + review"
```

---

## Task 9: Update OpenSpec conventions

**Files:**
- Modify: `openspec/AGENTS.md`

- [ ] **Step 1: Find the design-doc Goals/Non-Goals section**

```bash
grep -n "^## Goals / Non-Goals\|^### " openspec/AGENTS.md | head -30
```

Located at line 248: `## Goals / Non-Goals`. We'll insert the new rule directly into that section.

- [ ] **Step 2: Insert the renderer-deferral rule**

Open `openspec/AGENTS.md`. Find the line:

```
## Goals / Non-Goals
```

Read the current contents of that section (the lines after that heading until the next `## ` heading). The current content is brief. Replace the entire section (from `## Goals / Non-Goals` up to but NOT including the next `## ` heading) with:

```markdown
## Goals / Non-Goals

State explicitly what the proposal does and does not do. The Non-Goals section is load-bearing — vague deferrals rot into permanent gaps.

### Hard rules for Non-Goals on renderer-touching proposals

A proposal is "renderer-touching" if its `Impact` section lists ANY file under `src/renderer/`. For these proposals:

1. **Every deferred UI component, sub-page, or rich-interaction surface MUST be named individually.** Examples of unacceptable wording: "remaining components deferred to a follow-up", "additional UI polish out of scope". Examples of acceptable wording: "GraviMetadataUpload component (XLSX upload) deferred to issue #207; ScanFormSection refactor deferred to issue #208".
2. **Every named deferral MUST link a filed GitHub issue number.** "Will file later" is not acceptable. The issue must already exist when the proposal is reviewed.
3. **The `## Why` section MUST address visual verification.** Either confirm the proposal includes a smoke-spec task (see `.claude/commands/new-feature.md`), or explain why it doesn't (e.g., "renderer change is a no-op rename — no visual surface affected").

The check: a future maintainer reading this proposal a year from now should be able to point to a tracked issue for every "we'll do that later" claim, AND reproduce the visual review by running `npm run test:e2e:smoke` and reading the captured PNGs.

### Other Non-Goals guidance (applies to all proposals)

State up front what's out of scope so reviewers don't ask. Common categories:

- Backwards compatibility / migration tooling for changes that don't ship to existing users
- Performance work that's downstream of the immediate functional fix
- Refactors that would expand the proposal's scope beyond review-able size

```

- [ ] **Step 3: Verify validation still works**

```bash
openspec validate add-graviscan-renderer-pages --strict
openspec validate fix-scanner-config-save-flow --strict
openspec validate surface-disabled-scanners-on-detect --strict
```

Expected: all three remain valid. The AGENTS.md change is convention, not schema, so existing proposals are not invalidated.

- [ ] **Step 4: Commit**

```bash
git add openspec/AGENTS.md
git commit -m "docs(openspec): renderer-touching proposals must list deferred UI components by name with linked issues"
```

---

## Task 10: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Re-run the smoke spec from a clean checkout**

```bash
rm -rf tests/e2e/screenshots/*.png
npm run test:e2e:smoke
ls tests/e2e/screenshots/*.png | wc -l
```

Expected: exactly 20 PNGs (10 per mode). If the count is below 20, scan the test output for `[smoke] sidebar link not visible for ...` warnings — those indicate locator regexes that need updating. The plan is incomplete until the count is 20.

- [ ] **Step 2: Read 3 representative screenshots via the Read tool**

Use the `Read` tool on:
- `tests/e2e/screenshots/cylinder-home.png`
- `tests/e2e/screenshots/graviscan-scanner-config.png`
- `tests/e2e/screenshots/graviscan-graviscan.png`

Confirm each renders as an actual image (the Read tool returns image data, not an error).

- [ ] **Step 3: Confirm the new npm script works**

```bash
npm run test:e2e:smoke 2>&1 | tail -5
```

Expected: a `passing` line at the bottom of Playwright's output.

- [ ] **Step 4: Confirm openspec validate still passes**

```bash
openspec validate add-graviscan-renderer-pages --strict
openspec validate fix-scanner-config-save-flow --strict
openspec validate surface-disabled-scanners-on-detect --strict
```

All three: `is valid`.

- [ ] **Step 5: Confirm linting + prettier are clean across the new files**

```bash
npx tsc --noEmit
npm run lint
npx prettier --check tests/e2e/smoke-renderer.e2e.ts .claude/skills/electron-playwright-workflow/SKILL.md .claude/commands/new-feature.md .claude/commands/review-pr.md .claude/commands/pre-merge.md openspec/AGENTS.md
```

If prettier flags anything, run `npx prettier --write` on the offending files and amend the relevant commit (or add a follow-up commit).

- [ ] **Step 6: Push the branch and confirm CI runs the smoke spec**

```bash
git push
gh pr view --json statusCheckRollup --jq '.statusCheckRollup[] | select(.name | test("(?i)e2e|smoke")) | {name, status, conclusion}'
```

Expected: a check named something like "Test - E2E" runs. If there's no separate smoke check, that's acceptable — `test:e2e:smoke` runs as part of `test:e2e` because it's a Playwright spec under `tests/e2e/`.

- [ ] **Step 7: Final commit if anything was amended in steps 5–6**

```bash
git status
# if dirty:
git add <files>
git commit -m "chore: prettier/lint touch-ups"
git push
```

---

## Self-review

**Spec coverage check:**

| User-stated requirement | Task that implements it |
|---|---|
| (1) Smoke spec covers all renderer pages | Tasks 2–4 |
| (2) Update electron-playwright-workflow SKILL.md | Task 5 |
| (3) Update new-feature command | Task 6 |
| (4) Update review-pr command | Task 7 |
| (5) Update pre-merge command | Task 8 |
| (6) Update OpenSpec AGENTS.md | Task 9 |
| End-to-end smoke spec works locally | Task 10 |
| `playwright.config.ts` UNCHANGED | Confirmed: no task touches it. Smoke spec calls `page.screenshot()` explicitly. |
| Eyeball-only, no pixel-diff | Confirmed: no `toHaveScreenshot()` anywhere. |
| Document MCP-vs-Electron limitation | Task 5 (skill) + Task 2 spec header comment. |

**Placeholder scan:** No "TBD", "TODO", "implement later", "fill in details", "Add appropriate error handling", or "Similar to Task N" anywhere. Code blocks are complete.

**Type/name consistency:**

- `RouteSpec` interface defined ONCE in Task 2 with the verified shape (no second-version replacement). Task 3 only runs and verifies; it does not redefine the interface.
- `SHARED_ROUTES` / `CYLINDER_ONLY_ROUTES` / `GRAVISCAN_ONLY_ROUTES` defined ONCE in Task 2.
- `launchAppForMode` and `captureRoute` defined ONCE in Task 2.
- `npm run test:e2e:smoke` script name consistent across Tasks 4, 5, 6, 7, 8, 10.
- All sidebar locator regexes match the verified labels in Task 0 Step 3.
- Task 4's npm script does NOT include `--project=electron` (no projects array in `playwright.config.ts`, verified Task 0 Step 5).

**Verification rule applied:**

Every shell command listed in this plan was either run during planning OR is a standard tool invocation (`git status`, `ls`, `file`, `stat`, `grep`, `npx tsc --noEmit`, `npm run lint`, `npx prettier --check`, `openspec validate`, `gh pr view`). The plan's locator regexes match the labels in `Layout.tsx` as of 2026-04-29 — Task 0 Step 3 is the verification gate that catches drift.

**Risk flags:**

- Dev server must be running for Tasks 2–4 + Task 10. Task 0 Step 6 catches this. If the server isn't running when Task 3 Step 3 runs, Playwright fails fast with a clear error.
- A locator regex might fail on a future Layout.tsx label change. Task 3 Step 6 is the explicit recovery path: scan warnings, update regex, re-run.
- The smoke spec captures full-page screenshots that include any modal/popup that happens to be open at navigation time. If a future toast/notification appears mid-test, screenshots may be noisy. Acceptable — eyeball review tolerates this; pixel-diff would not.
- `Meta+Shift+Comma` keyboard shortcut for `/machine-config` is registered via a `keydown` listener on `window` (Layout.tsx:329). Playwright's `page.keyboard.press()` dispatches into the focused element, which should bubble to the window. If this fails on some platforms, Task 3 Step 6 will flag the missing `machine-config.png`. Recovery: add `await window.click('body')` to focus the document before the keypress.
