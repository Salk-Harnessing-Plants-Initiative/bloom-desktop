## MODIFIED Requirements

### Requirement: Create Experiment

The Experiments page MUST allow users to create new experiments with validation. Name, species, scientist, and accession file SHALL all be required fields.

#### Scenario: Valid Submission

**Given** the user is on the `/experiments` page
**When** the user enters a valid name (e.g., "Drought Study 2025")
**And** the user selects a species from the dropdown
**And** the user selects a scientist from the dropdown
**And** the user selects an accession file from the dropdown
**And** the user clicks "Create" button
**Then** the experiment is created in the database with the selected scientist and accession linked
**And** the form fields are cleared
**And** the experiments list refreshes to show the new entry

**Acceptance Criteria**:

- Name is trimmed of leading/trailing whitespace
- Species is required (dropdown, no empty option after selection)
- Scientist is required (dropdown from scientists list)
- Accession file is required (dropdown from accessions list)
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

#### Scenario: Validation Failure - No Scientist Selected

**Given** the user is on the `/experiments` page
**When** the user fills in the name and species
**And** the user does not select a scientist
**And** the user clicks "Create" button
**Then** form submission is prevented
**And** a validation error is displayed for the scientist field

**Acceptance Criteria**:

- Error message indicates scientist is required (e.g., "Scientist is required")
- No IPC call is made
- Form remains populated with entered values

#### Scenario: Validation Failure - No Accession File Selected

**Given** the user is on the `/experiments` page
**When** the user fills in the name and species
**And** the user does not select an accession file
**And** the user clicks "Create" button
**Then** form submission is prevented
**And** a validation error is displayed for the accession file field

**Acceptance Criteria**:

- Error message indicates accession file is required (e.g., "Accession file is required")
- No IPC call is made
- Form remains populated with entered values

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

#### Scenario: Existing Experiments Without Scientist or Accession

**Given** experiments exist in the database without a linked scientist or accession file
**When** the user navigates to the `/experiments` page
**Then** those experiments SHALL still be displayed in the list
**And** the application MUST NOT error or crash

**Acceptance Criteria**:

- Existing experiments with NULL scientist_id or accession_id load normally
- The list view gracefully handles missing scientist/accession data
- Only new experiment creation enforces the required fields
