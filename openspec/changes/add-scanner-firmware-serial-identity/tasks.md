# Tasks — add-scanner-firmware-serial-identity

> **Discipline:** Strict TDD. Section 1 writes failing tests. Section 2 makes them pass. Section 3 verifies end-to-end.
>
> **Order-of-shipment:** This proposal lands AFTER `fix-renderer-empty-scanner-id-collision` is merged. Section 2's matching-priority changes assume Proposal 1's `matchDetectedToDb` inversion (task 2.20a) is already in place.

## 1. Tests (red phase)

### 1a. Detection unit tests

> **Test fixtures.** All `lsusb -v` output fixtures referenced below SHALL live at `tests/fixtures/lsusb/` (new directory). Filenames: `v600-with-serial.txt`, `v600-iserial-zero.txt`, `v850-with-serial.txt`, `v850-with-whitespace-serial.txt`, `non-root-truncated.txt`, `multi-device-verbose.txt`. Tests load these via `readFileSync` rather than embedding 200-line strings inline.

- [ ] 1.1 Extend `tests/unit/lsusb-detection.test.ts` with `lsusb -v` parsing cases:
  - V850 fixture (Epson 04b8:013a) with `iSerial 3 ABC123XYZ` → `firmware_serial: 'ABC123XYZ'`
  - V600 fixture (Epson 04b8:0144) with `iSerial 0` → `firmware_serial: null`
  - V850 fixture with `iSerial 3 ` (whitespace only) → `firmware_serial: null`
  - Multi-device verbose output with two V850s, distinct serials → both extracted, keyed by `bus:device`
  - Verbose output for a non-Epson device interleaved → not parsed (vid:pid filter holds)
- [ ] 1.2 _(REMOVED — Windows-side PnP detection is out of scope for this proposal. The current codebase has no Windows GraviScan scanner-detection code path; `lsusb-detection.ts` calls `lsusb` unconditionally and the Python worker uses `python-sane` directly with SANE-style device names. Tracked as issue #219 for after Windows GraviScan support lands as its own proposal.)_

### 1b. Schema + matching unit tests

- [ ] 1.3 Extend `tests/unit/main/graviscan/scanner-handlers.test.ts` with serial-priority cases:
  - **Match by serial when serial matches AND usb_port matches**: returns the saved row, no audit row written (no rebind needed).
  - **Match by serial when serial matches AND usb_port differs (the port-swap case)**: returns the saved row, writes a `GraviScannerBinding` row with `reason: 'auto:port-swap-detected'`, updates `usb_port` on the saved row.
  - **No match by serial; match by usb_port**: returns the saved row, opportunistically writes serial via backfill, writes a `GraviScannerBinding` row with `reason: 'auto:initial-bind'`.
  - **No match by serial; usb_port matches but a DIFFERENT serial is present (the replacement case)**: returns a `replacementCandidate`, does NOT silently update the row, requires explicit user confirmation.
  - **Both serial and usb_port unavailable; composite match**: returns the saved row via composite tuple.
  - **Detected scanner with `firmware_serial: null` matches a saved row with non-null serial only by composite/usb_port**: serial-null rows do not "claim" non-null saved rows.
  - **Two saved rows with the same `firmware_serial`** (data corruption guard): @@unique constraint MUST reject the second insert at DB level.
  - **Backfill never overwrites a non-null serial**: explicit guard.
- [ ] 1.4 Add audit-table unit tests:
  - `GraviScannerBinding` insert is append-only (Prisma middleware rejects `update` operations on the table).
  - The `writeBinding` helper validates `reason` against the enum: `auto:initial-bind`, `auto:firmware-serial-match`, `auto:port-swap-detected`, `manual:user-confirmed`, `manual:rma-replacement`. Any other value is rejected with a runtime error.
  - **Deletion of a parent GraviScanner with related binding rows SHALL FAIL** with a referential-integrity error (`onDelete: NoAction`). The audit log survives — a separate test asserts the bindings remain queryable after the parent's `enabled: false` soft-delete.
  - On `manual:rma-replacement`, both `firmware_serial` (new) and `previous_firmware_serial` (old) are populated in the binding row.
  - On `auto:port-swap-detected`, both `usb_port` (new) and `previous_usb_port` (old) are populated.
  - The Prisma middleware that intercepts direct UPDATE on `GraviScanner.firmware_serial` rejects writes when `existing.firmware_serial` is non-null AND the call did NOT pass `_allow_overwrite_firmware_serial: true`.
- [ ] 1.5 Extend `tests/unit/scan-metadata-json.test.ts`:
  - Verify `scanner_firmware_serial` is emitted when populated; OMITTED (not empty string) when null.
  - Verify `scanner_usb_port_at_capture` is emitted when populated.
  - **Positive assertion** that `metadata_version === 1` after writing with the new fields populated. (Round-3 review caught: the prior wording was a comment, not an assertion. This is now a concrete `expect(json.metadata_version).toBe(1)` that catches a future careless bump.)

### 1c. Subprocess + Python unit tests

- [ ] 1.6 Extend `tests/unit/scanner-subprocess.test.ts`:
  - Verify `--firmware-serial` is passed when the saved row has a non-null serial.
  - Verify the flag is OMITTED (not an empty string) when serial is null.
  - Same pattern for `--usb-port` and `--display-name`.
- [ ] 1.7 Extend `python/tests/test_scan_worker.py`:
  - With `--firmware-serial ABC123 --usb-port 1-1 --display-name "Bench-3"`, the resulting TIFF's tag 270 JSON contains all three fields.
  - With these flags omitted, the JSON contains only the existing fields; no empty-string entries leak.

### 1d. Renderer unit tests

- [ ] 1.8 Extend `tests/unit/hooks/useScannerConfig.test.ts`:
  - Auto-save effect is BLOCKED when `configStatus === 'mismatch'`. Setup: mock `validateConfig.mockResolvedValue({...status:'mismatch'...})`. Action: detect new state. Assertion: no `saveScannersToDB` call within 2 seconds.
  - When the IPC return shape includes `autoRebinds: [...]`, the renderer surfaces a non-blocking toast (verify a state-flag for the toast is set).
  - When the IPC return shape includes `replacementCandidates: [...]`, the renderer surfaces the modal (verify the modal-state flag is set).
  - Disconnected ghost rows: `validateConfig.missing` populates a renderer-side `disconnectedScanners` state used to render greyed rows.

### 1e. Integration + E2E

- [ ] 1.9 Add `tests/integration/scanner-handlers-integration.test.ts`:
  - End-to-end on a real (in-memory) Prisma DB: detect 2 scanners with serials → save → re-detect with ports swapped → assert both rows updated, 2 `GraviScannerBinding` rows written with `reason: 'auto:port-swap-detected'`.
  - End-to-end replacement: detect 1 scanner, save → detect a different serial at the same usb_port → assert no silent rewrite; `replacementCandidates` returned.
- [ ] 1.10 Add `tests/e2e/graviscan-port-swap.e2e.ts` (new). **Faithful port-swap simulation requires a mock-mode helper.** Today, `buildMockScanners` in `scanner-handlers.ts:45` doesn't read from a mutable test-controlled array — it generates from `dbScanners` or fabricates from `MOCK_SCANNER_COUNT`. To simulate a port-swap, this E2E test SHALL:
  - **Step 1**: provision the test DB with two `GraviScanner` rows, each with distinct `firmware_serial` and `usb_port` values (`{serial: 'ABC123', usb_port: '1-1'}` and `{serial: 'XYZ789', usb_port: '1-2'}`).
  - **Step 2**: run the app, navigate to /scanner-config, run Detect; assert both scanners appear bound by serial (auto-rebind toast does NOT fire because no port change yet).
  - **Step 3**: invoke a new test-only IPC `gravi.__test__swapMockPorts(serialA, serialB)` (or a similar test-mode hook) that swaps the `usb_port` columns of the two DB rows so the next `buildMockScanners` reflects the swapped state. The handler SHALL be no-op outside `NODE_ENV === 'test'`.
  - **Step 4**: navigate back to /scanner-config (or click Detect); assert the auto-rebind toast appears with text containing both serial fragments and the port change.
  - **Step 5**: run a single test scan; assert metadata.json's `scanner_firmware_serial` matches each scanner's ORIGINAL serial (NOT the swapped port).
  - **Implementation note for 2.10a (added below): `gravi.__test__swapMockPorts` IPC handler.**
- [ ] 1.10a Add IPC handler `gravi.__test__swapMockPorts(serialA: string, serialB: string)` in `src/main/graviscan/scanner-handlers.ts`. Guards: `if (process.env.NODE_ENV !== 'test') return { success: false, error: 'test-only IPC' }`. Implementation: swap `usb_port` columns of the two rows whose `firmware_serial` matches the args. Add a unit test that the handler is rejected outside test mode.

### 1f. Gate (red phase)

- [ ] 1.11 Run the new unit + integration suites; confirm RED for behavioral reasons:
  ```bash
  npm run test:unit -- tests/unit/lsusb-detection.test.ts tests/unit/main/graviscan/scanner-handlers.test.ts tests/unit/scan-metadata-json.test.ts tests/unit/scanner-subprocess.test.ts tests/unit/hooks/useScannerConfig.test.ts
  npm run test:python -- python/tests/test_scan_worker.py
  ```
  Expected: each new test fails with a behavior-mismatch (NOT a type/import/syntax error).
- [ ] 1.12 Gate: `npx tsc --noEmit && npm run lint && npm run format:check` — clean.

## 2. Implementation (green phase)

### 2a. Schema migration

- [ ] 2.1 Edit `prisma/schema.prisma`:
  - Add `firmware_serial String?` to `GraviScanner`.
  - Add `@@unique([firmware_serial])` to `GraviScanner` (SQLite allows multiple NULLs).
  - Add new model `GraviScannerBinding` with **`onDelete: NoAction`** (NOT cascade — the audit log MUST survive deletion of the parent so the binding history remains queryable). **`bound_by` is a denormalized snapshot** (not an FK to `Phenotyper`) — if the phenotyper is later renamed or removed, the audit row stays readable as a UUID-string. Schema:
    ```prisma
    model GraviScannerBinding {
      id                       String   @id @default(uuid())
      scanner_id               String
      firmware_serial          String?
      previous_firmware_serial String?  // populated only on `manual:rma-replacement` rows
      usb_port                 String?
      previous_usb_port        String?  // populated on `auto:port-swap-detected` rows
      bound_at                 DateTime @default(now())
      bound_by                 String?  // denormalized phenotyper_id snapshot; "system" for auto events; intentionally NOT a Prisma @relation FK so the row survives if the Phenotyper row is removed
      reason                   String   // enum-like; validated at handler layer
      notes                    String?  // free-form; used by mid-session edits
      scanner                  GraviScanner @relation(fields: [scanner_id], references: [id], onDelete: NoAction)
      @@index([scanner_id])
      @@index([firmware_serial])
    }
    ```
  - **Add the Prisma inverse-relation back-reference on `GraviScanner`** (Prisma requires both sides of the relation; `prisma generate` will fail without it):
    ```prisma
    model GraviScanner {
      ...
      bindings  GraviScannerBinding[]
    }
    ```
  - **SQLite NULL semantics note.** `@@unique([firmware_serial])` on a column where most rows have `firmware_serial = NULL` is safe under SQLite (each NULL is treated as distinct, so multiple NULL rows coexist). The migration SHALL NOT fail on existing DBs. Verified: `prisma/schema.prisma:10` declares `provider = "sqlite"`. Document this in the migration's release notes so reviewers don't worry about pre-existing rows.
  - **Pre-migration gate**: run `npx prisma generate` BEFORE `migrate dev` and confirm zero errors. The new `bindings GraviScannerBinding[]` back-reference on `GraviScanner` MUST be present, and `prisma generate` is the cheapest check that catches a missed back-reference.
  - Run `npx prisma migrate dev --name add_graviscanner_firmware_serial`.
- [ ] 2.2 Update `src/types/graviscan.ts`:
  - Add `firmware_serial?: string | null` to `DetectedScanner`.
  - Add `firmware_serial: string | null` to `GraviScanner`.
  - Add `scanner_firmware_serial?: string` and `scanner_usb_port_at_capture?: string` to `GraviScanMetadataJson`.

### 2b. Detection (Linux)

- [ ] 2.3 Extend `src/main/lsusb-detection.ts`:
  - **Centralize Epson product IDs.** The existing `EPSON_MODELS` map at `src/main/lsusb-detection.ts:19-22` already declares: `'013a': 'Perfection V600 Photo'` AND `'0144': 'Perfection V850 Pro'`. **Use this existing map verbatim — do NOT introduce new PIDs without lab-bench verification.** Export it (rename to `KNOWN_EPSON_SCANNERS` if structurally helpful, OR keep as-is and add `export`). The future Windows-PnP detection module (issue #219, deferred) will reference the same exported constant.
  - **V800 is intentionally excluded** from the initial set. If a lab acquires a V800, an explicit follow-up change SHALL add the PID (which can ONLY be confirmed by running `lsusb -d 04b8:` against a real V800; multiple sources online disagree on the V800 PID). Document this Non-Goal in the proposal's `## Non-Goals` section.
  - **Single-pass `lsusb -v` invocation, NOT per-PID.** Per-PID iteration (3 spawns × ~50ms each = 150ms+ added latency) is wasteful and fragile under non-root degradation. Call `lsusb -v` ONCE without `-d` filter, parse the output for any device-block whose `idVendor` matches `EPSON_VENDOR_ID` (and whose `idProduct` is in `EPSON_MODELS`), and extract `iSerial` per matched block.
  - **Non-root graceful degradation.** On many distros, `lsusb -v` for non-root processes prints `Couldn't open device, some information will be missing` to stderr AND emits truncated `iSerial 3 ` (no string) lines. The parser regex `iSerial\s+\d+\s+(\S+)` does NOT match the trailing-whitespace form (no `\S+` to capture), so it correctly produces null without crashing. Stderr SHALL be ignored (`stdio: ['ignore', 'pipe', 'ignore']` matching the pattern in `lsusb-detection.ts:147-151`). Add a unit test with a fixture representing the non-root output and assert all serials parse to null.
  - Add `parseLsusbVerbose(output: string): Map<string, string>` returning `bus:device → iSerial`. Regex: capture per-device blocks; extract `iSerial\s+\d+\s+(\S+)`. **Capture-then-coerce-to-null**: the regex captures the literal string after the descriptor index; immediately after capture, coerce `"0"` and empty/whitespace-only values to `null`. The `iSerial 3 0` form (descriptor index 3, literal serial `"0"`) MUST be coerced to `null`.
  - **Use the single-pass invocation specified above** (NOT per-PID iteration — the per-PID approach was a draft that contradicted the single-pass directive; resolved in favor of single-pass per round-3 review). The implementation walks the unified `lsusb -v` output, splits on `^Bus \d+ Device \d+:` markers to identify per-device blocks, and within each block parses `idVendor` and `idProduct` to filter against `EPSON_MODELS`. For matched blocks, extract the `iSerial` line. Output: a single `Map<string, string>` keyed by `bus:device → iSerial` (null where unmapped/empty/`"0"`).
  - Populate `firmware_serial` on each constructed `DetectedScanner` (null when not in the map or coerced to null).
  - Sort the deduplicated detection result by `usb_port` ascending (this is also required by Proposal 1's task 2.20b — re-confirm here).

### 2c. Non-Linux platform handling (graceful degradation)

- [ ] 2.4 _(REMOVED — Windows-PnP detection deferred; see issue #219.)_
- [ ] 2.5 _(REMOVED — Windows orchestration deferred; see issue #219.)_
- [ ] 2.5a **Non-Linux platform graceful degradation.** The existing detection orchestrator already calls `lsusb` unconditionally — on `process.platform !== 'linux'` this fails with `ENOENT` today. Add an explicit guard at the top of the detection orchestrator: when `process.platform !== 'linux'` AND mock mode is OFF, the orchestrator SHALL skip the `lsusb -v` invocation entirely and return whatever the existing detection path returned (no degradation introduced; just no firmware_serial). On `process.platform === 'linux'`, run `lsusb -v` as task 2.3 specifies. In mock mode (`GRAVISCAN_MOCK=true`) on any platform, `buildMockScanners` SHALL fabricate deterministic mock serials (e.g., `MOCK-SERIAL-${i}`) so unit tests for the new matching logic have something distinguishable to assert against. Add unit tests:
  - **Test 2.5a-1**: on `process.platform === 'darwin'` outside mock mode, the detection orchestrator does NOT invoke `execFileSync('lsusb', ['-v', ...])` (assert via spy).
  - **Test 2.5a-2**: on `process.platform === 'win32'` outside mock mode, same — no `lsusb` invocation, no crash.
  - **Test 2.5a-3**: in mock mode on any platform, scanners come back with `firmware_serial: 'MOCK-SERIAL-1'` etc.

### 2d. Matching priority (main process)

- [ ] 2.6 **Update `matchDetectedToDb`** in `src/main/graviscan/scanner-handlers.ts:83-108` (this is a separate function from `saveScannersToDB`; both need the serial layer). New priority: try `firmware_serial` first (when both detected and saved are non-null), then `usb_port`, then the composite. Update the function's docstring to remove "by USB bus+device, falling back to usb_port" (Proposal 1's task 2.20a removed that priority; this task adds the serial layer above the new `usb_port`-primary form). Add a unit test asserting that `matchDetectedToDb` matches by serial when serial matches but `usb_port` differs. **Contract:** `matchDetectedToDb` remains a void-returning function that mutates `detectedScanners` in-place (existing contract). It does NOT write `GraviScannerBinding` audit rows directly — that responsibility stays in `saveScannersToDB` (and in `confirmReplacement`). `matchDetectedToDb` SHALL set the canonical hint field `detected.bound: 'serial' | 'usb_port' | 'composite' | 'none'` on each detected scanner (NOT `_matchSource`; the spec scenario uses `bound`, so use the same field name everywhere). The audit-row write is exclusively a save-time concern.
- [ ] 2.6a **Update `saveScannersToDB`** (separate from `matchDetectedToDb`). The IPC return envelope's `scanners` array SHALL include a `bound: 'serial' | 'usb_port' | 'composite' | 'none'` field per scanner indicating which path matched (consistent with the `bound` field on `matchDetectedToDb`'s mutation and `validateConfig`'s match results — same field name, same enum, used identically across all three handlers).
  - Same three-tier priority for the upsert match: serial → usb_port → composite.
  - After finding a matched row by serial: if `existing.usb_port !== detected.usb_port`, this is a port-swap. Update the row's `usb_port` AND insert a `GraviScannerBinding` row with `reason: 'auto:port-swap-detected'`, populating `previous_usb_port: existing.usb_port` AND `usb_port: detected.usb_port`. Push `{ scanner_id, old_usb_port, new_usb_port, firmware_serial }` onto an `autoRebinds` array returned in the IPC envelope.
  - If no match by serial AND match by `usb_port` BUT both have non-null distinct serials, this is a replacement. Do NOT update; push `{ saved_scanner_id, saved_serial, detected_serial, usb_port }` onto `replacementCandidates`. Return without writing for that scanner.
  - Backfill: if matched by `usb_port` AND `existing.firmware_serial === null && detected.firmware_serial !== null`, write the serial onto the row AND insert a `GraviScannerBinding` row with `reason: 'auto:initial-bind'`.
  - **Never overwrite a non-null `firmware_serial` from this code path.** Add a code-level guard.
- [ ] 2.6b **Prisma client extension enforcing "never overwrite non-null serial".** Verified: `package.json` declares Prisma `^6.18.0`, where the legacy `$use` middleware is REMOVED. `$extends({ query: { graviScanner: { ... } } })` is the only intercept point. **Per-operation arg-shape branching** is required because Prisma's `args` shape differs across operations:
  - **`update`**: read `args.data.firmware_serial`. Query existing row's `firmware_serial`; if non-null AND no override, throw.
  - **`updateMany`**: read `args.data.firmware_serial`. If non-null AND no override, throw immediately — don't try per-row enforcement.
  - **`upsert`**: this is the case Round-3 review caught the prior pseudocode missing. `args` is `{ where, create, update }` — there is NO `args.data`. Read BOTH `args.update.firmware_serial` (the update-branch path, which is the dangerous one) AND `args.create.firmware_serial` (acceptable on first-create — no existing row to protect). The extension SHALL:
    - Pre-query the target row by `args.where`. If the row exists AND `existing.firmware_serial` is non-null AND `args.update.firmware_serial !== undefined` AND no override, throw.
    - If the row does NOT exist, the create branch runs; setting `firmware_serial` from `args.create.firmware_serial` is fine (no overwrite — first write).
  - Setting `firmware_serial: null` (clearing) on a row whose existing value is non-null SHALL also be denied unless the override token is set — this prevents "null then re-set to a different value" two-step bypass. Apply this rule across `update`, `updateMany`, AND `upsert` (in `upsert`'s case, on `args.update`).
  - The override SHALL be carried via `AsyncLocalStorage` (Node's built-in), NOT via an extra field in `data` (which Prisma's TypeScript validation rejects with `Unknown arg`). Implementation pattern:
    ```ts
    import { AsyncLocalStorage } from 'node:async_hooks';
    const overrideStore = new AsyncLocalStorage<{ allow: true } | undefined>();
    export function withFirmwareSerialOverride<T>(fn: () => Promise<T>): Promise<T> {
      return overrideStore.run({ allow: true }, fn);
    }
    // Inside the extension:
    if (data.firmware_serial !== undefined && overrideStore.getStore()?.allow !== true) {
      // … existing-value check …
    }
    ```
  - The replacement-modal handler in `confirmReplacement` SHALL be the ONLY call site that wraps its `prisma.graviScanner.update(...)` call in `withFirmwareSerialOverride(...)`.
  - Add unit tests:
    - **Test 2.6b-1**: a direct `prisma.graviScanner.update({ data: { firmware_serial: 'NEW' } })` outside the override scope is rejected.
    - **Test 2.6b-2**: the same call wrapped in `withFirmwareSerialOverride(...)` succeeds.
    - **Test 2.6b-3**: `prisma.graviScanner.updateMany({ data: { firmware_serial: 'NEW' } })` is rejected without override.
    - **Test 2.6b-4**: `prisma.graviScanner.upsert({ ..., update: { firmware_serial: 'NEW' } })` is rejected without override.
    - **Test 2.6b-5**: `prisma.graviScanner.update({ data: { firmware_serial: null } })` against a non-null row is rejected without override.
    - **Test 2.6b-6** (AsyncLocalStorage Promise-chain integrity): inside `withFirmwareSerialOverride(async () => prisma.graviScanner.update(...))`, assert that the extension's `overrideStore.getStore()?.allow === true` is observed AT THE INTERCEPT POINT, not just at the wrapper level. Confirms context propagates through Prisma's internal async machinery.
    - **Test 2.6b-7** (concurrent override scopes): race two `withFirmwareSerialOverride(...)` calls on different rows simultaneously; assert each completes successfully AND a third unwrapped call running concurrently is still rejected. Confirms `als.run()` isolation under realistic IPC concurrency.
- [ ] 2.7 Update `validateConfig` in the same file:
  - Same priority as `saveScannersToDB`: serial → usb_port → composite.
  - Add `bound: 'serial' | 'usb_port' | 'composite' | 'none'` to each match result so the renderer can render a confidence badge.
- [ ] 2.8 Update `disableMissingScanners`:
  - "matched" predicate now: serial match wins when both sides have serial; falls back to usb_port + composite as today.
  - Add unit test: **"an enabled saved scanner whose serial matches a still-detected device but whose usb_port has changed must NOT be marked disabled."** Setup: saved row `firmware_serial: 'ABC'`, `usb_port: '1-1'`, enabled `true`. Detected scanner `firmware_serial: 'ABC'`, `usb_port: '1-2'`. `enabledIdentities` carries the new identity. The function SHALL NOT mark this scanner disabled — serial-match takes priority over the usb_port mismatch.

### 2e. Audit-table writer

- [ ] 2.9 Add a small helper `writeBinding(db, scanner_id, opts)` to a new `src/main/graviscan/binding-handlers.ts`. Signature:
  ```ts
  export async function writeBinding(db: PrismaClient, scannerId: string, opts: {
    reason: 'auto:initial-bind' | 'auto:firmware-serial-match' | 'auto:port-swap-detected' | 'manual:user-confirmed' | 'manual:rma-replacement';
    firmware_serial?: string | null;
    previous_firmware_serial?: string | null;
    usb_port?: string | null;
    previous_usb_port?: string | null;
    bound_by?: string | null;
    notes?: string | null;
  }): Promise<void>;
  ```
  - Validate `reason` against the enum at runtime; throw on invalid values.
  - Helper SHALL be the ONLY code path that writes to `GraviScannerBinding`. All other handlers MUST use this helper.
  - **Prisma client extension enforces audit-log immutability.** Same `$extends` pattern as 2.6b. Intercept `update`, `updateMany`, AND `upsert` on `GraviScannerBinding` and throw `Error('GraviScannerBinding is append-only')`. Allow `create` and `createMany`. `delete`/`deleteMany` SHALL also throw unless wrapped in a separate `withBindingAuditOverride()` AsyncLocalStorage scope (used only by an admin-tool maintenance script — not by any production handler).
  - Add unit tests:
    - **Test 2.9-1**: any direct `prisma.graviScannerBinding.update(...)` throws.
    - **Test 2.9-2**: `prisma.graviScannerBinding.upsert(...)` throws.
    - **Test 2.9-3**: `prisma.graviScannerBinding.updateMany(...)` throws.
    - **Test 2.9-4**: `prisma.graviScannerBinding.delete(...)` throws outside override scope.
    - **Test 2.9-5**: `prisma.graviScannerBinding.create(...)` succeeds (the only allowed write path).

### 2f. Subprocess + Python

- [ ] 2.10 Extend `src/main/graviscan/scanner-subprocess.ts`:
  - **Constructor signature change.** Today's constructor (`scanner-subprocess.ts:59-72`) takes `(pythonPath, isPackaged, scannerId, saneName, mock)`. Add three OPTIONAL trailing parameters: `firmwareSerial?: string | null`, `usbPort?: string | null`, `displayName?: string | null`. Optional ensures backward-compat for any test that constructs the subprocess without the new fields; production code SHALL always pass them.
  - **Spawn argv update.** Add `--firmware-serial <value>`, `--usb-port <value>`, `--display-name <value>` to the spawned argv. Omit a flag entirely (do NOT pass empty string) when the value is null/undefined. Argv is array-form (no shell), so spaces in `--display-name "Bench-3 Left"` pass cleanly without quoting concerns.
  - **Update the sole call site** at `src/main/graviscan/scan-coordinator.ts:156`. Pass through the new fields from the saved DB row (which the coordinator already has access to via `sessionContext`). If the call site doesn't currently have access to `firmware_serial`/`usb_port`/`display_name`, add them to the coordinator's `setSessionContext` input alongside the existing `scannerNames` map.
  - **Update test mocks.** Search `tests/` for `new ScannerSubprocess(` and update all call sites. Today the constructor has 5 params; the new shape has 8. Existing test fixtures SHALL be updated to pass `null` for the three new params so they exercise the no-flag-omit path explicitly.
- [ ] 2.11 Extend `python/graviscan/scan_worker.py`:
  - **Add argparse flags** at the existing `parse_args()` call site (around line 818): `--firmware-serial`, `--usb-port`, `--display-name`. All `default=None`. (`parse_args()` rejects unknown flags by default — symmetric `--firmware-serial` etc. on the TS subprocess-spawn side per task 2.10 must always be passed even when null, OR the Python side must add them as optional. The Python side adds them as optional `default=None`; TS side OMITS the flag entirely when null so `argparse` treats them as `None`.)
  - **Thread through `ScanWorker.__init__`**: store `self.firmware_serial`, `self.usb_port`, `self.display_name` from `args.firmware_serial`/etc.
  - **Update `_build_tiff_metadata` signature** at line 52. Add three new optional kwargs: `firmware_serial=None, usb_port=None, display_name=None`. Inside the function, include each in the TIFF tag 270 JSON ONLY when non-None and non-empty (do NOT emit empty-string keys).
  - **Update ALL THREE call sites** of `_build_tiff_metadata` at lines **420, 598, and 644** of `scan_worker.py`. Each call SHALL pass `firmware_serial=self.firmware_serial, usb_port=self.usb_port, display_name=self.display_name` as kwargs. Round-3 review verified: `_build_tiff_metadata` is called from THREE places (lines 420/598/644) — missing any one would silently produce TIFFs without the new identity fields. Add a unit test that mocks `_build_tiff_metadata` and asserts it's called with the new kwargs from each of the three code paths.

### 2g. metadata.json enrichment

- [ ] 2.12 Extend `session-handlers.ts:setSessionContext` to populate two new maps: `scannerSerials: Map<scanner_id, firmware_serial>` and `scannerUsbPorts: Map<scanner_id, usb_port>`. Source from the same DB query that populates `scannerNames`.
- [ ] 2.13 **Extend (do NOT duplicate) Proposal 1's per-cycle DB-query at `scan-coordinator.ts:304-342`.** Proposal 1 task 2.20c rebuilds `sessionContext.scannerNames` per-cycle. This task SHALL extend that same per-cycle query to ALSO populate `sessionContext.scannerSerials: Map<string, string | null>` and `sessionContext.scannerUsbPorts: Map<string, string | null>` from the same `findMany` rows (just additional `.set(r.id, r.firmware_serial)` and `.set(r.id, r.usb_port)` lines inside the existing loop). NO new DB query. The per-cycle filtering invariant from Proposal 1 (filter `scannerIds` via `isDbScannerId()` BEFORE the Prisma query) carries through.

  Then in `scan-coordinator.ts`'s metadata.json write, include `scanner_firmware_serial: ctx.scannerSerials.get(scannerId) ?? undefined` and `scanner_usb_port_at_capture: ctx.scannerUsbPorts.get(scannerId) ?? undefined`. Use `??` to coerce `null` to `undefined` so the JSON serializer omits the field (per the spec scenario "metadata.json omits firmware serial when null").
- [ ] 2.14 Extend `scan-metadata-json.ts:writeGraviMetadataJson` to emit the two new optional fields.

### 2h. Renderer (auto-save block, toast, modal, ghost rows)

- [ ] 2.15 Edit `src/renderer/hooks/useScannerConfig.ts`:
  - Auto-save effect: add `if (configStatus === 'mismatch') return;` early-return inside the timeout callback.
  - Surface `autoRebinds` and `replacementCandidates` from the IPC return shape into renderer state. Add `autoRebinds: AutoRebindEvent[]` and `replacementCandidates: ReplacementCandidate[]` to the hook's returned shape.
  - Surface `disconnectedScanners: GraviScanner[]` from `validateConfig.missing`.
- [ ] 2.16 Edit `src/renderer/graviscan/ScannerConfig.tsx`:
  - Render greyed-out ghost rows for `disconnectedScanners`, with "Disconnected since `<last-seen>`" subtitle and "Remove permanently" button.
  - Render a non-blocking toast when `autoRebinds.length > 0`. Text: "Scanner `<display_name>` (serial `<short-serial>`) moved from USB `<old>` to `<new>`. Configuration updated." Auto-dismiss after 6s; click to dismiss earlier.
  - Render a blocking modal when `replacementCandidates.length > 0`. Operator picks per-candidate: "Replacement (preserves history)" / "New scanner (new identity)". Modal posts back via a new IPC `gravi.confirmReplacement(decisions, options?)` whose precise signature is:
    ```ts
    type ReplacementDecision = {
      saved_scanner_id: string;
      saved_serial: string;
      detected_serial: string;
      usb_port: string;
      choice: 'replacement' | 'new-scanner';
    };
    type ConfirmReplacementOptions = {
      bound_by?: string;   // phenotyper_id when known; defaults to 'system:replacement-pending' (used until Proposal 3's UI wiring lands)
    };
    function confirmReplacement(
      decisions: ReplacementDecision[],
      options?: ConfirmReplacementOptions
    ): Promise<{ success: boolean; error?: string }>;
    ```
    The handler writes the appropriate `GraviScannerBinding` row per decision (`reason: 'manual:rma-replacement'` for the "replacement" choice; `reason: 'manual:user-confirmed'` for "new-scanner"), populates `bound_by` from `options.bound_by ?? 'system:replacement-pending'`, and (only on the "replacement" path) wraps the parent-row update in `withFirmwareSerialOverride(...)`.

### 2i. Optional CLI — DEFERRED

- [ ] 2.17 _(REMOVED — split out into a separate proposal `add-bloom-audit-cli`. Keeping this proposal focused on the renderer/main/Python identity work; the audit CLI is a user-facing tool with its own UX/error-handling/test surface that warrants its own change. Track as a follow-up issue if/when labs request it.)_

### 2j. Gate (green phase)

- [ ] 2.18 Run the unit suite: `npm run test:unit` — all green including the new tests.
- [ ] 2.19 Run Python tests: `npm run test:python` — all green.
- [ ] 2.20 Run integration: `npm run test:integration` — all green.
- [ ] 2.21 Run TypeScript and lint gates: `npx tsc --noEmit && npm run lint && npm run format:check` — clean.

## 3. Verification

- [ ] 3.1 Run smoke E2E: `npm run test:e2e:smoke`. Expected: pass; PNGs land in `tests/e2e/screenshots/`.
- [ ] 3.2 **Parent visual verification.** Renderer-touching change. The parent (NOT a subagent) MUST `Read`:
  - `tests/e2e/screenshots/cylinder-home.png`
  - `tests/e2e/screenshots/graviscan-scanner-config.png`
  - `tests/e2e/screenshots/graviscan-graviscan.png`
- [ ] 3.3 Run the new port-swap E2E: `npm run test:e2e -- tests/e2e/graviscan-port-swap.e2e.ts`. Expected: pass.
- [ ] 3.4 Run the proposal-1 canary E2E (regression): `npm run test:e2e -- tests/e2e/graviscan-scanner-config-save.e2e.ts`. Expected: still pass.
- [ ] 3.5 Run integration: `npm run test:integration`. Expected: pass.
- [ ] 3.6 Run Python: `npm run test:python`. Expected: pass.
- [ ] 3.7 Run OpenSpec validator: `openspec validate add-scanner-firmware-serial-identity --strict`. Expected: clean.
- [ ] 3.8 Dispatch the `openspec-review` subagent team against this proposal one more time. Address any BLOCKING findings.
- [ ] 3.9 **Hardware-availability check (manual, recommended):** before merging, the lab manager runs `lsusb -v -d 04b8:` on the production benches and confirms `iSerial` is non-zero for the actual scanners in use. Document the per-bench serial status in the lab notebook.
- [ ] 3.10 Commit:
  ```
  feat(graviscan): firmware_serial as primary scanner identity (#203)

  Adds firmware_serial extraction via lsusb -v on Linux, three-tier
  matching priority (serial → usb_port → composite), GraviScannerBinding
  audit table, TIFF tag 270 + metadata.json self-describing identity,
  auto-rebind on port-swap, and replacement-detection modal.

  Closes #203
  Related: #167, #182, #217 (mid-session replug, deferred follow-up)

  Spec: openspec/changes/add-scanner-firmware-serial-identity
  ```
- [ ] 3.11 Push, confirm CI green on Linux/macOS/Windows. The Linux jobs exercise the `lsusb -v` parsing code path; the macOS/Windows jobs exercise the platform-guard graceful-degradation path (no `lsusb` invocation, no crash). Real-hardware firmware_serial behavior is verified manually per task 3.9 on a Linux lab bench.
