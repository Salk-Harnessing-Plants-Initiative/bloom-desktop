# ipc-reliability Specification

## Purpose

TBD - created by archiving change harden-cylinderscan-tier1. Update Purpose after archive.

## Requirements

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

#### Scenario: Calling a cleanup function twice is safe

- **GIVEN** a renderer component has already invoked one of the 8 target listeners' returned cleanup function once
- **WHEN** the same cleanup function is invoked a second time
- **THEN** no error SHALL be thrown
- **AND** the listener SHALL remain removed (no double-removal side effects)

#### Scenario: PythonStatus consumes cleanup on unmount

- **GIVEN** `PythonStatus` has subscribed to `python.onStatus` and `python.onError` in a `useEffect`
- **WHEN** the component unmounts
- **THEN** both listeners' cleanup functions SHALL be invoked
- **AND** neither callback SHALL fire for events received after unmount

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

#### Scenario: Streaming-thread errors are never attributed to an unrelated pending request

- **GIVEN** a `sendCommand()` call is in flight with request id `N` (e.g. a `daq:get-status` command)
- **AND** the camera streaming background thread encounters its own, unrelated error
- **WHEN** the streaming thread's error is emitted
- **THEN** it SHALL NOT carry request id `N` or resolve/reject the pending request for id `N`
- **AND** it SHALL instead be treated as an unattributable error (rejecting all currently-pending requests, per the scenario above)

#### Scenario: Timed-out request is removed from the pending map

- **GIVEN** a `sendCommand()` call has been pending long enough to hit its timeout
- **WHEN** the timeout fires and the call rejects
- **THEN** its entry SHALL be removed from `pendingRequests`
- **AND** a subsequent response arriving with that same (now-stale) id SHALL be ignored, not resolve/reject anything

#### Scenario: Concurrent restart() calls share one in-flight operation

- **GIVEN** `PythonProcess.restart()` is called while an earlier `restart()` call is still in flight (e.g. a user double-clicking "Restart Python")
- **WHEN** the second call is made
- **THEN** it SHALL return the same in-flight operation rather than starting a competing `stop()`-then-`start()` sequence
- **AND** exactly one new process SHALL be spawned as a result of the overlapping calls, not two, and neither call SHALL reject with "Process already started"

#### Scenario: A stale exit event from a superseded process generation does not corrupt the new process's state

- **GIVEN** `restart()` has stopped an old process and started a new one, and the old process's real OS-level exit event arrives late (after the new process is already running with its own in-flight `sendCommand()` requests)
- **WHEN** the stale exit event fires
- **THEN** it SHALL NOT null out the reference to the new, live process
- **AND** it SHALL NOT reject any of the new process's currently-pending requests
- **AND** the new process's pending requests SHALL still resolve normally when their own matching responses arrive

#### Scenario: stop() rejects currently-pending requests immediately, not via the eventual exit event

- **GIVEN** one or more `sendCommand()` calls are pending against the current process
- **WHEN** `stop()` is called (directly, or as part of `restart()`)
- **THEN** every currently-pending request SHALL reject immediately
- **AND** none SHALL be left waiting for the process's real (possibly delayed, possibly generation-guarded-away) `exit` event, or for its own timeout, to fail

#### Scenario: Generation protection applies to a direct stop()-then-start(), not only to restart()

- **GIVEN** `stop()` is called directly (not via `restart()`) and `start()` is called again afterward
- **AND** the first process's real OS-level exit event arrives late, after the second `start()` has begun
- **WHEN** the stale exit event fires
- **THEN** it SHALL NOT corrupt the second process's state, identically to the `restart()` case above
