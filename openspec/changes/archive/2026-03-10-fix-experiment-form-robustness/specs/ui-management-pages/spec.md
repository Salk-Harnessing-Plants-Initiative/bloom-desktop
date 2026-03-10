## MODIFIED Requirements

### Requirement: Create Experiment

The Experiments page MUST allow users to create new experiments with validation (name required, species required, scientist required, accession required).

#### Scenario: Valid Submission

**Given** the user is on the `/experiments` page
**When** the user enters a valid name (e.g., "Drought Study 2025")
**And** the user selects a species from the dropdown
**And** the user selects a scientist from the dropdown
**And** the user selects an accession from the dropdown
**And** the user clicks "Create" button
**Then** the experiment is created in the database with scientist and accession linked
**And** the form fields are cleared
**And** the experiments list refreshes to show the new entry

**Acceptance Criteria**:

- Name is trimmed of leading/trailing whitespace at the validation level
- Species is required (dropdown, no empty option after selection)
- Scientist is required (dropdown from scientists list)
- Accession is required (dropdown from accessions list)
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

#### Scenario: Validation Failure - Whitespace-Only Name

**Given** the user is on the `/experiments` page
**When** the user enters only whitespace characters (e.g. " ")
**And** the user selects a scientist and accession
**And** the user clicks "Create" button
**Then** form submission is prevented
**And** an error message "Name is required" appears

**Acceptance Criteria**:

- Whitespace is trimmed before min-length validation
- No IPC call is made to the database
- Other form fields retain their values

#### Scenario: Validation Failure - No Scientist Selected

**Given** the user is on the `/experiments` page
**And** scientists exist in the database
**When** the user fills in name and species
**And** the user does not select a scientist
**And** the user clicks "Create" button
**Then** form submission is prevented
**And** an error message "Scientist is required" appears near the scientist field

#### Scenario: Validation Failure - No Accession Selected

**Given** the user is on the `/experiments` page
**And** accessions exist in the database
**When** the user fills in name, species, and scientist
**And** the user does not select an accession
**And** the user clicks "Create" button
**Then** form submission is prevented
**And** an error message "Accession is required" appears near the accession field

#### Scenario: Species Dropdown

**Given** the user is on the `/experiments` page
**When** the user views the species dropdown
**Then** all supported species are available for selection

**Acceptance Criteria**:

- Dropdown pre-selects the first species
- All 15 species are listed alphabetically
