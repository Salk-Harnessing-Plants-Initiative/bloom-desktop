## ADDED Requirements

### Requirement: GraviScan Scanner Firmware Serial Identity

The system SHALL use USB iSerialNumber (`firmware_serial`) as the **primary stable-identity key** for GraviScan scanners across detection, save, validate, and disable-missing operations. `firmware_serial` is hardware-burned, survives port-swap, replug, USB-hub change, and OS reboot. Where `firmware_serial` is unavailable (some Epson V600 firmware revisions return `iSerial 0`), the system SHALL gracefully degrade to the existing `usb_port`-primary matching while making the ambiguity visible to the operator.

This requirement extends — but does not contradict — the canonical scanner-identity invariants in `GraviScan Scanner Configuration Page` (introduced by `add-graviscan-renderer-pages`, modified by `surface-disabled-scanners-on-detect`, `fix-scanner-config-save-flow`, and `fix-renderer-empty-scanner-id-collision`). The renderer-wide assignment lookup invariant (match by `usb_port` with composite fallback, never by `scanner_id` / `scannerId`) carries through unchanged.

**Identity priority across the stack** (consistent across `matchDetectedToDb`, `saveScannersToDB`, `validateConfig`, and `disableMissingScanners`):

1. **`firmware_serial`** — when both detected and saved are non-null. Hardware-rooted; survives port-swap.
2. **`usb_port`** — fallback when serial is null on either side. Stable across replug to the SAME port.
3. **Composite tuple** `(vendor_id, product_id, name, usb_bus, usb_device)` — last-resort fallback for empty-port platforms.

**Self-healing backfill.** When a saved row's `firmware_serial` is null and the live detected scanner's serial is non-null, the system SHALL opportunistically write the serial onto the saved row AND insert a `GraviScannerBinding` audit row with `reason: 'auto:initial-bind'`.

**Never-overwrite invariant.** The system SHALL NEVER silently overwrite a non-null `firmware_serial` on a saved row. This invariant has **exactly one exception**: the operator's explicit confirmation via the replacement modal (`reason: 'manual:rma-replacement'`), which DOES rewrite the existing row's `firmware_serial`. The audit row for that replacement SHALL preserve the previous serial in its `previous_firmware_serial` column so the binding history is recoverable.

The invariant SHALL be enforced at TWO layers: (a) a code-layer guard inside the matching code path, and (b) a Prisma middleware that intercepts UPDATE operations on `firmware_serial` and rejects writes whose target row has a non-null existing value, unless the call passes an explicit `_allow_overwrite_firmware_serial: true` flag (used only by the replacement-modal handler).

**Auto-rebind on port-swap.** When detection finds a saved row whose `firmware_serial` matches a detected scanner BUT the saved `usb_port` differs from the detected `usb_port`, the system SHALL:

1. Update the saved row's `usb_port` to the new value.
2. Insert a `GraviScannerBinding` audit row with `reason: 'auto:port-swap-detected'`, including both the old and new `usb_port` so the history is reconstructable.
3. Return the bind event in the IPC envelope under `autoRebinds: AutoRebindEvent[]` so the renderer can surface a non-blocking toast.

**Replacement detection.** When detection finds a different `firmware_serial` at a saved `usb_port` (BOTH non-null and DIFFERENT), the system SHALL NOT silently update the saved row. Instead it SHALL return a `replacementCandidates: ReplacementCandidate[]` entry in the IPC envelope. The renderer SHALL surface a blocking modal asking the operator to choose: "Replacement (preserves history)" or "New scanner (new identity)". The chosen path SHALL be confirmed via a new IPC `gravi.confirmReplacement(candidates, choices)` that writes the appropriate `GraviScannerBinding` row.

**Auto-save block during mismatch.** The 500ms-debounced auto-save effect in `useScannerConfig.ts` SHALL early-return when `configStatus === 'mismatch'`. Auto-save during a mismatch was the silent-overwrite mechanism that caused mis-attribution before this proposal.

**Disconnected ghost rows.** A previously-saved scanner that is currently unplugged SHALL appear as a greyed-out ghost row in the detected-scanners list with the subtitle "Disconnected since `<last-seen>`". The operator SHALL have a "Remove permanently" button that writes `enabled: false` and hides the row.

#### Scenario: firmware_serial is the primary stable-identity key

- **GIVEN** two saved `GraviScanner` rows with distinct `firmware_serial: 'ABC123'` (display_name "Bench-3", usb_port `'1-1'`) and `firmware_serial: 'XYZ789'` (display_name "Bench-4", usb_port `'1-2'`)
- **AND** the operator physically swaps the two USB cables (Scanner-A moves to `'1-2'`, Scanner-B to `'1-1'`)
- **WHEN** detection runs and `matchDetectedToDb` resolves each detected scanner against the DB
- **THEN** the detected scanner with `firmware_serial: 'ABC123'` SHALL match the saved row whose `firmware_serial` is `'ABC123'` (regardless of `usb_port` mismatch)
- **AND** the saved row's `usb_port` SHALL be updated from `'1-1'` to `'1-2'`
- **AND** a `GraviScannerBinding` row SHALL be inserted with `reason: 'auto:port-swap-detected'`, `firmware_serial: 'ABC123'`, `usb_port: '1-2'`, `previous_usb_port: '1-1'`
- **AND** `display_name: "Bench-3"` SHALL follow the device, NOT the port

#### Scenario: Match-priority field is exposed for renderer display

- **WHEN** `matchDetectedToDb`, `saveScannersToDB`, or `validateConfig` resolves a saved row against a detected scanner
- **THEN** the result SHALL include a `bound: 'serial' | 'usb_port' | 'composite' | 'none'` field
- **AND** `bound: 'serial'` SHALL be set when the match was made by `firmware_serial`
- **AND** `bound: 'usb_port'` SHALL be set when the match was made by `usb_port` (serial unavailable on one or both sides)
- **AND** `bound: 'composite'` SHALL be set when the match was made by the composite tuple fallback
- **AND** `bound: 'none'` SHALL be set when no match was made (a new scanner)
- **AND** the IPC contract SHALL expose `bound: ...` so a future renderer (rendering of the confidence badge is deferred to proposal `surface-scanner-identity-on-metadata-page`) can render a badge per scanner row. This proposal lands the IPC field; the badge UI lands in Proposal 3.

#### Scenario: Self-healing backfill writes serial onto pre-existing rows

- **GIVEN** a saved `GraviScanner` row with `firmware_serial: null` (created before this proposal landed) and `usb_port: '1-1'`
- **AND** detection now exposes `firmware_serial: 'ABC123'` for the scanner at `'1-1'`
- **WHEN** `saveScannersToDB` (or `validateConfig`) matches by `usb_port`
- **THEN** the saved row's `firmware_serial` SHALL be updated to `'ABC123'`
- **AND** a `GraviScannerBinding` row SHALL be inserted with `reason: 'auto:initial-bind'`
- **AND** subsequent matches for this scanner SHALL prefer the serial path

#### Scenario: Backfill never overwrites a non-null serial (code-layer guard)

- **GIVEN** a saved `GraviScanner` row with `firmware_serial: 'ABC123'`
- **AND** detection somehow returns a different `firmware_serial: 'XYZ789'` for the device at the same `usb_port`
- **WHEN** the matching code's backfill predicate runs
- **THEN** the saved row's `firmware_serial` SHALL NOT be overwritten by the backfill path
- **AND** the system SHALL return a `replacementCandidate` for operator confirmation

#### Scenario: Backfill never overwrites a non-null serial (Prisma middleware enforcement)

- **GIVEN** any code path attempts `prisma.graviScanner.update({ where: { id }, data: { firmware_serial: 'NEW' } })`
- **AND** the existing row's `firmware_serial` is non-null
- **WHEN** Prisma processes the update
- **THEN** the middleware SHALL reject the operation with a runtime error UNLESS the call also passes `_allow_overwrite_firmware_serial: true`
- **AND** the only call site that SHALL pass this flag is the replacement-modal handler (after operator confirmation)
- **AND** a unit test SHALL exercise a direct-update path (e.g., a hypothetical maintenance script) and assert the middleware rejects it

#### Scenario: Replacement detection requires explicit operator confirmation

- **GIVEN** a saved row at `usb_port: '1-1'` with `firmware_serial: 'ABC123'`
- **AND** a different physical scanner (with `firmware_serial: 'XYZ789'`) is plugged into `'1-1'` (e.g., RMA replacement, or accidental swap with a same-model unit)
- **WHEN** detection runs
- **THEN** the system SHALL NOT silently update the saved row
- **AND** the system SHALL return `replacementCandidates: [{ saved_scanner_id, saved_serial: 'ABC123', detected_serial: 'XYZ789', usb_port: '1-1' }]` in the IPC envelope
- **AND** the renderer SHALL surface a blocking modal asking the operator to choose: "Replacement (preserves history)" or "New scanner (new identity)"
- **AND** on "Replacement", the system SHALL update the existing row's `firmware_serial` (the only allowed exception to the never-overwrite invariant) AND write a `GraviScannerBinding` row with `reason: 'manual:rma-replacement'`, `firmware_serial: 'XYZ789'` (the new serial), and `previous_firmware_serial: 'ABC123'` (the old serial)
- **AND** on "New scanner", the system SHALL set the existing row's `enabled: false` AND create a new GraviScanner row with the new serial, AND write a `GraviScannerBinding` row with `reason: 'manual:user-confirmed'`

#### Scenario: Non-Linux platforms skip USB-serial extraction entirely

- **GIVEN** the app is running on `process.platform !== 'linux'` (macOS for development, or Windows where GraviScan scanner-detection is not yet implemented — see issue #219)
- **WHEN** the detection orchestrator runs in real (non-mock) mode
- **THEN** the orchestrator SHALL skip the `lsusb -v` invocation entirely (no `execFileSync('lsusb', ...)` call)
- **AND** every detected scanner's `firmware_serial` field SHALL be `null`
- **AND** matching SHALL fall back to `usb_port` priority (the existing pre-Proposal-2 behavior)
- **AND** in mock mode (`GRAVISCAN_MOCK=true`) on any platform, `buildMockScanners` SHALL fabricate deterministic mock serials (e.g., `MOCK-SERIAL-${i}`) so unit tests for the new matching logic have something distinguishable to assert against
- **AND** an operator on a non-Linux platform using identical-model scanners SHALL still benefit from `usb_port`-based identity, but port-swap auto-rebind is unavailable — the same hard mismatch banner as the V600-iSerial-0 case SHALL apply
- **AND** Windows GraviScan scanner-detection is out-of-scope for this proposal entirely (the existing codebase has no Windows scanner-detection or scanning path despite the cosmetic `'twain'` backend label); when Windows GraviScan support is added in a future proposal, issue #219 tracks the Windows-side firmware_serial extraction (`Get-PnpDevice`) as a follow-up

#### Scenario: Graceful degradation when firmware_serial is unavailable

- **GIVEN** an Epson V600 scanner whose firmware returns `iSerial 0` (some firmware revisions do)
- **WHEN** detection runs
- **THEN** `DetectedScanner.firmware_serial` SHALL be `null` (NOT the literal string `"0"` or empty)
- **AND** matching SHALL fall back to `usb_port` priority (the existing pre-Proposal-2 behavior)
- **AND** if the operator port-swaps two such scanners, the system SHALL detect the mismatch (saved row at `'1-1'` no longer matches the detected scanner now at `'1-1'` by composite tuple) and show a hard mismatch banner
- **AND** the auto-save SHALL be blocked while `configStatus === 'mismatch'`
- **AND** the operator SHALL explicitly confirm the new bindings via the Save button before any DB write

#### Scenario: lsusb -v iSerial extraction handles all observed Linux output forms

- **GIVEN** Linux `lsusb -v` output for an Epson V850 with a populated firmware serial (line of the form `iSerial 3 ABC123XYZ`)
- **WHEN** the parser extracts `firmware_serial`
- **THEN** the resulting `DetectedScanner.firmware_serial` SHALL be `'ABC123XYZ'`
- **GIVEN** Linux `lsusb -v` output for an Epson V600 with `iSerial 0` (firmware revision that does not populate a serial)
- **WHEN** the parser extracts `firmware_serial`
- **THEN** `firmware_serial` SHALL be `null` (NOT the literal string `"0"`)
- **GIVEN** Linux `lsusb -v` output emitted by a non-root process where the descriptor is truncated (`iSerial 3 ` with trailing whitespace only)
- **WHEN** the parser extracts `firmware_serial`
- **THEN** the regex's `\S+` capture group SHALL not match (no non-whitespace characters after the descriptor index)
- **AND** `firmware_serial` SHALL be `null`
- **AND** the parser SHALL NOT crash or hang on the truncated form

#### Scenario: Disconnected ghost rows surface temporarily-unplugged scanners

- **GIVEN** a saved `GraviScanner` row for a scanner that is currently unplugged
- **WHEN** the user navigates to the Scanner Configuration page
- **THEN** `validateConfig.missing` SHALL include this row
- **AND** the page SHALL render the missing scanner as a greyed-out ghost row in the detected-scanners list with the subtitle "Disconnected since `<last-seen>`"
- **AND** the operator SHALL have a "Remove permanently" button to opt-out (writes `enabled: false` and hides the row)
- **AND** when the scanner is plugged back in, the next detection SHALL match it by `firmware_serial` (or fallback) and the ghost row SHALL transition back to a live row with the previous bindings preserved

### Requirement: GraviScannerBinding Audit Table

The system SHALL maintain a `GraviScannerBinding` table that captures every (re)bind event for every `GraviScanner` row. The table SHALL be **append-only** (the application layer SHALL NOT support UPDATE on existing rows) so that the binding history is reconstructable for scientific audits.

**Schema:**

```prisma
model GraviScannerBinding {
  id                       String   @id @default(uuid())
  scanner_id               String
  firmware_serial          String?
  previous_firmware_serial String?  // populated only on `manual:rma-replacement` rows
  usb_port                 String?
  previous_usb_port        String?  // populated on `auto:port-swap-detected` rows
  bound_at                 DateTime @default(now())
  bound_by                 String?  // phenotyper_id when known; "system" for auto events
  reason                   String   // enum: see allowed values below
  notes                    String?  // free-form, used by manual:user-confirmed mid-session edits
  scanner                  GraviScanner @relation(fields: [scanner_id], references: [id], onDelete: NoAction)
  @@index([scanner_id])
  @@index([firmware_serial])
}
```

**FK behavior — NO cascade-on-delete.** The audit-table is append-only and survives the deletion of its parent. `onDelete: NoAction` (or `Restrict`) ensures binding history is preserved even if a `GraviScanner` row is later removed via direct DB cleanup. Deleting a parent with bindings SHALL fail with a referential-integrity error; lab managers who really want to clean up SHALL use the `enabled: false` soft-delete path instead.

**Allowed `reason` values** (validated at the application layer; rejecting any other value with a runtime error):

- `'auto:initial-bind'` — first time we observed a serial for this row (backfill).
- `'auto:firmware-serial-match'` — match was made by serial; no rebind needed (used as a marker on first save when we want to record the match basis).
- `'auto:port-swap-detected'` — serial matched a saved row at a different `usb_port`. Both `usb_port` and `previous_usb_port` populated.
- `'manual:user-confirmed'` — operator explicitly confirmed via UI (e.g., mid-session metadata edit, soft-gate naming, "New scanner" branch of replacement modal).
- `'manual:rma-replacement'` — operator chose "Replacement" in the replacement modal. Both `firmware_serial` and `previous_firmware_serial` populated.

#### Scenario: Audit table is append-only at the application layer

- **GIVEN** a `GraviScannerBinding` row exists for a previous bind event
- **WHEN** any handler attempts to UPDATE that row via Prisma
- **THEN** the operation SHALL be rejected at the application layer (no UPDATE codepath in `binding-handlers.ts`)
- **AND** a Prisma middleware SHALL intercept any `update` operation on `GraviScannerBinding` and reject it with a runtime error
- **AND** the table SHALL only support INSERT (and DELETE only via the explicit `bloom audit prune` admin path, NOT cascade)

#### Scenario: GraviScanner deletion does not cascade-delete bindings

- **GIVEN** a `GraviScanner` row with multiple `GraviScannerBinding` rows referencing it
- **WHEN** any code path attempts `prisma.graviScanner.delete({ where: { id } })`
- **THEN** the operation SHALL fail with a referential-integrity error (FK is `onDelete: NoAction`)
- **AND** the binding rows SHALL remain in the audit table
- **AND** lab managers MAY use the `enabled: false` soft-delete to "remove" a scanner from active use without losing audit history

#### Scenario: Audit row preserves previous serial on RMA replacement

- **GIVEN** a saved row with `firmware_serial: 'ABC123'`
- **AND** an RMA replacement scanner is plugged in with `firmware_serial: 'XYZ789'` at the same `usb_port`
- **AND** the operator chooses "Replacement (preserves history)" in the replacement modal
- **WHEN** the system writes the audit row
- **THEN** the `GraviScannerBinding` row SHALL include `firmware_serial: 'XYZ789'` (new serial)
- **AND** SHALL include `previous_firmware_serial: 'ABC123'` (old serial)
- **AND** SHALL include `reason: 'manual:rma-replacement'`
- **AND** SHALL include `bound_by` populated from the IPC payload — when Proposal 3 lands, the renderer SHALL pass the currently-selected phenotyper_id; this proposal's `confirmReplacement` IPC accepts `bound_by` as a parameter (default `'system'` when caller omits it). Until Proposal 3's UI wiring lands, calls SHALL pass `'system:replacement-pending'` so the field is non-null and traceable to the pre-UI period.
- **AND** a SQL query for binding history of this `scanner_id` SHALL show the full progression from `'ABC123'` → `'XYZ789'`

#### Scenario: Reason field is validated against the enum

- **GIVEN** a code path attempts to insert a `GraviScannerBinding` row
- **WHEN** the `reason` value is not one of the allowed enum strings
- **THEN** the application-layer `writeBinding` helper SHALL reject the call with a runtime validation error
- **AND** the row SHALL NOT be persisted to the database

### Requirement: GraviScan Scan Metadata JSON Self-Describing Identity

The GraviScan per-image `<image_basename>.metadata.json` file (defined by `add-graviscan-renderer-pages`'s `GraviScan Metadata JSON Writer` requirement) SHALL be extended with optional self-describing identity fields so that a researcher with no DB access can recover physical-device provenance from the file alone.

**Newly-added optional fields on `GraviScanMetadataJson`:**

- **`scanner_firmware_serial?: string`** — the USB iSerialNumber of the physical scanner that captured this image, when the hardware exposes one. Survives DB loss, identifies the device across port-swaps, and is the recommended identity field for cross-experiment audits. Omitted (NOT empty string) when null.
- **`scanner_usb_port_at_capture?: string`** — the `usb_port` value as known to the system at scan time. Useful for reconstructing the physical topology of a session even after later port-swaps. Omitted when null.

These fields SHALL be sourced from the per-cycle `sessionContext.scannerSerials` and `sessionContext.scannerUsbPorts` maps, which SHALL be refreshed per cycle (re-querying the DB) — extending the per-cycle `scannerNames` refresh introduced in `fix-renderer-empty-scanner-id-collision`.

**`metadata_version` SHALL remain `1`.** The new fields are optional and additive; consumers MUST tolerate their absence. A future breaking schema change would warrant `metadata_version: 2`.

**TIFF tag 270 (ImageDescription) SHALL also embed `firmware_serial`, `usb_port`, and `display_name`** alongside the existing `scanner_id` field already written by `python/graviscan/scan_worker.py:_build_tiff_metadata`. New CLI flags (`--firmware-serial`, `--usb-port`, `--display-name`) SHALL be plumbed from `src/main/graviscan/scanner-subprocess.ts` to the Python subprocess. Each flag SHALL be OMITTED (not passed as empty string) when its value is null in the saved DB row.

This requirement does NOT alter the canonical `Scan Metadata JSON File` requirement (which is CylScan-specific) or the existing `GraviScan Metadata JSON Writer` requirement's atomic-write, error-handling, and directory-creation invariants.

#### Scenario: metadata.json carries firmware serial when known

- **GIVEN** a `GraviScanner` row with `firmware_serial: 'ABC123'`, `usb_port: '1-2'`, `display_name: "Bench-3"`
- **WHEN** a scan completes and the per-image metadata.json is written
- **THEN** the JSON SHALL include `"scanner_firmware_serial": "ABC123"`
- **AND** the JSON SHALL include `"scanner_usb_port_at_capture": "1-2"`
- **AND** the JSON SHALL include the existing `"scanner_name": "Bench-3"` field (unchanged)
- **AND** the `metadata_version` SHALL remain `1`

#### Scenario: metadata.json omits firmware serial when null (does not emit empty string)

- **GIVEN** a `GraviScanner` row with `firmware_serial: null` (e.g., V600 with `iSerial 0`)
- **WHEN** metadata.json is written
- **THEN** the JSON SHALL NOT include a `"scanner_firmware_serial"` key
- **AND** the JSON SHALL NOT include the empty-string value `""` for that field
- **AND** consumers SHALL treat the absence of the key as "serial unavailable", NOT as "empty serial"

#### Scenario: TIFF tag 270 self-describes the physical scanner

- **GIVEN** a scan via `_sane_scan` or `_mock_scan` in `python/graviscan/scan_worker.py`
- **AND** the subprocess was invoked with `--firmware-serial ABC123 --usb-port 1-2 --display-name "Bench-3"`
- **WHEN** the TIFF is written
- **THEN** TIFF tag 270 (ImageDescription) SHALL contain a JSON payload with `"firmware_serial": "ABC123"`, `"usb_port": "1-2"`, `"display_name": "Bench-3"`, alongside the existing `"scanner_id"`, `"grid_mode"`, `"plate_index"`, `"resolution_dpi"`, `"scan_region_mm"`, `"capture_timestamp"`, `"bloom_version"` fields
- **AND** when the subprocess is invoked WITHOUT the new flags, the TIFF tag 270 SHALL omit those fields entirely (no empty-string keys)

#### Scenario: scanner_firmware_serial is refreshed per cycle for long interval scans

- **GIVEN** a continuous-mode scan session has started with N=12 cycles, 5-minute interval
- **AND** between cycle 3 and cycle 4, a `GraviScanner` row's `firmware_serial`, `usb_port`, OR `display_name` is updated in the DB (e.g., a port-swap auto-rebind triggered between cycles via the auto-rebind path in this proposal, OR — once Proposal 3 lands — via the operator's display_name editor)
- **WHEN** cycle 4's `scanOnce` writes metadata.json
- **THEN** the per-cycle Prisma query (introduced by `fix-renderer-empty-scanner-id-collision` task 2.20c, extended here) SHALL rebuild `sessionContext.scannerSerials`, `sessionContext.scannerUsbPorts`, AND `sessionContext.scannerNames` from the same `findMany` rows
- **AND** cycle 4's metadata.json SHALL reflect the post-update values for all three fields
- **AND** cycles 1-3 SHALL retain the original values in their already-written metadata.json files (per-cycle freshness, not retroactive rewrite)
- **AND** the auto-rebind path SHALL ALWAYS write a `GraviScannerBinding` row (`reason: 'auto:port-swap-detected'` or `'auto:initial-bind'`); the manual-rename path SHALL write `reason: 'manual:user-confirmed'` (when Proposal 3's editor exists) so reviewers can reconstruct when cycle N's identity became cycle N+1's identity
- **AND** simulating this scenario in a test does NOT require Proposal 3's editor — a direct `prisma.graviScanner.update(...)` between cycle 3 and cycle 4 (in test setup) achieves the same DB state and the per-cycle refresh path SHALL pick it up
