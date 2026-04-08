## Capability: UI Layout Consistency

Pages with two-panel layouts (settings + live preview) SHALL use a consistent centered container pattern.

## MODIFIED Requirements

### Requirement: Camera Settings Page Layout

The Camera Settings page SHALL use a centered, max-width constrained container matching the CaptureScan layout pattern.

#### Scenario: Centered container on wide screens

- **GIVEN** the user navigates to the Camera Settings page
- **WHEN** the viewport width exceeds the max-width threshold (80rem)
- **THEN** the page content SHALL be horizontally centered
- **AND** the content width SHALL NOT exceed `max-w-7xl` (80rem)
- **AND** the page background SHALL be `bg-gray-50`

#### Scenario: Full-width on narrow screens

- **GIVEN** the user navigates to the Camera Settings page
- **WHEN** the viewport width is below the max-width threshold
- **THEN** the content SHALL fill the available width with consistent padding (`p-6`)
- **AND** the two-column grid SHALL collapse to single column on small screens

#### Scenario: Two-panel layout preserved

- **GIVEN** the user navigates to the Camera Settings page on a large screen
- **WHEN** the page renders
- **THEN** the Settings form SHALL appear in the left column
- **AND** the Live Preview SHALL appear in the right column
- **AND** both panels SHALL use `shadow-sm` and `rounded-lg` styling
