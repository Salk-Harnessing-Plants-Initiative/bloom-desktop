# scanning — spec deltas

## ADDED Requirements

### Requirement: Scanner Identity Matching Precedence

The system SHALL match a detected USB scanner to its saved `GraviScanner` row on `usb_port`
first. `usb_bus`+`usb_device` SHALL NOT be treated as primary identity: the operating system
reassigns `usb_device` on every reconnect, so a coincidental reuse of a device number can match
an unrelated saved row.

A port value SHALL be considered unusable when it is `null` or the empty string. Two unusable
values SHALL NOT be treated as equal to each other.

Where the `usb_port` lookup finds no row, the system SHALL fall back to `usb_bus`+`usb_device`
**restricted to rows whose own `usb_port` is unusable**. A row holding a usable `usb_port` SHALL
NOT be matched by device number under any circumstance, because that is precisely how a relocated
or re-enumerated scanner takes over an unrelated row's identity. A row holding *no* usable port
carries no competing identity claim, so matching it by device number cannot misattribute anything
— and is the only way such a row can ever acquire a port.

This two-sided restriction is what separates the hazard from the repair. Restricting the fallback
to the detected side alone would additionally strand every row with an unusable port: those rows
would stop matching, accumulate duplicates, and — because stale-row handling leaves a `null` port
untouched — remain enabled and unmatchable indefinitely.

This precedence SHALL apply to `matchDetectedToDb()` and `upsertScannerRow()`. It does not extend
to `validateConfig()` and `resetUsb()`, which match on `usb_port` only and have no bus/device
fallback; that port-only behaviour is intentional and unchanged. Note `validateConfig()` does not
merely report an unmatched row — it **writes** `enabled: false` on it, which is what removes such a
row from every read path.

Where a `usb_port` lookup resolves more than one saved row, the system SHALL NOT silently choose
one. It SHALL leave every candidate row unmodified and report the ambiguity, because choosing
which of two duplicate rows is canonical determines which row future scans are attributed
through, and that is an operator decision. The schema carries no uniqueness constraint on
`usb_port`, and the defect this change fixes can itself have produced duplicate-port rows.

The system SHALL NOT overwrite a saved row's usable `usb_port` with an unusable one. A detected
scanner records an empty `usb_port` whenever the USB topology query is unavailable, and persisting
that would destroy the only stable identity key the hardware affords.

A row created for a detected scanner whose `usb_port` is unusable SHALL record `null` rather than
the empty string, so that stale-row handling treats it as unmatchable rather than as absent from
the detection set.

Where no detected scanner carries a usable `usb_port` — the signature of an unavailable topology
query rather than of scanners having genuinely disappeared — the system SHALL NOT disable saved
rows for absence from the detection set. Disabling on that signal would disable every enabled row
at once, on evidence that says nothing about whether the scanners are present.

`usb_port` identifies a physical **port**, not a physical scanner. The Epson Perfection V600
exposes no USB serial number, so if two same-model scanners are physically swapped between ports,
the system SHALL bind each row to the scanner now occupying its port, and SHALL NOT claim to
detect the swap. This is a recorded non-guarantee (see issue #203).

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

#### Scenario: A scanner on an unknown port does not capture a row holding a usable port

- **GIVEN** a saved row `sc-A` with `usb_port: '1-2.3'`, `usb_bus: 1`, `usb_device: 8`
- **AND** a detected scanner with a usable `usb_port: '1-9'` and `usb_bus: 1`, `usb_device: 8`
- **WHEN** the detected scanner is matched against the saved rows
- **THEN** it SHALL NOT bind to `sc-A`
- **AND** it SHALL be treated as a new scanner
- **AND** an upsert for it SHALL create a new row rather than overwriting `sc-A`'s `usb_port`

#### Scenario: A row with no usable port is healed by a device-number match

- **GIVEN** a saved row `sc-1` with `usb_port: null`, `usb_bus: 1`, `usb_device: 4`
- **AND** a detected scanner with a usable `usb_port: '1-4'`, `usb_bus: 1`, `usb_device: 4`
- **WHEN** an upsert is performed for that detected scanner
- **THEN** `sc-1` SHALL be updated rather than a new row created
- **AND** `sc-1`'s `usb_port` SHALL become `'1-4'`
- **AND** the same SHALL hold for a saved row whose `usb_port` is the empty string

#### Scenario: The fallback never reaches a row that holds a usable port

- **GIVEN** a saved row `sc-A` with `usb_port: '1-2.3'`, `usb_bus: 1`, `usb_device: 4`
- **AND** a saved row `sc-B` with `usb_port: null`, `usb_bus: 1`, `usb_device: 4`
- **AND** a detected scanner with `usb_port: ''`, `usb_bus: 1`, `usb_device: 4`
- **WHEN** the detected scanner is matched against the saved rows
- **THEN** it SHALL bind to `sc-B`
- **AND** it SHALL NOT bind to `sc-A`

#### Scenario: An ambiguous port lookup writes nothing and reports

- **GIVEN** two saved rows both holding `usb_port: '1-2.3'`
- **WHEN** an upsert resolves that port
- **THEN** neither row SHALL be modified
- **AND** no new row SHALL be created
- **AND** the ambiguity SHALL be reported, naming both rows

#### Scenario: An unusable detected port does not overwrite a usable stored port

- **GIVEN** a saved row `sc-1` with `usb_port: '1-2.3'`, matched via the device-number fallback
- **AND** an upsert payload whose `usb_port` is the empty string
- **WHEN** the upsert updates `sc-1`
- **THEN** `sc-1`'s `usb_port` SHALL remain `'1-2.3'`

#### Scenario: A newly created row records an unusable port as null

- **GIVEN** no saved row matches a detected scanner
- **AND** the detected scanner's `usb_port` is the empty string
- **WHEN** a row is created for it
- **THEN** the row's `usb_port` SHALL be `null`, not the empty string

#### Scenario: An unavailable topology query does not disable the fleet

- **GIVEN** three enabled saved rows with usable `usb_port` values
- **AND** a detection pass in which every detected scanner reports an empty `usb_port`
- **WHEN** the detected scanners are saved
- **THEN** no saved row SHALL be disabled for absence from the detection set
- **AND** no saved row's `usb_port` SHALL be overwritten

### Requirement: Scanner Port Integrity Audit

The system SHALL audit saved scanner port integrity at application startup and record the result
in the durable scan log. `usb_port` is the primary identity key and the only stable physical
identifier the supported hardware affords, but it is nullable, was never backfilled by any
migration, and carries no uniqueness constraint — so an operator has today no way to discover
that a scanner's identity is degraded until recovery is attempted.

The audit SHALL examine **all** saved rows, not only enabled ones. A row disabled for absence
from a detection set is exactly the state a duplicate leaves behind, and it is invisible to every
other read path, so an audit restricted to enabled rows could not see the population it exists to
surface.

The audit SHALL report:

- rows whose `usb_port` is `null` or the empty string;
- distinct non-empty `usb_port` values held by more than one row;
- disabled rows that still hold a non-empty `usb_port`, which is the signature of a row stranded
  by a duplicate, together with any enabled row that now holds a port it previously held.

The audit SHALL derive these findings from the database alone, without invoking USB detection. It
SHALL therefore neither block nor delay application startup. Comparing a stored `usb_port` against
what live detection currently reports requires a non-blocking detection interface, which this
change does not introduce, and requires a rule for deciding which stored row corresponds to which
detected device when the two notations differ — which is the finding itself. That comparison is
deliberately out of scope here.

The audit SHALL be read-only: it SHALL NOT modify, disable, merge or delete any row, because
deciding which of two duplicate rows is canonical has data-attribution consequences that belong to
an operator. Any failure of the audit itself SHALL be logged and otherwise ignored, and SHALL NOT
prevent startup.

The audit SHALL be invoked from a main-process startup path that actually executes. It SHALL NOT
be attached to `runStartupScannerValidation()`, which is reachable only through an IPC channel no
renderer code invokes.

#### Scenario: The audit reports a row with no usable port

- **GIVEN** an enabled `GraviScanner` row whose `usb_port` is `null`
- **WHEN** the startup audit runs
- **THEN** it SHALL record that row as having no stable USB port
- **AND** the row SHALL NOT be modified

#### Scenario: The audit reports duplicate ports

- **GIVEN** two rows both holding `usb_port: '1-2.3'`
- **WHEN** the startup audit runs
- **THEN** it SHALL record `'1-2.3'` as held by more than one row, naming both rows
- **AND** neither row SHALL be modified

#### Scenario: The audit sees a stranded disabled row

- **GIVEN** a disabled row holding `usb_port: '1-10.0'`
- **AND** an enabled row holding `usb_port: '1-10'`
- **WHEN** the startup audit runs
- **THEN** it SHALL record the disabled row as stranded while still holding a port
- **AND** neither row SHALL be modified

#### Scenario: A clean installation logs a clean audit

- **GIVEN** rows whose ports are non-empty and distinct, with no stranded disabled rows
- **WHEN** the startup audit runs
- **THEN** it SHALL record that the audit found no findings

#### Scenario: The audit runs without USB detection

- **GIVEN** any set of saved rows
- **WHEN** the startup audit runs
- **THEN** it SHALL NOT invoke USB detection
- **AND** it SHALL NOT delay application startup

#### Scenario: The audit does not fail startup

- **GIVEN** the audit itself throws
- **WHEN** the application starts
- **THEN** the failure SHALL be logged
- **AND** application startup SHALL proceed
