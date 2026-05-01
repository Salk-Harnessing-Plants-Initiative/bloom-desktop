# Tasks — fix-renderer-empty-scanner-id-collision

> **Discipline:** Strict TDD. Section 1 writes failing tests. Section 2 makes them pass. Section 3 verifies end-to-end. Do not advance to a section until the prior section's gate command is green.
>
> **Scope reminder:** 11 collision sites (6 forward, 2 inverse, 3 same-direction) + 5 secondary issues + lint guard. See `proposal.md` for the full catalog.

## 1. Tests (red phase)

> **Test placement (matches existing project layout):**
>
> - `tests/unit/graviscan-types.test.ts` — extend (existing file)
> - `tests/unit/hooks/useScannerConfig.test.ts` — extend (existing file)
> - `tests/unit/hooks/useScanSession.test.ts` — extend (existing file)
> - Do NOT create `tests/unit/types/` — that directory does not exist in this project.

- [ ] 1.1 **Confirm the canary E2E is RED on current HEAD before fix.** Run:
  ```bash
  npm run test:e2e -- tests/e2e/graviscan-scanner-config-save.e2e.ts
  ```
  Expected: `expect(scannerCount).toBeGreaterThanOrEqual(2)` at line 203 fails with `expected: >= 2, received: 1`. Capture the failure log; this is the regression evidence. Do NOT skip — if it passes, the bug is not what the proposal claims and re-diagnosis is needed.
- [ ] 1.2 Extend `tests/unit/graviscan-types.test.ts` with `findDetectedForAssignment`, `findIndexDetectedForAssignment`, `findAssignmentForDetected` cases. (Note: the prior tasks.md draft proposed `// @ts-expect-error not yet implemented` directives. Empirically, vitest's tsc pass treats missing-export imports leniently in test files, so the tests run RED for the right reason — `is not a function` at runtime — without the directives. Do NOT add `@ts-expect-error`.) Cases:
  - **`findDetectedForAssignment`**:
    - Returns the detected scanner whose `usb_port` matches `assignment.usbPort`
    - With two placeholder scanners (both `scanner_id: ''`, distinct `usb_port`), two lookups return two distinct objects
    - With `assignment.usbPort === null`, returns `undefined`
    - With `assignment.usbPort === ''` AND detected scanners also have `usb_port === ''`, falls back to composite key match (uses `vendor_id, product_id, name, usb_bus, usb_device`)
    - With `assignment.usbPort` valid but no detected match, returns `undefined`
    - With empty `detected` array, returns `undefined`
    - Generic over `D extends DetectedScannerLookupable` so callers passing minimal mocks compile
  - **`findIndexDetectedForAssignment`**:
    - Returns the array index for the matching scanner
    - Returns `-1` when no match
    - Same usb_port/composite-fallback semantics as the find variant
  - **`findAssignmentForDetected`** (inverse direction):
    - Returns the assignment whose `usbPort` matches `detected.usb_port`
    - With two placeholder scanners and two assignments (matched 1:1 by `usb_port`), each detected scanner resolves to its own assignment
    - With `detected.usb_port === ''`, falls back to composite key
    - With no matching assignment, returns `undefined`
- [ ] 1.3 Extend `tests/unit/hooks/useScannerConfig.test.ts` with the placeholder-collision regression group:
  - `buildAssignmentsFromDetection` with two placeholder scanners produces two assignments with identical `''` `scannerId` AND distinct `usbPort` values (this confirms the assignment shape that downstream lookups depend on)
  - The auto-save effect's payload-building step (line ~556 in `useScannerConfig.ts`) — extracted into a pure helper if not already — produces a payload of length 2 (not 1) when fed the two assignments + two detected scanners
  - `handleScannerAssignment(slotIndex, '')` after a previous uncheck restores `assignments[slotIndex].usbPort` from `detectedScanners[slotIndex].usb_port` (this is the secondary-issue fix at `useScannerConfig.ts:466`)
  - **Test A — id-remap distributes by usb_port (not by scanner_id===tempId OR by bus+device coincidence)**: with N=2 placeholders post-Save, BOTH `scannerAssignments[0].scannerId` and `[1].scannerId` get distinct real UUIDs; specifically NOT both equal to the same UUID. The test mock SHALL set `usb_bus`/`usb_device` to values that DO NOT coincide with the original assignments (e.g., the saved rows have `usb_bus: 9, usb_device: 99` vs the placeholders' `usb_bus: 1, usb_device: 1` and `1, 2`). This forces the predicate to use the `usb_port` path exclusively; if task 2.17a (type widening) is forgotten, the test will fail. Mock shape: `gravi().saveScannersToDB.mockResolvedValue({ success: true, scanners: [{id: 'real-uuid-1', usb_port: '1-1', usb_bus: 9, usb_device: 99, name: 'Mock 1'}, {id: 'real-uuid-2', usb_port: '1-2', usb_bus: 9, usb_device: 100, name: 'Mock 2'}] })`.
  - **Test B (state-shape invariants after save→re-detect→uncheck)**: round-3 review caught that the original draft of Test B (which traced closure semantics) would NOT have reproduced the prior session's "3rd row Mock Scanner 1 duplicate" bug — that specific bug almost certainly came from a `setScannerAssignments(prev => [...prev, ...])` merge-instead-of-replace mistake that the current source does NOT contain. So this test instead asserts the **state-shape invariants** that the user observed were violated, regardless of the underlying mechanism. A future regression that re-introduces ANY merge-instead-of-replace pattern (or any other bug producing a third entry) will be caught by these invariants. **Mock discipline:** use `mockResolvedValueOnce` for EVERY detection AND save call so call ordering is deterministic. Sequence:
    1. Mount hook with **pre-queued mocks** — exactly two `detectScanners.mockResolvedValueOnce` calls AND exactly one `saveScannersToDB.mockResolvedValueOnce` call (no extras to spuriously prove "only N called").
    2. `handleDetectScanners()` — consumes detect mock #1 (2 placeholders with `scanner_id: ''`, distinct `usb_port`).
    3. `setResolution(600)` to trigger the debounced auto-save; `waitFor(saveScannersToDB called)` — consumes the save mock. The save mock's response carries 2 real UUIDs at distinct usb_ports.
    4. The auto-save's id-remap step should rewrite placeholders to real UUIDs in `detectedScanners`. **Mid-flow invariant assertion**: `expect(result.current.detectedScanners).toHaveLength(2)` AND `expect(new Set(result.current.detectedScanners.map(d => d.scanner_id)).size).toBe(2)` (two distinct ids, no duplication).
    5. `handleDetectScanners()` — consumes detect mock #2 (2 detected, with the same real UUIDs from DB).
    6. `act(() => result.current.handleScannerAssignment(0, null))` — uncheck slot 0.
    7. **Final state-shape invariants** (these are the user-observed-bug guards):
       - `expect(result.current.detectedScanners).toHaveLength(2)` — NEVER 3, ever, regardless of intermediate state.
       - `expect(new Set(result.current.detectedScanners.map(d => d.usb_port)).size).toBe(2)` — no duplicate `usb_port` values (the "two copies of Mock Scanner 1" symptom).
       - `expect(result.current.scannerAssignments).toHaveLength(2)`.
       - `expect(result.current.scannerAssignments[0].scannerId).toBeNull()` — the uncheck took effect.
       - `expect(result.current.scannerAssignments[1].scannerId).toBe('real-uuid-2')` — the surviving assignment carries the real id.
       - `expect(gravi().detectScanners).toHaveBeenCalledTimes(2)` AND `expect(gravi().saveScannersToDB).toHaveBeenCalledTimes(1)` — no spurious extra IPC fires (defense against re-entry).
    8. Note in test docstring: "If a future implementation regresses by merging-instead-of-replacing in any setScannerAssignments/setDetectedScanners call (the suspected mechanism of the prior 3-row bug), the length-2 assertions catch it. The test asserts on observable state, not on closure traces."
  - **Test recovery from collapsed-row state**: 1 surviving DB row + 1 detected placeholder (mixed). Save sends a payload with both `usb_port` entries; `saveScannersToDB` is called with 2 entries (1 update, 1 insert).
- [ ] 1.4 Extend `tests/unit/hooks/useScanSession.test.ts` with the `isScannerEnabled` regression group:
  - `isScannerEnabled('real-uuid-string')` returns `true` (with `scannerAssignmentsRef.current` containing that id)
  - `isScannerEnabled('')` returns `false` even when `scannerAssignmentsRef.current` contains an assignment with `scannerId === ''` (the placeholder is not "enabled" for scan-start)
  - `isScannerEnabled('non-existent')` returns `false`
- [ ] 1.5 Add `tests/unit/graviscan-collision-grep.test.ts` (new file) — a **Node-native** meta-test that walks `src/renderer/` and `src/main/graviscan/` for the collision pattern. **Cross-platform safe (works on Linux/macOS/Windows; no shell dependency, no `execSync`, no `/bin/sh`).** Implementation: `fs.readdirSync` + `fs.readFileSync` recursively over `.ts`/`.tsx`, scanning each line.

  **Pattern hardening:** The regex SHALL match BOTH `===` and `!==` (negated comparisons are equally collision-prone — boolean inverts but both sides still compare placeholder `''` to placeholder `''`) AND SHALL allow zero-or-more whitespace around the operator (so `s.scanner_id===a.scannerId` with no spaces is also flagged). Final form:
  ```ts
  const COLLISION_PATTERN = /\.scanner_id\s*(?:===|!==)\s*\S+\.scannerId|\.scannerId\s*(?:===|!==)\s*\S+\.scanner_id/;
  ```

  **Coverage scope:** `src/renderer/` AND `src/main/graviscan/`. The bug class is not renderer-exclusive; main-process code that mixes the two field names is equally collision-prone.

  **No allowlist:** Section 2 rewrites EVERY collision-prone line via the helpers. The "verified safe" sites at `useScannerConfig.ts:466` and `:730` are also rewritten (see tasks 2.16 and 2.16b) so the test turns fully GREEN with no per-site allowlist.

  **Known limitation (acknowledged):** Multi-line forms (`s.scanner_id ===\n  a.scannerId`) are NOT flagged because the test scans line-by-line. Multi-line forms in the codebase are vanishingly rare; if introduced, an integration-test reviewer SHALL flag manually. Documented as a Non-Goal in the test's docstring.

  Initially RED. Round-3 review counted **9 grep-visible matches** on current HEAD: `useScannerConfig.ts:557, 730`, `useScanSession.ts:747`, `useTestScan.ts:56, 87, 196`, `GraviScan.tsx:203, 306`, `ScannerConfig.tsx:97`. (One additional collision-prone site at `useScannerConfig.ts:466` is regex-invisible because it compares `scannerId` to a bare string param; that site is fixed via slot-index per task 2.16.) Turns GREEN after section 2 completes. This locks the spec invariant in CI.
- [ ] 1.6 Run the new unit tests to confirm they fail for the right reason:
  ```bash
  npm run test:unit -- tests/unit/graviscan-types.test.ts tests/unit/hooks/useScannerConfig.test.ts tests/unit/hooks/useScanSession.test.ts tests/unit/graviscan-collision-grep.test.ts
  ```
  Expected: each new test fails with a behavior-mismatch (not a type/import/syntax error other than the known `@ts-expect-error` ones). If a test fails for a non-behavioral reason, fix the test setup before proceeding.
- [ ] 1.7 Gate: `npx tsc --noEmit && npm run lint && npm run format:check` MUST pass with the new tests in place. The `@ts-expect-error` directives on the helper imports are the only acceptable type errors at this stage; everything else must be clean.

## 2. Implementation (green phase)

### 2a. Helpers

- [ ] 2.1 Add the helpers + types to `src/types/graviscan.ts` (after the `isDbScannerId` block, before the `Scan Session State` section). Also extend `ScannerPanelState` with a `usbPort` field:

  ```ts
  export interface DetectedScannerLookupable {
    scanner_id: string;
    usb_port: string;
    vendor_id?: string;
    product_id?: string;
    name?: string;
    usb_bus?: string | number;
    usb_device?: string | number;
  }

  export interface ScannerAssignmentLookupable {
    scannerId: string | null;
    usbPort: string | null;
    vendorId?: string | null;
    productId?: string | null;
    name?: string | null;
    usbBus?: string | number | null;
    usbDevice?: string | number | null;
  }

  /** Composite stable-identity key for scanners on platforms where `usb_port` is empty. */
  function compositeStableKey(parts: {
    vendor_id?: string;
    product_id?: string;
    name?: string;
    usb_bus?: string | number;
    usb_device?: string | number;
  }): string {
    return `${parts.vendor_id ?? ''}:${parts.product_id ?? ''}:${parts.name ?? ''}:${parts.usb_bus ?? ''}:${parts.usb_device ?? ''}`;
  }

  function compositeStableKeyFromAssignment(
    a: ScannerAssignmentLookupable
  ): string {
    return `${a.vendorId ?? ''}:${a.productId ?? ''}:${a.name ?? ''}:${a.usbBus ?? ''}:${a.usbDevice ?? ''}`;
  }

  /**
   * Resolve `ScannerAssignment` → `DetectedScanner` by `usb_port` (canonical
   * stable-identity key per the scanning spec). Falls back to the composite
   * `(vendor_id, product_id, name, usb_bus, usb_device)` when `usb_port` is
   * empty (some Linux configurations).
   *
   * Why not match by `scanner_id`? Fresh-install placeholder scanners share
   * the empty-string sentinel `''` as `scanner_id`. `Array.find` on a shared
   * key returns the first match for every lookup, collapsing N scanners to 1
   * in the Save payload. See openspec/changes/fix-renderer-empty-scanner-id-
   * collision/proposal.md.
   */
  export function findDetectedForAssignment<
    D extends DetectedScannerLookupable,
  >(detected: D[], assignment: ScannerAssignmentLookupable): D | undefined {
    if (assignment.usbPort && assignment.usbPort.length > 0) {
      return detected.find((s) => s.usb_port === assignment.usbPort);
    }
    const key = compositeStableKeyFromAssignment(assignment);
    return detected.find((s) => compositeStableKey(s) === key);
  }

  /** Same matching logic as `findDetectedForAssignment`, returns array index or -1. */
  export function findIndexDetectedForAssignment<
    D extends DetectedScannerLookupable,
  >(detected: D[], assignment: ScannerAssignmentLookupable): number {
    if (assignment.usbPort && assignment.usbPort.length > 0) {
      return detected.findIndex((s) => s.usb_port === assignment.usbPort);
    }
    const key = compositeStableKeyFromAssignment(assignment);
    return detected.findIndex((s) => compositeStableKey(s) === key);
  }

  /**
   * Inverse direction: resolve `DetectedScanner` → `ScannerAssignment`.
   * Used by `useTestScan.ts` lines 87 and 196.
   */
  export function findAssignmentForDetected<
    A extends ScannerAssignmentLookupable,
  >(assignments: A[], detected: DetectedScannerLookupable): A | undefined {
    if (detected.usb_port && detected.usb_port.length > 0) {
      return assignments.find((a) => a.usbPort === detected.usb_port);
    }
    const key = compositeStableKey(detected);
    return assignments.find((a) => compositeStableKeyFromAssignment(a) === key);
  }
  ```

  Also locate the `ScannerPanelState` interface (in this same file, around line 267) and add `usbPort: string | null`. Update every object-literal constructor that currently omits it. Known constructor sites that will fail to compile until updated:
  - `src/renderer/graviscan/GraviScan.tsx:207-216` — initial scannerStates from detection (covered by task 2.15, populates from `detected?.usb_port ?? null`)
  - `src/renderer/hooks/useScanSession.ts:907-918` — `handleResetScanners` reset path; preserve the existing value: `usbPort: s.usbPort`

- [ ] 2.2 _(Skipped — the test files do not have `@ts-expect-error` directives. The directives were a planning artifact that turned out to be unneeded; vitest's tsc pass treats missing-export imports leniently in test files.)_
- [ ] 2.3 Re-run helper unit tests; expected: all pass:
  ```bash
  npm run test:unit -- tests/unit/graviscan-types.test.ts
  ```

### 2b. Forward-direction collision sites (assignment → detected)

- [ ] 2.4 Replace `src/renderer/hooks/useScannerConfig.ts:557` (auto-save effect). Import `findDetectedForAssignment` from `'../../types/graviscan'` and rewrite the `.map` from `find((s) => s.scanner_id === a.scannerId)` to `findDetectedForAssignment(detectedScanners, a)`.
- [ ] 2.5 In the same file, also ensure `buildAssignmentsFromDetection` populates the new shape (carries `usbPort`, `vendorId`, `productId`, `name`, `usbBus`, `usbDevice` into the assignment so the helper has the composite-fallback fields available downstream). This may already be partially in place — verify against the test added in 1.3.
- [ ] 2.6 Replace `src/renderer/graviscan/ScannerConfig.tsx:97` (manual save handler). Import the helper and rewrite the lookup.
- [ ] 2.7 Replace `src/renderer/hooks/useTestScan.ts:56` (forward direction). Import the helper and rewrite.
- [ ] 2.8 Replace `src/renderer/graviscan/GraviScan.tsx:202-204` (scannerStates init forward lookup). Import the helper and rewrite.
- [ ] 2.9 Replace `src/renderer/graviscan/GraviScan.tsx:305-310` (checkbox toggle, `findIndex` form). Use `findIndexDetectedForAssignment(scannerConfig.detectedScanners, { scannerId: scanner.scannerId, usbPort: scanner.usbPort })` — the panel state's new `usbPort` field is available here via 2.1's `ScannerPanelState` extension.
- [ ] 2.10 Replace `src/renderer/hooks/useScanSession.ts:747` (forward lookup, single site — proposal v1's "741, 746" was wrong). Import the helper and rewrite.

### 2c. Inverse-direction collision sites (detected → assignment)

- [ ] 2.11 Replace `src/renderer/hooks/useTestScan.ts:87` and `src/renderer/hooks/useTestScan.ts:196` with `findAssignmentForDetected(scannerAssignments, scanner)`.

### 2d. Same-direction collision sites (key both sides on usbPort)

- [ ] 2.12 Replace `src/renderer/graviscan/GraviScan.tsx:205` (`scannerStates.find((s) => s.scannerId === a.scannerId)`). Rewrite to match by `usbPort`: `scannerStates.find((s) => s.usbPort === a.usbPort)` — this works because both states now carry `usbPort`. (The composite fallback is not strictly needed here because both sides are already in the renderer's state shape, but for symmetry consider an inline helper that handles the empty-port case.)
- [ ] 2.13 Replace `src/renderer/graviscan/GraviScan.tsx:291-293` (`assignments.some((a) => a.scannerId === scanner.scannerId)`). Rewrite to `assignments.some((a) => a.usbPort === scanner.usbPort)`.
- [ ] 2.14 Replace `src/renderer/hooks/useScanSession.ts:742` (`scannerAssignments.find((a) => a.scannerId === scanner.scannerId)`). Rewrite to match by `usbPort`.
- [ ] 2.15 Update `GraviScan.tsx` `ScannerPanelState` constructor at lines 207-216 to include `usbPort: detected?.usb_port ?? null`.

### 2e. Secondary issues

- [ ] 2.16 Fix `src/renderer/hooks/useScannerConfig.ts:466` — change `handleScannerAssignment` predicate `scannerId ? ... : null` to `scannerId !== null ? ... : null` so placeholder `''` does not silently drop `usbPort` on re-check. **REPLACE** the inner `find((s) => s.scanner_id === scannerId)` with `detectedScanners[slotIndex]` (the function already takes `slotIndex` and the renderer's slot↔detected pairing is 1:1 by index). This is BOTH simpler than wrapping the helper around a synthetic assignment AND eliminates the collision-grep match without the helper. (Earlier task drafts said "rewrite via the helper" — that was wrong; the helper expects a `ScannerAssignmentLookupable` shape and the callsite only has a bare `scannerId: string`. Slot-index access is the correct fix.)
- [ ] 2.16b Fix `src/renderer/hooks/useScannerConfig.ts:730` — rewrite the `for` loop's inner `updatedAssignments[i].scannerId === cached.scanner_id` via the helper too (real-id-only at runtime, but rewrite so the collision-grep guard is fully clean).
- [ ] 2.17a **TYPE WIDENING (BLOCKING for 2.17).** In `src/renderer/hooks/useScannerConfig.ts:609-614`, widen the inline narrowed `savedScanners` type from `{id, usb_bus, usb_device, name}` to `{id, usb_bus, usb_device, name, usb_port: string | null}`. The main-process return shape (Prisma `GraviScanner`, defined in `src/types/graviscan.ts:102-114`) already includes `usb_port: string | null` — the renderer was just dropping it on the floor. Without this widening, task 2.17 cannot be implemented (the predicate would have nothing to match against).
- [ ] 2.17 Fix `src/renderer/hooks/useScannerConfig.ts:618-623` — auto-save id-remap predicate. Rewrite from `s.scanner_id === tempId || (s.usb_bus === saved.usb_bus && s.usb_device === saved.usb_device)` to match by `saved.usb_port` (with composite fallback for empty-port platforms). Use a small inline helper or call `findDetectedForAssignment` adapted to the `savedScanner` shape. Test A in 1.3 locks this behavior.
- [ ] 2.17b **Lift the in-flight save flag into `useScannerConfig` so manual save AND auto-save share a single source of truth.** Today the manual save's `savingRef` lives in `ScannerConfig.tsx:50`; the auto-save effect has no equivalent. Add `savingRef: React.MutableRefObject<boolean>` to `useScannerConfig`'s return and have BOTH paths consume it: the auto-save's 500ms timer callback early-returns if `savingRef.current` is true; the manual save's `handleSave` reads/writes the ref via the hook. Place near `uncheckedKeysRef` declaration; check at the start of the timer callback and set/unset around the `saveScannersToDB` call in BOTH the auto-save effect AND the manual save handler. **DELETE the local `savingRef` declaration in `ScannerConfig.tsx:50`** — the call site SHALL consume the hook-returned ref. (Without this lift, the manual save's re-detect fires while the auto-save's debounce is still ticking, racing the renderer-side id-remap step at lines 615-643 with a stale `assignedScanners` closure.)

  **Reset-during-save race guard.** `handleResetScannerConfig` (`useScannerConfig.ts:411-459`) clears state without consulting `savingRef` today. If reset fires while a save IPC is in flight, the IPC's success callback runs the id-remap step (`useScannerConfig.ts:615-643`) with stale closure values, re-populating just-cleared state. **Fix:** add a `resetGenerationRef: React.MutableRefObject<number>` (initialized to 0). `handleResetScannerConfig` increments it. Both the auto-save's IPC success handler AND the manual save's success handler capture `resetGenerationRef.current` BEFORE awaiting the IPC, and after `await`, check `if (resetGenerationRef.current !== captured) return;` to abandon the post-IPC state-mutation step entirely if a reset has fired in the meantime. Add unit tests:
  - **Test 2.17b-1**: auto-save effect skips when `savingRef.current === true`.
  - **Test 2.17b-2**: manual save → reset → IPC resolves; assert that `setDetectedScanners` and `setScannerAssignments` are NOT called by the post-IPC remap (the captured generation no longer matches).
  - **Test 2.17b-3**: in-flight auto-save → reset → IPC resolves; same assertion.
- [ ] 2.18 Fix `src/renderer/hooks/useScanSession.ts:207` — `isScannerEnabled` should return `false` for `scannerId === ''`. Change the predicate to `isDbScannerId(scannerId) && scannerAssignmentsRef.current.some((a) => a.scannerId === scannerId)`. Also expose `isScannerEnabled` from the hook's return at line 926-938 so unit tests can exercise it directly (per spec scenario "isScannerEnabled gates Start Scan on real DB ids only").
- [ ] 2.18b Gate `useTestScan.handleTestAllScanners` on `isDbScannerId` so Test Scan does not fire IPC with placeholder ids. Add early-return + log when no real-id assignments exist (parallel to Start Scan's gating). Spec scenario "isScannerEnabled gates Test Scan on real DB ids only".
- [ ] 2.19 Fix `src/renderer/graviscan/GraviScan.tsx:64-70` — `assignedScannerIds` filter `!== null` → `isDbScannerId(a.scannerId)` so empty-string ids never leak as Prisma FK candidates.
- [ ] 2.19b Fix the React duplicate-key warning at `src/renderer/graviscan/GraviScan.tsx:296`. Change `key={scanner.scannerId}` to `key={scanner.usbPort ?? \`slot-${idx}\`}`. This eliminates the React warning that surfaces when two `ScannerPanelState` entries share `scannerId === ''` (which happens for any fresh-install with N>1 placeholders that get rendered before Save).
- [ ] 2.20 Fix `src/renderer/graviscan/ScannerConfig.tsx:75-83` — diagnostic console log emitting `scanner_ids: ['', '']`. Replace with the per-assignment shape `assignments.map((a) => ({ scannerId: a.scannerId, usbPort: a.usbPort }))` so logs are readable.

### 2g. Main-process consistency (closes the missed `f1f4b3f` edit)

- [ ] 2.20a Fix `src/main/graviscan/scanner-handlers.ts:83-108` — `matchDetectedToDb` currently matches by `usb_bus + usb_device` first, falling back to `usb_port`. The `f1f4b3f` proposal explicitly stated this would be inverted to `usb_port`-primary, but only `saveScannersToDB` was actually changed; this function was missed. **New priority:** try `usb_port` first (skip when `saved.usb_port` is null), then fall back to composite `(vendor_id, product_id, name, usb_bus, usb_device)` (consistent with `saveScannersToDB`'s logic at lines 393-415). **Legacy `usb_port: null` rows MUST match via the composite path** — a row written before `usb_port` was populated (vendor_id, product_id, name set; usb_port null; usb_bus + usb_device populated) SHALL match a currently-detected scanner whose `(vendor_id, product_id, name, usb_bus, usb_device)` tuple matches. The composite must NOT include `usb_port` in its predicate (since the saved value is null and the detected value is non-null, they would never match on that field). Update the function's docstring to "match by usb_port primary, composite fallback (works for legacy null-port rows)". Add unit tests:
  - **Test 2.20a-1**: a saved scanner with stable `usb_port` but `usb_device` reassigned (the #182 scenario) matches by port.
  - **Test 2.20a-2 (legacy null-port)**: a saved scanner with `usb_port: null`, `usb_bus: 1`, `usb_device: 4`, `name: "Epson V850"` matches a detected scanner with the same `(vendor_id, product_id, name, usb_bus, usb_device)` tuple, even when the detected scanner now has a non-null `usb_port`.
  - **Test 2.20a-3 (legacy null-port + name mismatch)**: a saved scanner with `usb_port: null` AND `name: "Old Renamed Scanner"` (admin renamed via direct DB) does NOT match a detected scanner where `name: "Epson V850"`. This is correct behavior — the lab manager who renamed the row is signaling "this is a different conceptual device". Documented as a Non-Goal: legacy renames may break composite-fallback matching; recommend re-saving on next detection to populate `usb_port`.
- [ ] 2.20b Fix `src/main/lsusb-detection.ts:185-195` — currently deduplicates by `usb_port` but does NOT sort. Sort the deduplicated list by `usb_port` ascending using a **numeric-aware comparator**, NOT lexicographic. Lexicographic compare would order `'1-10'` before `'1-2'` (because `'1' < '2'` at index 2 makes `'1-10' < '1-2'`); numeric-aware compare preserves the operator's expectation that ports sort by their numeric segments. Implementation:
  ```ts
  function compareUsbPorts(a: string, b: string): number {
    const pa = a.split('-').map((n) => parseInt(n, 10));
    const pb = b.split('-').map((n) => parseInt(n, 10));
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const ai = pa[i] ?? 0;
      const bi = pb[i] ?? 0;
      if (Number.isNaN(ai) || Number.isNaN(bi)) {
        // fallback to lexicographic for non-numeric segments
        return a.localeCompare(b);
      }
      if (ai !== bi) return ai - bi;
    }
    return 0;
  }
  ```
  Add unit tests:
  - **Test 2.20b-1**: `compareUsbPorts('1-2', '1-10')` returns negative (1-2 sorts BEFORE 1-10).
  - **Test 2.20b-2**: a detection result with mixed-order `lsusb` output produces a sorted-by-`usb_port` array.
  - **Test 2.20b-3**: empty-port entries (`''`) and non-numeric entries (`'foo'`) sort consistently (don't crash; preserve a stable ordering).
- [ ] 2.20c Fix `src/main/graviscan/scan-coordinator.ts:304-342` — currently `sessionContext.scannerNames` is populated once at scan-start (`session-handlers.ts:202-212`) and frozen for the lifetime of the session. For long interval scans (e.g., 8-hour 12-cycle runs), a `display_name` rename mid-session is silently lost from cycles N>1's metadata.json. Refresh `scannerNames` per-cycle inside `scanOnce` by re-querying `db.graviScanner.findMany(...)` and rebuilding the map.

  **Required prerequisite — add the import.** Round-3 review confirmed `isDbScannerId` is exported from `src/types/graviscan.ts:400` but NOT currently imported in `scan-coordinator.ts` (line 22 imports only `PlateConfig, ScannerConfig`). Add `isDbScannerId` to the import list at line 22 BEFORE attempting the implementation, or the file will fail to compile.

  **Where the refresh runs (concrete code anchor).** The refresh SHALL run **once per cycle, BEFORE the metadata-write loop at line 310**, NOT inside the per-plate loop (which would N+1-query the DB). Insert the new code AFTER line 304 (the start of `scanOnce`'s metadata-write phase) and BEFORE line 310 (`for (const plate of platesToScan)`). Execute the Prisma query exactly once per `scanOnce` call.

  **CRITICAL: filter `scannerIds` via `isDbScannerId()` BEFORE the Prisma query** so placeholder `''` ids never reach `where: { id: { in: [...] } }` (a placeholder match would return zero rows AND leave `ctx.scannerNames.get('')` undefined → metadata.json would carry `"scanner_name": ""`). The implementation:
  ```ts
  const realIds = scannerIds.filter(isDbScannerId);
  const rows = await db.graviScanner.findMany({ where: { id: { in: realIds } } });
  const next = new Map<string, string>();
  for (const r of rows) next.set(r.id, r.display_name ?? r.name);
  // Atomic reassignment — closures elsewhere see the new map after this line:
  ctx.scannerNames = next;
  ```

  **Hard fallback at the metadata.json write path**: change `scan-coordinator.ts:320`'s `scanner_name: ctx.scannerNames.get(scannerId) || scannerId` to `scanner_name: ctx.scannerNames.get(scannerId) || (isDbScannerId(scannerId) ? scannerId : 'unknown-scanner')` so an empty `scannerId` never produces an empty `scanner_name` field in metadata.json. Add unit tests:
  - **Test 2.20c-1**: a `display_name` change between cycles 1 and 2 is reflected in cycle 2's metadata.json.
  - **Test 2.20c-2**: when `scannerIds` somehow contains `''` (defense-in-depth), the per-cycle Prisma query is called with the filtered list (no `''`) and metadata.json's `scanner_name` is `'unknown-scanner'`, never `''`.
  - **Test 2.20c-3**: the per-cycle Prisma query fires **exactly once per `scanOnce` call**, NOT once per plate (catches the N+1 mistake). Use `expect(db.graviScanner.findMany).toHaveBeenCalledTimes(1)` after a multi-plate scanOnce.

### 2f. Gate

- [ ] 2.21 Run the unit suite:
  ```bash
  npm run test:unit
  ```
  Expected: all green, including the collision-grep meta-test (1.5), which proves the spec invariant is enforced.
- [ ] 2.22 Run TypeScript and lint gates:
  ```bash
  npx tsc --noEmit
  npm run lint
  npm run format:check
  ```
  Expected: all green.

## 3. Verification

- [ ] 3.1 Run the smoke spec to confirm renderer pages still render real content:
  ```bash
  npm run test:e2e:smoke
  ```
  Expected: passes; PNGs land in `tests/e2e/screenshots/`.
- [ ] 3.2 **Parent visual verification.** This is a renderer-touching change; the parent (not a subagent) MUST `Read` at minimum:
  - `tests/e2e/screenshots/cylinder-home.png`
  - `tests/e2e/screenshots/graviscan-scanner-config.png`
  - `tests/e2e/screenshots/graviscan-graviscan.png`

  to confirm the pages render real content. Do not skip — the entire renderer-visual-verification guardrail exists for this case.

- [ ] 3.3 Run the canary E2E that proves the bug is fixed:
  ```bash
  npm run test:e2e -- tests/e2e/graviscan-scanner-config-save.e2e.ts
  ```
  Expected: passes (the `expect(scannerCount).toBeGreaterThanOrEqual(2)` assertion at line 203 now holds).
- [ ] 3.4 Run the integration suite to surface any IPC payload-shape regressions:
  ```bash
  npm run test:integration
  ```
  Expected: passes; pay attention to scanner-config-save and test-scan integration tests.
- [ ] 3.5 Run the Python suite (sanity, no Python changes expected):
  ```bash
  npm run test:python
  ```
  Expected: passes.
- [ ] 3.6 Run the OpenSpec validator on this change:
  ```bash
  openspec validate fix-renderer-empty-scanner-id-collision --strict
  ```
  Expected: clean.
- [ ] 3.7 Dispatch the `openspec-review` subagent team against this proposal one more time before declaring done; address any remaining BLOCKING findings.
- [ ] 3.8 Commit with a message that references the bug and the spec scenario:

  ```
  fix(graviscan): match assignment↔detected by usb_port (placeholder-id collision)

  Spec: openspec/changes/fix-renderer-empty-scanner-id-collision
  Closes the Array.find collision exposed by 3689c6b's empty-string sentinel
  across 11 renderer call sites + 5 secondary issues. Adds machine-checkable
  spec invariant via tests/unit/graviscan-collision-grep.test.ts.

  Related: #167, #199, #201, #203
  ```

- [ ] 3.9 Push and confirm CI is green on Linux/macOS/Windows. If a platform job fails, do not move on. The previously-failing assertion at `tests/e2e/graviscan-scanner-config-save.e2e.ts:203` MUST turn green on all three platforms.
- [ ] 3.10 Update PR #196 description to reference this change as one more spec proposal stacked on the branch (auto-close issues stay attached to the parent PR; this is a renderer correctness fix, not a feature addition).
