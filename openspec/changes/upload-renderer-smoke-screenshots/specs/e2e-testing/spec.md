## MODIFIED Requirements

### Requirement: CI Integration for E2E Tests

The system SHALL execute E2E tests in CI across Linux, macOS, and Windows platforms, and SHALL upload artifacts that enable PR reviewers to inspect renderer pages without running the smoke spec locally.

#### Scenario: CI job builds webpack before E2E tests

- **GIVEN** a PR workflow is triggered
- **WHEN** the E2E test job runs
- **THEN** webpack dev build SHALL be created before Playwright tests execute

#### Scenario: CI job starts webpack dev server

- **GIVEN** webpack build is complete
- **WHEN** E2E tests need to run
- **THEN** webpack dev server SHALL be started in background before tests and stopped after completion

#### Scenario: CI job uploads failure artifacts

- **GIVEN** an E2E test fails in CI
- **WHEN** the test job completes
- **THEN** Playwright traces, screenshots, and videos SHALL be uploaded as GitHub Actions artifacts

#### Scenario: CI job uploads renderer smoke screenshots on every run

- **GIVEN** the E2E test job runs (smoke spec is part of `test:e2e`)
- **WHEN** the job finishes — whether the spec passed or failed
- **THEN** every PNG written to `tests/e2e/screenshots/` SHALL be uploaded as a GitHub Actions artifact named `renderer-screenshots-<os>` (where `<os>` distinguishes the matrix runner)
- **AND** the upload step SHALL use `if: always()` so artifacts are produced even when the spec fails (the failure case is exactly when reviewers want to see what was captured)
- **AND** the artifact SHALL be downloadable from the PR's check page without running anything locally
- **AND** retention SHALL be the GitHub Actions default (90 days), sufficient for typical PR review windows

#### Scenario: E2E tests run on all platforms

- **GIVEN** a PR workflow is triggered
- **WHEN** E2E test jobs execute
- **THEN** tests SHALL run on ubuntu-latest, macos-latest, and windows-latest runners

### Requirement: npm Scripts for E2E Testing

The system SHALL provide npm scripts for executing E2E tests in different modes.

#### Scenario: Standard E2E test execution

- **GIVEN** the user runs `npm run test:e2e`
- **WHEN** the script executes
- **THEN** it SHALL build Python executable, build webpack, and run Playwright tests

#### Scenario: E2E test execution with UI

- **GIVEN** the user runs `npm run test:e2e:ui`
- **WHEN** the script executes
- **THEN** it SHALL build dependencies and launch Playwright UI mode for interactive debugging

#### Scenario: E2E test execution with debug mode

- **GIVEN** the user runs `npm run test:e2e:debug`
- **WHEN** the script executes
- **THEN** it SHALL build dependencies and launch Playwright debug mode with step-through capability

#### Scenario: Renderer smoke spec direct execution

- **GIVEN** the user runs `npm run test:e2e:smoke`
- **WHEN** the script executes
- **THEN** it SHALL run only `tests/e2e/smoke-renderer.e2e.ts` via Playwright
- **AND** the spec SHALL launch the Electron app once per scanner mode and capture full-page PNGs of every renderer route to `tests/e2e/screenshots/`
- **AND** the script SHALL be a strict subset of `test:e2e` — anything `test:e2e:smoke` runs MUST also run as part of `test:e2e`, ensuring CI never diverges from local-only execution

## ADDED Requirements

### Requirement: Renderer Smoke Spec

The system SHALL provide a Playwright E2E spec at `tests/e2e/smoke-renderer.e2e.ts` whose sole purpose is producing screenshot artifacts of every renderer page in every supported scanner mode. The spec is a visual-verification gate, not a behavior-assertion test — its acceptance criterion is that PNG files are written, not that any UI element matches expected content.

#### Scenario: Smoke spec captures every visible renderer route per mode

- **GIVEN** the smoke spec runs (locally via `npm run test:e2e:smoke` or as part of CI)
- **WHEN** the cylinderscan-mode test case launches the Electron app
- **THEN** the spec SHALL capture full-page screenshots for every route reachable from the cylinderscan-mode sidebar PLUS `/machine-config` (reached via Cmd/Ctrl+Shift+Comma)
- **AND** the graviscan-mode test case SHALL do the same for graviscan-mode routes
- **AND** filenames SHALL follow the convention `<mode>-<page-name>.png` (e.g., `cylinder-home.png`, `graviscan-scanner-config.png`)

#### Scenario: Smoke spec uses `_electron.launch()` not the Playwright MCP

- **GIVEN** any future maintainer extends or debugs the smoke spec
- **WHEN** they need to drive the Electron app
- **THEN** the spec SHALL use `@playwright/test`'s `_electron.launch()` API
- **AND** the spec SHALL NOT use the Playwright MCP (`mcp__playwright__browser_*`) tools — those drive Chrome via DevTools Protocol and cannot inject the Electron preload's `window.electron.*` bridge, so every IPC call would fail
- **AND** the spec's header comment SHALL document this limitation explicitly so future maintainers don't repeat the wasted-attempt cycle

#### Scenario: Smoke spec navigation is deterministic, not heuristic

- **GIVEN** the spec navigates between renderer pages
- **WHEN** it visits each route
- **THEN** navigation SHALL use one of two deterministic strategies per `RouteSpec`:
  - `{ kind: 'sidebar-link', name: RegExp }` — clicks a NavLink whose accessible name matches the regex (verified against `src/renderer/Layout.tsx` labels)
  - `{ kind: 'keyboard', press: string }` — fires a keyboard shortcut (used for `/machine-config`, which has no sidebar entry)
- **AND** if a sidebar link's regex doesn't match (e.g., a label was renamed), the spec SHALL log a `[smoke] sidebar link not visible` warning AND continue with remaining routes — so a single broken locator doesn't suppress all screenshots
- **AND** locator regexes SHALL be anchored (`/^Home$/` not `/home/i`) to avoid ambiguity when multiple links share substrings

#### Scenario: Captured screenshots are reviewable without running the spec

- **GIVEN** a PR that touches `src/renderer/` is opened on GitHub
- **WHEN** CI completes the E2E job
- **THEN** the captured PNGs SHALL be available as a downloadable artifact on the PR's check page (per `Requirement: CI Integration for E2E Tests`)
- **AND** human reviewers and Claude command flows (`/review-pr`, `/pre-merge`) SHALL use the CI artifact as an acceptable substitute for running `npm run test:e2e:smoke` locally
- **AND** the local path (`tests/e2e/screenshots/`) and the CI artifact contents SHALL be functionally equivalent
