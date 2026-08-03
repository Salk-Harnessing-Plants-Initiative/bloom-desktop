## MODIFIED Requirements

### Requirement: Per-Scanner Remove Button on Configure Scanner Page

The Configure Scanner page SHALL render a `Remove` button per scanner
row. When clicked, the button SHALL:

1. Call `window.electron.gravi.disableScanner(scannerId)` (which
   in turn invokes the `graviscan:disable-scanner` IPC; see
   machine-configuration capability).
2. Optimistically remove the row from the visible scanner list (the
   IPC's success will be confirmed by a subsequent
   `get-scanner-status` refresh, which filters `enabled=true`).
3. Show a toast or inline confirmation on success/failure.

The button SHALL be visible on every scanner row, regardless of
whether the row is currently in `disconnected`, `starting`, `error`,
`dead`, or `ready` state. The button SHALL be disabled (grayed) for
ALL rows while a scan is active anywhere, per the global gate
described in the scenario below.

#### Scenario: Remove button appears on each scanner row

- **GIVEN** the Configure Scanner page lists N scanner rows
- **WHEN** the rows are rendered
- **THEN** each row SHALL show a Remove button

#### Scenario: Clicking Remove disables the scanner

- **GIVEN** a scanner row for scanner_id `A` is displayed
- **WHEN** the operator clicks the Remove button
- **THEN** `window.electron.gravi.disableScanner('A')` SHALL be
  called
- **AND** on success, the row SHALL disappear from the scanner list
  on the next status refresh

#### Scenario: Remove button is disabled during active scan (global gate)

- **GIVEN** `window.electron.gravi.getScanStatus()` indicates
  `isActive: true` (a scan is running somewhere in the app)
- **WHEN** the scanner rows are rendered
- **THEN** every row's Remove button SHALL be disabled (`disabled`
  attribute set) and visually grayed, regardless of that row's own
  `status` value
- **AND** clicking any of them SHALL NOT call the disable-scanner IPC
- **AND** once `getScanStatus()` next reports `isActive: false`, the
  Remove buttons SHALL become enabled again (subject to the
  per-status rule in the next scenario)

  Note: this is a global gate on the session-level "is a scan
  active" signal, not a per-row status check. The real
  `getScannerStatus()` status union
  (`'ready' | 'starting' | 'error' | 'dead' | 'disconnected'`,
  confirmed in `src/main/graviscan/scanner-handlers.ts`) has no
  `scanning` value — a subprocess that is mid-scan is indistinguishable
  from one that is merely initializing, because `ScannerSubprocess`
  only exposes an `isReady` flag and both cases report `starting` (see
  `src/main/graviscan/scan-coordinator.ts`'s `getScannerStatuses()`).
  A per-row `scanning` check is therefore not implementable without a
  coordinator/backend change, which is out of scope for this proposal
  (Tier 2 owns coordinator changes). Since `ScanCoordinator` is a
  module-level singleton (`src/main/graviscan/wiring.ts`) and
  concurrent multi-experiment scanning is architecturally impossible
  today, gating every Remove button on "is any scan active anywhere"
  is not a meaningful narrowing compared to a real per-row gate — it
  is the accurate expression of the current architecture.

#### Scenario: Remove remains enabled per-row for non-active-scan statuses

- **GIVEN** `getScanStatus()` indicates `isActive: false`
- **WHEN** a scanner row's status is `error`, `dead`, or
  `disconnected`
- **THEN** that row's Remove button SHALL remain enabled (the global
  gate only disables Remove while a scan is actually active; being
  errored/dead/disconnected does not itself disable Remove)

#### Scenario: Failure surfaces an inline error message

- **GIVEN** the disable-scanner IPC returns `{ ok: false, error: msg }`
- **WHEN** the response arrives
- **THEN** the UI SHALL surface the error message via the
  ConfigureScanner page's inline save-error banner
  (`setSaveError(\`Failed to remove scanner: ${err}\`)`) so the
  operator sees the failure without leaving the page or chasing a
  fading toast
- **AND** the scanner row SHALL remain visible until the operator
  retries or dismisses the banner

#### Scenario: Success removes the row optimistically on the same page

- **GIVEN** the disable-scanner IPC returns `{ ok: true }`
- **WHEN** the response arrives
- **THEN** the UI SHALL remove the row from the local scanner list
  immediately (`setScanners((prev) => prev.filter(...))`) — the
  visual confirmation is the row disappearing from the page
- **AND** the scanner list SHALL refresh on the next
  `get-scanner-status` poll to confirm the removal against the DB

(Note: the original spec called for `useToast.showToast` for both
the success and failure paths. Per Cluster D (commit 4540537) the
implementation uses the existing inline `saveError` banner pattern
on the ConfigureScanner page, which is consistent with the page's
other save/error feedback and avoids introducing a new toast
dependency. The spec was updated to match the shipped behavior;
re-introducing toasts is a future-redo concern.)

(Note: the illustrative code above previously read
`window.electron.graviscan.disableScanner(...)`. `main`'s actual
preload namespace exposes GraviScan operations under
`window.electron.gravi.*` — confirmed in `src/main/preload.ts`
(`contextBridge.exposeInMainWorld('electron', { ..., gravi: graviAPI })`)
and `src/types/electron.d.ts` (`ElectronAPI.gravi: GraviAPI`). This is a
spec-text correction only; no behavior changes as a result — the
implementation was always going to use the real namespace.)

---

## ADDED Requirements

### Requirement: Scanner Detection and Persistence on Configure Scanner Page

The Configure Scanner page SHALL provide a "Detect Scanners" action
that calls `window.electron.gravi.detectScanners()`, auto-assigns a
`display_name` of `Scanner N` to each detected scanner ordered by
`usb_port`, and persists the result via
`window.electron.gravi.saveScannersToDB()`. After a successful save,
the page SHALL reload its list via
`window.electron.gravi.getScannerStatus()` so the visible rows
reflect the merged DB + live coordinator state (one of `ready`,
`starting`, `error`, `dead`, `disconnected`).

#### Scenario: Detect populates the scanner list

- **GIVEN** the Configure Scanner page is open with no scanners listed
- **WHEN** the operator clicks "Detect Scanners" and
  `detectScanners()` returns one or more scanners
- **THEN** the scanners SHALL be saved via `saveScannersToDB()`
- **AND** the page SHALL display the saved scanners after reloading
  status via `getScannerStatus()`

#### Scenario: Detect with zero scanners surfaces an inline error

- **GIVEN** the operator clicks "Detect Scanners"
- **WHEN** `detectScanners()` returns `{ success: true, scanners: [] }`
- **THEN** the page SHALL show an inline error such as "No scanners
  detected. Check USB connections."
- **AND** SHALL NOT call `saveScannersToDB()`

#### Scenario: Detect failure surfaces the returned error inline

- **GIVEN** the operator clicks "Detect Scanners"
- **WHEN** `detectScanners()` returns `{ success: false, error: msg }`
- **THEN** the page SHALL display `msg` in an inline error area
- **AND** SHALL NOT call `saveScannersToDB()`

#### Scenario: Save failure surfaces the returned error without clearing the list

- **GIVEN** detection succeeded and `saveScannersToDB()` is called
- **WHEN** `saveScannersToDB()` returns `{ success: false, error: msg }`
- **THEN** the page SHALL display `msg` in an inline error area
- **AND** the previously-displayed scanner list SHALL remain unchanged

#### Scenario: Page polls status while any scanner is starting

- **GIVEN** at least one scanner row currently has status `starting`
- **WHEN** the page is mounted
- **THEN** the page SHALL periodically re-call `getScannerStatus()`
  until no row remains in `starting` status
- **AND** the page SHALL NOT poll when no row is `starting`

---

### Requirement: Resolution and Grid Mode Configuration on Configure Scanner Page

The Configure Scanner page SHALL provide a single, global resolution
selector sourced from `GRAVISCAN_RESOLUTIONS` (per the "DPI Dropdown
Restricted to Validated Set" requirement) and a single, global grid
mode selector (`2grid` / `4grid`), persisted together via
`window.electron.gravi.saveConfig({ resolution, grid_mode })` and
loaded via `window.electron.gravi.getConfig()`. This control is
global, not per-scanner: `main`'s `GraviScanner` Prisma model has no
per-scanner `grid_mode` column (only `GraviScan` and the `GraviConfig`
singleton do), matching `graviscan:get-scanner-status`'s own documented
behavior of applying one `GraviConfig`-sourced `gridMode` uniformly to
every scanner row.

If the persisted `GraviConfig.resolution` is not a member of
`GRAVISCAN_RESOLUTIONS` (a legacy value saved before the DPI dropdown
was restricted), the page SHALL fall the dropdown back to `1200` for
display and show an inline warning naming the stale value, without
calling `saveConfig()` until the operator explicitly saves.

Because the `1200` fallback display is visually indistinguishable
from an operator deliberately choosing `1200`, the page SHALL NOT
allow a plain, unmodified Save click to silently persist the
fallback value as if it were a confirmed choice. While the
legacy-value warning is showing, the Save button SHALL remain
disabled until the operator has explicitly interacted with the
resolution selector (e.g. re-selecting a value, including
re-selecting `1200`) — this interaction is treated as the operator's
affirmative re-confirmation of the resolution to persist.

#### Scenario: Save is disabled until the operator re-confirms a legacy resolution

- **GIVEN** a `GraviConfig` row exists with `resolution: 6400` and
  the page has fallen the selector back to `1200` with the stale-value
  warning showing
- **WHEN** the page has just mounted and the operator has not yet
  touched the resolution selector
- **THEN** the "Save" button SHALL be disabled
- **AND** clicking it (if somehow triggered) SHALL NOT call
  `saveConfig()`
- **WHEN** the operator then interacts with the resolution selector
  (selecting any value, including re-selecting `1200`)
- **THEN** the "Save" button SHALL become enabled

#### Scenario: Loads persisted resolution and grid mode into the form

- **GIVEN** a `GraviConfig` row exists with `resolution: 600` and
  `grid_mode: '4grid'`
- **WHEN** the Configure Scanner page mounts
- **THEN** the resolution selector SHALL show `600`
- **AND** the grid mode selector SHALL show `4grid`

#### Scenario: Legacy out-of-range resolution triggers fallback and warning

- **GIVEN** a `GraviConfig` row exists with `resolution: 3200`
- **WHEN** the Configure Scanner page mounts
- **THEN** the resolution selector SHALL display `1200`
- **AND** an inline warning SHALL name the stale value `3200`
- **AND** `saveConfig()` SHALL NOT be called automatically

#### Scenario: Saving resolution and grid mode calls saveConfig

- **GIVEN** the operator has changed the resolution and/or grid mode
  selectors
- **WHEN** the operator clicks "Save"
- **THEN** `window.electron.gravi.saveConfig({ resolution, grid_mode })`
  SHALL be called with the selected values
- **AND** on success, a transient success message SHALL be shown

---

### Requirement: Reset USB on Configure Scanner Page

The Configure Scanner page SHALL provide a "Reset All USB
Connections" action (labeled to make clear it affects every
connected scanner, not a single row — `resetUsb()`'s backend
implementation unconditionally shuts down the entire
`ScanCoordinator`, per `src/main/graviscan/scanner-handlers.ts`) that
calls `window.electron.gravi.resetUsb()`. Adjacent explanatory text
SHALL state that this action resets ALL connected scanners
simultaneously.

Before invoking `resetUsb()`, the page SHALL check
`window.electron.gravi.getScanStatus()`. If it indicates
`isActive: true`, the action SHALL be blocked: the page SHALL show an
inline message (e.g. "Cannot reset USB while a scan is in progress")
and SHALL NOT call `resetUsb()`.

When no scan is active, clicking the action SHALL immediately mark
every currently-listed scanner row as `starting` for immediate visual
feedback, then refresh scanner status (`getScannerStatus()`) and the
scan-active gate once `resetUsb()` resolves, regardless of its result.
The page SHALL NOT re-run the full detect-and-save flow (`detectScanners()`

- `saveScannersToDB()`) after `resetUsb()`: `resetUsb()`'s backend
  implementation already shuts down, re-detects, and re-initializes the
  coordinator internally (`src/main/graviscan/scanner-handlers.ts`), and
  re-running detect independently races the subprocess `resetUsb()` just
  spawned — the newly-spawned subprocess is typically still `starting`
  (not yet `ready`) the instant `resetUsb()` resolves, so a second
  `saveScannersToDB()` call's `!coordinator.hasWorker(id)` check sees no
  ready worker and spawns a **second** subprocess for the same scanner,
  orphaning the first mid-initialization and leaving the scanner stuck
  `disconnected` (confirmed via a real multi-process E2E run, not merely
  suspected — a unit test with mocked IPC calls cannot catch this class of
  bug since it doesn't model subprocess timing). A status refresh plus the
  page's own polling effect (see "Scanner Detection and Persistence...")
  is sufficient to reflect `resetUsb()`'s outcome as its subprocesses come
  up. A `resetUsb()` failure SHALL surface the returned error message
  inline and SHALL NOT crash the page.

#### Scenario: Reset USB is blocked while a scan is active

- **GIVEN** `window.electron.gravi.getScanStatus()` indicates
  `isActive: true`
- **WHEN** the operator clicks "Reset All USB Connections"
- **THEN** the page SHALL show an inline message such as "Cannot
  reset USB while a scan is in progress"
- **AND** `window.electron.gravi.resetUsb()` SHALL NOT be called

#### Scenario: Clicking Reset USB immediately marks all rows starting

- **GIVEN** the Configure Scanner page lists scanners with mixed
  statuses, and `getScanStatus()` indicates `isActive: false`
- **WHEN** the operator clicks "Reset All USB Connections"
- **THEN** every listed row SHALL immediately show status `starting`,
  before `resetUsb()` resolves

#### Scenario: Reset USB success refreshes status without re-running detect

- **GIVEN** the operator has clicked "Reset All USB Connections"
  (no scan was active)
- **WHEN** `resetUsb()` resolves with `{ success: true }`
- **THEN** the page SHALL call `getScannerStatus()` and `getScanStatus()`
  to refresh the visible rows and the scan-active gate
- **AND** the page SHALL NOT call `detectScanners()` or
  `saveScannersToDB()` as part of this flow

#### Scenario: Reset USB failure surfaces an inline error

- **GIVEN** the operator has clicked "Reset All USB Connections"
  (no scan was active)
- **WHEN** `resetUsb()` resolves with `{ success: false, error: msg }`
- **THEN** the page SHALL display `msg` in an inline error area
- **AND** SHALL NOT throw an unhandled error

---

### Requirement: GraviScan Environment Variable Status Banner

The Configure Scanner page SHALL display a small inline banner
surfacing whether `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL` and
`LIBUSB_ENDPOINT_RECOVERY` are configured, backed by
`window.electron.config.getGraviScanEnvStatus()`. The banner SHALL
show configured/not-configured state for each value without ever
displaying the webhook URL itself (only a boolean derived from its
presence is transmitted to the renderer).

#### Scenario: Both env vars configured

- **GIVEN** `getGraviScanEnvStatus()` resolves to
  `{ slackConfigured: true, libusbRecoveryEnabled: true }`
- **WHEN** the Configure Scanner page renders
- **THEN** the banner SHALL indicate both are configured/enabled
- **AND** SHALL NOT render the webhook URL value anywhere in the DOM

#### Scenario: Slack webhook not configured

- **GIVEN** `getGraviScanEnvStatus()` resolves to
  `{ slackConfigured: false, libusbRecoveryEnabled: true }`
- **WHEN** the Configure Scanner page renders
- **THEN** the banner SHALL visually distinguish the "not configured"
  Slack state from the "configured" libusb-recovery state (e.g. via
  color or icon), so the operator does not need to read closely to
  notice a missing wedge-alert channel
