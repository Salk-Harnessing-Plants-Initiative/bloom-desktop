# Spec Delta: Scanner Fetch with Proper Supabase Authentication

## ADDED Requirements

### Requirement: Bloom API Scanner Fetch Authentication

The Machine Configuration page SHALL fetch valid scanner names from the Bloom API using proper Supabase authentication with `@salk-hpi/bloom-js` library, matching the pilot implementation.

#### Scenario: Successful scanner fetch with valid credentials

**Given** a user has entered valid Bloom API credentials (username, password, anon key, API URL)
**When** the application fetches scanners from the Bloom API
**Then** the system creates a Supabase client with the API URL and anon key
**And** authenticates using `supabase.auth.signInWithPassword()` with the username and password
**And** creates a `SupabaseStore` instance from `@salk-hpi/bloom-js`
**And** calls `store.getAllCylScanners()` to query the `cyl_scanners` table
**And** returns a list of scanners with `id` and `name` fields
**And** populates the scanner dropdown with the fetched names

**Acceptance Criteria**:

- Uses `@supabase/supabase-js` `createClient()` method
- Uses `@salk-hpi/bloom-js` `SupabaseStore` class
- Authenticates with email/password (not password as Bearer token)
- Queries `cyl_scanners` table (not `/scanners` HTTP endpoint)
- Returns scanner objects with `{ id: number, name: string | null }` structure
- Scanner dropdown shows only valid scanners from database

#### Scenario: Authentication failure with invalid credentials

**Given** a user has entered invalid Bloom API credentials
**When** the application attempts to fetch scanners
**Then** the Supabase client authentication fails
**And** the system returns an error: "Authentication failed: [error message]"
**And** the scanner dropdown shows "Unable to load scanners"
**And** an error message displays to the user
**And** a "Retry" button allows the user to attempt fetch again

**Acceptance Criteria**:

- Supabase auth errors are caught and formatted for user display
- No raw error objects exposed to UI
- Retry mechanism available
- Scanner dropdown disabled during error state

#### Scenario: Network error during scanner fetch

**Given** a user has valid credentials
**And** the Bloom API is unreachable or network is down
**When** the application attempts to fetch scanners
**Then** the system catches the network error
**And** returns an error: "Network error: [error message]"
**And** the scanner dropdown shows "Unable to load scanners"
**And** appropriate error handling prevents application crash

**Acceptance Criteria**:

- Network errors caught and handled gracefully
- User-friendly error messages displayed
- Application remains functional despite API unavailability
- Retry mechanism available

#### Scenario: Scanner fetch triggers after credential save

**Given** a user is configuring the machine for the first time (no existing credentials)
**When** the user enters Bloom API credentials and clicks "Save Configuration"
**And** the credentials save successfully
**Then** the system automatically triggers `fetchScanners()`
**And** shows a loading indicator in the scanner dropdown
**And** populates the scanner dropdown when fetch completes
**And** the user can immediately select a scanner without page refresh

**Acceptance Criteria**:

- Scanner fetch triggered automatically after first-time credential save
- Loading state shown during fetch ("Loading scanners...")
- Dropdown populates without requiring page navigation or refresh
- Seamless UX: credentials → save → scanners load → select scanner
