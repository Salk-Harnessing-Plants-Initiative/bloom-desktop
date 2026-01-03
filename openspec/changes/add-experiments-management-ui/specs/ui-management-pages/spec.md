# ui-management-pages Specification Changes

## ADDED Requirements

### Requirement: Experiments List View

The Experiments page SHALL display all experiments from the database in a clean, readable list format, with support for both empty and populated states.

#### Scenario: Empty State

**Given** no experiments exist in the database
**When** the user navigates to `/experiments`
**Then** the page displays a message indicating no experiments are present
**And** the create form is visible below

**Acceptance Criteria**:

- Empty state message is clear (e.g., "No experiments yet")
- List container is visually distinct but empty
- User can immediately see the create form without scrolling

#### Scenario: Display Experiments

**Given** multiple experiments exist in the database
**When** the user navigates to `/experiments`
**Then** all experiments are displayed in a list
**And** each list item shows: `{species} - {name} ({scientist name or "unknown"})`
**And** the list is sorted alphabetically by name

**Acceptance Criteria**:

- Each experiment appears exactly once
- Format: "{species} - {name} ({scientist name})" or "(unknown)" if no scientist linked
- List is scrollable if content exceeds container height (max-height: 256px)
- Loading state appears while fetching data
- Database errors show user-friendly error message

### Requirement: Create Experiment

The Experiments page MUST allow users to create new experiments with validation (name required, species required) and optional scientist/accession linking.

#### Scenario: Valid Submission

**Given** the user is on the `/experiments` page
**When** the user enters a valid name (e.g., "Drought Study 2025")
**And** the user selects a species from the dropdown
**And** the user optionally selects a scientist
**And** the user optionally selects an accession
**And** the user clicks "Create" button
**Then** the experiment is created in the database
**And** the form fields are cleared
**And** the experiments list refreshes to show the new entry

**Acceptance Criteria**:

- Name is trimmed of leading/trailing whitespace
- Species is required (dropdown, no empty option after selection)
- Scientist is optional (dropdown from scientists list)
- Accession is optional (dropdown from accessions list)
- Loading indicator appears during submission
- IPC call completes successfully
- New experiment appears in list without page refresh

#### Scenario: Validation Failure - Empty Name

**Given** the user is on the `/experiments` page
**When** the user leaves the name field empty
**And** the user clicks "Create" button
**Then** form submission is prevented
**And** an error indication appears

**Acceptance Criteria**:

- Validation runs before submission (no network call)
- Form remains populated with selected values
- Submit button can be clicked again after fixing error

#### Scenario: Species Dropdown

**Given** the user is on the `/experiments` page
**When** the user views the species dropdown
**Then** the following species are available (alphabetically sorted):

- Alfalfa
- Amaranth
- Arabidopsis
- Canola
- Lotus
- Maize
- Medicago
- Pennycress
- Rice
- Sorghum
- Soybean
- Spinach
- Sugar_Beet
- Tomato
- Wheat

**Acceptance Criteria**:

- Dropdown pre-selects first species by default
- All 15 species available
- Species are sorted alphabetically

### Requirement: Attach Accession to Existing Experiment

The Experiments page SHALL allow users to attach an accession to an existing experiment via a dedicated UI section.

#### Scenario: Attach Accession

**Given** experiments and accessions exist in the database
**When** the user selects an experiment from the dropdown
**And** the user selects an accession from the dropdown
**And** the user clicks "Attach Accession" button
**Then** the experiment is updated with the accession link
**And** a success message appears

**Acceptance Criteria**:

- Experiment dropdown shows: `{species} - {name} ({scientist name})`
- Accession dropdown shows: `{name} - {id}`
- Loading indicator during attachment
- Success message: "Accession successfully attached."
- Error message if attachment fails

### Requirement: Experiments Navigation Integration

The application SHALL provide navigation to the Experiments page via a clearly labeled link in the main navigation menu, with the route registered at `/experiments`.

#### Scenario: Access via Navigation

**Given** the user is on any page in the application
**When** the user clicks the "Experiments" link in the navigation
**Then** the application navigates to `/experiments`
**And** the Experiments page loads
**And** the experiments list is fetched and displayed

**Acceptance Criteria**:

- Navigation link is clearly labeled "Experiments"
- Link is visible in the main navigation menu
- Route is registered in React Router
- Navigation works in both development and packaged modes

### Requirement: ExperimentChooser Component

The ExperimentChooser component SHALL provide a dropdown for selecting experiments in CaptureScan, replacing the text input.

#### Scenario: Display Experiment Options

**Given** the ExperimentChooser is rendered
**When** experiments exist in the database
**Then** a dropdown displays all experiments by name
**And** a placeholder option "Choose an experiment" is shown when nothing selected

**Acceptance Criteria**:

- Dropdown shows experiment names
- Placeholder text when no selection
- Amber border when nothing selected
- Gray border when selection made

#### Scenario: Selection Change Callback

**Given** the ExperimentChooser is rendered
**When** the user selects an experiment
**Then** the `experimentIdChanged` callback is called with the experiment ID
**And** the dropdown updates to show the selected experiment

**Acceptance Criteria**:

- Callback receives experiment ID (string) or null
- Selection is visually indicated
- Clearing selection (if supported) calls callback with null

#### Scenario: Periodic Refresh

**Given** the ExperimentChooser is rendered
**When** the component is mounted
**Then** experiments are fetched immediately
**And** experiments are refreshed every 10 seconds

**Acceptance Criteria**:

- Initial fetch on mount
- Polling interval: 10 seconds
- Cleanup on unmount (clear interval)
- New experiments appear without manual refresh

### Requirement: PhenotyperChooser Component

The PhenotyperChooser component SHALL provide a dropdown for selecting phenotypers in CaptureScan, replacing the text input.

#### Scenario: Display Phenotyper Options

**Given** the PhenotyperChooser is rendered
**When** phenotypers exist in the database
**Then** a dropdown displays all phenotypers by name
**And** a placeholder option "Choose a phenotyper" is shown when nothing selected

**Acceptance Criteria**:

- Dropdown shows phenotyper names
- Placeholder text when no selection
- Amber border when nothing selected
- Gray border when selection made

#### Scenario: Selection Change Callback

**Given** the PhenotyperChooser is rendered
**When** the user selects a phenotyper
**Then** the `phenotyperIdChanged` callback is called with the phenotyper ID
**And** the dropdown updates to show the selected phenotyper

**Acceptance Criteria**:

- Callback receives phenotyper ID (string) or null
- Selection is visually indicated

#### Scenario: Periodic Refresh

**Given** the PhenotyperChooser is rendered
**When** the component is mounted
**Then** phenotypers are fetched immediately
**And** phenotypers are refreshed every 10 seconds

**Acceptance Criteria**:

- Initial fetch on mount
- Polling interval: 10 seconds
- Cleanup on unmount (clear interval)
- New phenotypers appear without manual refresh

### Requirement: CaptureScan Chooser Integration

The CaptureScan page SHALL use ExperimentChooser and PhenotyperChooser components instead of text inputs.

#### Scenario: Experiment Selection in CaptureScan

**Given** the user is on the CaptureScan page
**When** the user views the Experiment field
**Then** a dropdown is displayed (not a text input)
**And** the user can select from available experiments

**Acceptance Criteria**:

- Text input replaced with ExperimentChooser
- Selected experiment ID used for scan metadata
- Validation requires experiment selection

#### Scenario: Phenotyper Selection in CaptureScan

**Given** the user is on the CaptureScan page
**When** the user views the Phenotyper field
**Then** a dropdown is displayed (not a text input)
**And** the user can select from available phenotypers

**Acceptance Criteria**:

- Text input replaced with PhenotyperChooser
- Selected phenotyper ID used for scan metadata
- Validation requires phenotyper selection