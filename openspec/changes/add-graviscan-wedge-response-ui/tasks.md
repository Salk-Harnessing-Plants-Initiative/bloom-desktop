## 1. Shared type: `GraviWedgeEvent`

- [x] 1.1 In `src/types/graviscan.ts`, add
      `import type { WedgeDetectedEvent } from '../main/wedge-detector';`
      and `export type GraviWedgeEvent = WedgeDetectedEvent;` (design.md
      Decision 5). This is a type-only declaration — no dedicated test file;
      it's exercised transitively by every test in sections 6-9 that
      imports it. Confirm `npx tsc --noEmit` is clean immediately after
      adding it (before anything consumes it yet).

## 2. Main-process auto-pause + wedge forwarding (`wiring.ts`)

- [x] 2.0 In `tests/unit/graviscan/main-wiring.test.ts`, the
      `describe('setupWedgeDetection', ...)` block has **13 separate,
      independently-declared** `const coordinator = new EventEmitter();`
      mock coordinators (one per `it()`, not a shared `beforeEach`/factory)
      — none has a `stopScanner` method today. Introduce a shared
      `createMockWedgeCoordinator()` helper (an `EventEmitter` with
      `stopScanner: vi.fn().mockResolvedValue(undefined)` attached, e.g.
      via `Object.assign`) and refactor **all 13** of those call sites to
      use it instead of constructing a bare `new EventEmitter()` inline —
      matching the spirit of `session-handlers.test.ts`'s
      `createMockCoordinator()` factory (that file bakes the mock directly
      into a returned object literal rather than via `Object.assign` on an
      `EventEmitter`, since it isn't event-based — the mechanism differs
      but the "one shared factory, not 13 inline copies" principle is the
      same). This must land before 2.1 — patching only some of the 13 sites
      leaves the rest throwing `TypeError: coordinator.stopScanner is not a
function` once `onWedge` calls it (task 2.7).
- [x] 2.1 Add a failing test: drive the coordinator through the existing
      sane_start_invalid wedge scenario (reuse the existing event sequence
      from the current passing test). Assert `coordinator.stopScanner` is
      called exactly once with the wedged scanner's id (spy on the mock
      coordinator's `stopScanner` from 2.0). Confirm it fails (current
      `onWedge` never calls `stopScanner`).
- [x] 2.2 Add a failing test: the `stopScanner` call happens even if
      `SlackNotifier.notify()` would reject/hang — assert `stopScanner` is
      called synchronously within the `onWedge` callback's own call stack,
      not nested inside the async enrich/notify IIFE (i.e. mock
      `enrichWedgeEvent`/the notifier to never resolve, and still assert
      `stopScanner` was called).
- [x] 2.3 Add a failing test: `setupWedgeDetection(coordinator, db,
getMainWindowMock)` where `getMainWindowMock` returns a mock
      `BrowserWindow`-like object with a spyable `webContents.send`. Assert
      `webContents.send` is called with `('graviscan:wedge-detected',
expect.objectContaining({ scanner_id: 'sc-1', signature:
'sane_start_invalid', session_id, cycle_number, error_message }))`.
      Confirm it fails (current signature has no third parameter, no send
      call).
- [x] 2.4 Add a failing test: same wedge scenario, but call
      `setupWedgeDetection(coordinator, db)` (no third argument — the
      existing call shape). Assert no throw, and `stopScanner`/`slackNotifier
.notify` still fire exactly as in 2.1/existing behavior. Confirm it
      passes once 2.7 is implemented without any behavior change for
      omitted-argument callers.
- [x] 2.5 Add a failing test: `getMainWindow` provided but returns a window
      whose `isDestroyed()` is `true` (or returns `null`). Assert `send` is
      NOT called, `stopScanner` and Slack notify still fire, and nothing
      throws.
- [x] 2.6 Add a failing test: on the same sane_start_invalid wedge scenario,
      assert `scanLog` is called with a message matching `/auto-paused
scanner=sc-1 signature=sane_start_invalid session=.* cycle=1/` — the
      NEW log line this proposal adds — **in addition to** the existing,
      already-passing assertion that `scanLog` is still called with the
      pre-existing `wedge-detected ...` message (do not remove or replace
      that existing assertion/call). Confirm the new assertion fails
      (the line doesn't exist yet) while the pre-existing one still passes.
- [x] 2.7 Implement: inside `onWedge`, call `coordinator.stopScanner(evt
.scanner_id)` fire-and-forget with a `.catch()` logging any rejection.
      Keep the existing `scanLog('[WedgeDetector] wedge-detected ...')` line
      unchanged, and add a **second**, new `scanLog(...)` line recording the
      auto-pause (`scanner_id`, `signature`, `session_id`, `cycle_number`) —
      per design.md Decision 1, Decision 3, and Decision 6's code sample.
      Add the optional third parameter `getMainWindow` to
      `setupWedgeDetection()`'s signature (default `null`); inside the
      existing async enrich+notify IIFE, add the guarded
      `win.webContents.send('graviscan:wedge-detected', enriched)` call per
      design.md Decision 6. Update the call site in
      `getOrCreateCoordinator()` (`wiring.ts:382`) to pass `_getMainWindow`.
      Confirm 2.1-2.6 pass.
- [x] 2.8 Run the full existing `main-wiring.test.ts` suite (all wedge
      signature tests: sane_start, device-I/O, consecutive-failures,
      cycle-boundary reset, dedup, recovered-scan, idempotent cycle-start,
      including the pre-existing `wedge-detected` scanLog assertion).
      Confirm every previously-passing test still passes unmodified — this
      is a pure addition to `onWedge`, not a change to detection logic.
- [x] 2.9 Checkpoint: `npm run lint && npx tsc --noEmit && npm run
test:unit`.

## 3. `buildSaneName()` extraction

- [x] 3.1 In `tests/unit/graviscan/scanner-handlers.test.ts`, add a failing
      test for a new export `buildSaneName(usbBus: number, usbDevice:
number): string`: `buildSaneName(3, 7)` → `'epkowa:interpreter:003:007'`,
      plus `buildSaneName(123, 45)` → `'epkowa:interpreter:123:045'`
      (confirms zero-padding on both sides independently). Confirm it
      fails (export doesn't exist yet).
- [x] 3.2 Implement `buildSaneName()` in `src/main/graviscan/
scanner-handlers.ts`, matching the exact format currently inlined at
      `register-handlers.ts:166`. Confirm 3.1 passes.
- [x] 3.3 Refactor `register-handlers.ts`'s spawn-on-discovery block
      (~line 166) to call `buildSaneName(saved.usb_bus, saved.usb_device)`
      instead of the inline template string. Run the existing
      `register-handlers.test.ts` / `graviscan-ipc-integration.test.ts`
      suites covering `save-scanners-db`'s spawn-on-discovery path — confirm
      they still pass unmodified (pure refactor, identical output).
- [x] 3.4 Checkpoint: `npm run lint && npx tsc --noEmit && npm run
test:unit` (this refactor touches production code on the
      spawn-on-discovery path; gate it before section 4 begins).

## 4. `retry-scanner` handler

- [x] 4.1 In `tests/unit/graviscan/session-handlers.test.ts`, add a failing
      test: `retryScanner(coordinator, db, sessionFns, 'sc-1')` with an
      active session, a coordinator mock, and a `db.graviScanner.findUnique`
      mock resolving `{ usb_bus: 3, usb_device: 7, enabled: true }` → calls
      `coordinator.stopScanner('sc-1')` then `coordinator.addScanner({
scannerId: 'sc-1', saneName: 'epkowa:interpreter:003:007', plates: []
})`, resolves `{ success: true }`, and writes a `scanLog()` line
      recording the successful retry. Confirm it fails (export doesn't
      exist).
- [x] 4.2 Add a failing test: `db.graviScanner.findUnique` resolves `null`
      (scanner row not found) → resolves `{ success: false, error: '...' }`;
      `stopScanner`/`addScanner` NOT called.
- [x] 4.3 Add a failing test: found row has `usb_bus: null` (or
      `usb_device: null`, e.g. mid reset-usb) → resolves `{ success: false,
error: '...' }` without calling `addScanner` (design.md Decision 7).
- [x] 4.4 Add a failing test: found row has `enabled: false` → resolves
      `{ success: false, error: '...' }` without calling `addScanner`
      (design.md Decision 7's `enabled` check — a scanner explicitly
      disabled via ConfigureScanner's "Remove" action must not be silently
      respawned by a stale wedge banner).
- [x] 4.5 Add a failing test: no active session (`sessionFns
.getScanSession()` returns `null` or `{ isActive: false, ... }`) →
      resolves `{ success: false, error: '...' }` without calling
      `findUnique`/`stopScanner`/`addScanner`.
- [x] 4.6 Add a failing test: `coordinator` is `null` → resolves
      `{ success: false, error: '...' }` without throwing.
- [x] 4.7 Add a failing test: `stopScanner` resolves but `addScanner`
      rejects → surfaced as `{ success: false, error: msg }` (caught, not
      an unhandled rejection), and a `scanLog()` line records the failed
      retry attempt.
- [x] 4.8 Implement `retryScanner()` in `session-handlers.ts`, using
      `buildSaneName()` from section 3 and a narrow `db` parameter type
      (design.md Decision 7 — not the full `PrismaClient`). Confirm
      4.1-4.7 pass.
- [x] 4.9 In `tests/unit/graviscan/register-handlers.test.ts`, add a failing
      test analogous to the existing `cancel-scan` registration test,
      asserting `ipcMain.handle('graviscan:retry-scanner', ...)` wires the
      DB handle and `sessionFns` through to `sessionHandlers.retryScanner`
      and returns its result via the existing `wrapHandler` shape. Confirm
      it fails (channel not registered).
- [x] 4.10 Update `register-handlers.test.ts`'s hardcoded `CHANNELS` array
      (currently 21 entries, asserted via `toHaveBeenCalledTimes(21)`) to
      add `'graviscan:retry-scanner'` and bump the expected count to 22.
      This existing test WILL fail once 4.11 registers the new channel if
      this task is skipped.
- [x] 4.11 Implement the `ipcMain.handle('graviscan:retry-scanner', ...)`
      registration in `register-handlers.ts`, alongside the existing
      session handlers (~line 318, near `cancel-scan`). Update the file's
      own docstring (`register-handlers.ts:4`, "21 IPC channels") to say 22. Confirm 4.9-4.10 pass.
- [x] 4.12 Checkpoint: `npm run lint && npx tsc --noEmit && npm run
test:unit`.

## 5. `preload.ts` + `electron.d.ts`

- [x] 5.1 In `tests/unit/preload-gravi.test.ts`, extend the existing
      `invokeMethods` array (currently 17 entries) with `retryScanner` →
      `'graviscan:retry-scanner'`, and the existing `listenerMethods` array
      (currently 13 entries) with `onWedgeDetected` →
      `'graviscan:wedge-detected'`, following the file's existing per-method
      pattern (e.g. `getScannerStatus`'s invoke-method assertion,
      `onScanStarted`'s listener-registration/cleanup/payload-forwarding
      assertions). Confirm these fail (the methods don't exist in
      `preload.ts` yet) — this is the test that actually exercises the real
      `preload.ts` module (not a mock), so it's what catches a channel-name
      typo in the implementation.
- [x] 5.2 Add `onWedgeDetected`, `retryScanner` to the `graviAPI` object in
      `src/main/preload.ts`, following the existing `onScanError`/
      `cancelScan` patterns exactly (listener + cleanup function for the
      former; `ipcRenderer.invoke` for the latter). Confirm 5.1 passes.
- [x] 5.3 Add matching members to the `GraviAPI` interface in
      `src/types/electron.d.ts`: `onWedgeDetected: (callback: (event:
GraviWedgeEvent) => void) => () => void;`, `retryScanner: (scannerId:
string) => Promise<{ success: true } | { success: false; error:
string }>;`.
- [x] 5.4 Checkpoint: `npx tsc --noEmit` — this gates all renderer work
      below, which imports `window.electron.gravi.*` through these types.

## 6. Renderer hook: `useWedgeEvents`

- [x] 6.1 Create `tests/unit/hooks/useWedgeEvents.test.ts`. Add a failing
      test: mocking `window.electron.gravi.onWedgeDetected` to synchronously
      invoke its callback with a sample `GraviWedgeEvent` on mount, assert
      the hook's returned state contains one entry keyed by `scanner_id`.
      Confirm it fails (hook doesn't exist).
- [x] 6.2 Add a failing test: firing a second `onWedgeDetected` event for
      the same `scanner_id` (different `cycle_number`/`signature`) results
      in exactly one entry for that scanner, with the newer event's data,
      and any in-progress retry-confirmation sub-state for that entry reset
      to unconfirmed (design.md Decision 2/4).
- [x] 6.3 Add a failing test: firing `onWedgeDetected` for two different
      `scanner_id`s results in two independent entries, and dismissing (or
      confirming retry on) one leaves the other's data and confirmation
      state untouched.
- [x] 6.4 Add a failing test: after at least one wedge event, firing the
      mocked `onIntervalComplete` callback clears all entries.
- [x] 6.5 Add a failing test: after at least one wedge event, firing the
      mocked `onCancelled` callback clears all entries.
- [x] 6.6 Add a failing test: the hook exposes a `dismiss(scannerId)`
      function that removes exactly that entry (backs the Dismiss action —
      no IPC call from the hook itself for this path).
- [x] 6.7 Add a failing test: unmounting the hook calls all three returned
      cleanup functions (`onWedgeDetected`, `onIntervalComplete`,
      `onCancelled` unsubscribes) — no leaked listeners.
- [x] 6.8 Add a failing test: the hook also returns a session-scoped
      `totalAutoPauseEvents` count (design.md Decision 4's "session-level
      auto-pause counter") that increments on every `onWedgeDetected` event
      — including repeats for the same `scanner_id`, unlike the per-scanner
      entry map — and is unaffected by `dismiss()`.
- [x] 6.9 Add a failing test: the hook also returns a
      `totalScannersAffected` count — the size of the set of distinct
      `scanner_id`s that have fired at least one `onWedgeDetected` event
      this session. Firing a second event for a scanner already counted
      (e.g. after a retry) SHALL increment `totalAutoPauseEvents` but SHALL
      NOT increment `totalScannersAffected`; firing an event for a new
      `scanner_id` SHALL increment both.
- [x] 6.10 Add a failing test: both `totalAutoPauseEvents` and
      `totalScannersAffected` reset to `0` when the mocked
      `onIntervalComplete` or `onCancelled` callback fires, at the same
      time the per-scanner entries clear.
- [x] 6.11 Implement `src/renderer/hooks/useWedgeEvents.ts`. Confirm
      6.1-6.10 pass.

## 7. `WedgeBanner` component

- [x] 7.1 Create `tests/unit/components/WedgeBanner.test.tsx`. Add a
      failing test: given one active wedge event (via a mocked
      `useWedgeEvents` return value or the real hook + mocked IPC), the
      component renders a banner showing `scanner_id`/`display_name`,
      `signature`, and `error_message`, with copy indicating the scanner
      has already been paused (not that pausing is pending), styled with
      the existing error severity convention (`bg-red-50 border-2
border-red-500`, matching `ConfigureScanner.tsx`'s `saveError`
      banner). Confirm it fails (component doesn't exist).
- [x] 7.2 Add a failing test: given two active wedge events (different
      scanners), two banner entries render as a vertically-stacked list
      (design.md Decision 4 — no overlap), each independently actionable.
- [x] 7.3 Add a failing test: clicking "Dismiss" on an entry calls the
      hook's `dismiss(scannerId)` and removes that entry; asserts
      `window.electron.gravi.retryScanner` is NOT called.
- [x] 7.4 Add a failing test: clicking "Power-Cycled & Retry" does NOT call
      `retryScanner` yet — it shows a confirmation sub-state containing
      explicit explanatory text about the power-cycle precondition (not
      just bare buttons — design.md Decision 2) plus distinct "Confirm
      Retry" and "Cancel" controls.
- [x] 7.5 Add a failing test: from the confirmation sub-state, clicking
      "Confirm Retry" calls `window.electron.gravi.retryScanner(scannerId)`;
      on `{ success: true }` the entry is removed.
- [x] 7.6 Add a failing test: from the confirmation sub-state, clicking
      "Cancel" reverts to the unconfirmed state without calling
      `retryScanner`.
- [x] 7.7 Add a failing test: clicking "Confirm Retry" when `retryScanner`
      resolves `{ success: false, error }` leaves the entry in place (still
      in the confirmed-but-failed state) and shows the error inline.
- [x] 7.8 Add a failing test: when the hook's `totalAutoPauseEvents` is `0`,
      no counter indicator renders; when it is greater than `0` (e.g.
      `totalAutoPauseEvents: 3, totalScannersAffected: 1`), a small,
      non-dismissible indicator renders showing **both** numbers together
      (e.g. "3 auto-pause events across 1 scanner this session") — not the
      event count alone, since that alone would misrepresent one
      repeatedly-re-wedging scanner as a multi-scanner problem. Distinct
      from, and not removable by dismissing, any per-scanner entry.
- [x] 7.9 Implement `src/renderer/components/WedgeBanner.tsx`, including the
      counter indicator from 7.8. Confirm 7.1-7.8 pass.

## 8. Layout wiring (and fixing pre-existing tests it would otherwise break)

- [x] 8.1 Update `tests/unit/pages/Layout.test.tsx`'s `beforeEach` mock of
      `window.electron` to include a `gravi` object with no-op
      `onWedgeDetected`/`onIntervalComplete`/`onCancelled` (each returning
      an unsubscribe no-op) and a `retryScanner` stub. **This must land
      before task 8.3** — the file's one existing graviscan-mode test
      (rendering `Layout` with `mode="graviscan"`, at line 41) will
      otherwise throw once `WedgeBanner` mounts unconditionally in that
      mode and `useWedgeEvents()` calls `window.electron.gravi
.onWedgeDetected` on `undefined`.
- [x] 8.2 Update `tests/unit/pages/App.test.tsx`'s `mockGraviAPI` (used by
      its three graviscan-mode tests, which render the real `App`→`Layout`
      tree) with the same three no-op methods, for the same reason as 8.1.
- [x] 8.3 In `tests/unit/pages/Layout.test.tsx`, add a failing test:
      rendering `Layout` with `mode === 'graviscan'` renders `WedgeBanner`
      (assert via a test id or mocked-module render check); rendering with
      `mode === 'cylinderscan'` does NOT render it. Confirm it fails
      (not wired yet).
- [x] 8.4 Add a failing test: rendering `Layout` with `mode === 'graviscan'`
      and an arbitrary child route (e.g. the existing `"Home content"`
      stub used elsewhere in this file), with `onWedgeDetected` mocked to
      fire an event on mount — assert the banner's text is visible
      alongside the child route's content. This is the test that actually
      proves the "app-wide, not screen-scoped" requirement (design.md
      Decision 4) — a component-level test of `WedgeBanner` alone (section 7) doesn't prove it renders regardless of which route is active.
- [x] 8.5 Wire `<WedgeBanner />` into `src/renderer/Layout.tsx`, gated on
      `mode === 'graviscan'`, following the existing `showGraviscanLinks`
      conditional pattern (`Layout.tsx:217-227`). Position it as a fixed,
      vertically-stacked strip below the top nav (design.md Decision 4).
      Confirm 8.1-8.4 pass.
- [x] 8.6 Checkpoint: `npm run lint && npx tsc --noEmit && npm run
test:unit`.

## 9. Full regression + spec validation

- [x] 9.1 Run `npm run test:unit` in full. Confirm zero regressions —
      document the before/after test count (by test ID, not just totals),
      matching Tier 1/2's convention.
- [x] 9.2 Run `npm run lint && npx tsc --noEmit`.
- [x] 9.3 Confirm this change adds no `database.*`/`db:*` IPC handlers, so
      the `tests/e2e/renderer-database-ipc.e2e.ts` static coverage gate
      (which reads only `src/main/database-handlers.ts` per
      `scripts/check-ipc-coverage.py`) is unaffected — the new
      `graviscan:retry-scanner` handler lives in `register-handlers.ts`,
      outside that gate's scope. Verified at proposal time; no task needed.
- [x] 9.4 Document (do not attempt) E2E infeasibility: a Playwright E2E
      scenario exercising a real wedge (mock hardware → wedge fires →
      banner appears → Retry) is not attempted in this change.
      `python/graviscan/scan_worker.py`'s mock path (`_mock_scan()`) always
      succeeds and has no fault-injection mechanism (no env var/flag that
      forces a `sane_start`-style exception, a zero-byte file, or a
      row-timeout) — triggering a wedge signature deterministically through
      the existing mock-hardware harness would require adding new
      production fault-injection code to the Python worker, which is out of
      scope for this change (and would pull `python/tests/`'s 80% coverage
      requirement into a UI/IPC-wiring change that otherwise touches no
      Python at all). Rely on sections 2 (main-wiring), 4 (handler), and
      6-8 (renderer) instead.
- [x] 9.5 `openspec validate add-graviscan-wedge-response-ui --strict` —
      resolve every issue before requesting review.
