## ADDED Requirements

### Requirement: Scan Preview Image Error Handling

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
