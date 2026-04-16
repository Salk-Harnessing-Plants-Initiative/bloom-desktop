# Spec Deltas: scanning

## MODIFIED Requirements

### Requirement: GraviScan Session State Management

The system SHALL maintain scan session state at module level in `src/main/graviscan/wiring.ts` and expose it via getter/setter functions passed to handler modules through dependency injection. The session state type `ScanSessionState` SHALL be defined in `src/types/graviscan.ts`.

> **Delta:** Changed location from `main.ts` to `src/main/graviscan/wiring.ts`. Added scenario for markScanJobRecorded when session is null. All other scenarios unchanged.

#### Scenario: Session state accessible via getters

- **GIVEN** the GraviScan session state is initialized in `src/main/graviscan/wiring.ts`
- **WHEN** `sessionFns.getScanSession()` is called
- **THEN** it SHALL return the current `ScanSessionState` or `null` if no scan is active

#### Scenario: Session state updated by handlers

- **GIVEN** a scan is started via `graviscan:start-scan`
- **WHEN** `startScan()` calls `sessionFns.setScanSession(newState)`
- **THEN** `sessionFns.getScanSession()` SHALL return the updated state
- **AND** the state SHALL include `isActive`, `isContinuous`, `experimentId`, `phenotyperId`, `resolution`, `sessionId`, `jobs`, `currentCycle`, `totalCycles`, `intervalMs`, `scanStartedAt`, `scanEndedAt`, `scanDurationMs`, `coordinatorState`, `nextScanAt`, and `waveNumber` fields

#### Scenario: Session state cleared on cancel

- **GIVEN** an active scan session exists
- **WHEN** `graviscan:cancel-scan` is invoked
- **THEN** `cancelScan()` SHALL call `sessionFns.setScanSession(null)`
- **AND** `sessionFns.getScanSession()` SHALL return `null`

#### Scenario: Concurrent start-scan rejected when session active

- **GIVEN** an active scan session exists (`getScanSession()` returns non-null with `isActive: true`)
- **WHEN** the renderer invokes `graviscan:start-scan`
- **THEN** the handler SHALL return `{ success: false, error: 'Scan already in progress' }`
- **AND** the existing session SHALL NOT be modified

#### Scenario: markScanJobRecorded updates job status

- **GIVEN** an active scan session exists with a job keyed by `scannerId:plateIndex`
- **WHEN** `sessionFns.markScanJobRecorded('scanner1:00')` is called
- **THEN** the job's `status` field SHALL be set to `'recorded'`

#### Scenario: markScanJobRecorded ignores unknown job key

- **GIVEN** an active scan session exists
- **WHEN** `sessionFns.markScanJobRecorded('nonexistent:99')` is called
- **THEN** the session state SHALL NOT be modified
- **AND** no error SHALL be thrown

#### Scenario: markScanJobRecorded no-ops when session is null

- **GIVEN** no scan session is active (`getScanSession()` returns `null`)
- **WHEN** `sessionFns.markScanJobRecorded('scanner1:00')` is called
- **THEN** no error SHALL be thrown
- **AND** `getScanSession()` SHALL still return `null`

### Requirement: GraviScan Conditional Mode Registration

The system SHALL register GraviScan IPC handlers only when the configured scanner mode is `graviscan`. When mode is `cylinderscan` or empty, no GraviScan handlers SHALL be registered. The `initGraviScan()` function SHALL be exported from `src/main/graviscan/wiring.ts`.

> **Delta:** Changed source location from `main.ts` to `src/main/graviscan/wiring.ts`. All scenarios unchanged.

#### Scenario: GraviScan handlers registered in graviscan mode

- **GIVEN** `SCANNER_MODE=graviscan` in the `.env` config
- **WHEN** the app starts and `initGraviScan()` is called
- **THEN** `registerGraviScanHandlers` SHALL be called
- **AND** all 15 `graviscan:*` IPC channels SHALL be available

#### Scenario: GraviScan handlers not registered in cylinderscan mode

- **GIVEN** `SCANNER_MODE=cylinderscan` in the `.env` config
- **WHEN** the app starts
- **THEN** `registerGraviScanHandlers` SHALL NOT be called
- **AND** invoking any `graviscan:*` IPC channel SHALL result in an unhandled channel error

#### Scenario: GraviScan handlers not registered when mode is empty

- **GIVEN** `SCANNER_MODE` is not set or is an empty string in the `.env` config
- **WHEN** the app starts
- **THEN** `registerGraviScanHandlers` SHALL NOT be called

### Requirement: GraviScan Coordinator Lazy Instantiation

The `ScanCoordinator` SHALL be instantiated lazily — created only when `graviscan:start-scan` is invoked, not at app startup. The `getOrCreateCoordinator()` function SHALL be exported from `src/main/graviscan/wiring.ts`. This matches the CylinderScan pattern where `ScannerProcess` is created in the `scanner:initialize` handler.

> **Delta:** Changed source location from `main.ts` to `src/main/graviscan/wiring.ts`. Updated shutdown scenario to reference `shutdownGraviScan()`. All other scenarios unchanged.

#### Scenario: No coordinator at startup

- **GIVEN** the app starts in `graviscan` mode
- **WHEN** no scan has been initiated
- **THEN** no `ScanCoordinator` instance SHALL exist
- **AND** no Python subprocesses SHALL be spawned

#### Scenario: Coordinator created on first call

- **GIVEN** the app is in `graviscan` mode
- **AND** no `ScanCoordinator` instance exists
- **WHEN** `getOrCreateCoordinator()` is called
- **THEN** a new `ScanCoordinator` SHALL be instantiated
- **AND** its events SHALL be wired to the renderer via `setupCoordinatorEventForwarding()`

#### Scenario: Coordinator returned from cache on subsequent calls

- **GIVEN** a `ScanCoordinator` instance already exists
- **WHEN** `getOrCreateCoordinator()` is called
- **THEN** the existing instance SHALL be returned
- **AND** no new `ScanCoordinator` SHALL be created

#### Scenario: Concurrent calls return same instance

- **GIVEN** `getOrCreateCoordinator()` is called concurrently from multiple callers
- **WHEN** both calls resolve
- **THEN** both SHALL return the same `ScanCoordinator` instance
- **AND** only one `ScanCoordinator` SHALL have been created (promise memoization)

#### Scenario: Coordinator shutdown on app quit

- **GIVEN** a `ScanCoordinator` instance exists (scan was started)
- **WHEN** the app is quitting
- **THEN** `shutdownGraviScan()` SHALL be called
- **AND** the coordinator SHALL be shut down gracefully via `coordinator.shutdown()`
- **AND** `closeScanLog()` SHALL be called

### Requirement: GraviScan Coordinator Event Forwarding

The system SHALL forward `ScanCoordinator` events to the renderer process via IPC. The `setupCoordinatorEventForwarding()` function SHALL be exported from `src/main/graviscan/wiring.ts`. All forwarding SHALL use the `if (mainWindow && !mainWindow.isDestroyed())` guard pattern.

> **Delta:** Changed source location from `main.ts` to `src/main/graviscan/wiring.ts`. Fixed pre-existing gap: added `rename-error` to the forwarded events list.

#### Scenario: Scan events forwarded to renderer

- **GIVEN** a `ScanCoordinator` is active and `mainWindow` exists
- **WHEN** the coordinator emits `scan-event`, `grid-start`, `grid-complete`, `cycle-complete`, `interval-start`, `interval-waiting`, `interval-complete`, `overtime`, `cancelled`, `scan-error`, or `rename-error`
- **THEN** the event SHALL be forwarded to the renderer via `mainWindow.webContents.send('graviscan:<event-name>', payload)`

#### Scenario: No crash when mainWindow is null

- **GIVEN** a `ScanCoordinator` is active
- **AND** `mainWindow` is `null`
- **WHEN** the coordinator emits an event
- **THEN** the event SHALL be silently dropped (no crash, no error log)

#### Scenario: No crash when mainWindow is destroyed

- **GIVEN** a `ScanCoordinator` is active
- **AND** `mainWindow.isDestroyed()` returns `true`
- **WHEN** the coordinator emits an event
- **THEN** the event SHALL be silently dropped (no crash, no error log)

### Requirement: GraviScan Barrel Exports

The `src/main/graviscan/index.ts` barrel SHALL export all existing handler exports unchanged, plus `initGraviScan` and `shutdownGraviScan` from `wiring`. The full barrel export list SHALL include: `registerGraviScanHandlers` from `register-handlers`, `ScanCoordinator` from `scan-coordinator`, `ScannerSubprocess` from `scanner-subprocess`, `scanLog`, `cleanupOldLogs`, `closeScanLog` from `scan-logger`, `initGraviScan` and `shutdownGraviScan` from `wiring`, in addition to all existing handler module re-exports.

> **Delta:** Added re-exports of `initGraviScan` and `shutdownGraviScan` from `./wiring`. All existing exports are preserved unchanged. Internal wiring functions (`graviSessionFns`, `setupCoordinatorEventForwarding`, `getOrCreateCoordinator`) are not barrel-exported — they are importable directly from `wiring.ts` when needed.

#### Scenario: All public symbols exported

- **GIVEN** a TypeScript file imports from `./graviscan`
- **WHEN** it references `registerGraviScanHandlers`, `ScanCoordinator`, `ScannerSubprocess`, `scanLog`, `cleanupOldLogs`, `closeScanLog`, `initGraviScan`, or `shutdownGraviScan`
- **THEN** the imports SHALL resolve without TypeScript compilation errors

## ADDED Requirements

### Requirement: GraviScan Graceful Shutdown

The system SHALL provide a `shutdownGraviScan()` function in `src/main/graviscan/wiring.ts` that encapsulates all GraviScan cleanup: coordinator shutdown and scan log closing. This function SHALL be called from `main.ts` during the `before-quit` handler.

#### Scenario: Coordinator shutdown when active

- **GIVEN** a `ScanCoordinator` instance exists
- **WHEN** `shutdownGraviScan()` is called
- **THEN** `coordinator.shutdown()` SHALL be called
- **AND** the internal coordinator reference SHALL be set to `null`
- **AND** `closeScanLog()` SHALL be called

#### Scenario: No-op when no coordinator exists

- **GIVEN** no `ScanCoordinator` instance exists (no scan was started)
- **WHEN** `shutdownGraviScan()` is called
- **THEN** no error SHALL be thrown
- **AND** `closeScanLog()` SHALL still be called (safe to call even if not opened)

#### Scenario: Coordinator shutdown error handled gracefully

- **GIVEN** a `ScanCoordinator` instance exists
- **AND** `coordinator.shutdown()` throws an error
- **WHEN** `shutdownGraviScan()` is called
- **THEN** the error SHALL be caught and logged via `console.error`
- **AND** the coordinator reference SHALL still be set to `null`
- **AND** `closeScanLog()` SHALL still be called

#### Scenario: Shutdown awaits in-flight coordinator creation

- **GIVEN** `getOrCreateCoordinator()` has been called and its creation promise is pending
- **WHEN** `shutdownGraviScan()` is called before creation completes
- **THEN** the function SHALL await the pending creation
- **AND** shut down the resulting coordinator
- **AND** no orphaned coordinator instance SHALL remain

#### Scenario: Shutdown handles rejected coordinator creation

- **GIVEN** `getOrCreateCoordinator()` has been called and its creation promise is pending
- **AND** the creation promise will reject (e.g., Python executable not found)
- **WHEN** `shutdownGraviScan()` is called
- **THEN** the rejection SHALL be caught and logged via `console.error`
- **AND** the coordinator reference SHALL remain `null`
- **AND** `closeScanLog()` SHALL still be called

### Requirement: GraviScan Wiring Module Side-Effect-Free

The `src/main/graviscan/wiring.ts` module SHALL be side-effect-free at load time. Importing the module SHALL NOT execute any code beyond variable declarations and function definitions. The module SHALL use only `import type` at the top level — no runtime Electron imports.

#### Scenario: Module importable in Node test environment

- **GIVEN** a Node.js test environment without Electron
- **AND** the `electron` module is mocked (intercepting dynamic imports inside functions)
- **WHEN** `wiring.ts` is imported
- **THEN** no side effects SHALL occur (no IPC registration, no subprocess spawning, no file I/O)
- **AND** all exported functions (`initGraviScan`, `shutdownGraviScan`, `getOrCreateCoordinator`, `setupCoordinatorEventForwarding`, `graviSessionFns`, `_resetWiringState`) SHALL be defined and callable
