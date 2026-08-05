## 1. Delete completion — metadata.json sync

- [ ] 1.1 In a new test file (or extending existing coverage) for
      `scan-metadata-json.ts`, write failing tests for `markMetadataDeleted(outputDir)`:
      reads an existing `metadata.json`, adds `deleted: true`, writes it back
      atomically (`.tmp` + rename), preserves all other fields unchanged.
- [ ] 1.2 Add `deleted?: boolean` to the `ScanMetadataJson` interface and
      implement `markMetadataDeleted()` in `scan-metadata-json.ts`, reusing
      the existing atomic-write helper pattern from `writeMetadataJson()`.
      Confirm 1.1's tests pass.
- [ ] 1.3 Write a failing unit test for `db:scans:delete`
      (`database-handlers.ts`) asserting it calls `markMetadataDeleted()`
      with the correct resolved path (`path.join(scansDir, scan.path,
      'metadata.json')`) after the Prisma soft-delete succeeds.
- [ ] 1.4 Write a failing unit test for the missing-file case: `db:scans:delete`
      still returns `{ success: true }` and logs a warning when
      `metadata.json` doesn't exist on disk.
- [ ] 1.5 Update `db:scans:delete` to call `markMetadataDeleted()` per 1.3/1.4.
      Reuse the `scansDir` resolution already used in `image-uploader.ts`
      (extract to a shared helper if that avoids duplicating the
      `loadEnvConfig` call, otherwise inline consistently).
- [ ] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check
      gate before moving to UI work.

## 2. Delete completion — shared modal + ScanPreview affordance

- [ ] 2.1 Write a failing component test for a new `DeleteConfirmModal`
      component: renders Plant ID + capture date, Cancel/Delete buttons,
      calls the provided `onConfirm`/`onCancel` callbacks.
- [ ] 2.2 Implement `DeleteConfirmModal` (location: confirm during
      implementation — likely `src/renderer/components/`).
- [ ] 2.3 Write a failing test asserting `BrowseScans.tsx`'s delete button
      opens `DeleteConfirmModal` instead of calling `window.confirm()`, and
      that confirming still calls `scans.delete` and refreshes the table.
- [ ] 2.4 Update `BrowseScans.tsx`'s `handleDelete` flow to use
      `DeleteConfirmModal`. Confirm 2.3 passes and no existing BrowseScans
      delete tests regress.
- [ ] 2.5 Write a failing test asserting `ScanPreview.tsx` has a delete
      button in its toolbar that opens `DeleteConfirmModal`, and that
      confirming calls `scans.delete` then navigates back to `/scans`.
- [ ] 2.6 Add the delete button + modal wiring to `ScanPreview.tsx`.
      Confirm 2.5 passes.
- [ ] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check
      gate before moving to upload work.

## 3. Upload data-integrity fixes (`image-uploader.ts`)

- [ ] 3.1 Write failing unit tests for the soft-delete guard: `uploadScan()`
      on a scan with `deleted: true` returns `{ success: false }` without
      calling the upload function; `uploadBatch()` skips a deleted scan in
      the batch while still processing the others.
- [ ] 3.2 Implement the soft-delete guard in `uploadScan`/`uploadBatch`.
      Confirm 3.1 passes.
- [ ] 3.3 Write failing unit tests for the retry-skip filter: a scan with a
      mix of `'uploaded'`/`'failed'`/`'pending'` images only sends the
      non-`'uploaded'` ones to the upload function; an all-`'uploaded'`
      scan makes zero upload calls and returns a no-op success.
- [ ] 3.4 Implement the retry-skip filter. Confirm 3.3 passes.
- [ ] 3.5 Write failing unit tests for storage-existence verification:
      mock the Supabase client so a `bloom-fs`-reported success is followed
      by (a) a confirmed-existing object → image marked `'uploaded'`, and
      (b) a missing object → image marked `'failed'` with the distinguishing
      error message from the `upload` spec delta.
- [ ] 3.6 Implement the storage-existence check using the raw Supabase
      client already held by `ImageUploader` (`this.supabase`). Confirm 3.5
      passes.
- [ ] 3.7 Add a documentation comment to `nWorkers: 4` matching
      `graviscan-upload.ts`'s existing rationale (3 round-trips per image:
      insert RPC → file upload → update RPC). No behavior change — no test
      needed beyond confirming existing upload tests still pass.
- [ ] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check
      gate before moving to duplicate-check work.

## 4. Duplicate-scan check (#120) + dead-code removal

- [ ] 4.1 Write a failing unit test for a new `checkDuplicateScan(db,
      plantId, experimentId, waveNumber, plantAgeDays)` handler function:
      returns `true` when a non-deleted matching scan exists, `false`
      otherwise (including when the only match is soft-deleted), matching
      the `ui-management-pages` spec's "Scan Duplicate Check IPC Handler"
      scenarios exactly.
- [ ] 4.2 Implement `checkDuplicateScan` and register
      `db:scans:checkDuplicate` in `database-handlers.ts`, following the
      existing `db:scans:*` inline-handler convention. Confirm 4.1 passes.
- [ ] 4.3 Add `checkDuplicate` to `preload.ts` and its typed declaration in
      `electron.d.ts`.
- [ ] 4.4 Write the required E2E test in
      `tests/e2e/renderer-database-ipc.e2e.ts` for `db:scans:checkDuplicate`
      (direct-Prisma-seed + `window.evaluate` pattern, matching the file's
      existing style) — this repo's CI coverage gate statically scans this
      file for `db:*` handler calls.
- [ ] 4.5 Write a failing test asserting `CaptureScan.tsx` calls
      `checkDuplicate` with `(plant_id, experiment_id, wave_number,
      plant_age_days)` every 2s and shows/hides the warning + disables/
      enables `Start Scan` accordingly, replacing the old
      `getMostRecentScanDate`-based logic.
- [ ] 4.6 Update `CaptureScan.tsx` to use `checkDuplicate`. Confirm 4.5
      passes.
- [ ] 4.7 Remove `db:scans:getMostRecentScanDate` entirely (per design.md
      Decision 6, confirmed dead once 4.6 lands): the handler in
      `database-handlers.ts`, its `preload.ts` exposure, its
      `electron.d.ts` declaration, its dedicated E2E tests in
      `tests/e2e/plant-barcode-validation.e2e.ts` and
      `tests/e2e/renderer-database-ipc.e2e.ts`, and the mocks in
      `tests/unit/capture-scan-config.test.tsx` and
      `tests/unit/pages/CaptureScan-event-cleanup.test.tsx`.
- [ ] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check
      gate before full E2E.

## 5. Follow-up issues (documentation only, no code)

- [ ] 5.1 File a follow-up issue against the local↔cloud UUID traceability
      gap (pilot #59 equivalent), referencing design.md Decision 5 —
      needs a `@salk-hpi/bloom-fs` type change plus a Supabase schema
      migration.
- [ ] 5.2 File a follow-up issue for the scheduled upload/storage audit
      tool (pilot #61 equivalent), referencing design.md Decision 8.
- [ ] 5.3 File a follow-up tier/issue for the Basler acquisition-metadata
      readback gap (pilot #3 equivalent), referencing design.md Decision 8
      and Non-Goals.

## 6. Final verification

- [ ] 6.1 Run the full unit test suite (`npm run test:unit`) — confirm no
      regressions outside this change's scope.
- [ ] 6.2 Run the full E2E suite (`npm run test:e2e` or equivalent) —
      confirm `renderer-database-ipc.e2e.ts`'s new test passes and existing
      delete/upload/duplicate-check E2E coverage (`scan-preview.e2e.ts`,
      any BrowseScans delete E2E) still passes.
- [ ] 6.3 Run `npx tsc --noEmit` and `npm run lint` clean.
- [ ] 6.4 Manually verify the IPC coverage gate would pass (per the repo's
      "IPC coverage gate" convention: confirm `db:scans:checkDuplicate` has
      a real call in `renderer-database-ipc.e2e.ts`, not just a unit test).
- [ ] 6.5 `openspec validate add-cylinderscan-delete-upload-integrity --strict`
      passes with no issues.
