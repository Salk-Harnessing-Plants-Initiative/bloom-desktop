**Commit-boundary note**: commit only after a numbered section's final subtask is checked off (e.g. after 1.7, not after 1.1–1.6) — earlier subtasks are intentionally red by TDD design. Do not commit mid-section.

## 1. GraviMetadataList: loading/error/empty states (closes #352, part 1; includes a same-file `handleExpand` gap found in review)

- [x] 1.1 Write tests in `tests/unit/components/GraviMetadataList.test.tsx` (existing `it` blocks and `makeFile()` helper must keep passing unchanged):
  - a loading message renders while the initial `listFiles()` call is pending (before it resolves)
  - when `listFiles()` resolves `{ success: false, error }`, the error text renders and no empty-state message appears
  - when `listFiles()` resolves `{ success: false }` with no `error` field, a default fallback message (e.g. `'Failed to load metadata files'`) renders instead of blank text
  - when `listFiles()` resolves `{ success: true, data: [] }`, an empty-state message ("No GraviScan metadata uploaded yet") renders
- [x] 1.2 Run the new tests and confirm they fail (no `isLoading`/`error` state exists yet).
- [x] 1.3 Implement in `GraviMetadataList.tsx`: add `isLoading`/`error` state around `fetchFiles()` (set `isLoading` true before the call, false in a `finally`; set `error` from `result.error ?? 'Failed to load metadata files'` when `result.success` is false, matching the existing `deleteError` fallback convention at `GraviMetadataList.tsx:77`; clear `error` on a successful fetch). Branch the render with conditionals inside the existing top-level card (do not early-return in a way that unmounts the card itself — the existing 5 tests already `waitFor` list content and must keep working unchanged): loading message (`text-sm text-gray-500`) while `isLoading`; error inline (`text-sm text-red-600 mb-2`, matching the existing `deleteError` convention) when `error` is set; empty-state message (`text-sm text-gray-500`) when `files.length === 0` after a successful, non-loading fetch. Note: this loading state also applies to the remount triggered by `key={refreshKey}` in `Metadata.tsx` after a successful upload, not just first mount — no special-casing needed.
- [x] 1.4 Run the tests from 1.1 and confirm they now pass, and the full existing test file still passes.
- [x] 1.5 Write a test in `tests/unit/components/GraviMetadataList.test.tsx` for the `handleExpand` gap: when expanding a file whose `graviPlateAccessions.list(fileId)` call resolves `{ success: false, error }` (or with no `error` field), the error renders inline (with the same fallback-message convention as 1.3) and no empty plate/section table appears in its place.
- [x] 1.6 Implement: add error handling to `handleExpand` mirroring 1.3's pattern, and run the test from 1.5 to confirm it passes.
- [x] 1.7 Update `tests/unit/pages/Metadata.test.tsx`'s composition assertion (currently checks `container.querySelector('ul')` synchronously right after mount) to `waitFor` `GraviMetadataList` settling into its resolved state before asserting. Note: a `waitFor` alone is not sufficient — this test's mock resolves `listFiles()` to an empty list, and after 1.3's empty-state implementation an empty list renders the "No GraviScan metadata uploaded yet" message, not a `<ul>` (the `<ul>` only renders when `files.length > 0`), so the assertion itself must change to check for the resolved empty-state text rather than a `<ul>` element. Run the full test file to confirm it passes. Then run `npm run test:unit` (full suite) to confirm no other test relies on `GraviMetadataList`'s prior synchronous-render behavior.

## 2. GraviMetadataList: table column headers (closes #352, part 2)

- [x] 2.1 Write a test in `tests/unit/components/GraviMetadataList.test.tsx` asserting the expanded plate/section table renders a header row with the 7 expected column labels, in order: Plate ID, Accession, Transplant Date, Custom Note, Section, Plant QR, Medium.
- [x] 2.2 Run the test and confirm it fails (no `<thead>` exists yet).
- [x] 2.3 Implement: add a `<thead>` row with those 7 `<th>` cells above the existing `<tbody>`, matching the existing `<td className="px-3 py-2">` styling convention.
- [x] 2.4 Run the test from 2.1 and confirm it passes, then run `npm run test:unit` (full suite) to confirm no regressions.

## 3. GraviMetadataUpload: block colliding column mappings (closes #353)

- [ ] 3.1 Write tests extending the existing `describe('pre-submit metadata validation (closes #207, #313)', ...)` block in `tests/unit/components/GraviMetadataUpload.test.tsx` (reuse existing `buildWorkbookFile`/`getFileInput` helpers and mocks, don't duplicate them):
  - mapping two different fields to the same column blocks submission with an `<li>`-scoped error naming both fields and the column, and `createWithSections` is not called
  - mapping the optional Custom Note field to the same column as a required field (e.g. Medium) is caught the same way as two required fields colliding — the check must cover all of `ALL_FIELDS`, not just `REQUIRED_FIELDS`
  - mapping three fields to the same column produces exactly one `<li>` error naming all three fields and the column — not three separate pairwise messages
  - two independent collisions (e.g. fields A/B sharing one column and fields C/D sharing a different column) each produce their own `<li>` error
  - a mapping that collides AND would also fail the existing partial-row check shows only the collision error, not a mix of collision and partial-row messages — proves the collision check actually short-circuits before the later checks
  - a mapping where several fields are left entirely unmapped (never touched, not explicitly set to `''`) does not falsely report those fields as colliding with each other — this must continue to pass alongside the existing test `'surfaces an error instead of a false "Done uploading!" when no column headers auto-map'`, which exercises exactly this case today
  - a mapping where every field maps to a distinct column (or is left unmapped) still passes through to `createWithSections` as before
- [ ] 3.2 Run the new tests and confirm they fail (no collision check exists yet).
- [ ] 3.3 Implement in `GraviMetadataUpload.tsx`'s `handleImport()`: before the existing partial-row check, iterate `ALL_FIELDS` (required and optional — not just `REQUIRED_FIELDS`). For each field, first normalize its mapping value with `mapping[field] ?? ''` (this collapses both an untouched/`undefined` entry and an explicitly-cleared `''` entry to the same empty string), then **explicitly filter out** any field whose normalized value is `''` before grouping the remaining fields by column index — normalizing and excluding are two separate steps; skipping the filter step would let every untouched/cleared field collide with every other one in a phantom `''` bucket. For each column index claimed by more than one (non-excluded) field, push one error naming every colliding field and that column's position (e.g. 1-based index or column letter) alongside its header text if present (e.g. `"Medium and Custom Note are both mapped to the same column (column 4, header 'Notes') — choose a different column for each."`); if any such errors exist, `setRowErrors(errors)` and return before running the partial-row check or `validateGraviMetadata`.
- [ ] 3.4 Run the tests from 3.1 and confirm they pass, and the full existing test file (including the pre-existing 4 validation cases and the no-auto-map case) still passes. Then run `npm run test:unit` (full suite) to confirm no regressions.

## 4. Spec sync and verification

- [ ] 4.1 Run `npx openspec validate fix-gravi-metadata-ux-gaps --strict` and resolve any issues.
- [ ] 4.2 Run `npm run lint`, `npm run format:check` (or `./node_modules/.bin/prettier --check`), and `npx tsc --noEmit` across the two changed component files and their test files — `tsc --noEmit` is a required CI gate (`.github/workflows/pr-checks.yml`'s "Compile TypeScript" job) that isn't otherwise exercised until CI without this step.
- [ ] 4.3 Run `npm run test:unit` and confirm the full unit suite passes, not just the two touched files.
- [ ] 4.4 Manually verify both fixes against the running app (Metadata page, graviscan mode): a slow/failed fetch shows loading/error, an empty list shows the empty-state message, a failed expand shows an inline error, the expanded table shows headers, and attempting a colliding column mapping (including a 3-way collision) is blocked with the expected message.
