## 1. TDD — Failing tests first

**Commit discipline:** Sections 1 and 2 MUST land as a single commit (squash at merge time). The BREAKING field removal in 2.7 leaves existing tests temporarily red if committed separately from their updated mocks (1.1(j), 1.4) and fixture edits (1.5). Do NOT split 1.x and 2.x across PRs. Intermediate commits on the feature branch are fine as long as the final PR merges as one squashed commit.

- [x] 1.1 Update `tests/unit/pages/ScannerConfig.test.tsx`:
  - Replace the weak `"Save button calls saveConfig and saveScannersToDB"` test (which used bare `toHaveBeenCalled()`) with separate assertions:
    - (a) `saveScannersToDB` called with an array of length N equal to the number of enabled scanners
    - (b) Each entry matches `expect.objectContaining({ name, vendor_id, product_id, usb_port, usb_bus, usb_device, display_name })` AND `expect.not.objectContaining({ scanner_id: expect.anything() })`
    - (c) Unchecking one of two enabled scanners produces a Save payload of length 1 (the remaining enabled one)
    - (d) With all scanners unchecked, the Save button is disabled and no IPC call is made
    - (e) With all scanners unchecked, a helper text explains at least one scanner must be enabled
    - (f) After a successful save, a banner with Tailwind classes `bg-green-50 border border-green-200 text-green-800` is visible and references the scanner count, grid mode (formatted as "2-Grid" or "4-Grid"), and resolution (formatted as "600 DPI")
    - (g) After `saveScannersToDB` returns `{ success: false, error: 'X' }`, a banner with `bg-red-50 border border-red-200 text-red-800` is visible and contains `'X'`
    - (h) After `saveConfig` succeeds and `saveScannersToDB` fails, the banner references both outcomes and the Save button is re-armed
    - (i) Rapid double-click on Save triggers exactly one IPC round-trip (re-entrancy guard holds during in-flight)
    - (i2) After a successful save resolves, a subsequent Save click fires a second, independent IPC round-trip (re-entrancy guard releases)
    - (j) BREAKING: Update the `useScannerConfig` mock at line 77 to drop `handleToggleScannerEnabled` from the mocked return shape
    - (j2) BREAKING: Update the default `scannerAssignments` mock (currently length 1 at lines 48-55) to length 2 matching the default `detectedScanners` length 2, so tests (a), (b), (c) have coherent input state
  - Add new test: clicking the "Enabled" checkbox on a detected scanner sets `scannerAssignments[i].scannerId = null` and the next render shows the checkbox unchecked
  - Add new test: after save, `disableMissingScanners` IPC is called exactly once with the enabled-scanner USB identity list

- [x] 1.2 Update `tests/unit/hooks/useScannerConfig.test.ts` with:
  - (k) `detectScanners` returning N scanners populates `scannerAssignments` with N non-null entries
  - (l) Changing the resolution triggers the auto-save with the correct scanner payload (N entries, not zero)
  - (m) Un-checking a scanner then re-detecting (same `usb_port`, new `scanner_id`) preserves the unchecked state — drive via `handleScannerAssignment(0, null)` (NOT via the removed `handleToggleScannerEnabled`)
  - (n) Un-checking a scanner then re-detecting with a changed `usb_device` but same `usb_port` still preserves the unchecked state (covers #182 — USB device number instability)
  - (n2) After un-checking, simulating a hook remount (re-call `renderHook(...)`) and re-detecting — unchecked state is restored from `localStorage`
  - (n3) Two mock scanners both with `usb_port: ''` (empty) but different `usb_bus`/`usb_device` — un-checking one does NOT affect the other (composite fallback key distinguishes them)
  - (o) The auto-save writes the currently selected `grid_mode` (not always `'2grid'`)
  - (o2) The auto-save also calls `disableMissingScanners` with the enabled-scanner identity list
  - (o3) On checkbox toggle, `localStorage.setItem` is called SYNCHRONOUSLY during the `onChange` invocation (before any `await` or microtask). Assert by spying on `localStorage.setItem`, invoking the toggle, and checking the spy was called before the test's `await`/`vi.waitFor` returns — NOT just that it was eventually called. Tests this spec requirement: "unchecked-state memory SHALL be written to `localStorage` within the same event handler."
  - (o4) On re-save when a `GraviScanner` row exists with admin-set `display_name: "Bench 3"`, the renderer sends `display_name: undefined` (NOT `scanner.name`) for that scanner. Assert via `toHaveBeenCalledWith` that the payload entry for that scanner has `display_name` set to exactly `undefined`. This tests the admin-preservation sentinel semantic.

- [x] 1.3 Update `tests/unit/graviscan/scanner-handlers.test.ts`:
  - (p) `saveScannersToDB(db, [])` returns `{ success: false, error: 'no scanners to save' }` and performs no DB write
  - (p2) `saveScannersToDB` matches existing rows by `usb_port` FIRST; given a DB row with `usb_port='1-2'` and a detected scanner with `usb_port='1-2'` but different `usb_bus`+`usb_device`, the handler updates the existing row (not creates a new one)
  - (p3) `saveScannersToDB` fallback: given a DB row with `usb_port=null` but matching composite `(vendor_id, product_id, name, usb_bus, usb_device)`, the handler updates the existing row
  - (p4) `saveScannersToDB` does NOT match by `(usb_bus, usb_device)` alone — a detected scanner whose bus+device coincidentally matches a row whose `usb_port` differs produces a NEW row, not an update
  - (q) `disableMissingScanners(db, enabledIdentities)` sets `enabled = false` on rows not in the identity list
  - (q2) `disableMissingScanners` does NOT touch rows matching the identity list
  - (q3) `disableMissingScanners` does NOT delete any rows — only flips `enabled`
  - (q4) `disableMissingScanners` matches by `usb_port` primary, composite fallback (consistent with `saveScannersToDB`)

- [x] 1.4 Update `tests/unit/pages/GraviScan.test.tsx`:
  - BREAKING: remove `handleToggleScannerEnabled: vi.fn()` from the mocked `useScannerConfig` return (line 70) — no longer part of the hook API

- [x] 1.5 Update `tests/unit/hooks/useScanSession.test.ts` (REQUIRED — the previous "no edits needed" claim was wrong):
  - Remove `enabled: true` from the default `makeScannerState` helper at line 37 — will fail to typecheck after Task 2.7 removes the field from `ScannerPanelState`
  - Rewrite the line-521 test "canStartScan is false when no scanners enabled" to drive readiness via `scannerAssignments: [{ slot, scannerId: null, ... }]` instead of `{ enabled: false }` — the readiness gate semantics have shifted from "scannerStates enabled" to "scannerAssignments has non-null scannerId"
  - Audit every other `makeScannerState(...)` call site (grep: `makeScannerState\(` shows lines 49 and 521). Both need updates after the helper's signature change

- [x] 1.6 Create `tests/unit/graviscan/session-handlers-metadata.test.ts`:
  - Given a `GraviScanner` row with `display_name: "X"` and `name: "Y"`, `session-handlers.ts` populates `scannerNames` with `"X"`
  - Given `display_name: null` and `name: "Y"`, populates with `"Y"`
  - Given both null, falls back to the scanner id
  - Direct assertion on the `ScanCoordinator.setSessionContext` argument's `scannerNames` Map

- [x] 1.7 Run `npm run test:unit -- --grep "ScannerConfig|useScannerConfig|scanner-handlers|GraviScan|session-handlers"` and confirm the NEW tests fail and existing tests still compile against the current (broken) implementation. Some existing tests will fail to compile due to (j), (j2), and 1.5 — this is expected as part of the single-commit bundling. Record failure messages for comparison at gate 2.10.

**Check gate (after 1.7):** Confirm NEW tests are failing for the right reasons (behavior mismatch, not type mismatch). Type mismatches in EXISTING tests at this gate are expected and will be resolved by Section 2.

## 2. Implementation — refactor to single source of truth

- [x] 2.1 In `src/renderer/hooks/useScannerConfig.ts`, populate `scannerAssignments` on detection. When `handleDetectScanners` and the `'no-config'` branch of `validateScannerConfig` finish loading scanners, map each `DetectedScanner` into a `ScannerAssignment` with `scannerId` set. The existing `matchDetectedToDb` path already does this for `'valid'` and `'mismatch'` branches — extend consistently.

- [x] 2.2 Add a persisted unchecked-state map:
  - Compute the stable-identity key for a scanner as: `s.usb_port || \`\${s.vendor_id}:\${s.product_id}:\${s.name}:\${s.usb_bus}:\${s.usb_device}\``(uses the empty-string-falsy`!usb_port`predicate, NOT`usb_port === null`)
  - Persist the `Set<string>` of unchecked keys to `localStorage` under a new `STORAGE_KEYS.uncheckedScannerKeys` entry, using the existing storage wrapper pattern in `useScannerConfig.ts` (lines 18-25)
  - Load the Set on hook init; apply it AFTER detection when building `scannerAssignments` so unchecked scanners stay unchecked
  - On checkbox toggle (in `ScannerConfig.tsx`), add/remove from the Set and write to localStorage synchronously in the same event handler

- [x] 2.3 Rewrite the auto-save effect (lines ~477-559) to:
  - Build its scanner payload from `scannerAssignments` (now correctly populated) — NOT from a filter that yields `[]`
  - Read `grid_mode` from the radio group's bound value, NOT from `scannerAssignments.find(a => a.scannerId !== null)?.gridMode` (stale on fresh install)
  - Keep the existing `if (assignedScanners.length === 0) return;` short-circuit — defense in depth
  - After `saveScannersToDB` succeeds, also call `window.electron.gravi.disableMissingScanners(enabledIdentities)` (new handler, see 2.9)

- [x] 2.4 **BREAKING:** Remove `handleToggleScannerEnabled` from `useScannerConfig`'s return. Remove the `scannerStates` / `setScannerStates` parameters from `UseScannerConfigParams`. The hook no longer reads or writes `scannerStates`. Update the hook's return type and all internal references.

- [x] 2.5 In `src/renderer/graviscan/ScannerConfig.tsx`:
  - Remove the local `scannerStates` useState (line 14) and stop passing `setScannerStates` to the hook
  - Remove the import of `ScannerPanelState` (line 10) if no longer used after the other changes
  - Bind each "Enabled" checkbox to `scannerAssignments[i].scannerId !== null`; `onChange` handler sets `scannerId` to `detectedScanners[i].scanner_id` or `null` AND updates the persisted unchecked-state map from task 2.2
  - Rewrite `handleSave` to build `scannersToSave` from `scannerAssignments` (enabled entries only)
  - Default `display_name` in the payload to: if the user has NOT explicitly overridden for this scanner → `undefined` (so main-process `?? existing.display_name` preserves admin values); else the user's override value; if no admin override exists yet → `scanner.name`
  - After `saveScannersToDB` succeeds, call `window.electron.gravi.disableMissingScanners` with the enabled-scanner identity list
  - Add `isSaving` state + ref; guard `handleSave` against re-entrancy (set ref before IPC, clear ref in `finally`)
  - Add success banner (`bg-green-50 border border-green-200 text-green-800`, dismiss button) text: `"N scanners saved · 2-Grid · 600 DPI"` using the formatted grid mode and resolution
  - Add error banner (`bg-red-50 border border-red-200 text-red-800`) with the error message from the IPC response
  - Add partial-failure banner copy: `"Config saved. Scanner save failed: <error>."` when `saveConfig` succeeds but `saveScannersToDB` fails
  - Disable the Save button when all scanners are unchecked; render a helper note
  - Log `console.info('[ScannerConfig] handleSave', { action: 'save', count, grid_mode, resolution, scanner_ids })` before the IPC call (renderer DevTools visibility — NOT main-process log; do not mislabel)

- [x] 2.6 In `src/renderer/graviscan/GraviScan.tsx`:
  - Stop passing `scannerStates` / `setScannerStates` to `useScannerConfig` (removed in 2.4). Continue passing to `useScanSession` (unchanged).
  - Remove the `enabled: true` initializer on line 203 inside the `scannerStates.map(...)` — the field is being removed from `ScannerPanelState`
  - Remove `scannerStates.enabled` read on line 289 — change checkbox binding to `scannerAssignments.find(a => a.scannerId === scanner.scannerId)?.scannerId != null`
  - Thread `scannerAssignments` into the `<ScanControlSection>` call site (currently line ~471) as a new prop

- [x] 2.7.1 **Prerequisite for 2.7 read-site edits:** Plumb `scannerAssignmentsRef` through `UseScanSessionParams`:
  - Add `scannerAssignmentsRef: React.MutableRefObject<ScannerAssignment[]>` to `UseScanSessionParams` alongside the existing `scannerAssignments: ScannerAssignment[]` on line 42
  - In `GraviScan.tsx`, create `const scannerAssignmentsRef = useRef(scannerAssignments)` and keep it current via `useEffect(() => { scannerAssignmentsRef.current = scannerAssignments; }, [scannerAssignments])`
  - Thread the ref to `useScanSession` alongside the existing value prop
  - This mirrors the existing `scannerPlateAssignmentsRef` pattern (useScanSession.ts:51-53)

- [x] 2.7 **BREAKING (internal):** Remove `enabled: boolean` from `ScannerPanelState` in `src/types/graviscan.ts`. Update all readers and writers:
  - `src/renderer/hooks/useScanSession.ts` — **READS of `s.enabled`** at lines 205, 297, 339, 464, 674, 694, 833, 854, 879 (9 occurrences) — replace each with `scannerAssignmentsRef.current.find(a => a.scannerId === s.scannerId)?.scannerId != null`. Note: `scannerAssignments` is currently passed as a value prop (line 42) but NOT as a ref. Task 2.7.1 below adds the ref plumbing — do that before these read-site edits, otherwise async callbacks inside event handlers and intervals will close over stale `scannerAssignments` values. Verify line numbers with `rg -n "s\.enabled" src/renderer/hooks/useScanSession.ts` before edits.
  - `src/renderer/hooks/useScanSession.ts` — **WRITES of `enabled`** at line 562 (`enabled: true` in the scan-status restoration effect) and line 898 (`enabled: s.enabled` in `handleResetScanners`) — OMIT the property entirely from both object literals. Line 562's "mark as scanning" semantic is already carried by the sibling `isBusy: true, state: 'scanning'` properties in the same object, so nothing is lost.
  - `src/components/graviscan/ScanControlSection.tsx` — lines 183, 189 — the component currently duplicates `ScannerPanelState`'s structural type inline in its props. Add `scannerAssignments: ScannerAssignment[]` to `ScanControlSectionProps`, remove `enabled: boolean` from the inline scanner prop shape at lines 28-35, replace both `s.enabled` reads with `scannerAssignments.find(a => a.scannerId === s.scannerId)?.scannerId != null`
  - `src/renderer/graviscan/GraviScan.tsx` — lines 203 (init write) and 289 (read) — covered by task 2.6
  - `src/renderer/graviscan/ScannerConfig.tsx` — line 189 — covered by task 2.5
  - **DO NOT remove `enabled: boolean` from `GraviScanner` in `prisma/schema.prisma`** — that DB column is retained and now carries the true semantic ("scanner included in current configuration"). Only the renderer type `ScannerPanelState.enabled` is removed.
  - **Note:** line numbers are approximate — use `rg "s\.enabled|scannerStates\[.*\]\.enabled|enabled:"` within each file to locate actual occurrences at implementation time

- [x] 2.8 In `src/main/graviscan/scanner-handlers.ts`:
  - `saveScannersToDB`: if the passed-in array is empty, return `{ success: false, error: 'no scanners to save' }` without touching the DB
  - Invert `matchDetectedToDb` priority: match by `usb_port` FIRST, then by composite `(vendor_id, product_id, name, usb_bus, usb_device)`. Remove the `(usb_bus, usb_device)`-alone primary match (lines 367-374 currently)
  - Preserve the `display_name: scanner.display_name ?? existing.display_name ?? null` pattern on update (line 387) — this is the admin-value-preservation path

- [x] 2.9 In `src/main/graviscan/scanner-handlers.ts`, add a new handler `disableMissingScanners(db, enabledIdentities)`:
  - `enabledIdentities` is `Array<{ usb_port: string; vendor_id: string; product_id: string; name: string; usb_bus: number | null; usb_device: number | null }>`
  - For each existing `GraviScanner` row whose `enabled = true`, check if any entry in `enabledIdentities` matches it by `usb_port` primary, composite fallback
  - For rows NOT matched, set `enabled = false` via Prisma `update`
  - Do NOT delete rows
  - Return `{ success: true, disabled: N }` or `{ success: false, error }`
  - Register the IPC handler in `src/main/graviscan/register-handlers.ts` alongside the existing graviscan handlers (NOT in `src/main/database-handlers.ts` — that file is for cylinder/database handlers). Use the existing `wrapHandler()` wrapper for the `{ success, error }` envelope.
  - Expose via `src/main/preload.ts` under the existing `gravi` namespace: `window.electron.gravi.disableMissingScanners`. Use `unwrapGravi()` to flatten the nested envelope, consistent with other gravi handlers.

- [x] 2.10 In `src/main/graviscan/session-handlers.ts` line 196:
  - Replace `scannerNames.set(s.scannerId, s.scannerId)` with a Prisma lookup against `GraviScanner` by `scanner_id`
  - Use `display_name ?? name ?? scanner_id` as the resolved value
  - Do this before the `for (const plate of s.plates)` loop so the lookup happens once per scanner, not per-plate
  - Add a test in `session-handlers-metadata.test.ts` (see task 1.6)

**Check gate (after 2.10):** Run `npm run test:unit` — every new test from Section 1 SHALL now pass, and no existing test SHALL have regressed. Run `npx tsc --noEmit` — zero errors. If either fails, fix before proceeding to Section 3.

## 3. E2E and manual verification

- [x] 3.1 Create `tests/e2e/graviscan-scanner-config-save.e2e.ts`:
  - Launch Electron with `GRAVISCAN_MOCK=true` + test DB
  - Navigate to `/scanner-config`
  - Wait for 2 mock scanners to appear with Enabled checkboxes
  - Click Save Configuration
  - Assert success banner visible within 2s
  - Assert `GraviScanner` table has 2 rows via a direct `sqlite3` query on the test DB (Playwright Node context)
  - Assert `SELECT usb_port FROM GraviScanner` returns a non-empty string for all rows (the column is nullable but mock scanners always set it to e.g. `'1-1'`)
  - Assert `SELECT enabled FROM GraviScanner` is all true
  - Navigate to `/metadata`; assert no Prisma FK error banner appears AND `window.console.error` was NOT called with `/FOREIGN KEY constraint/i` during the page load
  - Separate test: uncheck one scanner on `/scanner-config`, click Save — assert `SELECT enabled FROM GraviScanner WHERE <unchecked usb_port>` is `false`
- [x] 3.2 Add the new E2E file to `playwright.config.ts` if a glob doesn't pick it up automatically
- [x] 3.3 Manual smoke: with dev server running and `GRAVISCAN_MOCK=true`, walk the flow — Scanner Config → Save → `sqlite3 ~/.bloom/dev.db "SELECT COUNT(*) FROM GraviScanner WHERE enabled=1"` should be ≥ 1 → Metadata loads without Prisma errors in the terminal. **Verified:** count=2, no FK errors after fix-scanner-config-save-flow + surface-disabled-scanners-on-detect landed.
- [ ] 3.4 Manual smoke: uncheck all scanners; confirm Save button disabled and helper text visible. (Covered by unit test in tests/unit/pages/ScannerConfig.test.tsx; manual click-through deferred to follow-up.)
- [ ] 3.5 Manual smoke: rapid double-click Save — confirm only one round-trip in the terminal log and one success banner. (Covered by unit test (i) and (i2); manual click-through deferred.)
- [x] 3.6 Manual smoke: uncheck one scanner, Cmd-R to reload renderer, assert the scanner is still unchecked on the re-rendered page. **Verified** during smoke testing of surface-disabled-scanners-on-detect.
- [ ] 3.7 Manual smoke: perform a scan, open the resulting scan directory, check the `*.metadata.json` file's `scanner_name` field — should be the scanner's `display_name` (or `name`), NOT a UUID. **Blocked by #206** (bloom-hardware subprocess argparse mismatch). Verified at the unit-test level in tests/unit/graviscan/session-handlers-metadata.test.ts.

**Check gate (after 3.7):** Run full test suite `npm run test:unit`, `npm run test:e2e -- graviscan-scanner-config-save`, `npx tsc --noEmit`, `npm run lint`, `npx prettier --check .`. All green.

## 4. File follow-up issues

- [x] 4.1 File GitHub issue **#201**: "GraviScan orphan-row diagnostic for dev DBs". Query:

  ```sql
  SELECT gs.id, gs.scanner_id FROM GraviScan gs
    LEFT JOIN GraviScanner gsr ON gs.scanner_id = gsr.id
    WHERE gsr.id IS NULL;
  ```

  Document remediation options (delete orphans vs. create phantom GraviScanner rows from metadata.json). Update the "to be filed" placeholder in proposal.md to the actual assigned issue number once created.

- [x] 4.2 File GitHub issue **#202**: "Metadata page should read scanners from GraviScanner table, not re-run detection". Currently `Metadata.tsx:61` calls `detectScanners()` — couples metadata to physical scanner connectivity. Note that after this PR, `GraviScanner.enabled` reliably reflects user configuration, so the new issue becomes actionable with a simple `graviscans.list({ enabled: true })` IPC. Update proposal.md once assigned.

- [x] 4.3 Comment on existing issue **#167**: Link this PR and note that aligning both renderer and main-process on `usb_port` as primary identity makes the future `@@unique(usb_port)` migration safe. Do NOT file a new issue for #201 — it duplicates #167.

- [x] 4.4 Comment on existing issue **#159**: Link this PR and note that after merge, the fix-site shifts from `scannerStates.some(s => s.enabled)` to `scannerAssignments.some(a => a.scannerId !== null)`. Update #159 if it references the old path.

- [x] 4.5 Comment on existing issue **#199**: Link this PR's inline strengthening of `ScannerConfig.test.tsx` and reference new issue **#200** (lint rule for bare `toHaveBeenCalled`). The broader audit remains open for the non-Scanner-Config test files.

- [x] 4.6 File GitHub issue **#203**: "USB device-number instability during reconnect (follow-up to #182)". Even after this PR, there are edge cases where a physical scanner moves to a DIFFERENT `usb_port` (e.g., user moves the cable). The current PR documents this as a known limitation in the spec's requirement preamble. A future fix would require cross-session scanner identity tracking. Link to #182. Update proposal.md once assigned.

## 5. Final verification

- [x] 5.1 `npm run test:unit` passes (new tests + all existing tests) — 970 passed
- [ ] 5.2 `npm run test:e2e -- graviscan-scanner-config-save` passes locally — E2E test file written but not yet run locally; will run in CI on PR
- [x] 5.3 `npx tsc --noEmit` clean
- [x] 5.4 `npm run lint` clean
- [x] 5.5 `npx prettier --check "**/*.{ts,tsx,md,json}"` clean
- [x] 5.6 `openspec validate fix-scanner-config-save-flow --strict` passes
- [x] 5.7 All "to be filed" placeholders in proposal.md have been updated with actual assigned issue numbers from task 4.x — #201, #202, #203 substituted

## 6. Process improvements (to apply from now on)

- [x] 6.1 Adopt rule for all new tests in this branch and future work: every test must assert either (a) call payload via `toHaveBeenCalledWith(...)` or access to `mock.calls`, OR (b) post-state (rendered UI, store state, IPC response). Bare `expect(fn).toHaveBeenCalled()` is no longer acceptable. Tracked in issue **#200** (lint rule). Until #200 lands, enforce via review. **Status:** rule documented; enforcement deferred to #200 lint rule.
- [x] 6.2 Adopt rule: before any OpenSpec review round is considered "complete," run the actual scenario end-to-end with the dev server + mock mode. Adversarial subagents read code, they do not click buttons. Review rounds that only read are worth half of their previous weight. **Status:** rule documented for future application; demonstrated value in this PR (smoke test caught 4 bugs that 5 review rounds missed).
