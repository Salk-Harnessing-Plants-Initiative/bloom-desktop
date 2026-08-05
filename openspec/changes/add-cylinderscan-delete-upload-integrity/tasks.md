## 1. Delete completion — metadata.json sync

- [ ] 1.1 In a new test file (or extending existing coverage) for
      `scan-metadata-json.ts`, write failing tests for `markMetadataDeleted(outputDir)`:
      reads an existing `metadata.json`, adds `deleted: true`, writes it back
      atomically (`.tmp` + rename), preserves all other fields unchanged.
      Also write failing tests for a new `isScanMetadataDeleted(json): boolean`
      helper: returns `true` only when `json.deleted === true`, returns
      `false` for `{deleted: false}` AND for a legacy object with no
      `deleted` key at all (design.md Decision 13 — absence must mean
      "not deleted," enforced by this helper rather than left as
      prose-only guidance).
- [ ] 1.2 Add `deleted?: boolean` to the `ScanMetadataJson` interface and
      implement `markMetadataDeleted()` and `isScanMetadataDeleted()` in
      `scan-metadata-json.ts`. Decide during implementation whether to
      extract a shared `atomicWriteJson()` helper from `writeMetadataJson`'s
      inlined `.tmp`-then-rename logic for `markMetadataDeleted()` to reuse,
      or duplicate the ~4-line pattern inline — either is acceptable, but
      if extracting, re-run `writeMetadataJson`'s existing tests to confirm
      no behavior change. Confirm 1.1's tests pass.
- [ ] 1.3 Write a failing unit test for `db:scans:delete`
      (`database-handlers.ts`) asserting it calls `markMetadataDeleted()`
      with the correct resolved path after the Prisma soft-delete succeeds.
      Path resolution must mirror `image-uploader.ts:255-257`'s existing
      `path.isAbsolute(image.path) ? image.path : path.join(scansDir,
      image.path)` guard — `scan.path` can be absolute for legacy/
      pilot-imported scans, not just relative — so use
      `path.isAbsolute(scan.path) ? path.join(scan.path, 'metadata.json') :
      path.join(scansDir, scan.path, 'metadata.json')`, not an unconditional
      `path.join(scansDir, scan.path, 'metadata.json')`.
- [ ] 1.4 Write a failing unit test for the missing-file case: `db:scans:delete`
      still returns `{ success: true }` and logs a warning when
      `metadata.json` doesn't exist on disk.
- [ ] 1.5 Update `db:scans:delete` to call `markMetadataDeleted()` per 1.3/1.4,
      with the absolute-path-aware resolution from 1.3. Reuse the `scansDir`
      resolution already used in `image-uploader.ts` (extract to a shared
      helper if that avoids duplicating the `loadEnvConfig` call, otherwise
      inline consistently).
- [ ] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check
      gate before moving to UI work.

## 2. Delete completion — shared modal, ScanPreview affordance, success message

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
- [ ] 2.5 Write a failing test asserting a successful delete shows a brief
      success message ("Scan deleted successfully") in `BrowseScans.tsx`.
      Confirmed during review: this repo has **no existing toast/success-
      message component anywhere in the renderer** — this is new, minimal
      UI (a simple inline/dismissing banner is sufficient; do not build a
      general-purpose toast system for one call site).
- [ ] 2.6 Implement the success message per 2.5. Confirm it passes.
- [ ] 2.7 Write a failing test asserting `ScanPreview.tsx` has a delete
      button in its toolbar that opens `DeleteConfirmModal`, and that
      confirming calls `scans.delete` then navigates back to `/scans`.
- [ ] 2.8 Add the delete button + modal wiring to `ScanPreview.tsx`.
      Confirm 2.7 passes.
- [ ] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check
      gate before moving to upload work.

## 3. Upload data-integrity fixes (`image-uploader.ts`)

- [ ] 3.1 Write failing unit tests for the soft-delete guard: `uploadScan()`
      on a scan with `deleted: true` returns `{ success: false }` without
      calling the upload function; `uploadBatch()` skips a deleted scan in
      the batch while still processing the others.
- [ ] 3.2 Implement the soft-delete guard in `uploadScan`/`uploadBatch`.
      Confirm 3.1 passes.
- [ ] 3.3 Write failing unit tests for the retry-skip-but-still-verify
      filter (design.md Decisions 9 & 10 — read both before starting this
      section):
      - A scan with images [A `'uploaded'`, B `'failed'`, C `'pending'`]:
        only B and C are passed to the `bloom-fs` upload call; `total`
        (re-upload count) is 2, not 3.
      - **Index-safety regression test**: with the same 3-image scan,
        assert that when `bloom-fs`'s callback reports index 0 (of the
        *filtered* 2-item call) as B succeeding and index 1 as C failing,
        the correct `Image` row (B, then C) receives each status update —
        not `scan.images[0]`/`scan.images[1]` (which would be A and B).
        This must fail against a naive `scan.images[index]` implementation
        and pass only once callbacks index into the filtered
        `imagesToUpload` array instead.
      - The "mark as uploading" loop only marks the filtered subset
        (B and C), not A — assert A's status is untouched by this loop.
      - An all-`'uploaded'` scan makes zero `bloom-fs` upload calls and
        returns `total: 0`.
- [ ] 3.4 Implement the filtered `imagesToUpload` array (design.md
      Decision 10): build it once, pass it (not `scan.images`) to
      `uploadImagesFn`, index into it (not `scan.images`) from the
      `result`/`before`/`onProgress` callbacks, and filter the
      "mark as uploading" loop the same way. Confirm 3.3 passes.
- [ ] 3.5 Write failing unit tests for storage-existence verification,
      covering all outcomes from the `upload` spec's "Upload Verifies
      Storage Object Existence Before Marking Uploaded" requirement:
      - `object_path` lookup + storage check both succeed, object present
        → `'uploaded'`.
      - `object_path` lookup succeeds, storage check confirms object
        missing → `'failed'` with the distinguishing message.
      - `object_path` lookup itself returns null (simulating `bloom-fs`'s
        own discarded internal update failure) → treated as inconclusive,
        not confirmed-missing (see next bullet).
      - Verification call throws/times out on attempts 1-2 but succeeds
        (object present) on attempt 3 → final status `'uploaded'`, exactly
        3 attempts made.
      - Verification call fails all 3 attempts → `'failed'` with the
        "verification could not be confirmed" message, distinct from the
        confirmed-missing message.
      - Mock the Supabase client for all of the above — do not hit a real
        network in these tests.
- [ ] 3.6 Implement storage-existence verification using the raw Supabase
      client already held by `ImageUploader` (`this.supabase`): look up
      `object_path` from `cyl_images` by `created` id, then check storage;
      wrap both in the bounded-retry-on-inconclusive-failure logic from
      3.5. Reuse this same verification function for both a fresh upload's
      result callback and the retry-skip path's re-verification (3.3/3.4)
      — one implementation, two call sites. Confirm 3.5 passes.
- [ ] 3.7 Add a documentation comment to `nWorkers: 4` matching
      `graviscan-upload.ts`'s existing rationale (3 round-trips per image:
      insert RPC → file upload → update RPC). No behavior change — no test
      needed beyond confirming existing upload tests still pass.
- [ ] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check
      gate before moving to duplicate-check work.

## 4. Duplicate-scan check (#120) + dead-code removal

- [ ] 4.1 Write failing unit tests for a new `checkDuplicateScan(db,
      plantId, experimentId, waveNumber, plantAgeDays)` handler function:
      returns `true` when a non-deleted matching scan exists, `false`
      otherwise (including when the only match is soft-deleted); returns
      an error (not `false`) for malformed/missing arguments — matching
      the `ui-management-pages` spec's "Scan Duplicate Check IPC Handler"
      scenarios exactly, including its "Invalid or missing arguments"
      scenario.
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
- [ ] 4.5 Write failing tests asserting `CaptureScan.tsx` calls
      `checkDuplicate` with `(plant_id, experiment_id, wave_number,
      plant_age_days)` every 2s and shows/hides the warning + disables/
      enables `Start Scan` accordingly, replacing the old
      `getMostRecentScanDate`-based logic. Include:
      - The two specific transitions issue #120 itself calls out: changing
        wave number away from a duplicate match clears the warning; changing
        plant ID away from a duplicate match clears the warning (not just
        the steady-state match/no-match cases).
      - An edge case for invalid/unparsed `waveNumber`/`plantAgeDays` (both
        are string form state requiring `parseInt` before use, per
        `CaptureScan.tsx`'s existing pattern at lines ~305-306, ~512-513):
        the check SHALL NOT run (or SHALL no-op) with a clearly invalid
        wave/age value, matching the existing early-return guard for blank
        `plantQrCode`/`experimentId`.
- [ ] 4.6 Update `CaptureScan.tsx` to use `checkDuplicate`. Confirm 4.5
      passes.
- [ ] 4.7 Remove `db:scans:getMostRecentScanDate` entirely (per design.md
      Decision 6, confirmed dead once 4.6 lands — an independent full-tree
      grep for "getMostRecentScanDate" found no other caller): the handler
      in `database-handlers.ts`, its `preload.ts` exposure, its
      `electron.d.ts` declaration, and:
      - Remove its two dedicated `test()` blocks inside
        `tests/e2e/renderer-database-ipc.e2e.ts`'s larger
        `describe('Renderer Database IPC - Scans (with Filters)', ...)`
        block (they are individual tests within a large shared describe,
        not an isolated section — remove precisely those two tests, leave
        the rest of that describe block untouched).
      - Remove the dedicated `describe('IPC: db:scans:getMostRecentScanDate',
        ...)` block in `tests/e2e/plant-barcode-validation.e2e.ts` (this one
        *is* fully isolated).
      - **Rewrite, not delete**, the separate
        `'should show warning when plant already scanned today'` test in
        `tests/e2e/plant-barcode-validation.e2e.ts` (inside
        `describe('UI: Duplicate Scan Prevention', ...)`) — it asserts the
        literal string `'This plant was already scanned today'`, which no
        longer applies under the new 4-field key. Rewrite it (and add
        siblings) to cover the new key's match/no-match scenarios from the
        `ui-management-pages` spec delta, including the new
        "different day" scenario.
      - In `tests/unit/capture-scan-config.test.tsx`, **replace** the
        `getMostRecentScanDate` mock with a `checkDuplicate` mock (not just
        remove it) — otherwise `CaptureScan.tsx`'s periodic effect calls an
        `undefined` function in this test file's harness once 4.6 lands.
      - In `tests/unit/pages/CaptureScan-event-cleanup.test.tsx`, remove the
        `getMostRecentScanDate` mock (this file's suite is currently
        `describe.skip`'d, so this is a low-risk cleanup, not a live-test
        fix).
- [ ] 4.8 Confirm the "duplicate check stops polling on unmount" scenario
      (`ui-management-pages` spec's "Periodic duplicate check") has a real,
      *running* test — not just one sitting in the currently-`describe.skip`'d
      `CaptureScan-event-cleanup.test.tsx`. If no other active test file
      covers interval cleanup for this component, add one (e.g. alongside
      4.5's tests) rather than leaving this scenario structurally untested.
- [ ] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check
      gate before full E2E.

## 5. Follow-up issues (documentation only, no code)

- [ ] 5.1 File a follow-up issue against the local↔cloud UUID traceability
      gap (pilot #59 equivalent), referencing design.md Decision 5 —
      needs a `@salk-hpi/bloom-fs` type change plus a Supabase schema
      migration. Reference issue #60's 2026-06-17 follow-up comment
      (deterministic storage paths) as related prior art.
- [ ] 5.2 File a follow-up issue for the scheduled upload/storage audit
      tool (pilot #61 equivalent), referencing design.md Decision 9's Risks
      note that this tier's fixes narrow, but don't eliminate, the
      historical-corruption blind spot — raising this follow-up's practical
      priority.
- [ ] 5.3 File a follow-up tier/issue for the Basler acquisition-metadata
      readback gap (pilot #3 equivalent), referencing design.md Decision 11
      and Non-Goals.
- [ ] 5.4 File a follow-up issue for #110's two unaddressed asks
      (benchmark 4/8/10 workers; consider configurable concurrency) —
      this tier only documents the existing rationale (3.7).
- [ ] 5.5 Comment on #79 explaining the soft-delete-only decision
      (design.md Decision 1) and why its "remove files from disk"
      acceptance criterion is intentionally not met by this change.

## 6. Final verification

- [ ] 6.1 Run the full unit test suite (`npm run test:unit`) — confirm no
      regressions outside this change's scope.
- [ ] 6.2 Run the full E2E suite (`npm run test:e2e` or equivalent) —
      confirm `renderer-database-ipc.e2e.ts`'s new test passes and existing
      delete/upload/duplicate-check E2E coverage (`scan-preview.e2e.ts`,
      any BrowseScans delete E2E, the rewritten
      `plant-barcode-validation.e2e.ts` tests) still passes.
- [ ] 6.3 Run `npx tsc --noEmit` and `npm run lint` clean.
- [ ] 6.4 Manually verify the IPC coverage gate would pass (per the repo's
      "IPC coverage gate" convention: confirm `db:scans:checkDuplicate` has
      a real call in `renderer-database-ipc.e2e.ts`, not just a unit test).
- [ ] 6.5 Manually re-confirm the index-safety regression test (3.3) and
      the three-way verification-outcome tests (3.5) are present and
      genuinely exercise the failure modes described — these two areas
      were the most severe gaps found in pre-implementation review, so
      don't let them silently degrade into shallow assertions during
      implementation.
- [ ] 6.6 `openspec validate add-cylinderscan-delete-upload-integrity --strict`
      passes with no issues.
