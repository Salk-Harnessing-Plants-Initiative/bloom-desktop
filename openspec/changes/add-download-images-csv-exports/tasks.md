# Tasks: Add plates.csv/sections.csv exports + Downloads-folder default

TDD: write the test FIRST, watch it fail, then write the minimum code to make
it pass.

## 1. plates.csv / sections.csv

- [x] 1.1 Write failing tests in `tests/unit/graviscan/image-handlers.test.ts`
      (new cases in the `downloadImages` describe block):
  - does not write `plates.csv`/`sections.csv` when the experiment has no
    plate accessions (only `metadata.csv` is written).
  - writes `plates.csv` with one row per plate accession and `sections.csv`
    with one row per section mapping, with the exact confirmed headers and
    correctly-escaped free-text fields (comma-containing `custom_note`).
  - writes `plates.csv` but not `sections.csv` when a plate has no sections.
- [x] 1.2 Add `sections: true` to the `graviPlateAccessions` include in
      `downloadImages()`'s `graviScan.findMany()` query.
- [x] 1.3 Add `platesHeader`/`sectionsHeader` constants and build
      `platesRows`/`sectionsRows` per wave from the wave's plate accessions
      (same source `scan.experiment.accession?.graviPlateAccessions` already
      used for `metadata.csv`'s accession lookup), reusing `csvEscape()` with
      `String(...)`/`?? ''` wrapping for numeric/nullable fields.
- [x] 1.4 Write `plates.csv`/`sections.csv` only when their row arrays have
      more than the header row (`length > 1`).
- [x] 1.5 Confirm 1.1's tests pass.

## 2. Target-directory contract

- [x] 2.1 Write failing tests: `downloadImages()` defaults to
      `app.getPath('downloads')` when `targetDir` is omitted; an explicit
      `targetDir` is used as-is without consulting `app.getPath('downloads')`.
- [x] 2.2 Make `targetDir` optional in `downloadImages()`'s params type;
      resolve it to `params.targetDir ?? app.getPath('downloads')` at the top
      of the function body.
- [x] 2.3 Confirm 2.1's tests pass.

## 3. Verification

- [x] 3.1 `npx vitest run tests/unit/graviscan/image-handlers.test.ts` passes.
- [x] 3.2 `npx vitest run tests/unit/graviscan/` passes except the two
      pre-existing, unrelated Windows path-separator failures
      (`register-handlers.test.ts` "allows paths within output directory",
      `scan-coordinator.test.ts` "regex path rewriting only affects filename,
      not directory") — confirmed failing identically on the base commit
      before this change.
- [x] 3.3 `npx tsc --noEmit` — confirm no new errors versus the base commit
      (one pre-existing unrelated error in `graviscan-upload.ts:278` remains).
- [x] 3.4 `npx prettier --check` passes on all touched files.
- [x] 3.5 `openspec validate add-download-images-csv-exports --strict`
      passes.
- [x] 3.6 `npx eslint --resolve-plugins-relative-to . <touched files>` is
      clean (workaround for this worktree's known `eslint-plugin-import`
      duplicate-resolution conflict with `npm run lint`).
