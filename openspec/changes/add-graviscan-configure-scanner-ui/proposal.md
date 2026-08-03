## Why

`main` has zero GraviScan renderer code today — selecting GraviScan mode in
Machine Configuration routes into CylinderScan screens that never call
GraviScan IPC. Two already-accepted OpenSpec requirements
(`ui-management-pages`: "DPI Dropdown Restricted to Validated Set" and
"Per-Scanner Remove Button on Configure Scanner Page") already describe a
`src/renderer/ConfigureScanner.tsx` page that does not exist yet, and the
backend it depends on (`graviscan:get-scanner-status`, confirmed implemented
at `src/main/graviscan/register-handlers.ts:222`) was never wired into the
preload bridge during the recent GraviScan backend-parity port (PRs
#267–#272). This is Tier 1 of
`docs/superpowers/plans/2026-07-30-graviscan-renderer-roadmap.md`.

Two tracked issues motivate the specific scope:

- **#230** — after a USB reconfiguration, stale `GraviScanner` rows persist
  and there is no in-app way to disable them (the underlying
  `graviscan:disable-scanner` IPC handler already exists and is spec'd under
  `machine-configuration`, but nothing calls it). This proposal's Remove
  button work resolves it.
- **#245** — there is no UI indicator for whether
  `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL` / `LIBUSB_ENDPOINT_RECOVERY` are
  configured; an operator whose Slack webhook is silently misconfigured gets
  no wedge alerts and may not notice for hours. This proposal adds a small
  inline banner (not the full pill/modal/"Test Slack" UX from the issue's
  original proposal, which needs a live webhook POST and is deferred).
  Note: issue #245's own body specifically argues **against** a banner form
  factor, favoring a status pill plus a modal with a live "Test Slack"
  action. This proposal deliberately ships the simpler inline banner
  anyway, scoped to this tier's minimal goal (surface two booleans, no live
  webhook POST) rather than silently adopting the pill/modal form the issue
  argued against; the full pill/modal/Test-Slack UX remains explicitly
  deferred to a later tier, as called out in "Out of scope" below.

## What Changes

- Add `src/renderer/ConfigureScanner.tsx` — a new GraviScan-only page
  (route `/configure-scanner`) covering: detect scanners → auto-assign
  display names → persist to DB; a global resolution + grid-mode form
  backed by the `GraviConfig` singleton; a Reset USB action; a per-scanner
  Remove button; and a small env-var status banner.
- Mode-gate the new route in `src/renderer/App.tsx` inside a
  `{mode === 'graviscan' && (...)}` block (matching the existing
  `{mode === 'cylinderscan' && (...)}` pattern) and add a corresponding nav
  link in `src/renderer/Layout.tsx`'s mode-gated link list.
- Add `getScannerStatus` to the `graviAPI` object in `src/main/preload.ts`
  and to the `GraviAPI` interface in `src/types/electron.d.ts` — the one
  preload-wiring gap left from the backend port (the `graviscan:get-scanner-
status` `ipcMain.handle` already exists and is already tested).
- Trim `GRAVISCAN_RESOLUTIONS` in `src/types/graviscan.ts` from
  `[200,400,600,800,1200,1600,3200,6400]` to `[200,400,600,800,1200,1600]`,
  implementing the already-accepted "DPI Dropdown Restricted to Validated
  Set" requirement (no spec text change needed — the requirement already
  states the target array; only the code needs to catch up). Add a small
  `isValidResolution()` type guard to `src/types/graviscan.ts` so the new
  page can detect and warn about a legacy 3200/6400 value already saved in
  an existing `GraviConfig` row, without a DB migration.
- Implement the already-accepted "Per-Scanner Remove Button" requirement,
  and **correct that requirement's spec text**: it currently illustrates the
  call as `window.electron.graviscan.disableScanner(scannerId)`, but the
  actual, current preload namespace on `main` is `window.electron.gravi.*`
  (confirmed in `src/main/preload.ts:412` — `gravi: graviAPI`). This is a
  MODIFIED requirement in this proposal's `ui-management-pages` spec delta,
  correcting the illustrative code to the real namespace; the implementation
  was never going to use the wrong namespace, but the spec text itself needs
  to stop saying otherwise.
- Add a small `config:get-graviscan-env-status` IPC read (new
  `getGraviScanEnvStatus()` pure helper in `src/main/config-store.ts`, wired
  in `src/main/main.ts` next to the other `config:*` handlers) returning
  `{ slackConfigured: boolean; libusbRecoveryEnabled: boolean }` — booleans
  only, never the secret webhook URL — for issue #245's banner.
- Add a MODIFIED `scanning` capability requirement fixing a stale
  `/scanner-config` placeholder route name in "Mode-Aware Routing" to the
  actual `/configure-scanner` route, plus a new scenario confirming it is
  visible in `graviscan` mode and absent in `cylinderscan` mode.
- Add an ADDED `scanning` capability requirement, "Configure Scanner
  Navigation Link", for the new `Layout.tsx` nav item (Configure Scanner is
  not one of the six named home-page workflow steps, so `Home.tsx` /
  `WorkflowSteps.tsx` are untouched — per the roadmap's cross-cutting nav
  note).

**Notable design finding (see `design.md`):** the accepted
`machine-configuration` requirement "Per-Scanner grid_mode Persistence"
describes a per-scanner `GraviScanner.grid_mode` field that does **not**
exist in the current Prisma schema (confirmed: `GraviScanner` has no
`grid_mode` column; only `GraviScan` and the `GraviConfig` singleton do) and
is not implemented by `scanner-upsert.ts` — this matches issue #231
("per-scanner grid_mode silently fails to save"), which the roadmap already
assigns to Tier 2. This proposal's Configure Scanner page therefore exposes
**one global** grid-mode control backed by the working `GraviConfig`
singleton (`graviscan:save-config`/`graviscan:get-config`), not a
per-scanner control wired to the currently-broken path — avoiding building
new UI on top of a known-broken backend no-op.

## Impact

- Affected specs:
  - `ui-management-pages` — MODIFIED "Per-Scanner Remove Button on Configure
    Scanner Page" (namespace correction only); ADDED "Scanner Detection and
    Persistence on Configure Scanner Page", "Resolution and Grid Mode
    Configuration on Configure Scanner Page", "Reset USB on Configure
    Scanner Page", "GraviScan Environment Variable Status Banner".
  - `scanning` — MODIFIED "Mode-Aware Routing" (route-name correction +
    graviscan-mode scenario); ADDED "Configure Scanner Navigation Link".
- Affected code: `src/renderer/ConfigureScanner.tsx` (new),
  `src/renderer/App.tsx`, `src/renderer/Layout.tsx`, `src/main/preload.ts`,
  `src/types/electron.d.ts`, `src/types/graviscan.ts`,
  `src/main/config-store.ts`, `src/main/main.ts`.
- Out of scope (deferred to later tiers per the roadmap): #197
  (mock-hardware toggle), #198 (PythonStatus mode-awareness), #234
  (detect-scanners doesn't spawn workers), #231 (per-scanner grid_mode
  backend fix — see finding above), #232's backend-correctness half (V600
  silently rounding DPI), all `database.graviscans.*`/session/plate-
  accession DB data-layer work, the core scan-operation screen, wedge-
  response UI, and Browse/Experiment-Detail/Metadata screens. The full
  pill + modal + "Test Slack" UX described in #245's original proposal is
  also deferred — this tier ships the minimal inline status banner only.
