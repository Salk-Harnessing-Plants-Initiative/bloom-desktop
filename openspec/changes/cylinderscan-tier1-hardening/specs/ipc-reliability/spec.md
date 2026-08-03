## ADDED Requirements

### Requirement: Preload Listener Cleanup

Every `on*` subscription method exposed on `window.electron` by `src/main/preload.ts` SHALL return a cleanup function that removes its underlying `ipcRenderer` listener, so renderer components can unsubscribe on unmount without leaking listeners.

#### Scenario: Python status/error listeners clean up

- **GIVEN** a renderer component calls `window.electron.python.onStatus(callback)` or `window.electron.python.onError(callback)`
- **WHEN** the returned cleanup function is invoked
- **THEN** the corresponding `ipcRenderer` listener SHALL be removed
- **AND** the callback SHALL NOT be invoked for subsequent events on that channel

#### Scenario: Camera trigger/image-captured listeners clean up

- **GIVEN** a renderer component calls `window.electron.camera.onTrigger(callback)` or `window.electron.camera.onImageCaptured(callback)`
- **WHEN** the returned cleanup function is invoked
- **THEN** the corresponding `ipcRenderer` listener SHALL be removed

#### Scenario: DAQ listeners clean up

- **GIVEN** a renderer component calls any of `window.electron.daq.onInitialized`, `onPositionChanged`, `onHome`, or `onError`
- **WHEN** the returned cleanup function is invoked
- **THEN** the corresponding `ipcRenderer` listener SHALL be removed

### Requirement: IPC Command Response Correlation

Commands sent to the Python subprocess via `PythonProcess.sendCommand()` SHALL be correlated to their responses by a request id, so that multiple in-flight commands cannot cross-resolve or cross-reject each other's promises.

#### Scenario: Concurrent commands resolve to their own caller

- **GIVEN** two `sendCommand()` calls are in flight concurrently, each with a distinct command payload
- **WHEN** the Python subprocess emits a `DATA:` response for the first command
- **THEN** only the first command's promise SHALL resolve
- **AND** the second command's promise SHALL remain pending until its own matching response arrives

#### Scenario: Attributable error rejects only its own request

- **GIVEN** a `sendCommand()` call is in flight with request id `N`
- **WHEN** the Python subprocess emits an `ERROR:` response carrying request id `N`
- **THEN** only the pending request for id `N` SHALL reject
- **AND** any other currently-pending requests SHALL remain unaffected

#### Scenario: Unattributable error rejects all pending requests

- **GIVEN** one or more `sendCommand()` calls are in flight
- **WHEN** an error is emitted with no request id (e.g. a raw stderr line or a fatal top-level exception in the Python process)
- **THEN** every currently-pending request SHALL reject
- **AND** none SHALL be left waiting until its own timeout fires
