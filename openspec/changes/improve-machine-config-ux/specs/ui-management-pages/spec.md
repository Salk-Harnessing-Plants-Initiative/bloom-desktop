# Spec Delta: UI Management Pages - Machine Configuration Section Order

## MODIFIED Requirements

### Requirement: Machine Configuration Page Section Order

The Machine Configuration page SHALL present form sections in the following order to optimize user experience and logical flow: Bloom API Credentials (first), Machine Identity (second), Hardware (third).

#### Scenario: First-run configuration flow

**Given** a user is configuring the machine for the first time
**And** no credentials exist in `~/.bloom/.env`
**When** the user navigates to `/machine-configuration`
**Then** the Bloom API Credentials section appears first at the top of the page
**And** the Machine Identity section appears second below credentials
**And** the Hardware section appears third below machine identity
**And** the scanner name dropdown in Machine Identity section shows "Enter credentials first" (disabled)
**And** the user can complete the form in top-to-bottom order without scrolling back

**Acceptance Criteria**:
- Section visual order: Credentials → Machine Identity → Hardware
- Tab navigation order follows visual order
- Scanner dropdown disabled until credentials entered
- Save button appears at bottom after all sections
- No behavioral changes to validation or save functionality

#### Scenario: Existing configuration access flow

**Given** a user has existing credentials stored in `~/.bloom/.env`
**And** the user has authenticated successfully
**When** the user views the Machine Configuration page
**Then** the Bloom API Credentials section appears first at the top with masked password
**And** the Machine Identity section appears second with pre-selected scanner
**And** the Hardware section appears third with existing camera/directory settings
**And** the scanner name dropdown is populated and enabled (credentials already exist)
**And** the user can review and modify settings in top-to-bottom order

**Acceptance Criteria**:
- Credentials section shows: username (populated), password (masked), anon key (populated), API URL (populated)
- Scanner dropdown populated with scanners from Bloom API
- Pre-existing scanner selection visible
- Camera IP and scans directory pre-populated
- Form follows logical dependency: credentials enable scanner selection

#### Scenario: Keyboard navigation follows visual order

**Given** a user is on the Machine Configuration page
**When** the user presses Tab to navigate through form fields
**Then** focus moves in the following order:
  1. Username (Bloom API Credentials)
  2. Password (Bloom API Credentials)
  3. Anon Key (Bloom API Credentials)
  4. API URL (Bloom API Credentials)
  5. Scanner Name dropdown (Machine Identity)
  6. Camera IP Address (Hardware)
  7. Scans Directory path (Hardware)
  8. Browse button (Hardware)
  9. Save Configuration button

**Acceptance Criteria**:
- Tab order matches visual top-to-bottom order
- No focus traps or unexpected focus jumps
- Focus visible on all interactive elements
- Screen readers announce sections in correct order
