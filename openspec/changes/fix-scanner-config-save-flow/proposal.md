## Why

The Scanner Configuration page's Save button silently writes **zero scanners** to the database, even when mock scanners are detected and their "Enabled" checkboxes are shown as checked. This produces Prisma FK constraint errors on the downstream Metadata page (no `GraviScanner` rows exist for plate assignments to reference) and leaves no way for the user to complete the GraviScan workflow.

Round 3 adversarial review surfaced additional defects that were silently present on the pilot branch and carried into our port: the metadata.json `scanner_name` field falls back to the DB UUID rather than a human-readable name (breaking reproducibility), the renderer and main-process use conflicting primary keys for scanner identity (silent DB row corruption risk on USB reconnect), unchecked scanners are never marked disabled in the DB (UI/DB divergence), and the renderer's unchecked-state memory would be wiped by any dev reload (broken persistence guarantee). This proposal takes the **complete fix** approach — every defect identified across Rounds 1–3 is addressed in this PR rather than deferred.

Root cause of the silent save: Two independent code paths filter `scannersToSave` by `scannerAssignments` — a hook-level state array that starts with `scannerId: null` and is never populated on a fresh install. The filter yields an empty array and both paths silently write nothing. The "Enabled" checkbox writes to a separate `scannerStates` array that is also never populated on this page, so it has no functional effect. No user-visible feedback indicates the silent no-op.

Root cause of the weak test that let it ship: `tests/unit/pages/ScannerConfig.test.tsx` line 146 used bare `expect(fn).toHaveBeenCalled()` without asserting arguments. A lint rule to prevent this regression is tracked as **#200**.

## What Changes

### Bug fix — Scanner Config save flow

- **Populate `scannerAssignments` on detection.** Adopt the existing `ScannerAssignment` / `DEFAULT_SCANNER_SLOTS` model as the single source of truth. When `detectScanners` returns N scanners, create N assignments with `scannerId` set. "Enabled" becomes `scannerId !== null`; unchecking sets to `null`. This eliminates three overlapping state shapes (`scannerAssignments` / `scannerStates` / the earlier proposed `enabledMap`) and fixes downstream consumers (`GraviScan.tsx`, `useScanSession`, `useTestScan`, `usePlateAssignments`) that all read `scannerAssignments`.
- **Fix auto-save effect in `useScannerConfig.ts`** (lines 477-559) that has the same filter bug. Without this fix, a user changes resolution after a successful manual save and the auto-save silently overwrites with zero scanners.
- **Fix grid-mode source of truth.** Both manual save and auto-save read `grid_mode` from `scannerAssignments.find(a => a.scannerId !== null)` — which is `null` on fresh installs, so `'2grid'` fallback always wins. A user who selects 4-Grid then clicks Save currently saves `'2grid'`.
- **Add explicit re-entrancy guard** on `handleSave` so rapid double-clicks don't produce duplicate round-trips. (Note: the underlying handler already upserts by `(usb_bus, usb_device)` then `usb_port`, so duplicate DB rows are not the concern — the guard is UX-level: avoid double spinner, double detect, and double banners.)
- **Add save feedback UI** — green banner on success (references scanner count + config params), red banner on failure (with error message). Tailwind classes `bg-green-50` and `bg-red-50` match the project convention (see `CaptureScan.tsx`).
- **Define partial-failure behavior.** If `saveConfig` succeeds but `saveScannersToDB` fails, the page SHALL surface both outcomes and re-arm Save so the user can retry. No silent inconsistent state.
- **Reject empty payload on main side.** `saveScannersToDB` handler returns `{ success: false, error: 'no scanners to save' }` for an empty array — defense-in-depth symmetry with the new zero-enabled-scanners gate in the renderer.
- **Default `display_name` to `scanner.name`** (the DetectedScanner name) in the renderer payload, so future admin UI can override it without dropping the default. The main-process upsert's `?? existing.display_name` fallback is preserved by having the renderer pass `undefined` when the user has not explicitly overridden.

### Bug fix — Stable scanner identity (addresses #182, part 1)

- **Use `usb_port` as the renderer-side stable-identity key** for the persisted "user unchecked this scanner" memory. `usb_bus`+`usb_device` are NOT stable (#182: OS reassigns `usb_device` on reconnect). `usb_port` is stable across replug on the same physical port.
- **Fallback hierarchy when `usb_port` is missing**: `${vendor_id}:${product_id}:${name}:${usb_bus}:${usb_device}` — full composite avoids collisions between identical-model scanners on the same hub, which matters for labs running multiple scanners of the same Epson model.
- **Empty-string, not null.** `DetectedScanner.usb_port` is typed as non-nullable `string` and is set to `''` (empty) when platform info is missing (`src/main/lsusb-detection.ts:171`). The fallback predicate is `!usb_port`, not `usb_port === null`.
- **Persist the unchecked map to `localStorage`** under the existing `STORAGE_KEYS` scheme in `useScannerConfig.ts`. Survives page reload / HMR / navigation-away-and-back. A pure in-memory or module-level Map would be wiped by Electron dev-mode reloads, breaking the spec's unchecked-state-persistence guarantee in practice.
- **Align main-process matching with the renderer.** `matchDetectedToDb` in `src/main/graviscan/scanner-handlers.ts` currently matches by `usb_bus`+`usb_device` FIRST, then `usb_port`. Invert the order — `usb_port` primary, composite fallback, no `usb_bus`+`usb_device` primary. This closes a silent DB corruption window where a new scanner's bus+device pair coincidentally matches a stale row from another physical scanner (a previously-removed scanner's bus+device can be reassigned).

### Bug fix — Metadata traceability (addresses scientific-rigor gap)

- **Populate `scanner_name` in metadata.json with the human-readable name.** Today `session-handlers.ts:196` sets `scannerNames.set(s.scannerId, s.scannerId)` — so the metadata.json writes the scanner UUID. Replace with a DB lookup: `display_name ?? name ?? scanner_id`. A scientist auditing an archived scan in year N should see `"Epson Perfection V850"` or an admin-chosen `"Scanner on Bench 3"`, not `"f3b8c2a4-1d2e-4a9b-..."`. This is a direct reproducibility fix.
- **Preserve existing `display_name` on subsequent saves.** The renderer passes `display_name: undefined` when the user has not explicitly overridden, so the main-process upsert's `?? existing.display_name` fallback is reachable. Without this, re-save would clobber admin-chosen names with the current auto-detected `scanner.name`.

### Bug fix — DB/UI consistency when unchecking scanners

- **Propagate unchecked state to the DB as `enabled = false`.** Today `saveScannersToDB` is upsert-only; a scanner the user unchecks stays `enabled: true` in `GraviScanner`. Downstream consumers (Metadata page, BrowseGraviScans) render a disabled-in-UI scanner as still active — silent UI/DB divergence.
- **New IPC handler: `disableMissingScanners`.** Invoked by the renderer during `handleSave`. Takes the list of enabled-scanner USB identifiers and sets `enabled = false` on every `GraviScanner` row NOT in that list. Uses `usb_port` primary key match; falls back to composite. Does NOT delete — rows are retained so historical `GraviScan` records keep their FK. This is the safe form of "the user unchecked it."
- **Renderer calls `disableMissingScanners` in `handleSave`** after `saveScannersToDB` succeeds and before the follow-up `detectScanners`. Result rolls into the save success banner.

### Test strengthening (addresses #199 inline)

- Replace the weak `"Save button calls saveConfig and saveScannersToDB"` test (which used bare `toHaveBeenCalled()`) with assertions on call payload (non-empty array, exact field shape, count matches enabled scanners, uncheck-then-save excludes).
- Add scenarios for: zero-enabled-scanners (Save disabled), re-detect preserving unchecked state, USB reconnect preserving unchecked state, partial-failure UI + DB state, double-click guard + release after success, `disableMissingScanners` sets `enabled=false` on omitted rows, metadata.json `scanner_name` uses `display_name` not UUID.
- Add E2E test `tests/e2e/graviscan-scanner-config-save.e2e.ts` that clicks Save and asserts `GraviScanner` table has the expected row count AND `usb_port` is non-null AND `enabled` column reflects UI state, all via the test DB. Closes the "unit tests missed this" loop.

### **BREAKING** — hook API removal

- **BREAKING:** Remove `handleToggleScannerEnabled` from `useScannerConfig`'s return. The checkbox wired to it was on the ScannerConfig page, where it wrote to a never-populated `scannerStates` and had no functional effect. Tests and mocks referencing it must be updated.
- **BREAKING:** Remove `scannerStates` and `setScannerStates` from `UseScannerConfigParams`. The hook no longer reads or writes scan-runtime state; that state stays scoped to `GraviScan.tsx` for its legitimate use (status / progress / lastError tracking during scans). Hook signature changes — all call sites drop these props.
- **BREAKING (internal):** Remove the `enabled: boolean` field from `ScannerPanelState` in `src/types/graviscan.ts`. The field was used in two distinct senses that drifted out of sync: (1) "user wants this scanner included" — now derived from `scannerAssignments[i].scannerId !== null`; (2) UI checkbox state — now bound directly to the same assignment lookup. No field, no drift. Concrete surface area in `useScanSession.ts`: 9 reads of `s.enabled` (lines 205, 297, 339, 464, 674, 694, 833, 854, 879) and 2 writes (line 562 `enabled: true`, line 898 `enabled: s.enabled`) — total 11 occurrences. Plus 2 reads in `ScanControlSection.tsx` (lines 183, 189), 1 read + 1 write in `GraviScan.tsx` (lines 289, 203), and 1 read in `ScannerConfig.tsx` (line 189). All become `scannerAssignments`-keyed lookups, except the writes which simply omit the field from the new object literal.
- **Coordination with open issue #159**: #159 is about the Start Scan readiness gate reading `scannerStates.some(s => s.enabled)`. After this PR, #159's fix-site becomes `scannerAssignments.some(a => a.scannerId !== null)`. Noted on #159 as part of this PR's description.
- **Note:** `GraviScanner.enabled` (the DB column in `prisma/schema.prisma`) is UNCHANGED. Only the renderer-side `ScannerPanelState.enabled` is removed. The DB column now carries its true semantic: "this scanner is included in the current configuration." `disableMissingScanners` writes to it; reads from `GraviScanner.enabled` still filter correctly.

### Prop threading — `ScanControlSection`

- `ScanControlSection.tsx` currently duplicates `ScannerPanelState`'s structural type inline in its props. Add `scannerAssignments: ScannerAssignment[]` to the props interface, thread it from `GraviScan.tsx`'s render, and update the two `s.enabled` reads to `scannerAssignments.find(a => a.scannerId === s.scannerId)?.scannerId != null`. Remove `enabled: boolean` from the inline prop type.

### Follow-up issues to file

- **Issue #201:** "GraviScan orphan-row diagnostic for dev DBs" — script to detect `GraviScan` rows whose `scanner_id` doesn't match any `GraviScanner.id`, with remediation options (delete orphans vs. create phantom GraviScanner rows from metadata.json). Deferred because it's a one-off dev-DB remediation, not a product feature. Re-open when: any user reports FK constraint errors after this PR ships.
- **Issue #202:** "Metadata page should read scanners from `GraviScanner` table, not re-run detection". Currently `Metadata.tsx:61` calls `detectScanners()` to learn which scanner IDs exist — this couples metadata to physical scanner connectivity. Scanners saved to DB but temporarily disconnected disappear from the metadata page. Deferred because fixing it requires a new `db:graviscans:listScanners` IPC handler and a UI decision about rendering disconnected saved scanners. Re-open when: a user reports "my configured scanner disappeared from the Metadata page after unplugging" OR after this PR's `disableMissingScanners` introduces observable "disabled scanners" state that should be surfaced in the UI.
- **Existing issue #167** ("auto-cleanup duplicate scanner records") already proposes the DB-level `@@unique(usb_port)` constraint. NOT filing a new issue for that — instead, a comment is added to #167 noting that this PR lands `usb_port` as renderer+main primary-key, which makes the `@@unique` migration safe to add in a future PR.

## Impact

- Affected specs: `scanning` (MODIFIED `GraviScan Scanner Configuration Page` requirement — stacked on `add-graviscan-renderer-pages` proposal which first introduces the requirement)
- Affected code:
  - MODIFIED: `src/renderer/graviscan/ScannerConfig.tsx` (save flow, remove `scannerStates`, banner, re-entrancy guard, call `disableMissingScanners`)
  - MODIFIED: `src/renderer/hooks/useScannerConfig.ts` (populate assignments on detection, fix auto-save filter, fix grid-mode source, remove `handleToggleScannerEnabled` + `scannerStates` param, persist `enabledMap` to localStorage)
  - MODIFIED: `src/renderer/hooks/useScanSession.ts` (replace 11 `s.enabled` readers with `scannerAssignments` lookups; stop writing `enabled` in 10 `setScannerStates` calls)
  - MODIFIED: `src/renderer/graviscan/GraviScan.tsx` (remove `enabled: true` initializer on line 203, remove `scannerStates.enabled` read on line 289, thread `scannerAssignments` into `ScanControlSection`)
  - MODIFIED: `src/components/graviscan/ScanControlSection.tsx` (add `scannerAssignments` prop, remove `enabled` from inline prop type, replace 2 `s.enabled` reads)
  - MODIFIED: `src/main/graviscan/scanner-handlers.ts` (reject empty array on `saveScannersToDB`; invert `matchDetectedToDb` to `usb_port` primary; add `disableMissingScanners` handler)
  - MODIFIED: `src/main/graviscan/register-handlers.ts` (register the new `disableMissingScanners` IPC handler alongside existing graviscan handlers)
  - MODIFIED: `src/main/graviscan/session-handlers.ts` (line 196: resolve `scannerNames` from DB via `display_name ?? name ?? scanner_id` instead of UUID fallback)
  - MODIFIED: `src/main/preload.ts` (expose `disableMissingScanners` in the `gravi` namespace)
  - MODIFIED: `src/types/graviscan.ts` (remove `enabled: boolean` from `ScannerPanelState`; `GraviScanner` DB type UNCHANGED)
  - MODIFIED: `tests/unit/pages/ScannerConfig.test.tsx` (strengthened assertions + new scenarios, update mock fixture to length-2 assignments, drop `handleToggleScannerEnabled` mock)
  - MODIFIED: `tests/unit/hooks/useScannerConfig.test.ts` (auto-save payload assertions, USB reconnect scenario, localStorage persistence assertion)
  - MODIFIED: `tests/unit/hooks/useScanSession.test.ts` (remove `enabled` from `makeScannerState` helper line 37; rewrite line 521 test to drive readiness via `scannerAssignments` instead of `{ enabled: false }`)
  - MODIFIED: `tests/unit/pages/GraviScan.test.tsx` (drop `handleToggleScannerEnabled` mock)
  - MODIFIED: `tests/unit/graviscan/scanner-handlers.test.ts` (empty-array rejection, `disableMissingScanners` behavior, `matchDetectedToDb` inverted priority)
  - NEW: `tests/unit/graviscan/session-handlers-metadata.test.ts` (assert `scanner_name` populated from DB `display_name`, falls back to `name`)
  - NEW: `tests/e2e/graviscan-scanner-config-save.e2e.ts` (end-to-end save → DB row count + `usb_port` non-null + `enabled` reflects UI)
- Fixes: bug surfaced during local smoke testing of PR #196
- Related issues: **#159** (Start Scan readiness — fix-site shifts), **#167** (auto-cleanup duplicate scanner records — `@@unique` migration becomes safe after this PR), **#182** (usb_device instability — addressed renderer+main side), **#199** (placeholder-test audit — addressed inline for this file; lint rule tracked in #200), **#200** (lint rule for bare `toHaveBeenCalled` — to prevent regression)

## Non-Goals

- Redesigning `ScannerAssignment` / slot mental model — re-use the existing shape
- Auditing non-Scanner-Config tests for placeholder patterns beyond the files touched here (tracked in #199; enforcement via lint tracked in #200)
- Adding admin UI to rename `display_name` — out of scope; default it to `scanner.name` with preservation on re-save
- Rollback semantics beyond "re-arm Save" — no DB transaction wrapping `saveConfig` + `saveScannersToDB` + `disableMissingScanners`. Partial failure leaves the user with a clear error banner and retry; no silent inconsistent state from this proposal's perspective.
- **Adding a DB-level `@@unique` constraint on `GraviScanner`**. Tracked in #167. Re-open when: user data migrations are in place (orphan rows cleaned up via Issue A) AND Prisma migration tooling is standardized for the project. This PR makes the constraint-safe by aligning both renderer and main-process on `usb_port` as the primary identity.
- **Fixing `Metadata.tsx` to read scanners from the `GraviScanner` table**. Tracked in Issue B (target #202). Re-open when: a user reports a disconnected-saved-scanner visibility bug on the Metadata page OR when the product surfaces "disabled scanners" as a first-class concept.
- **Filing an orphan-row diagnostic script**. Tracked in Issue A (target #201). Re-open when: any user reports FK constraint errors after this PR ships.
