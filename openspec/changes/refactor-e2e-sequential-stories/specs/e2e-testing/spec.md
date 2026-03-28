## MODIFIED Requirements

### Requirement: E2E Test Lifecycle

E2E tests SHALL use `test.describe.serial` with `beforeAll`/`afterAll` to share a single Electron app instance per test file, instead of launching a new app per test via `beforeEach`/`afterEach`. Test data isolation SHALL be maintained via Prisma seeding between test phases.

#### Scenario: Single app launch per file

- **GIVEN** an E2E test file with N tests
- **WHEN** the test file is executed
- **THEN** exactly 1 Electron app instance SHALL be launched in `beforeAll`
- **AND** all N tests SHALL run sequentially against that instance
- **AND** the app SHALL be closed in `afterAll`

#### Scenario: Test data isolation via Prisma

- **GIVEN** a sequential test file with multiple phases
- **WHEN** a phase requires specific database state
- **THEN** test data SHALL be seeded via Prisma at the start of the phase
- **AND** destructive operations (delete) SHALL be ordered last within each phase
- **AND** page reloads SHALL be used when the renderer needs to pick up Prisma-seeded data

#### Scenario: Test names preserved

- **GIVEN** an E2E test file being refactored from beforeEach to beforeAll
- **WHEN** the refactoring is complete
- **THEN** all original test names SHALL be preserved exactly
- **AND** no tests SHALL be removed, merged, or renamed
- **AND** the total test count SHALL match the original file
