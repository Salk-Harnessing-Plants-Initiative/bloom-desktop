# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- V600 wedge investigation follow-ups (PR #237, openspec change
  `add-v600-wedge-followups`). Consolidated rollout of 5 bug fixes and
  2 new features surfaced by the 2026-05-06 → 2026-05-18 investigation
  that froze the production rig's V600 USB-wedge behavior.
  - **WedgeDetector** module (`src/main/wedge-detector.ts`, #236): detects
    three wedge signatures from scan-error events — `sane_start_invalid`,
    `device_io_120s_zero_bytes`, `consecutive_failures` — with per-cycle
    dedupe and a recovered-scan path. Wired into the scan-coordinator
    event stream in `main.ts`.
  - **SlackNotifier** module (`src/main/slack-notifier.ts`, #236): POSTs
    a structured wedge alert to a configurable Slack incoming webhook
    (`BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL`). Rate-limited at one
    notification per `(scanner_id, session_id)` per 60 s. AbortController
    fetch timeout (10 s default). Webhook URL never logged. Bounded
    TTL prune on the rate-limit map for long-lived processes.
  - **libusb-filter shim extension** (`src/main/native/libusb-filter.c`,
    #228): added `libusb_clear_halt()`-on-bulk-IN-timeout wrapper for
    Linux scan workers. Opt-out via `LIBUSB_ENDPOINT_RECOVERY=false`
    (case-insensitive). Init log line on subprocess stderr:
    `[libusb-filter] endpoint recovery: on/off`.
  - **DPI dropdown trim** (#232): `GRAVISCAN_RESOLUTIONS` reduced to the
    validated set `[200, 400, 600, 800, 1200, 1600]`. Legacy `3200`/
    `6400` configurations now trigger an amber warning banner on the
    Configure Scanner page asking the operator to re-select. New
    runtime `dpi-warning` event emitted from `scan_worker.py` if a
    non-validated DPI is requested.
  - **Predictive cadence warning banner** (#235): amber banner on the
    continuous-scan form when the estimated cycle wall time exceeds
    the configured interval. Pure `estimateCycleSeconds()` helper +
    `CadenceWarningBanner` component + `cadenceFallbackPlatesPerScanner`
    (worst-case fallback until ScannerPanelState gains gridMode).
  - **Per-scanner Remove button** on the Configure Scanner page (#230 UI
    half, openspec Task 9): new `graviscan:disable-scanner` IPC,
    `coordinator.stopScanner(id)` method, confirmation dialog, inline
    error banner on failure (consistent with the page's other
    save/error feedback).
  - **Mid-scan scanner discovery** (#234): `ScanCoordinator.addScanner()`
    + `hasWorker()` methods + a mid-scan queue so newly-discovered
    scanners come online without an app restart. Mid-scan queue
    re-enters `addScanner()` on cycle-complete to keep the
    `hasWorker` idempotency guard in the loop.

### Fixed

- **V600 wedge fixes** (PR #237, consolidated from openspec
  `add-v600-wedge-followups`):
  - `grid_mode` UPDATE/CREATE persistence in `save-scanners-db` (#231).
    Logic extracted into testable `scanner-upsert.ts:upsertScannerRow`.
  - Stale `GraviScanner` rows are now DISABLED instead of deleted (#230)
    to preserve the FK chain to historical `GraviScan` and
    `GraviScanPlateAssignment` rows. `validate-config` no longer
    deletes rows either. Re-detected previously-disabled rows are
    automatically re-enabled on next save.
  - `USBDEVFS_RESET` ioctl call removed from
    `scan_worker.py:_reopen_device()` (per investigation Section 1.2:
    this ioctl makes V600 wedges worse, not better). The method itself
    is retained for testability and rollback.
  - `scan_worker.py:_scan_plate` now emits `scan-error` with
    `bytes_received` and `wall_seconds` fields. Both timing fields use
    `time.monotonic()` for clock-skew immunity.
  - Orphan scan_worker subprocesses are now stopped when their scanner
    is disabled by `disableStaleScannerRows` (Copilot review #20):
    `stopWorkersForDisabledScanners` helper called after the disable
    step, preventing orphaned workers from holding USB / SANE
    resources.
  - PYTHONPATH cross-platform delimiter (Copilot review #16): now
    derived from `args.platform` (`'win32' ? ';' : ':'`) instead of
    hardcoded `':'`. Fixes module resolution on Windows.
  - Mock-mode banner restored on the GraviScan page (orphaned dead
    code in `ConfigStatusBanner.tsx`; inlined in `GraviScan.tsx` so
    `GRAVISCAN_MOCK=true` shows the "Mock Mode - Simulated scanners"
    text the E2E test asserts).
  - `bytes_received` / `wall_seconds` defensive defaults removed
    (Copilot review #15) so `WedgeDetector`'s missing-fields warning
    fires when a pre-Task-0 Python worker is in the loop. Defaults of
    0 were masking the configuration drift.
- Plant Barcode Validation & Autocomplete in CaptureScan (#74)
  - PlantBarcodeInput component with autocomplete dropdown (top 5 matches)
  - Barcode sanitization: replaces + and spaces with \_, strips other special characters
  - Hard validation against experiment's accession plant barcodes
  - Genotype ID auto-population when valid barcode is selected
  - Duplicate scan prevention (same plant + experiment + day shows warning)
  - Keyboard navigation for autocomplete (arrow keys, Enter to select, Escape to close)
  - IPC handlers: getPlantBarcodes, getGenotypeByBarcode, getMostRecentScanDate
  - ExperimentChooser shows checkmark (✓) indicator for experiments with accessions attached
  - Accessions page displays linked experiments in expandable view (pilot parity)
- Experiments Management UI with full CRUD functionality (#73)
  - Experiments page with list, create, and attach accession sections
  - ExperimentForm with name, species dropdown (15 species), scientist, and accession
  - ExperimentChooser dropdown for CaptureScan (replaces text input)
  - PhenotyperChooser dropdown for CaptureScan (replaces text input)
  - Visibility-aware polling (stops when tab hidden, resumes when visible)
  - Accessibility improvements with proper label associations
  - Navigation link and route for /experiments
- Accessions Management UI with basic CRUD operations (#69)
  - Create accessions with name validation
  - List accessions sorted alphabetically with creation dates
  - Inline name editing with Enter to save, Escape to cancel
  - Delete accessions with confirmation dialog (cascades to plant mappings)
  - Expand accession details to view mapping count
  - State preservation across navigation
- CI disk space management to prevent ENOSPC errors on Ubuntu runners
  - Uses `jlumbroso/free-disk-space` action to free ~20GB
  - Preserves xvfb for headless GUI tests
- GitHub Copilot review command for fetching PR comments via GraphQL

### Fixed

- Zero value persistence for waveNumber and plantAgeDays fields (#91)
  - Fixed save logic using `||` which converted 0 to null
  - Fixed load check using truthy comparison instead of `!== null`
  - Fixed display logic in MetadataForm using `??` instead of `||`
  - Fixed waveNumber min attribute from "1" to "0" to allow zero
- Migration checksum placeholders replaced with real SHA-256 hashes
  - Ensures `prisma migrate status` passes after database upgrade
  - Added CI tests to verify checksums match migration files
- E2E startup delay increased from 100ms to 500ms for all environments
  - Fixes intermittent test timeouts caused by Playwright/Electron race condition
- Database handler using empty string instead of null for optional genotype_id field
- E2E test selectors violating Playwright strict mode
- Limit parameter validation in getRecent database handler (max 100, default 10)

### Changed

- AccessionList component now includes error handling for getMappings, edit, and delete operations
