# add-scanner-firmware-serial-identity

## Why

Today the canonical scanner-identity key in GraviScan is `usb_port`. This is stable across replug to the same port (#182's fix) but **silently scrambles bindings when scanners are physically swapped between ports** — `display_name` follows `usb_port`, not the device, so a wave's metadata.json carries the wrong `scanner_name` next to images from a physically different scanner. The previous proposal (`fix-renderer-empty-scanner-id-collision`) explicitly accepts this in Non-Goals: "two scanners that swap ports will have their `display_name` overrides scrambled". Issue #203 also names this and sketches "hashing firmware serial + vendor ID" as a future fix.

This proposal implements that future fix. We add **USB iSerialNumber** as the primary identity, with `usb_port` and the existing composite tuple as ordered fallbacks. Identity then survives port-swap, replug, USB-hub change, and OS reboot. The scientific guarantee — "the `scanner_name` in metadata.json names the physical device that produced the image" — becomes enforceable.

This proposal stacks on `fix-renderer-empty-scanner-id-collision` (the renderer fix must land first to stop the immediate corruption; this proposal extends the identity model afterward).

## Related Issues

- `Closes: #203` — pins firmware serial + vendor ID as the cross-port stable identity. This proposal implements that exact sketch.
- `Related: #182` — origin of the `usb_port`-as-canonical-key effort. Firmware serial supersedes `usb_port` as primary while preserving `usb_port` as fallback.
- `Related: #167` — `@@unique` on scanner identity. Adds `@@unique([firmware_serial])` (nullable-permitting on SQLite).
- `Related: #217` — mid-session replug detection (deferred follow-up; depends on this proposal's serial work).

## Data Integrity Impact

**Pre-fix behavior:** A port-swap between two saved scanners silently rebinds `display_name` to the wrong physical device. Wave N's metadata.json says `scanner_name: "Bench-3"` next to images from what was physically Scanner-B before the swap. **No audit-trail evidence of the swap exists.**

**Post-fix behavior:** Detection extracts `firmware_serial` via `lsusb -v` (Linux) or `Get-PnpDevice` (Windows). Matching priority is **firmware_serial → usb_port → composite**. A port-swap is detected as "saved scanner with serial ABC123 is now at a different port"; the renderer auto-rebinds, writes a `GraviScannerBinding` audit row, and shows a non-blocking toast. `display_name` follows the device, not the port. metadata.json carries `scanner_firmware_serial` as a self-describing identity field.

**Hardware caveat:** Some Epson Perfection firmware revisions return `iSerial 0` (V600 in particular). The system MUST gracefully degrade to `usb_port`-primary matching when serial is unavailable, AND MUST surface a hard mismatch banner (blocking scan-start) when the operator swaps ports without distinguishable serials. Lab managers SHOULD verify their hardware exposes serials before relying on auto-rebind; the system surfaces this at first detection.

**Self-describing TIFFs:** TIFF tag 270 today carries the renderer-supplied `scanner_id` (DB UUID) — but that UUID is meaningless if the GraviScanner table is dropped or rebuilt. This proposal embeds `firmware_serial`, `usb_port`, and `display_name` alongside it, so a researcher in 2027 with no DB access can recover physical-device identity from the file alone.

**Migration path:** Self-healing backfill — opportunistically write `firmware_serial` onto saved rows when the live scanner exposes it. Pre-existing rows without serials match by `usb_port` indefinitely until the scanner is plugged in and the serial is read. **No data migration required.** A pre-existing row's `firmware_serial` is **never overwritten** — replacement scenarios (RMA, swap-with-identical) require explicit user confirmation.

**Tamper-evidence and audit:** `GraviScannerBinding` is an append-only event log of every (re)bind: `(scanner_id, firmware_serial, usb_port, bound_at, bound_by, reason)`. Reasons enum: `auto:port-swap-detected`, `auto:firmware-serial-match`, `manual:user-confirmed`, `manual:rma-replacement`, `auto:initial-bind`. Reviewers can SQL-query "show me every scanner binding for experiment X" and reconstruct which physical device produced each cycle's images.

## What Changes

**Schema (Prisma migration):**

- Add `firmware_serial: String?` column to `GraviScanner` with `@@unique([firmware_serial])` (SQLite allows multiple `NULL` values; the constraint catches "identical scanner saved twice" with a populated serial).
- Add `GraviScannerBinding` table: `id, scanner_id, firmware_serial?, usb_port?, bound_at, bound_by?, reason`. Indexed on `scanner_id` and `firmware_serial`. FK `scanner_id → GraviScanner.id` (cascade-on-delete is intentional — bindings die with their scanner).

**Detection (Linux-only — see Non-Goals):**

- Extend `src/main/lsusb-detection.ts` to parse `iSerial` from a single-pass `lsusb -v` invocation. Treat `"0"` and empty strings as `null`.
- Populates `DetectedScanner.firmware_serial: string | null` (new optional field on the type; `null` on platforms that don't expose it).
- Windows scanner detection — including any TWAIN-side firmware-serial extraction — is **out of scope for this proposal** (tracked separately as issue #219). The current codebase has no Windows GraviScan scanner-detection or scanning path despite the cosmetic `'twain'` backend label in the platform-info handler; layering `firmware_serial` onto a non-existent Windows code path would solve a problem in advance of the actual Windows GraviScan enablement work.

**Matching priority across the stack:**

- `matchDetectedToDb` (Proposal 1's fix lands first): try `firmware_serial` → `usb_port` → composite.
- `saveScannersToDB`: same priority. New "found existing row by serial but at different usb_port" path → write `GraviScannerBinding` audit row with `reason: 'auto:port-swap-detected'`.
- `validateConfig`: same priority; surface a `bound: 'serial' | 'usb_port' | 'composite' | 'none'` field per match so the renderer can render a confidence badge.

**Self-healing backfill:**

- On every match, if `existing.firmware_serial === null && detected.firmware_serial !== null`, write the serial onto the existing row. Add a `GraviScannerBinding` row with `reason: 'auto:initial-bind'`.
- **Never overwrite a non-null serial.** Replacement (different serial at same port, both non-null) → return a result that requires explicit operator confirmation via the UI before any DB write.

**Auto-rebind UX (depends on Proposal 3 for the toast component, but the IPC contract lands here):**

- New IPC return shape: `{ success, scanners, count, autoRebinds: Array<{ scanner_id, old_usb_port, new_usb_port, firmware_serial }>, replacementCandidates: Array<{ saved_scanner_id, saved_serial, detected_serial, usb_port }> }`. Renderer consumes `autoRebinds` to render a non-blocking toast and `replacementCandidates` to render a blocking modal.

**Auto-save block during mismatch:**

- Today the 500ms auto-save effect in `useScannerConfig.ts:554-652` fires DURING the `mismatch` banner display, silently overwriting bindings before the operator can read the warning. Add an early-return: `if (configStatus === 'mismatch') return`. This is a Proposal 2 concern (not Proposal 1) because the mismatch detection becomes meaningful only after firmware_serial is added.

**TIFF tag 270 enrichment (`python/graviscan/scan_worker.py`):**

- Extend `_build_tiff_metadata` to include `firmware_serial`, `usb_port`, and `display_name` alongside the existing `scanner_id`. New CLI flags (`--firmware-serial`, `--usb-port`, `--display-name`) plumbed from `src/main/graviscan/scanner-subprocess.ts`. Treat null/empty as omitted (don't write empty strings into the JSON).

**metadata.json enrichment (`src/types/graviscan.ts` + `src/main/graviscan/scan-metadata-json.ts`):**

- Add `scanner_firmware_serial?: string` and `scanner_usb_port_at_capture?: string` to `GraviScanMetadataJson`.
- The writer reads these from `sessionContext.scannerSerials` and `sessionContext.scannerUsbPorts` (new maps populated by `session-handlers.ts`).

**Disconnected ghost rows (Scanner Config UI):**

- Render `validateConfig.missing` as greyed-out rows in the detected list with "Disconnected since `<last-seen>`". Operators can click "Remove permanently" or leave the row to await reconnect. Closes the long-standing UX gap where temporarily-unplugged scanners simply vanished from the page.

**`bloom audit` CLI — split out, NOT in this proposal.**

- Originally drafted as an optional 150-LOC Node CLI here; on review, this is a separate user-facing feature with its own UX/help/error-handling/test surface. It belongs in its own change proposal (`add-bloom-audit-cli`) that depends on this proposal landing first. Removed from this proposal's scope.

## Impact

**Affected specs:**

- `scanning` — **ADDED** three new requirements: `GraviScan Scanner Firmware Serial Identity`, `GraviScannerBinding Audit Table`, and `GraviScan Scan Metadata JSON Self-Describing Identity`. Structured as ADDED (not MODIFIED) to avoid the verbatim-carry-forward burden on the large pre-existing `GraviScan Scanner Configuration Page` requirement and to keep the firmware-serial invariants as cohesive standalone units. The new requirements explicitly note their interaction with existing requirements (renderer-wide lookup invariant continues to apply; canonical CylScan-side `Scan Metadata JSON File` requirement is untouched).

**Affected code:**

- `prisma/schema.prisma` — add `firmware_serial` column to GraviScanner, `@@unique([firmware_serial])`, new `GraviScannerBinding` table with `onDelete: NoAction` (NOT cascade — audit log survives parent deletion), `previous_firmware_serial` and `previous_usb_port` columns on the audit table.
- `src/main/lsusb-detection.ts` — `lsusb -v` parsing; `firmware_serial` field on the typed shape; export `KNOWN_EPSON_SCANNERS` constant (single source of truth for Epson PIDs).
- `src/main/graviscan/binding-handlers.ts` (new) — `writeBinding` helper; the only code path that writes to `GraviScannerBinding`. Validates `reason` against the enum.
- `src/main/database.ts` — Prisma client extension(s) enforcing the never-overwrite-non-null-serial invariant AND the audit-log-is-append-only invariant. The file has TWO independent init codepaths (`initializeDatabase` sync at lines 38-130, `initializeDatabaseAsync` at lines 233-406); the extension MUST be installed in BOTH (or extracted to a shared helper invoked from both). This proposal SHALL use Prisma's `$extends({ query: ... })` API (current and forward-compatible) — NOT the deprecated `$use` middleware (removed in Prisma v6).
- `src/types/graviscan.ts` — `DetectedScanner.firmware_serial`, `GraviScanner.firmware_serial`, `GraviScanMetadataJson.scanner_firmware_serial` and `scanner_usb_port_at_capture`.
- `src/main/graviscan/scanner-handlers.ts` — `matchDetectedToDb` AND `saveScannersToDB` AND `validateConfig` AND `disableMissingScanners` all updated to the three-tier matching priority; auto-rebind audit-row writer; replacement-detection helper; new `gravi.__test__swapMockPorts` test-only IPC for the E2E port-swap test.
- `src/main/graviscan/scanner-subprocess.ts` — pass `--firmware-serial`, `--usb-port`, `--display-name` to Python.
- `src/main/graviscan/session-handlers.ts` — populate `sessionContext.scannerSerials` and `sessionContext.scannerUsbPorts` at scan-start; new `gravi.confirmReplacement` IPC handler.
- `src/main/graviscan/scan-coordinator.ts` — read serial/port maps in `scanOnce`'s metadata.json write; per-cycle re-query (extends the `scannerNames` per-cycle refresh from Proposal 1).
- `src/main/graviscan/scan-metadata-json.ts` — emit the new fields.
- `python/graviscan/scan_worker.py` — `_build_tiff_metadata` accepts and emits the new fields.
- `src/renderer/hooks/useScannerConfig.ts` — auto-save block during mismatch; `autoRebinds` toast handling; `replacementCandidates` modal trigger; disconnected ghost rows.
- `src/renderer/graviscan/ScannerConfig.tsx` — render disconnected rows; render auto-rebind toast; render replacement modal.

**Affected tests:**

- `tests/unit/lsusb-detection.test.ts` — add `lsusb -v` parsing fixtures (V850 with serial, V600 with `iSerial 0`).
- `tests/unit/windows-pnp-detection.test.ts` (new) — add Windows fixtures.
- `tests/unit/main/graviscan/scanner-handlers.test.ts` — extend with three-tier priority cases; auto-rebind audit-row assertions; replacement-detection assertions; "never overwrite non-null serial" guard.
- `tests/unit/scan-metadata-json.test.ts` — verify new fields are emitted.
- `tests/unit/scanner-subprocess.test.ts` — verify `--firmware-serial` is passed when populated, omitted when null.
- `tests/unit/python/test_scan_worker.py` (or pytest equivalent) — verify TIFF tag 270 includes the new fields.
- `tests/integration/scanner-handlers-integration.test.ts` — end-to-end: detect → match by serial → rebind on port-swap → audit row written.
- `tests/e2e/graviscan-port-swap.e2e.ts` (new) — simulate port-swap via mock scanner reordering, assert auto-rebind toast appears, assert metadata.json carries correct `scanner_firmware_serial`.

**Affected guardrails:**

- This PR touches `src/renderer/`, so the parent (not a subagent) MUST `Read` at minimum 3 PNGs from `tests/e2e/screenshots/` after `npm run test:e2e:smoke`.

## Non-Goals

- **No mid-session replug detection.** Tracked separately as #217. This proposal only handles between-session port changes; mid-session topology changes are out-of-scope.
- **No cryptographic signing or hashing of metadata.json.** Tamper-evidence at the operational threat-model this lab faces is not justified by the cost. (SHA-256 of the paired TIFF is a possible follow-up if labs request it.)
- **No retroactive remediation of pre-fix `Scan` rows or metadata.json files.** Per Proposal 1's Non-Goals, those stay corrupt — manual lab-notebook annotation is the documented remediation. Going forward, every scan carries `scanner_firmware_serial` so the integrity story is intact.
- **No automatic display_name editing UI on this proposal.** That ships in Proposal 3 (`surface-scanner-identity-on-metadata-page`) — the IPC contracts and audit-table support land here so Proposal 3 can build on them.
- **No mock-mode firmware_serial fabrication beyond a deterministic `MOCK-SERIAL-${i}` stub.** Mock mode exists for test-only paths; the stub keeps unit tests stable without inventing realistic-looking strings that could be confused with real hardware.
- **No support for non-Epson scanners' identity formats.** SANE backends other than `epkowa` may expose serials differently; if a non-Epson scanner is added later, the detection module needs extending. Scope here is V600/V850.
- **No Windows scanner-detection or firmware_serial work** (tracked as issue #219). The current codebase reports `backend: 'twain'` cosmetically for `process.platform === 'win32'` but has no actual Windows scanner-detection or scanning code path: `lsusb-detection.ts` calls `lsusb` unconditionally (fails with `ENOENT` on Windows), `python/graviscan/scan_worker.py` uses `python-sane` directly with `epkowa:interpreter:bus:device` SANE-style names, and there is no TWAIN bridge in the Python or main process. GraviScan is **effectively Linux-only today**. Layering `firmware_serial` onto a non-existent Windows code path would solve a downstream problem before the upstream Windows GraviScan enablement work is done. When Windows GraviScan support lands (separate proposal), issue #219 tracks the firmware_serial extraction (`Get-PnpDevice` on Windows) as a follow-up that mirrors the Linux-side `lsusb -v` work.
- **No macOS scanner-detection or firmware_serial work.** macOS has neither `lsusb` nor `Get-PnpDevice` in the production tooling. Like Windows, macOS would need a separate proposal that establishes a SANE-or-equivalent scanning path before firmware_serial is meaningful. Mock mode on macOS continues to work (with synthetic mock serials) for development purposes.
