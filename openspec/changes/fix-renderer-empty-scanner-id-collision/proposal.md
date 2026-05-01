# fix-renderer-empty-scanner-id-collision

## Why

Commit `3689c6b` (part of `surface-disabled-scanners-on-detect`) made the renderer preserve the empty-string sentinel `''` in `ScannerAssignment.scannerId` for fresh-install placeholder scanners, so the "Enabled" checkbox renders checked by default and users can save brand-new scanners on first run. The spec at `surface-disabled-scanners-on-detect/specs/scanning/spec.md` requires this behavior under the scenario _"Detection populates scanner assignments"_.

That commit, however, surfaced a pre-existing latent bug across the renderer: every site that resolves an assignment back to its detected scanner — or vice versa — uses `Array.find()` keyed on `scanner_id` / `scannerId`. When N placeholder assignments share `scannerId === ''`, `Array.find()` returns the first match for **every** lookup. Downstream effects:

- The Save payload is built from `find((s) => s.scanner_id === a.scannerId)`, so two placeholder assignments map to one detected scanner and `saveScannersToDB` receives one entry instead of two.
- The test-scan and run-scan IPC payloads do the inverse lookup `assignments.find((a) => a.scannerId === scanner.scanner_id)`; two scanners get the same assignment's grid mode.
- The GraviScan page initializes `ScannerPanelState` with `scannerId: ''` for placeholders; subsequent `scannerStates.find((s) => s.scannerId === a.scannerId)` and `assignments.some((a) => a.scannerId === scanner.scannerId)` lookups all collide.
- `isScannerEnabled` returns `true` for `scannerId === ''`, allowing Start Scan with placeholder ids that would FK-violate.

CI evidence: `tests/e2e/graviscan-scanner-config-save.e2e.ts:203` fails with `expected: >= 2, received: 1` on Linux/macOS/Windows after `3689c6b`.

The renderer's existing assignment→detected lookups key on `scanner_id`, but the spec already names `usb_port` as the canonical stable-identity key for: renderer unchecked-state memory, main-process upsert matching, and `validateConfig` matching. The renderer's assignment lookup is the only outlier.

This proposal is stacked on PR #196.

## Related Issues

- `Related: #167` — _Auto-cleanup stale/duplicate scanner records_ — calls out duplicate scanner rows and proposes `usb_port` as the dedup key. This proposal is an **adjacent renderer-side duplicate-prevention fix** (different failure mode: renderer collision _collapses_ N→1; #167 addresses bus/device-drift _expanding_ N→N+k). #167 should remain open and scoped to its three production fixes (UI Remove button, stale-flagging in `validateConfig`, `@@unique(usb_port)` migration).
- `Related: #182` — USB device-number reassignment on reconnect (origin of the `usb_port`-as-canonical-key effort).
- `Related: #199` — test-audit / placeholder-assertion eliminator. The test plan in `tasks.md` follows #199's discipline ("tests must fail for behavioral reasons, not type/import errors") but is not itself an audit deliverable.
- `Related: #200` — lint rule against bare `toHaveBeenCalled()` assertions. This proposal adds a sibling lint guard (`tests/unit/graviscan-collision-grep.test.ts`); the two share infrastructure assumptions about where lint-style tests live.
- `Related: #201` — GraviScan orphan-row diagnostic. Same family but **non-overlapping**: this proposal prevents future placeholder-collision damage; #201 cleans up _already-recorded_ orphan `GraviScan` rows. Users hitting the buggy commit range may need BOTH fixes; see Data Integrity Impact.
- `Related: #203` — pins `usb_port` as canonical stable-identity key (the exact invariant this proposal codifies in the spec). Note that the port-swap edge case #203 raises is explicitly out of scope here (see Non-Goals).

## Data Integrity Impact

**Pre-fix behavior:** A user on a fresh install with N>1 physical scanners detects N placeholder rows (all `scanner_id: ''`), clicks Save, and ends up with **one** `GraviScanner` DB row instead of N. Subsequent scans:

- Either succeed and FK-attribute every image to the single surviving row, regardless of which physical device produced the image — **scientific data attributable to the wrong physical scanner**.
- Or fail with an FK violation on the placeholder ids that did not survive Save.

Either path is data-integrity-relevant. Lab managers running fresh-install scans on the affected commit range (3689c6b through this fix) **SHOULD audit** any `Scan` rows attributed to a `GraviScanner` row whose `usb_port` does not match the lab's physical USB topology.

**Post-fix behavior:** N detected scanners produce N distinct DB rows. Image attribution is correct; the existing main-process upsert-by-`usb_port` matching remains canonical.

**Migration / recovery state:** A user upgrading from the buggy commit who has one collapsed `GraviScanner` row, after pulling this fix and re-detecting, will see one detected scanner with a real DB id (the survivor) and N-1 placeholder scanners with `scanner_id: ''`. Clicking Save persists the remaining N-1 as new rows. The success banner correctly reports the new total. See spec scenario _"Recovery from pre-fix collapsed-row state"_.

**This recovery only fixes future scans.** Pre-fix `Scan` rows in the DB (and their associated on-disk `metadata.json` files) keep their incorrect `scanner_id` foreign key pointing at the surviving collapsed row. The renderer fix cannot reattribute past scans to their actual physical scanners — there is no automated mapping from image bytes to physical hardware. Lab managers SHOULD audit. Suggested SQL (SQLite Bloom DB):

```sql
-- Find GraviScanner rows likely affected by the 3689c6b collision bug:
-- a single row backing scans whose image paths suggest multiple physical scanners.
SELECT s.scanner_id,
       gs.usb_port,
       gs.name,
       COUNT(DISTINCT substr(s.path, 1, instr(s.path, '/cy'))) AS distinct_path_prefixes,
       COUNT(*) AS scan_rows
FROM GraviScan s
JOIN GraviScanner gs ON gs.id = s.scanner_id
WHERE s.capture_date >= '2026-04-15'  -- adjust to your 3689c6b deploy date
GROUP BY s.scanner_id
HAVING distinct_path_prefixes > 1;
```

If the query returns rows with `distinct_path_prefixes > 1`, those scans are candidates for misattribution. Affected lab notebooks SHOULD note the data-integrity caveat for those wave numbers. **No DB-level remediation is shipped with this proposal** — the audit and any per-lab follow-up are intentionally manual to keep the renderer fix surgical.

**Validation count delta after upgrade:** Lab managers monitoring `validateConfig` logs across the upgrade will see "missing/new" deltas where N detected scanners now produce N saved rows where previously there was 1. This is expected post-fix behavior, not a regression.

## What Changes

**Helpers (in `src/types/graviscan.ts`):**

- `findDetectedForAssignment(detected, assignment)` — match `ScannerAssignment` → `DetectedScanner` by `usb_port`. Uses the `computeStableKey` composite fallback for empty-`usb_port` platforms (e.g., some Linux configurations) so the helper does not regress those platforms to "N collapse to 0."
- `findIndexDetectedForAssignment(detected, assignment)` — same matching, returns the array index for `findIndex` call sites.
- `findAssignmentForDetected(assignments, detected)` — inverse direction. Match `DetectedScanner` → `ScannerAssignment` by the same `usb_port` + composite fallback. Used by `useTestScan.ts` lines 87 and 196.

The composite fallback key is the same `${vendor_id}:${product_id}:${name}:${usb_bus}:${usb_device}` already specified in the existing requirement's "Stable-identity key for enabled/disabled memory" paragraph. We export `computeStableKey()` from `useScannerConfig.ts` to `src/types/graviscan.ts` (or duplicate the small pure function there) so the helper has access to it without circular imports.

**Forward-direction collision sites (assignment → detected):**

1. `src/renderer/hooks/useScannerConfig.ts:557` — auto-save effect
2. `src/renderer/graviscan/ScannerConfig.tsx:97` — manual save handler
3. `src/renderer/hooks/useTestScan.ts:56` — test-scan payload (forward)
4. `src/renderer/graviscan/GraviScan.tsx:202-204` — scannerStates init (forward)
5. `src/renderer/graviscan/GraviScan.tsx:305-310` — checkbox toggle (`findIndex` form, uses `findIndexDetectedForAssignment`)
6. `src/renderer/hooks/useScanSession.ts:747` — scannerConfigs IPC payload (single site, not two — proposal v1's "741, 746" was wrong)

**Inverse-direction collision sites (detected → assignment):**

7. `src/renderer/hooks/useTestScan.ts:87` — test-scan loop
8. `src/renderer/hooks/useTestScan.ts:196` — test-scan retry loop

**Same-direction collision sites (assignment → panel state, both sides `scannerId`):**

9. `src/renderer/graviscan/GraviScan.tsx:205` — `scannerStates.find((s) => s.scannerId === a.scannerId)`
10. `src/renderer/graviscan/GraviScan.tsx:291-293` — `assignments.some((a) => a.scannerId === scanner.scannerId)` (the "isEnabled" derivation in the render path)
11. `src/renderer/hooks/useScanSession.ts:742` — `scannerAssignments.find((a) => a.scannerId === scanner.scannerId)`

These same-direction sites collide whenever `ScannerPanelState.scannerId` carries `''` (which it does on fresh install since `GraviScan.tsx:208` sets it from `a.scannerId!`). Fix: stamp `ScannerPanelState` with `usbPort` at construction time and key the same-direction `find`s by `usbPort`. (`ScannerPanelState` is declared in `src/types/graviscan.ts`; adding a `usbPort: string | null` field is a small surface change.)

**Secondary issues (not collision sites, but compound the placeholder-id semantics):**

- `useScannerConfig.ts:466` — `handleScannerAssignment` truthiness check `scannerId ? ... : null` drops `usbPort` when `scannerId === ''`. **DECISION (post-review):** rewrite this `find` to use `findDetectedForAssignment` for spec-invariant consistency — the helper-everywhere rule prevents the collision-grep CI guard from producing false positives at this site. (Original analysis claimed it was downstream-protected; that's true at runtime but leaves the lint guard with a manual allowlist, which we choose to avoid.)
- `useScannerConfig.ts:618-623` — auto-save id-remap predicate `s.scanner_id === tempId` is `'' === ''` collision-prone. Rewrite to match by `usb_port`. **NOTE:** the renderer's narrowed `savedScanners` type at lines 609-614 currently omits `usb_port` from the row shape; the rewrite REQUIRES widening the narrowed type to include `usb_port: string | null` (see task 2.17a). The main-process return shape (Prisma `GraviScanner`) already includes `usb_port` — the renderer is just dropping it on the floor.
- `useScannerConfig.ts:730` — `for` loop body `updatedAssignments[i].scannerId === cached.scanner_id` is real-id-only at runtime (both sides come from a successful save round-trip), but the collision-grep CI guard would flag it. Rewrite via helper for consistency. (Same rationale as line 466.)
- `useScanSession.ts:207` — `isScannerEnabled` returns `true` for `scannerId === ''`. Fix: gate on `isDbScannerId()`. Also extend the gate to `useTestScan.handleTestAllScanners` so Test Scan does not fire with placeholder ids either.
- `GraviScan.tsx:64-70` — `assignedScannerIds` filter `!== null` should be `isDbScannerId(a.scannerId)` so empty-string ids never leak as Prisma FK candidates.
- `GraviScan.tsx:296` — `key={scanner.scannerId}` produces duplicate React keys when two `ScannerPanelState` entries share `scannerId === ''`. Change to `key={scanner.usbPort ?? \`slot-${idx}\`}` (after task 2.1 stamps `usbPort`).
- `ScannerConfig.tsx:75-83` — diagnostic console log emits `scanner_ids: ['', '']`; replace with the per-assignment `usb_port` shape.
- Auto-save reentry guard: the auto-save effect at lines 554-652 has a 500ms debounce. After a manual Save's `handleDetectScanners` shrinks `detectedScanners` to 1, a stale 500ms closure can re-fire `saveScannersToDB`. The DB upsert by `usb_port` makes this idempotent (no extra row), but defense-in-depth: add `autoSavingRef` to suppress reentry while a save is in flight (consistent with `ScannerConfig.tsx`'s `savingRef` pattern at line 50/67).

**Sites verified safe (no change required, but documented for the record):**

- `useScanSession.ts:559, 563, 567` — match jobs (from main IPC) against `scannerStates`. Jobs cannot carry `''` once `isScannerEnabled` blocks scan-start; downstream-protected by the fix at line 207. **Ordering dependency:** these sites become collision-safe only AFTER task 2.18 lands. Reviewer flagged this; not rewriting them keeps the change surface focused, but task 2.18 must precede any manual testing of the scan-start path.
- `useScanSession.ts:404` — match against `data.scannerId` from main IPC. Same ordering dependency as 559/563/567: this site is collision-safe ONLY AFTER task 2.18's `isScannerEnabled` gate lands. Acknowledged here so the implementation order (2.18 lands BEFORE 2.10/2.14/etc are exercised end-to-end) is explicit. If 2.18 is forgotten, scan-error events for placeholder scanners would silently mismatch the panel state.
- `useScannerConfig.ts:275` — `(a) => a.scannerId === m.saved.id` where `m.saved.id` is a real DB id from a successful save callback. Cannot be `''`.
- `usePlateAssignments.ts:88` — already uses `isDbScannerId`; canonical reference for the pattern.
- `src/renderer/graviscan/Metadata.tsx:76` — propagates `s.scanner_id` (which can be `''`) into `scannerId` of a new assignment, AND populates `usbPort` from `s.usb_port` at line 77. Downstream consumer (`usePlateAssignments`) already filters via `isDbScannerId`. The placeholder-preservation here mirrors `useScannerConfig.buildAssignmentsFromDetection` and is correct (same checkbox-checked-by-default UX).

**Spec invariant (machine-checkable):**

- A new pre-commit / CI grep MUST flag any `\.scanner_id === .*\.scannerId` or `\.scannerId === .*\.scanner_id` pattern outside of the helper definitions. This catches future regressions of the same shape. Implementation: an ESLint rule or a `lint:scanner-id-collision` script the CI invokes.

## Impact

**Affected specs:**

- `scanning` — modify the existing requirement _"GraviScan Scanner Configuration Page"_ to spell out the lookup-key invariant (assignment→detected via `usb_port`, with composite fallback for empty-port platforms). The MODIFIED delta carries forward all existing scenarios from the canonical source verbatim.

**Affected code:**

- `src/types/graviscan.ts` — add three helpers + `ScannerPanelState` gains `usbPort` field
- `src/renderer/hooks/useScannerConfig.ts` — replace collision sites at 466 and 730 via helper (originally "verified safe" but rewritten so the collision-grep CI guard does not need an allowlist); rewrite the auto-save `.map` at 557 via helper; **widen the `savedScanners` narrowed type at lines 609-614 to include `usb_port: string | null`** before rewriting the id-remap predicate at 618-623; add an `autoSavingRef` reentry guard
- `src/renderer/hooks/useTestScan.ts` — replace 3 collision sites (1 forward + 2 inverse); also gate `handleTestAllScanners` on `isDbScannerId` so Test Scan rejects placeholder ids (parallel to Start Scan)
- `src/renderer/hooks/useScanSession.ts` — replace 2 collision sites (1 forward + 1 same-direction), fix `isScannerEnabled`, extend `handleResetScanners` reset path to preserve `usbPort`
- `src/renderer/graviscan/ScannerConfig.tsx` — replace 1 collision site, fix console log
- `src/renderer/graviscan/GraviScan.tsx` — replace 4 collision sites (forward, findIndex, scannerStates init same-direction, isEnabled derivation), populate `ScannerPanelState.usbPort`, fix `assignedScannerIds`, change React `key` at line 296 from `scanner.scannerId` to `scanner.usbPort ?? \`slot-${idx}\`` to avoid duplicate-key warnings when two states share placeholder `''`
- `src/main/graviscan/scanner-handlers.ts` — invert `matchDetectedToDb` (lines 83-108) to `usb_port`-primary, composite-fallback, completing the missed `f1f4b3f` edit. Update the docstring.
- `src/main/lsusb-detection.ts` — sort the deduplicated detection result by `usb_port` ascending so row order is deterministic across sessions (closes a silent UX failure where identical-model scanners swap row positions on kernel re-enumeration).
- `src/main/graviscan/scan-coordinator.ts` — refresh `sessionContext.scannerNames` per-cycle in `scanOnce` (re-query the DB) so `display_name` renames between cycles of a long interval scan are reflected in cycles N>1's metadata.json.

**Affected tests (file paths follow existing project layout):**

- `tests/unit/graviscan-types.test.ts` — extend with `findDetectedForAssignment`, `findIndexDetectedForAssignment`, `findAssignmentForDetected` cases
- `tests/unit/hooks/useScannerConfig.test.ts` — add regression test for N=2 placeholder save AND the **save→re-detect→uncheck flow** (the test that would have caught the prior attempt's "3rd row" bug). Asserts `detectedScanners.length === 2` and no duplicate `usb_port` after the round-trip
- `tests/unit/hooks/useScanSession.test.ts` — add `isScannerEnabled` cases
- `tests/unit/graviscan-collision-grep.test.ts` (new) — meta-test enforcing the spec invariant. Uses **Node-native walk + regex** (not `execSync` with `/bin/sh`) so it works on Linux/macOS/Windows
- `tests/e2e/graviscan-scanner-config-save.e2e.ts` — already exercises canary at line 203 + uncheck at line 246; this proposal adds a **third E2E** for the save→re-detect→uncheck flow asserting exactly 2 distinct DB rows after the round-trip (no duplicates)

**Affected lint:**

- `eslint.config.js` (or sibling) — new rule or script blocking the collision-pattern regex.

**Affected guardrails:**

- This PR touches `src/renderer/`, so the parent (not a subagent) MUST `Read` at least 3 PNGs from `tests/e2e/screenshots/` after running `npm run test:e2e:smoke`.

## Non-Goals

- No change to main-process `saveScannersToDB` matching (already correctly keyed on `usb_port`).
- No change to the empty-string sentinel itself — preserving `''` in `scannerAssignments[i].scannerId` is mandated by the existing spec scenario _"Detection populates scanner assignments"_ for the checkbox-checked-by-default UX. This change makes the rest of the renderer correctly handle that sentinel.
- No new `localStorage` keys; the unchecked-state memory layer is unchanged.
- No additional UI affordances — this is a correctness fix, not a feature.
- No DB migration. Pre-fix collapsed rows remain; the recovery-state scenario (re-detect + Save) is the user-facing remedy.
- No change to `usePlateAssignments.scannerAssignmentsKey` memo (out of scope; tracked as follow-up — when `''` flips to a real UUID, the dependency key changes and `scannerPlateAssignments` is recreated. This is pre-existing and not introduced here).
- **No tracking of physical-device identity across USB port changes** (Related: #203). When a scanner is unplugged from port `1-1` and re-plugged to port `1-2`, the system SHALL treat it as a new device (a new `GraviScanner` row is created; the old row is later marked `enabled=false` by `disableMissingScanners`). The composite fallback `(vendor_id, product_id, name, usb_bus, usb_device)` is insufficient to disambiguate identical-model scanners across moves: `usb_bus`/`usb_device` are kernel-assigned and change on reconnect. Two scanners that swap ports will have their `display_name` overrides scrambled (each row's user-chosen label stays attached to its `usb_port`, not to the physical device). **Lab SOPs SHOULD document USB port assignments** (e.g., a sticker labeling each port). A future fix (firmware serial number or composite-without-port matching) requires extending `DetectedScanner`.
- **No retroactive remediation of pre-fix `Scan` rows or metadata.json files.** Scans captured on the buggy commit range (`3689c6b` through this fix's parent commit) attribute every image to the surviving collapsed `GraviScanner` row in BOTH the `Scan.scanner_id` foreign key AND the on-disk `metadata.json` `scanner_id`/`scanner_name` fields (verified: the IPC payload's `scannerId` flows into `scan-coordinator.ts:319-320` and is baked into the JSON). Re-detect + Save cannot rewrite either. Lab managers SHOULD audit affected scan series; see Data Integrity Impact for the audit query and recommended annotation.
- No automated remediation for orphan `GraviScan` rows (Related: #201). Users with the dual issue (collapsed-row + orphaned scans) need to run #201's diagnostic separately.
