## Why

Tier 5's post-merge manual walkthrough (PR #290, 2026-08-31) found two gaps in the GraviScan Metadata page (`/metadata`) that were filed as follow-ups rather than fixed in that PR, and are both still present on `main` as of 2026-09-01:

- **#352**: `GraviMetadataList.tsx` has no loading state, no error state, and no empty-state message. A failed `listFiles()` fetch fails silently (the operator sees a blank card indistinguishable from "no files exist") — this is not just a style gap: an operator who mistakes a failed fetch for "no metadata uploaded yet" has a plausible reason to re-upload the same file, risking a duplicate metadata record. The expanded plate/section detail table also has no column headers at all. Every other list screen from the same PR (`BrowseGraviScans.tsx`, `ExperimentDetail.tsx`) already has the loading/error/empty treatment; this component was only in scope for chevron/styling in that PR.
- **#353**: `GraviMetadataUpload.tsx`'s column-mapping dropdowns are fully independent — nothing stops two different fields (e.g. Medium and Custom Note) from being mapped to the same spreadsheet column. Existing validation checks the parsed _rows_, not the _mapping_ that produced them, so a same-column mapping between two non-identity fields can silently corrupt per-row data with no error surfaced anywhere.

## What Changes

- `GraviMetadataList.tsx`: add `isLoading`/`error` state around the `listFiles()` call; render a loading message while fetching, the error inline on failure (with a fallback message if the IPC result has no `error` string), and an empty-state message when the list is empty after a successful fetch.
- `GraviMetadataList.tsx`: add the same error handling to the per-file expand fetch (`graviPlateAccessions.list(fileId)`), which has the identical silent-failure gap as the top-level `listFiles()` call — found during review, same file, same root cause as #352.
- `GraviMetadataList.tsx`: add a `<thead>` header row (Plate ID / Accession / Transplant Date / Custom Note / Section / Plant QR / Medium) to the expanded plate/section detail table.
- `GraviMetadataUpload.tsx`: in `handleImport()`, before any row-level validation, check that the current column mapping has no two fields pointing at the same spreadsheet column (correctly excluding both unmapped `''` and never-touched `undefined` entries); block submission with an error naming every colliding field and disambiguating the shared column by position (not just header text, which can be blank or duplicated in real spreadsheets).

## Impact

- Affected specs: `ui-management-pages` (`GraviScan Metadata List`, `GraviScan Metadata Upload` requirements — both MODIFIED)
- Affected code: `src/renderer/components/GraviMetadataList.tsx`, `src/renderer/components/GraviMetadataUpload.tsx`
- Affected tests: `tests/unit/components/GraviMetadataList.test.tsx`, `tests/unit/components/GraviMetadataUpload.test.tsx`, `tests/unit/pages/Metadata.test.tsx` (its composition assertion currently checks for a rendered `<ul>` synchronously after mount, before `GraviMetadataList`'s new loading state resolves — needs to await settling)
- Closes: #352, #353
