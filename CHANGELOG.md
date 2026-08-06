# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
- GitHub Copilot review command for fetching PR comments via GraphQL

### Fixed

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
