## Context

This is Tier 1 of `docs/superpowers/plans/2026-07-30-graviscan-renderer-roadmap.md`,
following the GraviScan backend-parity port (PRs #267–#272). The backend
handlers this page needs already exist and are tested
(`src/main/graviscan/scanner-handlers.ts`, registered in
`src/main/graviscan/register-handlers.ts`); the gap is purely renderer +
one preload method + one small new IPC read. A production branch
(`fix/v600-wedge-followups-metadata_propogation_followup`) has a working
`ConfigureScanner.tsx` used for real UX reference, but it has known bugs and
targets a different (larger, per-job-event, `window.electron.graviscan.*`)
preload surface than `main`'s `window.electron.gravi.*` coarse-event surface.
It is reference material only, not something to port line-for-line.

Qualifies for a design doc under the OpenSpec criteria: "Ambiguity that
benefits from technical decisions before coding" (namespace correction,
grid-mode data model mismatch, confirm-dialog convention, env-status channel
placement) and touches multiple modules (renderer, preload, main, types).

**Issue #243** (duplicate-spawn race in `scanner-upsert.ts`'s row-matching
logic) touches the exact code path this page's Detect/Reset-USB UI drives
(`saveScannersToDB()` → `upsertScannerRow()`). It is not treated as a
blocker for this proposal: `main`'s current `scanner-upsert.ts` already
contains the re-enable-on-redetect fix (rows disabled via Remove are
re-enabled rather than duplicated when redetected) and the `usb_port`
fallback-matching/logging that issue #243's author recommended, so the
specific regression described in #243 appears mitigated on `main` today.
It is still worth re-confirming at implementation time, since this
proposal's Detect/Reset-USB flows are the first UI callers to actually
exercise that path end-to-end.

## Goals / Non-Goals

**Goals:**

- Ship a working Configure Scanner page against `main`'s actual, current
  `gravi` preload surface and DB schema — not the production branch's.
- Implement the two already-accepted spec requirements (DPI dropdown,
  Remove button) plus #230 and the minimal #245 banner.
- Avoid the bug patterns the roadmap calls out from the production branch:
  hardcoded platform-specific paths, dead unused code, inconsistent
  destructive-action UX.

**Non-Goals (explicitly deferred):**

- Per-job/per-scanner granular status events (`onScanStarted` etc.) —
  Tier 2's event-model change. This page polls `getScannerStatus()` on an
  interval while any row is `starting`, the same coarse-polling shape
  production's own `useEffect` polling fallback uses, and does not assume
  a per-scanner `onScannerInitStatus` push event exists (it doesn't, on
  `main`).
- Per-scanner grid mode — see Decision below.
- Backend correctness fixes (#234, #231, #232's clamp/validate half) — Tier 2.
- The full pill + modal + "Test Slack" webhook-POST UX from #245's original
  issue text — this ships a minimal inline banner reading two booleans only.

## Decisions

### Decision: One global grid-mode control, not per-scanner

The production reference implementation renders a grid-mode `<select>` per
scanner row, saved by re-calling `saveScannersDb()` with every row's
`grid_mode`. That relies on a per-scanner `GraviScanner.grid_mode` column
that does not exist in `main`'s current Prisma schema (confirmed: only
`GraviScan.grid_mode` — a per-scan record — and `GraviConfig.grid_mode` — a
global singleton — exist; `GraviScanner` has no such column). `main`'s
`getScannerStatus()` handler already documents this as a deliberate port
deviation and sources `gridMode` from the `GraviConfig` singleton, applied
uniformly to every scanner in its response.

Issue #231 ("Per-scanner grid_mode silently fails to save … UPDATE handler
omits the field") independently confirms `scanner-upsert.ts`'s current
`upsertScannerRow()` doesn't even accept/write a `grid_mode` field — so a
per-scanner select wired to `saveScannersToDB()` would be a **silent no-op**
on `main` today. The roadmap already assigns fixing that backend gap to
Tier 2 (bundled with #234).

**Decision:** Configure Scanner exposes exactly one grid-mode control (a
form field alongside resolution), persisted via
`window.electron.gravi.saveConfig({ grid_mode, resolution })` /
`getConfig()` — the currently-working path. When Tier 2 lands real
per-scanner `grid_mode` support, a follow-up can add the per-row control;
this tier does not build UI against a backend path known to silently drop
data.

### Decision: No `window.confirm()` before Remove

The accepted "Per-Scanner Remove Button" requirement's scenarios describe
the click handler calling `disableScanner()` directly and removing the row
optimistically — no confirmation-dialog step appears anywhere in the
numbered behavior or its scenarios. The production reference implementation
adds a `window.confirm()` before calling, inconsistent with its own
toast-vs-banner drift the roadmap already calls out as a pattern to avoid
copying wholesale.

**Decision:** follow the accepted spec literally — clicking Remove calls
`disableScanner()` immediately, no confirmation dialog. This is deliberately
different from `BrowseScans.tsx`'s `window.confirm()` before scan deletion:
scan deletion is irreversible data loss, while disabling a scanner is
reversible (re-detecting brings the row back, per the existing "Scanner
Detection and Persistence" flow) and the spec's own optimistic-removal
framing already assumes no confirmation gate. Flagged as an explicit,
documented choice — not a silent inconsistency — precisely to avoid the
"window.confirm inconsistency" bug class called out in the roadmap.

### Decision: Global scan-active gate instead of per-row status

The accepted "Per-Scanner Remove Button" requirement originally described
disabling Remove "while a scan is actively running on that scanner" —
implying a per-row `scanning` status. That status does not exist:
`getScannerStatus()`'s real return type
(`src/main/graviscan/scanner-handlers.ts`) is exactly
`'ready' | 'starting' | 'error' | 'dead' | 'disconnected'`. A subprocess
that is mid-scan and a subprocess that is merely initializing both report
`starting` — `ScannerSubprocess` only tracks an `isReady` boolean
internally, so `ScanCoordinator.getScannerStatuses()` cannot distinguish
the two cases via this API. Adding a real `scanning` status would require
threading job-lifecycle state through the coordinator and subprocess IPC,
which is coordinator/backend work this proposal is explicitly scoped to
avoid (Tier 2 owns coordinator changes; see Non-Goals).

**Decision:** gate all Remove buttons on the already-available
`window.electron.gravi.getScanStatus()` session-level signal
(`{ isActive: boolean, ... }`) instead of a per-row status. This is a
global gate — every row disables together, not just the row for the
scanner actually mid-scan. That is an honest reflection of the real
architecture, not an approximation of a narrower guard: `ScanCoordinator`
is instantiated once as a module-level singleton
(`src/main/graviscan/wiring.ts`), so the app cannot run two independent
scans concurrently today. A per-row gate would imply a level of isolation
between scanners during an active scan that does not exist; the global
gate is the correct guard for the current single-coordinator design, and
would need revisiting only if/when the coordinator itself gains
per-scanner concurrent-scan isolation.

### Decision: `config:get-graviscan-env-status`, not a `graviscan:*` channel

`register-handlers.ts`'s file header states it is "the ONLY file where
`ipcMain.handle()` calls exist for GraviScan" for the `graviscan:*`
namespace. The #245 env-status read needs `loadEnvConfig(ENV_PATH)`, which
is main.ts/config-store.ts territory (same place `config:get` and
`config:get-mode` already live), not GraviScan-coordinator territory.

**Decision:** add a pure, directly-unit-testable helper
`getGraviScanEnvStatus(config: MachineConfig): { slackConfigured: boolean; libusbRecoveryEnabled: boolean }`
to `src/main/config-store.ts` (parallel to existing `validateConfig`/
`getDefaultConfig` exports), and a thin `ipcMain.handle('config:get-graviscan-env-status', ...)`
in `main.ts` that calls `getGraviScanEnvStatus(loadEnvConfig(ENV_PATH))`.
Exposed on the renderer as `window.electron.config.getGraviScanEnvStatus()`
(added to `ConfigAPI`, not `GraviAPI` — it's a config-store read, and this
keeps `register-handlers.ts`'s single-file invariant for `graviscan:*`
channels intact). Returns booleans only; the webhook URL itself is never
sent to the renderer.

### Decision: Legacy out-of-range resolution — warn, don't silently rewrite

An existing `GraviConfig` row could already have `resolution: 3200` or
`6400` from before this trim (no DB migration is planned — the DPI
requirement is a UI-dropdown restriction, not a schema constraint, and
backend validation is explicitly Tier 2's half of #232). `isValidResolution()`
(new export in `src/types/graviscan.ts`) lets the page detect this on load,
fall the dropdown back to `1200` for display, and show an inline warning
naming the stale value — without calling `saveConfig()` until the operator
explicitly clicks Save. This avoids two bad alternatives: crashing/rendering
an invalid `<option>`, or silently overwriting the DB value before the
operator has agreed to the new one.

## Risks / Trade-offs

- **Found via real CI, not caught during adversarial review or local
  development: re-running the full detect-and-save flow after
  `resetUsb()` races the coordinator and orphans subprocesses.** The
  original design (and the accepted spec's original text, since
  corrected) had `handleResetUsb()` call `handleDetect()` after
  `resetUsb()` resolved, per the "re-run scanner detection" behavior
  the spec used to describe. `resetUsb()`'s backend
  (`src/main/graviscan/scanner-handlers.ts`) already performs its own
  full shutdown → re-detect → match → `coordinator.initialize()` cycle
  internally. Calling `handleDetect()` afterward independently triggers
  a _second_ `coordinator.addScanner()` spawn (via
  `saveScannersToDB()`'s IPC handler, per its #234 fix) for the same
  scanner — and since the subprocess `resetUsb()` just spawned is
  typically still `starting` (not yet `ready`) the instant `resetUsb()`
  resolves, `addScanner()`'s `hasWorker()` check sees no ready worker
  and spawns a second subprocess for the same scanner ID, orphaning the
  first mid-initialization. Confirmed via a real E2E run in CI (both
  scanners ended up stuck `disconnected` after Reset USB, never
  transitioning through `starting` to `ready`) — a unit test with
  mocked IPC calls cannot catch this class of bug, since the mock
  resolves `resetUsb()`/`detectScanners()` instantly with no modeling
  of real subprocess spawn timing. **Fixed**: `handleResetUsb()` now
  only calls `refreshScannerStatus()`/`refreshScanActive()` after
  `resetUsb()` resolves, relying on the page's own polling effect to
  reflect the subprocess's `starting` → `ready` transition, instead of
  re-running detect-and-save. The "Reset USB on Configure Scanner Page"
  requirement and its "fresh detect-and-save cycle" scenario were
  updated to match the corrected (and now-verified) behavior.
- **Reset USB is the most consequential action on this page, and its
  backend has no active-scan guard of its own.** `resetUsb()`
  (`src/main/graviscan/scanner-handlers.ts`) calls
  `coordinator.shutdown()` unconditionally, across every connected
  scanner, with no check for an in-progress scan — a click during a
  live experiment would tear down all scanning subprocesses mid-run.
  This is now mitigated at the UI layer only (see the "Reset USB on
  Configure Scanner Page" requirement's active-scan-blocking scenario
  and the "Reset All USB Connections" label clarifying blast radius):
  the page checks `getScanStatus()` before calling `resetUsb()` and
  blocks the action inline if a scan is active. This is a UI-level
  mitigation, not a backend one — a caller that invokes the
  `graviscan:reset-usb` IPC directly (bypassing this page) is still
  unguarded; a real fix would add the same check inside `resetUsb()`
  itself, which is backend work out of scope for this preload-wiring
  tier.
- **`GraviConfig` has no scan-time reader on `main` today.** Confirmed:
  `startScan()` sources `resolution`/`grid_mode` from caller-supplied
  parameters, not from the `GraviConfig` DB row. This means this page's
  Save action currently has **no observable effect on any real scan** —
  an operator can change and save resolution/grid mode here, and the
  next scan will still run with whatever values its caller happens to
  pass in, until Tier 2/Tier 4 wires `getConfig()`'s result into
  `startScan()`'s parameters. This is stated plainly so the Save button
  is not mistaken for already-wired, scan-affecting behavior — it
  persists the singleton row correctly, but nothing downstream reads it
  yet.
- **Polling instead of push events** for scanner status during
  detect/reset — acceptable for this tier's UX (matches the production
  reference's own polling fallback) but will be superseded once Tier 2's
  granular events land; the polling code should be easy to delete rather
  than deeply intertwined with the rest of the page.
- **No backend DPI validation** — an operator could still end up with an
  out-of-range value if something other than this page writes to
  `GraviConfig` (e.g. a future script). Accepted per the roadmap's explicit
  Tier 1/Tier 2 split of #232.
- **Env-status banner is minimal** — does not verify the webhook actually
  works (no live POST test), only that a URL is present. Explicitly scoped
  down from #245's original ask; flagged in proposal.md so it isn't mistaken
  for the full feature.

## Migration Plan

No database migration. No breaking IPC changes — `getScannerStatus` and
`config:get-graviscan-env-status` are net-new channels; existing channels
are unchanged. Rollback is simply reverting the PR (no persisted state
depends on the new code).

## Open Questions

- Should the env-status banner poll periodically (env vars can only change
  via Machine Configuration, which requires an app restart-equivalent
  reload today) or read once on mount? Current plan: read once on mount,
  since nothing in this app hot-reloads `~/.bloom/.env` into a running
  process — but confirm this assumption holds before implementation if any
  reviewer knows otherwise.
- Whether `config:get-graviscan-env-status` should be gated to only
  register/return meaningful data in `graviscan` mode, or is harmless to
  expose unconditionally (it reads two generic env-backed config fields with
  no GraviScan-specific side effects). Current plan: register
  unconditionally like the other `config:*` handlers, since `ConfigAPI` is
  not itself mode-gated anywhere else in the codebase.
- Whether `1200`'s "production, validated at 140×140 mm" label text (per the
  DPI requirement's Cluster K citation) should be sourced from a shared
  constant now, since the same string will need to appear in a second place
  once `src/renderer/components/graviscan/ScannerConfigSection.tsx` (or
  equivalent) is built in a later tier. Current plan: inline the string in
  `ConfigureScanner.tsx` for this tier and extract only if/when a second
  consumer actually appears (YAGNI), but a reviewer may prefer extracting a
  constant now.
