# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- GraviScan Browse / Experiment Detail / Metadata UI (roadmap Tier 5, #133, #207, #164)
  - `BrowseGraviScans`: filterable, paginated list of graviscan experiments with a wave/accession mismatch warning, a "Backup to Box" action (rclone-unavailable and partial-failure messaging), and a link through to Experiment Detail
  - `ExperimentDetail`: per-experiment scan/file listing with scanner/wave filter chips, resizable columns, file preview, and inline linking/unlinking of wave-scoped metadata (with a durable audit log line on both actions)
  - `Metadata`: spreadsheet upload (multi-sheet support, column auto-mapping, per-row validation, plate-ID/accession/QR format and uniqueness validation before submit — closes #313) and a list of previously uploaded metadata files; parses with `exceljs` rather than `xlsx`/SheetJS, which has two unpatched HIGH-severity CVEs in its only published npm version
  - `createWithSections` now rejects duplicate `plate_section_id` within a plate and duplicate `plant_qr` across the whole upload (new `@@unique([gravi_plate_id, plate_section_id])` constraint plus an application-level cross-plate check), closing #313
  - `Experiments.tsx` now shows each graviscan experiment's linked waves inline and lets a new wave be linked (or an existing one unlinked, confirmation-gated) without a second accession picker
  - Global upload-progress indicator in `Layout` that persists across navigation
  - `docs/graviscan-metadata-spreadsheet-schema.md` documents the expected spreadsheet columns
  - Fixes #286: new experiments now get an explicit `experiment_type` (`'graviscan'` or `'cylinderscan'`) instead of relying on an implicit default
  - See `openspec/changes/add-graviscan-tier5-browse-metadata/` for full design rationale

- CylinderScan style/UX parity pass ([PR #329](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/pull/329), closes [#104](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/104), [#175](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/175), [#106](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/106), [#107](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/107), roadmap Tier 4)
  - Blue/indigo accents replaced with a lime/stone/amber convention (adapted from `bloom-desktop-pilot`'s real usage) across CylinderScan-only pages and shared scan-management/entity-form pages. `WorkflowSteps.tsx` itself is untouched apart from removing its now-unused `cylinderScanSteps` export — GraviScan's own step data, routes, and the shared component's blue badge/hover colors are unchanged; there is no cross-mode color change in this PR
  - `CameraSettings.tsx` now centered in a `max-w-7xl` container with `shadow-sm` panels, matching `CaptureScan.tsx` (folds in and supersedes the standalone `align-page-layout-centering` change)
  - New `CylinderScanWorkflowGuide` component restructures the Home page's workflow guide into "Daily Workflow" / "Setup" sections, replacing the old flat numbered list; built standalone so GraviScan's own workflow guide needed zero changes
  - Home page "Today's Activity" dashboard: recent scans, upload-status breakdown, and a failed-upload banner (CylinderScan-only); new `db:scans:getFailedUploadCount` handler
  - `BrowseScans.tsx` gains a lazy-loaded thumbnail-preview column and a compact camera-settings-summary column (exposure time labeled in the microseconds it's actually stored in, not milliseconds; brightness/contrast omitted as hardcoded, hardware-unsupported identity defaults with no informational value)
  - `Layout.tsx`'s shell/sidebar recolor and the equivalent GraviScan workflow-guide restructure were deferred rather than built against PR #289/#290, which were both still open and actively rewriting those files as of this PR; tracked in follow-up [#328](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/328), blocked until both merge
  - See `openspec/changes/add-cylinderscan-style-ux-parity/` for full design rationale

- Layout sidebar/nav parity (closes [#328](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/328), [#337](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/337)) — picks up the cross-mode work Tier 4 deferred above, now that #289/#290 have merged
  - `Layout.tsx`'s shell background (`bg-gray-50` → `bg-stone-100`), sidebar panel (`bg-white shadow-lg` → `bg-stone-100 border-r border-stone-200`, unified into the shell rather than a separate white panel), and sidebar nav-link colors (base `text-gray-700` → `text-stone-700`; hover → `hover:bg-stone-50 hover:text-stone-900`, no longer lime; active → `bg-stone-50 text-lime-700 font-medium`, no border accent) now match `salk-bloom`'s (the production web app bloom-desktop uploads scans to) real convention, verified directly against its source rather than extrapolated. `lime-700` is contrast-safe against the lighter `bg-stone-50` background (≈4.79:1, clears WCAG AA's 4.5:1 minimum)
  - New `GraviScanWorkflowGuide` component gives GraviScan's Home screen the same "Daily Workflow" (Configure Scanner, Capture Scan, Browse GraviScans) / "Setup" (Scientists, Phenotypers, Metadata, Experiments) restructure CylinderScan got in Tier 4 via `CylinderScanWorkflowGuide`. Capture Scan's and Experiments' descriptions are generalized rather than carried over verbatim from the retired `graviScanSteps` data, which described both in gravitropism-only terms — GraviScan scanners run other kinds of studies too. `WorkflowSteps.tsx` and its `graviScanSteps` data are retired entirely (no remaining consumers)
  - Both scan modes' sidebars are reordered to match their Home page's Daily-Workflow-first structure: CylinderScan — Home, Camera Settings, Capture Scan, Browse Scans, Export Scans, then Setup; GraviScan — Home, Configure Scanner, Capture Scan, Browse GraviScans, then Setup. The default/no-mode order is unchanged
  - Filed as a follow-up, not fixed here: [#354](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/354) — `ConfigureScanner.tsx`'s "Reset USB"/"Remove Scanner" actions have no confirmation guard, worth addressing now that Daily Workflow placement increases how often operators visit that page
  - See `openspec/changes/fix-layout-sidebar-nav-parity/` for full design rationale

- GraviScan wave-scoped metadata linking (`database.experiments.{linkGraviMetadata,unlinkGraviMetadata,listGraviMetadata}`), unblocking the Browse/Experiment Detail/Metadata UI proposal (roadmap Tier 5)
  - `GraviExperimentWaveMetadata` model: one metadata-file link per `(experiment, wave)`, FK to `Experiment` (cascades) and `Accessions` (restricted)
  - `linkGraviMetadata` validates experiment existence/type, accession existence/file-type, and wave-number range before linking; rejects re-linking an already-linked wave rather than silently overwriting
  - `unlinkGraviMetadata` returns a friendly error for a non-existent link instead of a raw database error
  - `graviPlateAccessionsDelete`'s reference-count guard extended to also block deleting a metadata file still referenced by a wave-scoped link
  - Backend/IPC only — no renderer UI in this change

- GraviScan wedge-response UI: auto-pause and operator recovery for USB wedges (#244, #240, #228)
  - When the `WedgeDetector` fires, the wedged scanner's worker is now automatically stopped and excluded from all subsequent cycles — no operator action required to stop the data loss
  - App-wide `WedgeBanner` (visible regardless of which screen the operator is on) shows one entry per auto-paused scanner with its signature and error message
  - Two operator actions per entry: **Dismiss** (acknowledge, no backend effect) and **Power-Cycled & Retry** (confirmation-gated respawn, only after the operator confirms the physical power-cycle is done)
  - Session-scoped counter shows both total auto-pause events and distinct scanners affected, so a single chronically-re-wedging scanner isn't misread as a fleet-wide problem
  - New `graviscan:wedge-detected` push event and `graviscan:retry-scanner` IPC handler; durable `scanLog()` entries record every auto-pause and retry attempt
  - See `openspec/changes/add-graviscan-wedge-response-ui/` for full design rationale

- Idle session timer to prevent scan misattribution in shared lab environments (#102, #116)
  - Main process `IdleTimer` class resets session state after 10 minutes of inactivity
  - Session fields (phenotyper, experiment, wave number, plant age, accession name) cleared on idle
  - Amber notification banner shown in CaptureScan listing all cleared fields and the 10-minute threshold
  - Banner persists across navigation: one-shot `wasIdleResetFlag` in session-store survives route changes
  - Timer restarts on `session:set` (when session has data) and `scanner:initialize`; paused during active scans
  - `session:check-idle-reset` IPC handler for on-mount banner display after navigation-away idle reset
  - `session:reset` handler clears idle-reset flag to prevent stale banners after explicit resets
  - `isScanningRef` updated synchronously on all scan-exit paths (start, complete, error, catch) to close race windows between `setIsScanning()` calls and `useEffect` flushes
  - Scanner null-check moved above `pauseForScan()` to prevent spurious idle clock resets on failed scan attempts
  - E2E tests deferred to issue #124

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
- CI concurrency control for `pr-checks.yml` to stop redundant full-matrix runs from piling up on scarce macOS/Windows runners (closes [#307](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/307))
  - `concurrency` group keyed by workflow + ref; `cancel-in-progress` differentiated by trigger — cancels stale `pull_request` runs, but queues (rather than cancels) `push`-to-`main` runs to preserve each commit's completed CI record where possible
  - Known limitation, documented in-repo: GitHub Actions' default one-pending-run queue depth means a 3rd+ overlapping push to `main` can still silently evict an earlier queued run before it starts; runner contention is still avoided either way
  - `timeout-minutes` added to `test-integration`, `test-e2e-dev`, `test-make`, and `test-make-windows` (evidence-based values from observed run durations), since queuing means a hung job can now block the next queued `main` push's CI, not just its own
  - See `openspec/changes/add-pr-checks-concurrency-control/` for full design rationale
- GitHub Copilot review command for fetching PR comments via GraphQL
- CylinderScan batch scan export page ([PR #300](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/pull/300), closes [#77](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/77), roadmap Tier 3)
  - Export/experiment/date grouped scan selection (checkbox tree), target-directory picker, whole-scan-folder copy preserving `metadata.json` and all images verbatim
  - Rebuilt on current IPC/data conventions rather than ported file-for-file; carries forward the pilot's soft-deleted-scan filtering
  - Metadata-first copy ordering with fail-fast on error, so a failed `metadata.json` copy can't silently leave orphaned image frames
  - See `openspec/changes/archive/2026-08-06-add-cylinderscan-export-page/` for full design rationale; [#302](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/302) filed for a deferred progress-visibility gap (navigating away mid-export)

### Fixed

- CylinderScan config/UX quick fixes from Tier 4 walkthrough ([PR #344](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/pull/344), closes [#333](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/333), [#334](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/334), [#336](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/336), [#338](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/338), [#339](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/339))
  - Fixed stale default `bloom_api_url` (`api.bloom.salk.edu/proxy` → `bloom.salk.edu/api`) in both `config-store.ts` and a second, independent hardcoded copy in `MachineConfiguration.tsx`
  - Machine Configuration now shows a persistent, dismissible "restart required" notice when Scanner Mode changes, instead of the generic auto-dismissing save toast — confirmed `scanner_mode` is the only Machine Config field with this bug
  - Export page's success/partial banners now surface the scan count alongside the file count (e.g. "12 scans exported (73 files)"), not just an ambiguous file count
  - Camera auto-detection relocated from the Camera Settings page into Machine Configuration's Hardware section, replacing its plain text input — Machine Configuration is now the sole place to set `camera_ip_address`
  - "Check Hardware"/"Restart Python" relocated from Home's status panel into Machine Configuration's Hardware section, with a confirm dialog before restart; Home now shows only a simple Connected/Checking/Error indicator
  - Found and fixed via manual E2E smoke-testing: `config:get`'s real IPC handler (`main.ts`) silently omitted `scanner_mode` from its response, making the entire CylinderScan-only Hardware section fail to render in the real app despite passing unit tests that mock the IPC boundary directly; added a permanent E2E regression test since this bug class is invisible to mocked unit tests
  - See `openspec/changes/fix-cylinderscan-config-ux-quickfixes/` for full design rationale; [#337](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/337) (sidebar nav ordering) deferred pending PRs #289/#290; follow-up [#343](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/343) filed for Machine Config UI on 3 manual-`.env`-only fields
- CylinderScan correctness & security hardening ([PR #280](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/pull/280), roadmap Tier 1)
  - Replaced `webSecurity: false` with a custom protocol handler + path-traversal validation for local scan-image access (#93)
  - Added cleanup functions to all 8 preload listeners that were missing them (#96)
  - Replaced `any`-typed fields in `image-uploader.ts` with proper `bloom-fs`/`bloom-js` types (#97)
  - Added request/response correlation to `sendCommand` in `python-process.ts`, closing an IPC race (#47)
  - Added thread-safety guards around `Scanner.is_scanning` check-then-set points in `python/hardware/scanner.py` (#40)
  - `PythonStatus.tsx` and `python/ipc_handler.py`'s `check_hardware()` are now mode-aware, suppressing Camera/DAQ warnings in GraviScan mode (#198)
  - Added `app.requestSingleInstanceLock()` to prevent multiple concurrent app instances corrupting shared SQLite/hardware state (#249)
  - See `openspec/changes/archive/2026-08-05-harden-cylinderscan-tier1/` for full design rationale; [#282](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/282) and [#287](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/287) filed for out-of-scope gaps found during review
- CylinderScan packaging CI + hardware-doc currency ([PR #305](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/pull/305), roadmap Tier 5a)
  - New CI jobs exercise `npm run make` end-to-end on both macOS and Windows, asserting installer artifacts are produced and the packaged app actually renders and initializes its database (#251, #57) — CylinderScan's first Windows packaged-app verification
  - Fixed a real Windows packaging bug found while adding this coverage: unprivileged symlink creation is restricted on Windows, breaking Prisma client resolution on every packaged install; `database.ts` now falls back to a real copy via a new `ensureSymlinkOrCopy()` helper
  - Corrected drifted hardware-validation docs (`CAMERA_TESTING.md`, `DAQ_TESTING.md`, `SCANNER_TESTING.md`, `CONFIGURATION.md`) against already-accepted specs, and added a consolidated `docs/TROUBLESHOOTING.md` (#180)
  - See `openspec/changes/archive/2026-08-06-add-cylinderscan-packaging-ci/` for full design rationale; [#293](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/293)–[#296](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/296) and [#303](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/303) filed for out-of-scope follow-ups
- CylinderScan delete/upload data-integrity hardening (#79, #105, #120)
  - `db:scans:delete` now also marks the scan's on-disk `metadata.json` as `deleted: true`, keeping it in sync with the (still soft-delete-only) database row
  - Delete affordance added to `ScanPreview.tsx`; both it and `BrowseScans.tsx` now share a real `DeleteConfirmModal` (Plant ID + capture date) instead of `BrowseScans`' previous generic `window.confirm()`
  - `BrowseScans.tsx`'s Delete button is now also disabled while that scan's upload is in flight
  - `image-uploader.ts`: `uploadScan`/`uploadBatch` now skip soft-deleted scans; retry now skips images already marked `'uploaded'` instead of resending them (closing a duplicate-remote-row risk), with a regression test guarding the filtered-array index-safety this depends on
  - `image-uploader.ts`: freshly-uploaded images are now independently verified against Supabase storage (not just trusted from bloom-fs's callback) before being marked `'uploaded'` locally, with a bounded 3-attempt retry distinguishing confirmed-missing from a transient lookup failure — closes a real incident where a failed-then-retried upload was marked succeeded without the bytes actually landing in storage
  - `db:scans:checkDuplicate` replaces the old same-day/(plant_id + experiment_id) duplicate warning in `CaptureScan.tsx` with the correct `(plant_id, experiment_id, wave_number, plant_age_days)` key; `db:scans:getMostRecentScanDate` removed as dead code
  - See `openspec/changes/add-cylinderscan-delete-upload-integrity/` for full design rationale and follow-up issues filed for out-of-scope items (local↔cloud UUID traceability, a widened upload-audit/reconciliation tool, Basler acquisition-metadata readback)
- GraviScan `retry-scanner` reporting success when a respawned worker silently fails to come online (#283)
  - `retryScanner()` now checks `coordinator.getScannerStatuses()` immediately after `addScanner()` resolves and returns `{ success: false, error }` if the scanner isn't reported `'ready'` — `addScanner()`/`spawnSingleScanner()` never throw on spawn failure, so a resolved promise alone didn't mean the worker actually came online
  - Retry outcome log lines (`scanLog()`) now also include `session_id`, for cross-session log correlation
  - No renderer changes — `WedgeBanner.tsx` already handled `{ success: false, error }` correctly
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
