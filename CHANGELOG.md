# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
