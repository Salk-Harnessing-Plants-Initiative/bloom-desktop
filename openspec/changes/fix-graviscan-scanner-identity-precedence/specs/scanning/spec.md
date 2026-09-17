# scanning — spec deltas

## ADDED Requirements

### Requirement: Scanner Identity Matching Precedence

The system SHALL match a detected USB scanner to its saved `GraviScanner` row on `usb_port`.
`usb_bus`+`usb_device` SHALL NOT be treated as identity: the operating system reassigns
`usb_device` on every reconnect, so a coincidental reuse of a device number can match an
unrelated saved row.

A port value SHALL be considered unusable when it is `null` or the empty string. Two unusable
values SHALL NOT be treated as equal to each other.

**A match on `usb_bus`+`usb_device` SHALL NEVER assign, change or transfer a `usb_port`.** It
SHALL be reachable only when the detected scanner's own port is unusable *and* the candidate
row's port is unusable, and it SHALL be permitted to refresh only `usb_bus`/`usb_device` on that
row. This single invariant is what prevents a device number from moving identity between physical
scanners, and it is stated as an invariant rather than as a set of prohibitions because each
narrower formulation of this rule has closed one path while opening another.

It follows that a detected scanner carrying a **usable** port never reaches the device-number
tier. If its port matches no saved row, it is a new scanner. Matching it by device number would
let it take over a row that has a `scanner_id`, a `name`, and scan and plate-assignment records
attached to it — which is misattribution whether or not that row happens to hold a port.

The system SHALL NOT create a `GraviScanner` row for a detected scanner whose `usb_port` is
unusable. Such a row could never be matched again under this precedence, so creating one produces
an unidentifiable record that accumulates on every subsequent detection. The system SHALL instead
report that the scanner could not be identified, so that a degraded USB topology query is visible
rather than silently producing rows.

Where a lookup in **either** tier resolves more than one saved row, the system SHALL NOT choose
one. It SHALL leave every candidate unmodified and report the ambiguity, naming the port or
address and every candidate row. Choosing which of two duplicate rows is canonical determines
which row future scans are attributed through, and that is an operator decision. `usb_port`
carries no uniqueness constraint, and the defect this change fixes can itself have produced
duplicate rows.

The system SHALL NOT overwrite a saved row's usable `usb_port` with an unusable one.

This precedence SHALL apply to `matchDetectedToDb()` and `upsertScannerRow()`. These two operate
over different candidate sets — `matchDetectedToDb()` sees only `enabled` rows, while
`upsertScannerRow()` queries all rows — and that difference SHALL be preserved, since a disabled
row must remain re-enableable on re-detection while not competing for identity during a live
detection pass.

It does not extend to `validateConfig()` and `resetUsb()`, which match on `usb_port` only and have
no fallback; that is intentional and unchanged. Note `validateConfig()` does not merely report an
unmatched row — it **writes** `enabled: false` on it, which is what removes such a row from every
read path.

Where no detected scanner carries a usable `usb_port` — the signature of an unavailable topology
query rather than of scanners having disappeared — the system SHALL NOT disable saved rows for
absence from the detection set.

`usb_port` identifies a physical **port**, not a physical scanner. The Epson Perfection V600
exposes no USB serial number, so if two same-model scanners are physically swapped between ports,
the system SHALL bind each row to the scanner now occupying its port, and SHALL NOT claim to
detect the swap (see issue #203).

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

#### Scenario: A scanner with a usable port never reaches the device-number tier

- **GIVEN** a saved row `sc-A` with `usb_port: null`, `usb_bus: 1`, `usb_device: 5`, holding scan history
- **AND** a detected scanner with a usable `usb_port: '1-7'`, `usb_bus: 1`, `usb_device: 5`
- **WHEN** the detected scanner is matched against the saved rows
- **THEN** it SHALL NOT bind to `sc-A`
- **AND** `sc-A`'s `usb_port` SHALL remain `null`
- **AND** the detected scanner SHALL be treated as new
- **AND** the same SHALL hold when `sc-A`'s `usb_port` is the empty string

#### Scenario: The device-number tier refreshes an address but never a port

- **GIVEN** a saved row `sc-1` with `usb_port: null`, `usb_bus: 1`, `usb_device: 4`
- **AND** a detected scanner whose `usb_port` is the empty string, at `usb_bus: 1`, `usb_device: 4`
- **WHEN** the detected scanner is matched against the saved rows
- **THEN** `sc-1` SHALL be matched
- **AND** `sc-1`'s `usb_port` SHALL remain `null`
- **AND** only `usb_bus`/`usb_device` SHALL be refreshed on it

#### Scenario: An unidentifiable scanner does not create a row

- **GIVEN** no saved row matches a detected scanner
- **AND** the detected scanner's `usb_port` is unusable
- **WHEN** the detected scanners are saved
- **THEN** no `GraviScanner` row SHALL be created for it
- **AND** the system SHALL report that the scanner could not be identified

#### Scenario: An ambiguous lookup writes nothing and reports, in either tier

- **GIVEN** two saved rows both holding `usb_port: '1-2.3'`
- **WHEN** an upsert resolves that port
- **THEN** neither row SHALL be modified, no row SHALL be created, and the ambiguity SHALL be reported naming both rows
- **AND** the same SHALL hold when two rows with unusable ports share a `usb_bus`+`usb_device` and the device-number tier resolves them

#### Scenario: An unavailable topology query neither disables nor duplicates

- **GIVEN** three enabled saved rows with usable `usb_port` values
- **AND** a detection pass in which every detected scanner reports an empty `usb_port`
- **WHEN** the detected scanners are saved
- **THEN** no saved row SHALL be disabled for absence from the detection set
- **AND** no saved row's `usb_port` SHALL be overwritten
- **AND** no new row SHALL be created
- **AND** the system SHALL report that the scanners could not be identified

### Requirement: Scanner Port Integrity Audit

The system SHALL audit saved scanner port integrity at application startup and record the result
in the durable scan log. `usb_port` is the identity key and the only stable physical identifier
the supported hardware affords, but it is nullable, was never backfilled by any migration, and
carries no uniqueness constraint — so an operator has today no way to discover that a scanner's
identity is degraded until recovery is attempted.

The audit SHALL examine **all** saved rows, not only enabled ones. A row disabled for absence from
a detection set is exactly the state a duplicate leaves behind, and it is invisible to every other
read path, so an audit restricted to enabled rows could not see the population it exists to
surface.

The audit SHALL report:

- rows whose `usb_port` is `null` or the empty string, which cannot be matched by port and
  therefore cannot be recovered by the wedge-retry path;
- `usb_port` values held by more than one row, counting enabled and disabled rows alike;
- disabled rows whose `usb_port` is **also held by another row**, which is the signature of a row
  superseded by a duplicate. A disabled row that merely still holds a port SHALL NOT be reported:
  stale-row handling disables a row while deliberately preserving its `usb_port`, so that state is
  the normal resting condition of any scanner ever unplugged or re-cabled, and reporting it would
  bury the real findings in noise.

The audit SHALL derive every finding from the database alone, without invoking USB detection, and
SHALL therefore neither block nor delay application startup. Comparing a stored `usb_port` against
live detection requires a non-blocking detection interface this change does not introduce, and
requires a rule for pairing a stored row with a detected device when the two notations differ —
which is the finding itself. That comparison is deliberately out of scope.

The audit SHALL be read-only: it SHALL NOT modify, disable, merge or delete any row, because
deciding which of two duplicate rows is canonical has data-attribution consequences that belong to
an operator. Any failure of the audit itself SHALL be logged and otherwise ignored, and SHALL NOT
prevent or delay startup.

The audit SHALL be invoked from a main-process startup path that actually executes, and SHALL NOT
be attached to `runStartupScannerValidation()`, which is reachable only through an IPC channel no
renderer code invokes.

#### Scenario: The audit reports a row with no usable port

- **GIVEN** a `GraviScanner` row whose `usb_port` is `null`
- **WHEN** the startup audit runs
- **THEN** it SHALL record that row as having no stable USB port
- **AND** the row SHALL NOT be modified

#### Scenario: The audit reports duplicate ports across enabled and disabled rows

- **GIVEN** an enabled row and a disabled row both holding `usb_port: '1-2.3'`
- **WHEN** the startup audit runs
- **THEN** it SHALL record `'1-2.3'` as held by more than one row, naming both
- **AND** neither row SHALL be modified

#### Scenario: The audit reports a disabled row superseded by a duplicate

- **GIVEN** a disabled row holding `usb_port: '1-2.3'`
- **AND** another row that also holds `usb_port: '1-2.3'`
- **WHEN** the startup audit runs
- **THEN** it SHALL record the disabled row as superseded, naming both rows
- **AND** neither row SHALL be modified

#### Scenario: The audit does not report a merely retired disabled row

- **GIVEN** a disabled row holding `usb_port: '1-10'`
- **AND** no other row holds that port
- **WHEN** the startup audit runs
- **THEN** it SHALL NOT report that row
- **AND** a fleet whose only disabled rows are of this kind SHALL audit clean

#### Scenario: A clean installation logs a clean audit

- **GIVEN** enabled rows whose ports are usable and distinct, and no disabled rows holding a port
- **WHEN** the startup audit runs
- **THEN** it SHALL record that the audit found no findings

#### Scenario: The audit runs without USB detection and without delaying startup

- **GIVEN** any set of saved rows
- **WHEN** the startup audit runs
- **THEN** it SHALL NOT invoke USB detection
- **AND** application startup SHALL NOT wait for the audit to complete

#### Scenario: The audit does not fail startup

- **GIVEN** the audit throws, or its database handle is unusable
- **WHEN** the application starts
- **THEN** the failure SHALL be logged
- **AND** application startup SHALL proceed
- **AND** no unhandled rejection SHALL escape
