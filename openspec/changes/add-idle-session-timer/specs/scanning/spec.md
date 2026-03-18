## ADDED Requirements

### Requirement: Idle Session Timeout

The system SHALL implement an idle timer in the main process that resets session state after a configurable period of inactivity to prevent scan misattribution in shared lab environments.

#### Scenario: Session resets after 10 minutes of inactivity

- **GIVEN** a phenotyper has selected their identity and experiment
- **AND** no scanning activity occurs for 10 minutes
- **WHEN** the idle timeout expires
- **THEN** the session state SHALL be reset (phenotyperId, experimentId, waveNumber, plantAgeDays, accessionName set to null)
- **AND** the renderer SHALL be notified via a `session:idle-reset` event

#### Scenario: Timer resets on session changes

- **GIVEN** the idle timer is running
- **AND** at least one session field is non-null
- **WHEN** the user changes phenotyper or experiment selection (triggering `session:set`)
- **THEN** the idle timer SHALL restart from zero

#### Scenario: Timer does not reset on session:set when no session data exists

- **GIVEN** the idle timer is running
- **AND** no session data has been set (all fields are null)
- **WHEN** `session:set` is called with a partial update
- **THEN** the idle timer SHALL NOT be reset

#### Scenario: Timer resets on scanner initialization

- **GIVEN** the idle timer is running
- **WHEN** the scanner is initialized (triggering `scanner:initialize`)
- **THEN** the idle timer SHALL restart from zero

#### Scenario: Timer does not fire during active scan

- **GIVEN** the idle timer is running
- **AND** a scan is in progress (`scanner:scan` has been called)
- **WHEN** the configured timeout elapses
- **THEN** the idle timer SHALL NOT fire
- **AND** the timer SHALL resume only after the scan completes or errors

#### Scenario: Timer does not reset on non-activity events

- **GIVEN** the idle timer is running
- **WHEN** IPC events other than `session:set`, `scanner:initialize`, or `scanner:scan` are received (e.g., `scanner:status`, `camera:get-status`, page navigation)
- **THEN** the idle timer SHALL NOT restart
- **AND** the timer SHALL continue counting down from its current position

#### Scenario: Idle timeout is a no-op when no session is active

- **GIVEN** no phenotyper or experiment has been selected (all session fields are null)
- **WHEN** the idle timeout expires
- **THEN** `resetSessionState()` SHALL NOT be called
- **AND** no `session:idle-reset` event SHALL be sent to the renderer

#### Scenario: Idle callback fires exactly once per timeout cycle

- **GIVEN** the idle timer has been started
- **WHEN** the timeout elapses
- **THEN** the `onIdle` callback SHALL fire exactly once
- **AND** SHALL NOT fire again unless the timer is explicitly restarted via `start()` or `resetTimer()`

### Requirement: Configurable Idle Timeout Duration

The idle timeout duration SHALL be configurable programmatically (e.g., for unit tests) with a default value of 10 minutes (600,000 milliseconds). The timeout is not configurable at runtime via environment variables or user settings.

#### Scenario: Default timeout is 10 minutes

- **GIVEN** no custom timeout is configured
- **WHEN** the idle timer is created
- **THEN** the timeout SHALL default to 600,000 milliseconds (10 minutes)

#### Scenario: Custom timeout value is respected

- **GIVEN** a positive finite `timeoutMs` value is passed to the constructor
- **WHEN** the idle timer is created with the custom value
- **THEN** the timer SHALL use the configured duration instead of the default

#### Scenario: Invalid timeout value is rejected

- **GIVEN** a non-positive, non-finite, or NaN `timeoutMs` value is passed
- **WHEN** the idle timer constructor is called
- **THEN** the constructor SHALL throw a `RangeError`

### Requirement: Idle Reset User Notification

The system SHALL visibly notify the user when a session is reset due to inactivity so they understand why their selections were cleared.

#### Scenario: User sees notification after idle reset

- **GIVEN** the idle timeout has expired
- **WHEN** the session state is reset
- **THEN** the renderer SHALL display a visible notification to the user
- **AND** the notification SHALL indicate the reset was due to inactivity
- **AND** the phenotyper and experiment dropdowns SHALL show their empty/placeholder state

#### Scenario: Notification is dismissed when next scan starts

- **GIVEN** the idle reset notification banner is visible
- **WHEN** the user fills all required fields and starts a new scan
- **THEN** the notification banner SHALL no longer be visible
- **AND** the scan SHALL proceed normally

#### Scenario: Idle reset does not affect UI during an active scan

- **GIVEN** a scan is actively in progress in the renderer (`isScanning` is true)
- **WHEN** a `session:idle-reset` IPC event is received
- **THEN** the renderer SHALL NOT clear metadata state
- **AND** the idle reset notification banner SHALL NOT be shown

#### Scenario: Notification enumerates all cleared fields

- **GIVEN** the idle timeout has expired and the session state has been reset
- **WHEN** the renderer shows the notification banner
- **THEN** the notification text SHALL reference all cleared fields: phenotyper, experiment, wave number, plant age, accession name, and plant QR code

#### Scenario: Banner shown on CaptureScan mount after navigation-away idle reset

- **GIVEN** an idle reset occurred while the user was navigated away from CaptureScan
- **WHEN** the user navigates back to CaptureScan (component mounts)
- **THEN** the idle reset notification banner SHALL be displayed
- **AND** the form fields SHALL be in their empty/placeholder state
