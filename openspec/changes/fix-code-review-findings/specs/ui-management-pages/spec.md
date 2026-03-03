## MODIFIED Requirements

### Requirement: Scan Preview Image Viewer

The system SHALL display scan images using React-managed state for all rendering, including error states. When an image fails to load, the system SHALL display an error message using React conditional rendering (not direct DOM manipulation). The error state SHALL reset when navigating to a different frame.

#### Scenario: Image load failure shows error via React state

- **WHEN** an image fails to load in ScanPreview
- **THEN** an error message is displayed via React state (not innerHTML)
- **AND** the image element is hidden

#### Scenario: Error state resets on frame navigation

- **WHEN** the user navigates to a different frame after an image error
- **THEN** the error state resets and the new image loads normally

### Requirement: Scan Preview Keyboard Navigation

The system SHALL support keyboard navigation through scan frames using arrow keys, Home, and End. The keyboard handler SHALL use functional state updates to avoid stale closure references.

#### Scenario: Consecutive keyboard navigation works correctly

- **WHEN** the user presses ArrowRight multiple times in succession
- **THEN** the frame advances by one for each press (no skipped or repeated frames)

#### Scenario: Home and End keys navigate to boundaries

- **WHEN** the user presses Home
- **THEN** the viewer navigates to the first frame
- **WHEN** the user presses End
- **THEN** the viewer navigates to the last frame

### Requirement: Date Filter Validation

The system SHALL validate date filter inputs in the scan list handler. Malformed date strings SHALL be rejected with a descriptive error message rather than producing invalid Date objects.

#### Scenario: Malformed date rejected

- **WHEN** a malformed date string (e.g., `'not-a-date'`) is passed as dateFrom or dateTo
- **THEN** the system returns an error response with a descriptive message

#### Scenario: Valid date accepted

- **WHEN** a valid ISO date string (e.g., `'2025-02-17'`) is passed as dateFrom
- **THEN** the system parses it correctly and filters scans accordingly
