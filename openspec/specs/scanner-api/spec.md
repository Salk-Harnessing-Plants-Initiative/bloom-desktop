# scanner-api Specification

## Purpose

TBD - created by archiving change add-scanner-identity-service. Update Purpose after archive.

## Requirements

### Requirement: Scanner Identity Service

The application SHALL maintain runtime scanner identity state, initialized from persistent configuration and updated when configuration changes, accessible via IPC.

#### Scenario: Scanner identity initialized on app startup

- **GIVEN** the application is starting
- **AND** `~/.bloom/.env` file exists with `SCANNER_NAME=TestScanner`
- **WHEN** the main process initializes
- **THEN** the runtime scanner identity SHALL be set to "TestScanner"
- **AND** the identity SHALL be held in memory (not re-read from disk)

#### Scenario: Scanner identity defaults to empty on first run

- **GIVEN** the application is starting for the first time
- **AND** no `~/.bloom/.env` file exists
- **WHEN** the main process initializes
- **THEN** the runtime scanner identity SHALL be set to empty string ""
- **AND** the scanner SHALL be considered unconfigured

### Requirement: Scanner Identity IPC Handler

The application SHALL provide a `scanner:get-scanner-id` IPC handler that returns the current runtime scanner identity, matching the pilot implementation API.

#### Scenario: Get scanner ID returns current identity

- **GIVEN** scanner identity is set to "PBIOBScanner"
- **WHEN** renderer invokes `window.electron.scanner.getScannerId()`
- **THEN** the IPC handler SHALL return "PBIOBScanner"
- **AND** no file I/O SHALL occur (in-memory lookup only)

#### Scenario: Get scanner ID returns empty for unconfigured scanner

- **GIVEN** scanner identity is empty string ""
- **WHEN** renderer invokes `window.electron.scanner.getScannerId()`
- **THEN** the IPC handler SHALL return ""
- **AND** no error SHALL be thrown

### Requirement: Scanner Identity Sync on Config Save

When machine configuration is saved with a new scanner name, the runtime scanner identity SHALL be updated immediately to reflect the change, without requiring app restart.

#### Scenario: Scanner identity updates on config save success

- **GIVEN** scanner identity is currently "OldScanner"
- **AND** user saves config with `scanner_name: "NewScanner"`
- **WHEN** the `config:set` handler successfully saves to `.env`
- **THEN** the runtime scanner identity SHALL be updated to "NewScanner"
- **AND** subsequent calls to `scanner:get-scanner-id` SHALL return "NewScanner"
- **AND** no app restart SHALL be required

#### Scenario: Scanner identity unchanged on config save failure

- **GIVEN** scanner identity is currently "TestScanner"
- **AND** user attempts to save config with `scanner_name: "NewScanner"`
- **WHEN** the `config:set` handler fails to save (e.g., disk error)
- **THEN** the runtime scanner identity SHALL remain "TestScanner"
- **AND** the failure SHALL be reported to the user
- **AND** subsequent calls to `scanner:get-scanner-id` SHALL return "TestScanner"

### Requirement: Layout Scanner Name Display

The Layout component SHALL display the current scanner name by querying the scanner identity service, not by reading config directly, and SHALL update automatically when the scanner name changes.

#### Scenario: Layout displays scanner name from identity service

- **GIVEN** scanner identity is "PBIOBScanner"
- **WHEN** Layout component mounts or refreshes
- **THEN** Layout SHALL call `window.electron.scanner.getScannerId()`
- **AND** Layout SHALL display "Scanner: PBIOBScanner" in the footer
- **AND** Layout SHALL NOT call `config:get` for this purpose

#### Scenario: Layout shows "Not configured" for empty scanner name

- **GIVEN** scanner identity is empty string ""
- **WHEN** Layout component displays scanner info
- **THEN** Layout SHALL display "Scanner: Not configured"
- **AND** the text "Not configured" SHALL be visually distinct (e.g., gray color)

#### Scenario: Layout updates scanner name without reload

- **GIVEN** Layout is displaying "Scanner: OldScanner"
- **AND** user saves config with new scanner name "NewScanner"
- **WHEN** Layout's periodic refresh occurs
- **THEN** Layout SHALL call `scanner:get-scanner-id` again
- **AND** Layout SHALL update to display "Scanner: NewScanner"
- **AND** NO page reload or navigation SHALL occur
