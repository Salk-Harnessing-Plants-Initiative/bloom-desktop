## ADDED Requirements

### Requirement: Recent Scans Persistence

The system SHALL persist recent scans to the database and restore them when the user returns to the CaptureScan page.

#### Scenario: Recent scans loaded on page mount

- **GIVEN** the user has previously captured scans today
- **WHEN** the user navigates to the CaptureScan page
- **THEN** the recent scans list SHALL display scans captured today
- **AND** scans SHALL be sorted by capture date (most recent first)
- **AND** the list SHALL be limited to the 10 most recent scans

#### Scenario: New scan added to recent scans

- **GIVEN** the user is on the CaptureScan page
- **WHEN** the user completes a scan successfully
- **THEN** the new scan SHALL appear at the top of the recent scans list
- **AND** the scan SHALL be persisted to the database
- **AND** the scan SHALL remain visible after page navigation

#### Scenario: Recent scans filtered by session

- **GIVEN** the user returns to the CaptureScan page
- **WHEN** recent scans are loaded from the database
- **THEN** only scans from today SHALL be displayed
- **AND** deleted scans SHALL NOT be displayed

### Requirement: Accession File Required for Scanning

The system SHALL prevent scanning when the selected experiment has no accession file linked, matching pilot behavior.

#### Scenario: Scan blocked without accession

- **GIVEN** the user selects an experiment that has no accession file linked
- **WHEN** the user attempts to start a scan
- **THEN** the Start Scan button SHALL be disabled
- **AND** an error message SHALL explain that an accession file is required
- **AND** the message SHALL guide the user to link an accession file

#### Scenario: Scan allowed with valid accession and barcode

- **GIVEN** the user selects an experiment with an accession file linked
- **AND** the user enters a plant barcode that exists in the accession mappings
- **WHEN** all other required fields are valid
- **THEN** the Start Scan button SHALL be enabled
- **AND** the accession name SHALL be auto-populated from the mapping

#### Scenario: Scan blocked with invalid barcode

- **GIVEN** the user selects an experiment with an accession file linked
- **AND** the user enters a plant barcode that does NOT exist in the accession mappings
- **WHEN** the user attempts to start a scan
- **THEN** the Start Scan button SHALL be disabled
- **AND** an error message SHALL indicate the barcode is not found in the accession file

## MODIFIED Requirements

### Requirement: Scanner Event Listener Lifecycle

Scanner event listeners SHALL be properly cleaned up when component unmounts or dependencies change to prevent memory leaks and duplicate event handling.

#### Scenario: Event listeners return cleanup functions

- **GIVEN** the scanner API is available
- **WHEN** a component registers event listeners using `onProgress`, `onComplete`, or `onError`
- **THEN** each listener registration SHALL return a cleanup function
- **AND** calling the cleanup function SHALL remove the specific listener
- **AND** the cleanup function SHALL follow the same pattern as `camera.onFrame`

#### Scenario: Component cleanup on unmount

- **GIVEN** a component has registered scanner event listeners
- **WHEN** the component unmounts
- **THEN** all registered listeners SHALL be automatically removed
- **AND** no event handlers SHALL fire after unmount
- **AND** no memory leaks SHALL occur

#### Scenario: Component cleanup on dependency change

- **GIVEN** a useEffect has registered scanner event listeners
- **AND** the useEffect has dependencies
- **WHEN** any dependency value changes
- **THEN** all listeners from the previous effect SHALL be removed
- **AND** new listeners SHALL be registered with current dependency values
- **AND** only ONE set of listeners SHALL be active at any time

#### Scenario: Single scan completion event

- **GIVEN** a user starts a scan
- **AND** the user has typed in the Plant QR Code field multiple times
- **WHEN** the scan completes successfully
- **THEN** exactly ONE `onComplete` event SHALL fire
- **AND** exactly ONE scan entry SHALL be added to the recent scans list
- **AND** the scan SHALL appear exactly once in the UI

#### Scenario: Scan persisted to database on completion

- **GIVEN** a user has entered valid metadata
- **AND** the camera and scanner are configured
- **WHEN** the scan completes successfully
- **THEN** the scan record SHALL be persisted to the database
- **AND** the scan SHALL be retrievable via `db:scans:getRecent`
- **AND** the scan SHALL appear in recent scans after page navigation
