# configuration Specification Delta

## MODIFIED Requirements

### Requirement: Database Auto-Initialization on Startup

The application SHALL automatically initialize the database schema on startup if needed, ensuring the app works immediately after installation without manual CLI commands in development mode. In packaged (production) mode, the application SHALL detect database state but defer schema creation to external tooling. **Database initialization SHALL NOT block the Electron main process event loop.**

#### Scenario: Non-blocking initialization in development mode

- **GIVEN** the application is starting in development mode
- **AND** database initialization requires CLI commands (prisma, sqlite3)
- **WHEN** the initialization runs
- **THEN** CLI commands SHALL execute asynchronously
- **AND** the main process event loop SHALL remain responsive
- **AND** IPC communication with renderer SHALL NOT be blocked
- **AND** the UI SHALL show a loading indicator during initialization

#### Scenario: Non-blocking initialization in production mode

- **GIVEN** the application is starting in production mode (packaged)
- **AND** database state detection requires sqlite3 CLI
- **WHEN** the detection runs
- **THEN** CLI commands SHALL execute asynchronously
- **AND** the main process event loop SHALL remain responsive
- **AND** startup time for state detection SHALL be under 500ms

#### Scenario: App readiness signaling

- **GIVEN** the application is starting
- **WHEN** database initialization completes successfully
- **THEN** the main process SHALL send `database:ready` event to renderer
- **AND** the renderer SHALL transition from loading state to main UI
- **AND** E2E tests SHALL be able to detect app readiness via `[data-testid="app-ready"]`

#### Scenario: Database initialization error handling

- **GIVEN** the application is starting
- **WHEN** database initialization fails
- **THEN** the main process SHALL send `database:error` event to renderer
- **AND** the renderer SHALL display an error message to the user
- **AND** the error message SHALL include actionable guidance
- **AND** the application SHALL NOT crash
