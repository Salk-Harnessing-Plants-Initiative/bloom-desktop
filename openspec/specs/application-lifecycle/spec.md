# application-lifecycle Specification

## Purpose
TBD - created by archiving change harden-cylinderscan-tier1. Update Purpose after archive.
## Requirements
### Requirement: Single Instance Application Lock

The application SHALL acquire a single-instance lock at startup, before any window is created. If the lock cannot be acquired (another instance is already running), the new instance SHALL quit immediately without creating a window or initializing hardware/database connections. This applies app-wide, to both CylinderScan and GraviScan modes, since they share the same main process.

#### Scenario: First launch acquires the lock

- **GIVEN** no other instance of the application is running
- **WHEN** the application starts
- **THEN** `app.requestSingleInstanceLock()` SHALL return `true`
- **AND** the application SHALL proceed with normal startup

#### Scenario: Second launch is refused and focuses the existing window

- **GIVEN** an instance of the application is already running with a visible window
- **WHEN** a second instance is launched
- **THEN** the second instance SHALL detect the lock is held (`app.requestSingleInstanceLock()` returns `false`)
- **AND** the second instance SHALL quit immediately without creating a window
- **AND** the first instance's existing window SHALL be restored (if minimized) and focused

#### Scenario: Second-instance event fires before the window exists

- **GIVEN** the first instance is still starting up and has not yet created its main window
- **WHEN** a `second-instance` event fires in that instance
- **THEN** the handler SHALL NOT throw
- **AND** it SHALL no-op (there is nothing yet to focus, and the second instance has already been told to quit)

#### Scenario: Second-instance event fires after the window has been destroyed

- **GIVEN** the first instance's main window has been destroyed (e.g. on macOS, where `window-all-closed` does not quit the app, so the process keeps running with a destroyed-but-non-null window reference)
- **WHEN** a `second-instance` event fires in that instance
- **THEN** the handler SHALL NOT throw
- **AND** it SHALL no-op without calling `isMinimized()`, `restore()`, or `focus()` on the destroyed window

