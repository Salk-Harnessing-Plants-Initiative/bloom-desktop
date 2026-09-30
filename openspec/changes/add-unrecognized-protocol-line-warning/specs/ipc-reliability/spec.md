## ADDED Requirements

### Requirement: Unrecognized Protocol Line Visibility

`PythonProcess` SHALL log a warning whenever it receives a stdout line that does not match any recognized protocol prefix (`STATUS:`, `ERROR:`, `DATA:`, `IMAGE:`, or a subclass's own recognized prefixes) and does not match a known-informal, already-legitimate allowlist entry (the `WARNING:`/`INFO:` prefixes, or an exact-match list of known benign prefix-less lines), so that genuine protocol-level corruption is visible in application logs rather than silently dropped, without flagging pre-existing benign diagnostic output as if it were an error.

#### Scenario: A truly unrecognized line is logged, not silently dropped

- **GIVEN** a line arrives on the Python subprocess's stdout that does not start with any prefix `PythonProcess.parseLine()` (or a subclass override) recognizes, and does not match any allowlist entry
- **WHEN** the line is parsed
- **THEN** the existing `'raw'` event SHALL still be emitted (unchanged, for any explicit listener)
- **AND** a warning SHALL also be logged by default, containing a truncated preview of the offending line, without requiring a caller to attach its own `'raw'` listener

#### Scenario: Known-informal prefixes do not trigger the default warning

- **GIVEN** a line arrives that starts with `WARNING:` or `INFO:` (e.g. `WARNING:Error closing DAQ task: ...` from `daq.py`, or `INFO:Camera enumeration not available: ...` from `detect_cameras()`), neither of which is a formally recognized protocol prefix
- **WHEN** the line is parsed
- **THEN** the existing `'raw'` event SHALL still be emitted (unchanged, for any explicit listener)
- **AND** the default warning SHALL NOT be logged for this line, since it is expected, pre-existing diagnostic output rather than evidence of protocol corruption

#### Scenario: Known benign prefix-less lines do not trigger the default warning

- **GIVEN** a line arrives that exactly matches a known-benign, prefix-less diagnostic line already emitted by the Python side today (e.g. `"Generating synthetic test patterns instead"` from `camera_mock.py`, which has no recognizable prefix at all and so cannot be matched by a prefix-based allowlist)
- **WHEN** the line is parsed
- **THEN** the existing `'raw'` event SHALL still be emitted (unchanged, for any explicit listener)
- **AND** the default warning SHALL NOT be logged for this line

#### Scenario: The allowlist check is case-sensitive and exact

- **GIVEN** a line arrives that superficially resembles an allowlisted prefix but does not exactly match it — e.g. lowercase `warning:...`, or a line starting with `WARNINGLY:` (a different, unrelated prefix that merely starts with the same characters as `WARNING:`)
- **WHEN** the line is parsed
- **THEN** it SHALL NOT be treated as allowlisted
- **AND** the default warning SHALL be logged for it, per the "truly unrecognized line" scenario above
