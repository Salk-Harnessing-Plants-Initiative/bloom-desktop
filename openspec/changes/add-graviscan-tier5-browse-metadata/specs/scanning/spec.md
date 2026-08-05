## MODIFIED Requirements

### Requirement: Mode-Aware Routing

The app SHALL conditionally render routes based on the configured scanner mode. Capture and config routes are mode-gated. Shared browse/view routes (`/browse-scans`, `/scan/:scanId`, `/experiments`) are always visible regardless of mode. Mode-specific browse/detail/metadata routes (e.g. GraviScan's `/browse-graviscans`, `/graviscan-experiment/:experimentId`, `/metadata`) are mode-gated the same way capture/config routes are, since they query data or link resources meaningless outside their owning mode. The app SHALL show a loading state until the mode is resolved from the main process.

#### Scenario: CylinderScan capture routes visible in cylinderscan mode

- **GIVEN** scanner mode is `cylinderscan`
- **WHEN** the app renders routes
- **THEN** `/capture-scan` and `/camera-settings` routes SHALL be available
- **AND** `/graviscan`, `/configure-scanner`, `/browse-graviscans`, `/graviscan-experiment/:experimentId`, and `/metadata` routes SHALL NOT be available (`/graviscan` when added in a later increment)

#### Scenario: GraviScan configure-scanner and browse/detail/metadata routes visible in graviscan mode

- **GIVEN** scanner mode is `graviscan`
- **WHEN** the app renders routes
- **THEN** the `/configure-scanner`, `/browse-graviscans`, `/graviscan-experiment/:experimentId`, and `/metadata` routes SHALL be available
- **AND** `/capture-scan` and `/camera-settings` routes SHALL NOT be available

#### Scenario: Browse routes always visible

- **GIVEN** any scanner mode (cylinderscan, graviscan, or full)
- **WHEN** the app renders routes
- **THEN** `/browse-scans`, `/scan/:scanId`, and `/experiments` routes SHALL always be available

#### Scenario: Loading state while mode resolves

- **GIVEN** the app has just launched
- **WHEN** the `useAppMode()` hook is fetching the mode via IPC
- **THEN** the app SHALL display a loading indicator
- **AND** no routes SHALL be rendered until mode is known
- **AND** no flash of wrong routes SHALL occur

#### Scenario: Unknown route redirects to home

- **GIVEN** any scanner mode
- **WHEN** the user navigates to a route that does not exist or was removed by mode gating
- **THEN** the app SHALL redirect to `/`

#### Scenario: Empty mode (first run) redirects to machine config

- **GIVEN** no config exists or scanner_mode is empty string
- **WHEN** the `useAppMode()` hook resolves with mode `''`
- **THEN** the app SHALL redirect to `/machine-config`
- **AND** no capture or browse routes SHALL be rendered

### Requirement: Mode-Aware Home Page

The Home page SHALL display a numbered workflow guide specific to the configured scanner mode. Each step is a clickable card that navigates to the relevant page. GraviScan's "Metadata" and "Browse Scans" steps navigate to dedicated GraviScan-specific pages, not a CylinderScan-shared route or an alias of another step.

#### Scenario: CylinderScan workflow steps

- **GIVEN** scanner mode is `cylinderscan`
- **WHEN** the Home page renders
- **THEN** the workflow steps SHALL be: Scientists → Phenotypers → Accessions → Experiments → Camera Settings → Capture Scan → Browse Scans
- **AND** each step SHALL be clickable and navigate to the corresponding page

#### Scenario: GraviScan workflow steps

- **GIVEN** scanner mode is `graviscan`
- **WHEN** the Home page renders
- **THEN** the workflow steps SHALL be: Scientists → Phenotypers → Metadata → Experiments → Capture Scan → Browse Scans
- **AND** "Metadata" SHALL navigate to `/metadata` (a dedicated GraviScan metadata upload/list page, not an alias of the "Experiments" step's `/experiments` route)
- **AND** "Browse Scans" SHALL navigate to `/browse-graviscans` (GraviScan's own browse page, not CylinderScan's shared `/browse-scans` route)
- **AND** each other step SHALL be clickable and navigate to the corresponding page

#### Scenario: First-run redirect to Machine Config

- **GIVEN** no config file exists (`~/.bloom/.env` missing)
- **WHEN** the Home page mounts
- **THEN** the user SHALL be redirected to `/machine-config`
- **AND** the Machine Config wizard SHALL require scanner mode selection before proceeding

### Requirement: Mode-Aware Navigation

The Layout sidebar navigation SHALL conditionally show capture-related links based on the configured scanner mode. The shared "Experiments" link is always shown, in every mode, since `Experiment` records are not scan-type-specific. The shared "Browse Scans" link is shown only in modes whose browse data it actually reflects; a mode with its own dedicated browse page (GraviScan) hides the shared link and shows its own instead.

#### Scenario: CylinderScan nav items

- **GIVEN** scanner mode is `cylinderscan`
- **WHEN** the Layout sidebar renders
- **THEN** "Capture Scan" and "Camera Settings" nav links SHALL be visible
- **AND** the shared "Browse Scans" link (pointing at `/browse-scans`) SHALL be visible
- **AND** the subtitle SHALL say "CylinderScan" (not hardcoded "Cylinder Scanner")

#### Scenario: GraviScan nav items

- **GIVEN** scanner mode is `graviscan`
- **WHEN** the Layout sidebar renders
- **THEN** "Capture Scan" and "Camera Settings" nav links SHALL be replaced by GraviScan equivalents (when added in later increments)
- **AND** the shared "Browse Scans" link (pointing at `/browse-scans`) SHALL NOT be visible
- **AND** a "Browse GraviScans" link pointing at `/browse-graviscans` SHALL be visible
- **AND** a "Metadata" link pointing at `/metadata` SHALL be visible
- **AND** the "Experiments" link pointing at `/experiments` SHALL remain visible
- **AND** the subtitle SHALL say "GraviScan"

#### Scenario: Layout subtitle reflects configured mode

- **GIVEN** any scanner mode
- **WHEN** the Layout renders
- **THEN** the subtitle under "Bloom Desktop" SHALL display the mode name
- **AND** the footer SHALL continue to show the scanner name from config

### Requirement: GraviScan Preload Context Bridge

The preload script SHALL expose a `gravi` namespace on `window.electron` with methods for all GraviScan IPC channels and event listeners, including `ensureDir` and `listScanFiles`.

#### Scenario: Invoke methods available

- **GIVEN** the preload script has run
- **WHEN** renderer code accesses `window.electron.gravi`
- **THEN** the following 21 invoke methods SHALL be available: `detectScanners`, `getConfig`, `saveConfig`, `saveScannersToDB`, `disableScanner`, `getPlatformInfo`, `validateScanners`, `validateConfig`, `resetUsb`, `getScannerStatus`, `startScan`, `getScanStatus`, `markJobRecorded`, `cancelScan`, `retryScanner`, `getOutputDir`, `readScanImage`, `uploadAllScans`, `downloadImages`, `ensureDir`, `listScanFiles`
- **AND** the following 14 event listener methods SHALL be available: `onScanStarted`, `onScanComplete`, `onGridStart`, `onGridComplete`, `onCycleComplete`, `onIntervalStart`, `onIntervalWaiting`, `onIntervalComplete`, `onOvertime`, `onCancelled`, `onScanError`, `onUploadProgress`, `onDownloadProgress`, `onWedgeDetected`
- **AND** `onScanEvent` SHALL NOT be present

#### Scenario: ensureDir and listScanFiles invoke the correct channels

- **GIVEN** the preload script has run
- **WHEN** renderer code calls `window.electron.gravi.ensureDir(dirPath)` or `window.electron.gravi.listScanFiles(dirPath)`
- **THEN** `ensureDir` SHALL invoke `graviscan:ensure-dir` with `dirPath`, and `listScanFiles` SHALL invoke `graviscan:list-scan-files` with `dirPath` (or no argument, for base-directory mode)
- **AND** each SHALL return the handler's result shape directly (`{ success, ... }`), not wrapped in an additional envelope

#### Scenario: Granular event listener registration

- **GIVEN** the preload script has run
- **WHEN** renderer code calls `window.electron.gravi.onScanStarted(callback)`, `onScanComplete(callback)`, or `onScanError(callback)`
- **THEN** each SHALL register a listener for its correspondingly-named channel (`graviscan:scan-started`, `graviscan:scan-complete`, `graviscan:scan-error`) via `ipcRenderer.on()`
- **AND** the callback SHALL be invoked when the main process sends the matching message, with a payload including `jobId`, `scannerId`, and `plateIndex`

#### Scenario: Event listener cleanup

- **GIVEN** renderer code has registered an event listener via `window.electron.gravi.onScanStarted(callback)` (or `onScanComplete`/`onScanError`)
- **AND** the call returned a cleanup function
- **WHEN** the cleanup function is called
- **THEN** the listener SHALL be removed via `ipcRenderer.removeListener()`
- **AND** subsequent messages on that channel SHALL NOT invoke the callback

### Requirement: GraviScan Database Handler — experiments.linkGraviMetadata

The system SHALL provide a `database.experiments.linkGraviMetadata(experimentId, waveNumber, accessionId)` IPC handler in `src/main/database-handlers.ts`, backed by a `GraviExperimentWaveMetadata` Prisma model with a unique `(experiment_id, wave_number)` pair, FK to `Experiment` (`onDelete: Cascade`) and FK to `Accessions` (`onDelete: Restrict`). It SHALL validate, returning `{success: false, error: <message>}` and persisting nothing on any failure:

- `experimentId` and `accessionId` are non-empty strings and `waveNumber` is a non-negative integer within the range Prisma's `Int` column can store (32-bit signed: 0 to 2147483647);
- an `Experiment` with `id === experimentId` exists and its `experiment_type` is `"graviscan"`;
- an `Accessions` row with `id === accessionId` exists and has at least one linked `GraviPlateAccession` child;
- no `GraviExperimentWaveMetadata` row already exists for `(experimentId, waveNumber)`, regardless of whether the new `accessionId` would be the same as or different from the existing link's.

On success, the handler SHALL also write a durable log line via `scanLog()` (`src/main/graviscan/scan-logger.ts`) recording `experimentId`, `waveNumber`, and the linked accession's **file name** (not only its id), so the line is human-readable without a separate database lookup. This log is retained per `scan-logger.ts`'s existing `LOG_RETENTION_DAYS` (180 days by default) — a durable trail for that window, not a permanent history table.

#### Scenario: link succeeds for a valid graviscan experiment and metadata file

- **GIVEN** a `graviscan`-typed experiment and an `Accessions` row with at least one `GraviPlateAccession` child, neither yet linked for wave `2`
- **WHEN** `linkGraviMetadata(experimentId, 2, accessionId)` is called
- **THEN** a `GraviExperimentWaveMetadata` row SHALL be created for `(experimentId, 2, accessionId)`
- **AND** the handler SHALL return `{success: true, data: <row with accession included>}`
- **AND** a `scanLog()` line SHALL be written recording the experiment, wave `2`, and the accession

#### Scenario: link accepts wave 0 as a valid boundary value

- **GIVEN** a `graviscan`-typed experiment and a valid metadata file, wave `0` not yet linked
- **WHEN** `linkGraviMetadata(experimentId, 0, accessionId)` is called
- **THEN** a `GraviExperimentWaveMetadata` row SHALL be created for `(experimentId, 0, accessionId)`
- **AND** the handler SHALL return `{success: true, data: <row with accession included>}`

#### Scenario: link rejects a non-string, missing, or empty experimentId

- **GIVEN** `experimentId` is a non-string value (e.g. a number, object, or `undefined`), or an empty string `""`
- **WHEN** `linkGraviMetadata` is called with that `experimentId`
- **THEN** the handler SHALL return `{success: false, error: <message>}`
- **AND** no `GraviExperimentWaveMetadata` row SHALL be created

#### Scenario: link rejects a non-string, missing, or empty accessionId

- **GIVEN** `accessionId` is a non-string value (e.g. a number, object, or `undefined`), or an empty string `""`
- **WHEN** `linkGraviMetadata` is called with that `accessionId`
- **THEN** the handler SHALL return `{success: false, error: <message>}`
- **AND** no `GraviExperimentWaveMetadata` row SHALL be created

#### Scenario: link rejects a malformed waveNumber

- **GIVEN** `waveNumber` is negative, non-integer (e.g. `1.5`), not a number, or exceeds `2147483647` (one past the maximum value Prisma's `Int` column can store)
- **WHEN** `linkGraviMetadata` is called with that `waveNumber`
- **THEN** the handler SHALL return `{success: false, error: <message>}` — a friendly validation error, not a raw database range error
- **AND** no `GraviExperimentWaveMetadata` row SHALL be created

#### Scenario: link rejects an unknown experimentId

- **GIVEN** an `experimentId` that is a non-empty string but does not correspond to any `Experiment` row
- **WHEN** `linkGraviMetadata` is called with that `experimentId`
- **THEN** the handler SHALL return `{success: false, error: <message>}` indicating the experiment was not found
- **AND** no `GraviExperimentWaveMetadata` row SHALL be created

#### Scenario: link rejects an unknown accessionId

- **GIVEN** an `accessionId` that is a non-empty string but does not correspond to any `Accessions` row
- **WHEN** `linkGraviMetadata` is called with that `accessionId`, for an otherwise-valid `graviscan` experiment
- **THEN** the handler SHALL return `{success: false, error: <message>}` indicating the metadata file was not found
- **AND** no `GraviExperimentWaveMetadata` row SHALL be created

#### Scenario: link rejects a non-graviscan experiment

- **GIVEN** an experiment with `experiment_type === "cylinderscan"`
- **WHEN** `linkGraviMetadata(experimentId, 0, accessionId)` is called
- **THEN** the handler SHALL return `{success: false, error: <message>}`
- **AND** no `GraviExperimentWaveMetadata` row SHALL be created

#### Scenario: link rejects a metadata file with no GraviPlateAccession children

- **GIVEN** an `Accessions` row created via `accessions.createWithMappings` (a CylinderScan barcode-mapping file, no `GraviPlateAccession` children)
- **WHEN** `linkGraviMetadata(experimentId, 0, thatAccessionId)` is called on a `graviscan`-typed experiment
- **THEN** the handler SHALL return `{success: false, error: <message>}`
- **AND** no `GraviExperimentWaveMetadata` row SHALL be created

#### Scenario: link rejects an already-linked wave, even to the same accession

- **GIVEN** wave `3` of an experiment is already linked to metadata file A
- **WHEN** `linkGraviMetadata(experimentId, 3, metadataFileB)` is called, where metadata file B is either a different file or the same file A
- **THEN** the handler SHALL return `{success: false, error: <message>}`
- **AND** wave `3` SHALL remain linked to metadata file A, unchanged

#### Scenario: link succeeds again after the wave was unlinked, even with a different accession

- **GIVEN** wave `3` of an experiment was linked to metadata file A, then unlinked via `unlinkGraviMetadata`
- **WHEN** `linkGraviMetadata(experimentId, 3, metadataFileB)` is called with a different metadata file B
- **THEN** a new `GraviExperimentWaveMetadata` row SHALL be created linking wave `3` to metadata file B
- **AND** the handler SHALL return `{success: true, data: <row with accession B included>}`

#### Scenario: deleting the linked Experiment cascades away the link

- **GIVEN** wave `1` of an experiment is linked to a metadata file
- **WHEN** that `Experiment` row is deleted
- **THEN** the corresponding `GraviExperimentWaveMetadata` row SHALL no longer exist
- **AND** the linked `Accessions` row (the metadata file itself) SHALL be unaffected

### Requirement: GraviScan Database Handler — experiments.unlinkGraviMetadata

The system SHALL provide a `database.experiments.unlinkGraviMetadata(experimentId, waveNumber)` IPC handler in `src/main/database-handlers.ts`. On success, the handler SHALL also write a durable log line via `scanLog()` recording `experimentId`, `waveNumber`, and the accession that was unlinked.

#### Scenario: unlink succeeds and removes the link

- **GIVEN** wave `3` of an experiment is linked to a metadata file
- **WHEN** `unlinkGraviMetadata(experimentId, 3)` is called
- **THEN** the `GraviExperimentWaveMetadata` row for `(experimentId, 3)` SHALL be deleted
- **AND** the handler SHALL return `{success: true}`
- **AND** a `scanLog()` line SHALL be written recording the experiment, wave `3`, and the accession that was unlinked

#### Scenario: unlink on a non-existent link returns a friendly error

- **GIVEN** an experiment with no `GraviExperimentWaveMetadata` row for wave `5`
- **WHEN** `unlinkGraviMetadata(experimentId, 5)` is called
- **THEN** the handler SHALL return `{success: false, error: <message>}` rather than a raw Prisma `P2025` error
- **AND** no `scanLog()` line SHALL be written for this call

#### Scenario: unlink rejects a non-string, missing, or empty experimentId

- **GIVEN** `experimentId` is a non-string value (e.g. a number, object, or `undefined`), or an empty string `""`
- **WHEN** `unlinkGraviMetadata` is called with that `experimentId`
- **THEN** the handler SHALL return `{success: false, error: <message>}`
- **AND** no `GraviExperimentWaveMetadata` row SHALL be deleted

#### Scenario: unlink rejects a malformed waveNumber

- **GIVEN** `waveNumber` is negative, non-integer, missing, or not a number
- **WHEN** `unlinkGraviMetadata` is called with that `waveNumber`
- **THEN** the handler SHALL return `{success: false, error: <message>}`
- **AND** no `GraviExperimentWaveMetadata` row SHALL be deleted

### Requirement: GraviScan Type Definitions for Preload API

The system SHALL define a `GraviAPI` interface in `src/types/electron.d.ts` (including `ensureDir(dirPath?: string): Promise<{success: boolean; error?: string}>` and `listScanFiles(dirPath?: string): Promise<{success: boolean; files: string[]; error?: string}>`) and add `gravi: GraviAPI` to the `ElectronAPI` interface, providing type safety for renderer code accessing GraviScan IPC channels.

#### Scenario: GraviAPI type available in renderer

- **GIVEN** a renderer TypeScript file accesses `window.electron.gravi`
- **WHEN** the file is compiled with `npx tsc --noEmit`
- **THEN** the compiler SHALL recognize all 21 invoke methods (including `ensureDir` and `listScanFiles`) and 14 event listener methods with correct parameter and return types
