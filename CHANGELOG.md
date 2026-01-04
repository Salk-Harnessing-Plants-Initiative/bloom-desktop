# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

- Database handler using empty string instead of null for optional genotype_id field
- E2E test selectors violating Playwright strict mode

### Changed

- AccessionList component now includes error handling for getMappings, edit, and delete operations
