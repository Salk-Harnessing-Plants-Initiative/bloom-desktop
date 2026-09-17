# scanning — spec deltas

## ADDED Requirements

### Requirement: Scanner Identity Matching Precedence

The system SHALL match a detected USB scanner to its saved `GraviScanner` row on `usb_port`
first, and SHALL consult `usb_bus`+`usb_device` only when the **detected** scanner (or the
upsert payload) carries no usable `usb_port`. `usb_bus`+`usb_device` SHALL NOT be treated as
primary identity: the operating system reassigns `usb_device` on every reconnect, so a
coincidental reuse of a device number can match an unrelated saved row.

A port value SHALL be considered unusable when it is `null` or the empty string. Two unusable
values SHALL NOT be treated as equal to each other.

The fallback SHALL NOT be reached merely because a port lookup found no match. A detected
scanner that carries a usable `usb_port` matching no saved row SHALL be treated as a new
scanner, and SHALL NOT be matched onto a saved row by its device number.

This is a deliberate trade. It means a saved row whose `usb_port` no longer matches live
detection — because the scanner was relocated, or because the stored notation differs from
what detection now produces — SHALL result in a new row rather than being healed by a
device-number match. Healing by device number is rejected because it cannot distinguish
"this is the same scanner, recorded differently" from "this is a different scanner that
happens to hold that device number now", and the second case silently attributes one
scanner's plate barcodes to another scanner's images. A duplicated row is recoverable and
detectable; a misattributed image is neither. The "Scanner Port Integrity Audit" requirement
exists to surface the mismatch before it produces a duplicate.

This precedence SHALL apply to `matchDetectedToDb()` and `upsertScannerRow()`. It does not
extend to `validateConfig()` and `resetUsb()`, which match on `usb_port` only and have no
bus/device fallback; that port-only behaviour is intentional and unchanged, and a row with no
usable `usb_port` SHALL continue to be reported as missing or disconnected by those two paths
respectively.

Where a lookup by `usb_port` can match more than one saved row, the system SHALL select
deterministically, preferring an `enabled` row and then the most recently updated row. The
schema carries no uniqueness constraint on `usb_port`, and the defect this change fixes can
itself have produced duplicate-port rows on existing installations.

The system SHALL NOT overwrite a saved row's usable `usb_port` with an unusable one. A
detected scanner records an empty `usb_port` whenever the USB topology query is unavailable,
and persisting that would destroy the only stable identity key the hardware affords.

`usb_port` identifies a physical **port**, not a physical scanner. The Epson Perfection V600
exposes no USB serial number, so if two same-model scanners are physically swapped between
ports, the system SHALL bind each row to the scanner now occupying its port, and SHALL NOT
claim to detect the swap. This is a recorded non-guarantee, not an oversight (see issue #203).

#### Scenario: A reused device number does not bind a detected scanner to the wrong row

- **GIVEN** saved rows `sc-A` with `usb_port: '1-2.3', usb_device: 8` and `sc-B` with `usb_port: '1-4', usb_device: 5`
- **AND** a re-enumeration moves the scanner at port `1-4` to `usb_device: 8`
- **WHEN** detection results are matched against the saved rows
- **THEN** the detected scanner at `usb_port: '1-4'` SHALL bind to `sc-B`
- **AND** it SHALL NOT bind to `sc-A` on the strength of the coincident `usb_device: 8`

#### Scenario: Upsert updates the row owning the port, not the row owning the device number

- **GIVEN** a saved row `sc-A` with `usb_port: '1-2.3'`, `usb_bus: 1`, `usb_device: 8`
- **AND** a saved row `sc-B` with `usb_port: '1-4'`, `usb_bus: 1`, `usb_device: 5`
- **WHEN** an upsert is performed for `{ usb_port: '1-4', usb_bus: 1, usb_device: 8 }`
- **THEN** `sc-B` SHALL be updated
- **AND** `sc-A`'s `usb_port`, `name` and `display_name` SHALL be left unchanged
- **AND** no new `GraviScanner` row SHALL be created

#### Scenario: A scanner on an unknown port is treated as new, not matched by device number

- **GIVEN** a saved row `sc-A` with `usb_port: '1-2.3'`, `usb_bus: 1`, `usb_device: 8`
- **AND** a detected scanner with a usable `usb_port: '1-9'` and `usb_bus: 1`, `usb_device: 8`
- **WHEN** the detected scanner is matched against the saved rows
- **THEN** it SHALL NOT bind to `sc-A`
- **AND** it SHALL be treated as a new scanner
- **AND** an upsert for it SHALL create a new row rather than overwriting `sc-A`'s `usb_port`

#### Scenario: Matching falls back to bus and device only when the detected port is unusable

- **GIVEN** a saved row `sc-1` with `usb_port: null`, `usb_bus: 1`, `usb_device: 4`
- **AND** a detected scanner with `usb_port: ''` (because the USB topology query was unavailable), `usb_bus: 1`, `usb_device: 4`
- **WHEN** the detected scanner is matched against the saved rows
- **THEN** it SHALL bind to `sc-1` via the `usb_bus`+`usb_device` fallback
- **AND** an empty-string `usb_port` SHALL NOT be treated as matching another row's empty-string `usb_port`

#### Scenario: A duplicate-port lookup prefers the enabled, most recent row

- **GIVEN** two saved rows both holding `usb_port: '1-2.3'`, one `enabled: false` created earlier
  and one `enabled: true` updated more recently
- **WHEN** an upsert resolves that port
- **THEN** the `enabled`, most recently updated row SHALL be updated
- **AND** the other row SHALL be left unchanged

#### Scenario: An unusable detected port does not overwrite a usable stored port

- **GIVEN** a saved row `sc-1` with `usb_port: '1-2.3'`, matched via the `usb_bus`+`usb_device` fallback
- **AND** an upsert payload whose `usb_port` is the empty string
- **WHEN** the upsert updates `sc-1`
- **THEN** `sc-1`'s `usb_port` SHALL remain `'1-2.3'`
- **AND** a subsequent detection reporting `usb_port: '1-2.3'` SHALL match `sc-1` rather than creating a new row

#### Scenario: A newly created row records an unusable port as null rather than empty

- **GIVEN** no saved row matches a detected scanner
- **AND** the detected scanner's `usb_port` is the empty string
- **WHEN** a row is created for it
- **THEN** the row's `usb_port` SHALL be `null`
- **AND** it SHALL NOT be the empty string, so that stale-row handling treats it as unmatchable rather than as absent from the detection set

### Requirement: Scanner Port Integrity Audit

The system SHALL audit saved scanner port integrity at application startup and record the
result in the durable scan log. Because `usb_port` is the primary identity key and the only
stable physical identifier the supported hardware affords, but is nullable, was never
backfilled by any migration, and carries no uniqueness constraint, an operator has today no
way to discover that a scanner's identity is unrecoverable until recovery is attempted.

The audit SHALL report, for enabled rows:

- rows whose `usb_port` is `null` or the empty string;
- distinct non-empty `usb_port` values held by more than one row;
- rows whose stored `usb_port` does not exactly equal the value live detection produces for
  the same physical port.

The audit SHALL be read-only. It SHALL NOT modify, disable, merge or delete any row, because
deciding which of two duplicate rows is canonical has data-attribution consequences that
belong to an operator. It SHALL NOT block or delay application startup, and any failure of
the audit itself SHALL be logged and otherwise ignored.

Where USB detection is unavailable, the audit SHALL report the null/empty and duplicate
findings, which need no detection, and SHALL record that the notation comparison was not
performed rather than reporting it as passing.

#### Scenario: The audit reports a row with no usable port

- **GIVEN** an enabled `GraviScanner` row whose `usb_port` is `null`
- **WHEN** the startup audit runs
- **THEN** it SHALL record that row's `scanner_id` as having no stable USB port
- **AND** the row SHALL NOT be modified

#### Scenario: The audit reports duplicate ports

- **GIVEN** two enabled `GraviScanner` rows both holding `usb_port: '1-2.3'`
- **WHEN** the startup audit runs
- **THEN** it SHALL record `'1-2.3'` as held by more than one row, naming both `scanner_id`s
- **AND** neither row SHALL be modified

#### Scenario: The audit reports a notation mismatch against live detection

- **GIVEN** an enabled `GraviScanner` row with `usb_port: '1-10.0'`
- **AND** live detection reports the scanner at that physical port as `usb_port: '1-10'`
- **WHEN** the startup audit runs
- **THEN** it SHALL record the stored and detected values as a mismatch
- **AND** the row SHALL NOT be modified

#### Scenario: A clean installation logs a clean audit

- **GIVEN** enabled rows whose ports are non-empty, distinct, and equal to live detection's values
- **WHEN** the startup audit runs
- **THEN** it SHALL record that the audit found no findings

#### Scenario: The audit degrades when detection is unavailable

- **GIVEN** USB detection returns a failure
- **AND** one enabled row has `usb_port: null`
- **WHEN** the startup audit runs
- **THEN** it SHALL still report the null-port finding
- **AND** it SHALL record that the notation comparison was not performed
- **AND** it SHALL NOT report the notation comparison as passing

#### Scenario: The audit does not fail startup

- **GIVEN** the audit itself throws
- **WHEN** the application starts
- **THEN** the failure SHALL be logged
- **AND** application startup SHALL proceed
