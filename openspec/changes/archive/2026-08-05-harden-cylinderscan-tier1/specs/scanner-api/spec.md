## ADDED Requirements

### Requirement: Sequential Scan Command Processing

The Python IPC handler SHALL process scanner commands (and all other commands) strictly sequentially, one at a time, from a single-threaded command loop. No code path SHALL call into `Scanner` (`is_scanning`, `perform_scan()`, `cleanup()`) from any thread other than the main IPC command loop.

#### Scenario: No concurrent access to scanner state

- **GIVEN** the Python IPC handler is running
- **WHEN** any background thread (e.g. the camera streaming thread) is active
- **THEN** that thread SHALL NOT read or write `Scanner.is_scanning`
- **AND** the only caller of `Scanner.perform_scan()` and `Scanner.cleanup()` SHALL be the main IPC command loop

#### Scenario: Scan-in-progress cleanup is rejected immediately

- **GIVEN** a scan is currently in progress (`is_scanning` is `True`)
- **WHEN** `cleanup()` is called
- **THEN** it SHALL raise immediately, without waiting for the scan to complete
