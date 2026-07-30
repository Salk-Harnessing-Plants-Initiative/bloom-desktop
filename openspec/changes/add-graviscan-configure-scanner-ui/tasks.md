## 1. Types & Constants (`src/types/graviscan.ts`)

- [x] 1.1 Update the existing `GRAVISCAN_RESOLUTIONS has 8 entries` test in
      `tests/unit/graviscan-types.test.ts` to assert the trimmed 6-value set
      `[200, 400, 600, 800, 1200, 1600]` (rename the `it` block accordingly)
      and confirm it now **fails** against current code (still 8 entries).
- [x] 1.2 Add a new `isValidResolution()` describe block to the same file
      asserting: returns `true` for each of `200, 400, 600, 800, 1200, 1600`;
      returns `false` for `3200`, `6400`, `0`, and a non-numeric-looking
      value like `1201`. Confirm it fails (the export doesn't exist yet).
- [x] 1.3 Trim `GRAVISCAN_RESOLUTIONS` in `src/types/graviscan.ts` to
      `[200, 400, 600, 800, 1200, 1600] as const` and add
      `export function isValidResolution(value: number): value is GraviScanResolution`.
      Confirm 1.1 and 1.2 now pass.
- [x] 1.4 Run `npm run lint && npx tsc --noEmit && npm run test:unit`; fix
      any fallout before moving on.

## 2. Preload & Type Wiring — `getScannerStatus`

- [ ] 2.1 In `tests/unit/preload-gravi.test.ts`, add `'getScannerStatus'` to
      the `invokeMethods` list (bumping the "has all N invoke methods" count
      by one) and add a dedicated test asserting
      `exposedAPI.gravi.getScannerStatus()` calls
      `ipcRenderer.invoke('graviscan:get-scanner-status')` with no
      arguments. Confirm both fail against current `preload.ts`.
- [ ] 2.2 Add `getScannerStatus: () => ipcRenderer.invoke('graviscan:get-scanner-status')`
      to the `graviAPI` object in `src/main/preload.ts`. Confirm 2.1 passes.
- [ ] 2.3 Add the matching method signature to the `GraviAPI` interface in
      `src/types/electron.d.ts`:
      `getScannerStatus: () => Promise<{ success: boolean; scanners: Array<{ scannerId: string; displayName: string; usbPort: string | null; gridMode: string; status: 'ready' | 'starting' | 'error' | 'dead' | 'disconnected'; error?: string }>; error?: string }>`
      (mirrors `getScannerStatus()`'s real return type in
      `src/main/graviscan/scanner-handlers.ts`). Run `npx tsc --noEmit` to
      confirm no new type errors.
- [ ] 2.4 Extend `tests/e2e/graviscan-ipc.e2e.ts` with a
      `getScannerStatus returns scanner list shape` test (mirrors the
      existing `getConfig`/`getOutputDir` tests in that file): asserts
      `result.success === true` and `Array.isArray(result.scanners)`
      (this handler returns its shape directly, not wrapped in
      `wrapHandler`'s `{success, data}` — confirmed directly in
      `getScannerStatus()`'s implementation in
      `src/main/graviscan/scanner-handlers.ts`, which returns
      `{ success, scanners, error? }` as its own literal return type
      rather than being passed through `wrapHandler`).

## 3. Main-Process Env-Status Read (#245)

- [ ] 3.1 In `tests/unit/config-store.test.ts` (or a new
      `tests/unit/config-store-graviscan-env-status.test.ts` if keeping the
      existing file focused), write failing tests for a new
      `getGraviScanEnvStatus(config: MachineConfig)` export:
      - returns `{ slackConfigured: true, libusbRecoveryEnabled: true }`
        when `config.slack_webhook_url` is a non-empty string and
        `config.libusb_endpoint_recovery !== false`
      - returns `{ slackConfigured: false, ... }` when
        `slack_webhook_url` is `undefined`
      - returns `{ ..., libusbRecoveryEnabled: false }` when
        `libusb_endpoint_recovery === false`
      - returns `{ ..., libusbRecoveryEnabled: true }` when
        `libusb_endpoint_recovery === undefined` (default-on, per the
        existing `LIBUSB_ENDPOINT_RECOVERY` parsing convention in
        `config-store.ts`)
- [ ] 3.2 Implement `getGraviScanEnvStatus()` in `src/main/config-store.ts`
      as a small pure function (no fs access — takes an already-loaded
      `MachineConfig`) and export it. Confirm 3.1 passes.
- [ ] 3.3 Write a failing test (extend `tests/unit/config-ipc.test.ts`,
      following its existing "simulate handler logic" pattern) asserting
      that calling `getGraviScanEnvStatus(loadEnvConfig(ENV_PATH))` against
      a fixture `.env` containing `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL=...`
      and `LIBUSB_ENDPOINT_RECOVERY=false` returns
      `{ slackConfigured: true, libusbRecoveryEnabled: false }`.
- [ ] 3.4 Register `ipcMain.handle('config:get-graviscan-env-status', ...)`
      in `src/main/main.ts` next to the other `config:*` handlers, calling
      `getGraviScanEnvStatus(loadEnvConfig(ENV_PATH))`. Confirm 3.3 passes
      (via the direct function-level test) and manually smoke-check the
      handler registers without throwing.
- [ ] 3.5 Add `getGraviScanEnvStatus: () => Promise<{ slackConfigured: boolean; libusbRecoveryEnabled: boolean }>`
      to the `ConfigAPI` interface in `src/types/electron.d.ts`, and
      `getGraviScanEnvStatus: () => ipcRenderer.invoke('config:get-graviscan-env-status')`
      to the `configAPI` object in `src/main/preload.ts`. Add a test to
      whichever preload test file already covers `configAPI` (or create
      `tests/unit/preload-config.test.ts` if none exists) asserting the
      correct channel is invoked.
- [ ] 3.6 Run `npm run lint && npx tsc --noEmit && npm run test:unit`; fix
      any fallout before moving on.

## 4. `ConfigureScanner.tsx` Renderer Component

> **Commit-safety note:** tasks 4.1 and 4.2 must land in the same commit.
> 4.1's test file references `src/renderer/ConfigureScanner.tsx`, which
> does not exist until 4.2 — a commit containing only 4.1 would leave the
> tree in a state where `npx tsc --noEmit` fails on an unresolved import,
> not just a red test. Do not split 4.1 and 4.2 across separate commits.

- [ ] 4.1 Create `tests/unit/pages/ConfigureScanner.test.tsx` and write
      failing tests (mocking `window.electron.gravi.*` and
      `window.electron.config.getGraviScanEnvStatus`, following the mocking
      conventions in `tests/unit/pages/App.test.tsx` and
      `tests/unit/pages/MachineConfiguration.test.tsx`) for, at minimum:
      - renders a loading state, then the detect/save/list UI once
        `getScannerStatus()` and `getConfig()` resolve
      - a valid persisted `GraviConfig` (`resolution: 600,
        grid_mode: '4grid'`) round-trips correctly into the resolution and
        grid-mode `<select>` elements on mount (the plain success path,
        distinct from the legacy-fallback test below)
      - clicking "Detect Scanners" calls `detectScanners()` then
        `saveScannersToDB()` then re-calls `getScannerStatus()`
      - zero-scanner detection shows the "No scanners detected" inline error
        and does not call `saveScannersToDB()`
      - detect/save failures each surface their returned `error` string
        inline (two separate tests)
      - a `saveScannersToDB()` failure leaves the previously-displayed
        scanner list unchanged (assert the list content, not just that an
        error message appears)
      - while at least one row has status `starting`, the page
        periodically re-calls `getScannerStatus()` on an interval; once no
        row is `starting`, polling stops (assert the interval is cleared,
        e.g. via fake timers and a call-count check); polling is also
        torn down on unmount (no re-call after unmount)
      - the resolution `<select>` options are exactly
        `[200, 400, 600, 800, 1200, 1600]` in that order, sourced from
        `GRAVISCAN_RESOLUTIONS` (no hardcoded option list)
      - the `1200` option is labeled with the production-validated suffix
      - a legacy `resolution: 3200` from `getConfig()` falls back the
        selector to `1200` and shows the stale-value warning, without
        calling `saveConfig()`
      - while the legacy-value warning is showing and the operator has not
        yet touched the resolution selector, the "Save" button is disabled
        and a click does not call `saveConfig()`; after the operator
        interacts with the resolution selector, "Save" becomes enabled
      - saving resolution/grid mode calls
        `saveConfig({ resolution, grid_mode })` with the selected values
      - clicking "Reset All USB Connections" while `getScanStatus()`
        indicates `isActive: true` shows the inline "Cannot reset USB
        while a scan is in progress" message and does not call
        `resetUsb()`
      - clicking "Reset All USB Connections" while `getScanStatus()`
        indicates `isActive: false` immediately flips every row to
        `starting`, then (after `resetUsb()` resolves) re-runs the detect
        flow
      - a `resetUsb()` failure surfaces its error inline without throwing
      - each scanner row renders a Remove button; clicking it calls
        `window.electron.gravi.disableScanner(scannerId)` with **no**
        `window.confirm` gate (per this proposal's design decision)
      - all Remove buttons are disabled while `getScanStatus()` indicates
        `isActive: true` (global gate, not a per-row status check — see
        design.md's "Global scan-active gate" decision), and clicking one
        does not call the disable-scanner IPC; they re-enable once
        `getScanStatus()` next reports `isActive: false`
      - Remove remains enabled per-row for `error`, `dead`, and
        `disconnected` rows when `getScanStatus()` indicates
        `isActive: false` (the global gate is the only thing that disables
        Remove — an individual row's own status does not)
      - a `disableScanner` failure surfaces via the inline `saveError`
        banner and leaves the row visible; success removes the row locally
      - the env-status banner renders distinguishable configured/
        not-configured states from `getGraviScanEnvStatus()` for the
        all-true and all-false cases, **and** explicitly for the mixed
        case (`{ slackConfigured: false, libusbRecoveryEnabled: true }`,
        and its inverse) — assert both states are visually distinguished,
        not just that some text renders — and never renders a webhook URL
        string anywhere in the DOM
      Confirm all fail (component doesn't exist yet).
- [ ] 4.2 Implement `src/renderer/ConfigureScanner.tsx` to satisfy 4.1,
      following `MachineConfiguration.tsx`'s Tailwind conventions
      (`bg-white rounded-lg shadow` cards, `bg-blue-600 text-white
      rounded-md` primary buttons, `border-red-500`/`bg-red-50` error
      styling) rather than the production reference's `rounded-xl`/
      `border-gray-200` variant, for internal consistency with the rest of
      this codebase's pages. Do NOT port `ScannerConfigSection.tsx`/
      `useScannerConfig.ts` (1,508 lines of dead code on the production
      branch) or any `/tmp`-hardcoded path. Confirm all 4.1 tests pass.
- [ ] 4.3 Run `npx tsc --noEmit` and the full `npx vitest run` unit suite;
      fix any fallout.

## 5. Routing & Navigation Wiring

- [ ] 5.1 Add a failing case to `tests/unit/pages/App.test.tsx`, scoped to
      what is actually testable given `App.tsx`'s current
      `<Router initialEntries={['/']}>` (hardcoded, no route-injection
      seam — no existing test navigates to a non-default starting route
      this way): with mode `graviscan`, rendering `<App />` and clicking
      the "Configure Scanner" nav link (added by task 5.4) navigates to
      and renders the ConfigureScanner page content. Do NOT assert a
      direct-URL-redirect case for `cylinderscan` mode here — that half
      (no link exists to click) is already covered by task 5.3's Layout
      test; asserting it via a hardcoded starting route in `App.test.tsx`
      is not achievable without adding a route-injection seam, which is
      out of scope for this proposal.
- [ ] 5.2 Add `{mode === 'graviscan' && (<Route path="configure-scanner" element={<ConfigureScanner />} />)}`
      to `src/renderer/App.tsx`, mirroring the existing
      `{mode === 'cylinderscan' && (...)}` block structure. Confirm 5.1
      passes.
- [ ] 5.3 Add a failing test (new file `tests/unit/pages/Layout.test.tsx`,
      or extend an existing Layout-covering test if one is found during
      implementation) asserting: mode `graviscan` renders a "Configure
      Scanner" nav link pointing to `/configure-scanner`; mode
      `cylinderscan` does not render that link.
- [ ] 5.4 Add a `graviscanLinks` array (parallel to the existing
      `captureLinks`) to `src/renderer/Layout.tsx` containing the
      "Configure Scanner" entry, and gate it with
      `mode === 'graviscan' ? [...alwaysLinks, ...graviscanLinks] : ...`
      alongside the existing `showCaptureLinks` branch. Confirm 5.3 passes.
- [ ] 5.5 Run `npm run lint && npx tsc --noEmit && npm run test:unit`; fix
      any fallout before moving on.

## 6. E2E Coverage

- [ ] 6.1 Extend `tests/e2e/graviscan-ipc.e2e.ts` directly (do not create a
      new E2E file for this): `createGraviScanTestConfig()` and
      `launchElectronApp()` are module-local, unexported functions in that
      file, so reusing them requires adding tests to the same file rather
      than importing them elsewhere. Add a test that launches the app in
      `graviscan` mode with `GRAVISCAN_MOCK=true`, navigates to
      `/configure-scanner`, and asserts: the page renders; clicking
      "Detect Scanners" populates at least one mock scanner row; the
      resolution dropdown options match `GRAVISCAN_RESOLUTIONS` exactly.
      Because this is a full renderer+main E2E test, it cannot usefully
      "fail first" the way a unit test can until the route and page exist
      (tasks 4.2/5.2) — write and land it in the same commit as those
      tasks rather than manufacturing an artificial red state (e.g. via
      `git stash`); confirm it passes once 4/5 are implemented.
- [ ] 6.2 Add an E2E case for the Remove flow: detect scanners, click
      Remove on one row, assert the row disappears after the next status
      refresh (using `GRAVISCAN_MOCK=true`'s mock scanner data).
- [ ] 6.3 Add an E2E case for Reset USB (currently the only one of the
      four headline features — Detect, Save, Remove, Reset USB — with no
      E2E coverage in this task list): detect scanners, click "Reset All
      USB Connections", assert every row immediately shows `starting`,
      then assert the page settles back into a populated scanner list
      after the mock `resetUsb()`/re-detect cycle resolves (using
      `GRAVISCAN_MOCK=true`'s mock scanner data).
- [ ] 6.4 Run `npm run lint && npx tsc --noEmit && npm run test:unit`; fix
      any fallout before moving on.

## 7. Spec & Validation

- [ ] 7.1 Run `npx openspec validate add-graviscan-configure-scanner-ui --strict`
      and resolve any reported issues.
- [ ] 7.2 Run the full existing suite (`npm run test:unit`, relevant
      `tests/unit/graviscan/*`, and the new/changed E2E tests) to confirm
      no regressions, per the roadmap's "No regressions" validation target.
