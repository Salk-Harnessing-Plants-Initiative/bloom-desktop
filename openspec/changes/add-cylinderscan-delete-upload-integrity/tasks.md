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
      Build a minimal, local success-message affordance for this tier only
      (design.md Decision 16) — do **not** depend on the `useToast()`
      system in the still-open, unmerged `feat/auto-plate-assignment` PR
      (#148); a simple inline/dismissing banner is sufficient. If #148
      merges before this ships, migrating to `useToast()` is a separate,
      later cleanup, not part of this task.
- [ ] 2.6 Implement the success message per 2.5. Confirm it passes.
- [ ] 2.7 Write a failing test asserting the Delete button in
      `BrowseScans.tsx` is disabled while that same scan's upload is in
      flight (`uploadInProgress === scan.id`), matching the existing
      pattern the Upload button already uses for the reverse case
      (design.md Decision 15 — this brings the code in line with an
      already-accepted spec requirement under "Upload Scan to Bloom
      Storage"/"Upload Progress Indication," which is not itself changing
      in this proposal).
- [ ] 2.8 Add the `uploadInProgress` check to the Delete button's
      `disabled` condition in `BrowseScans.tsx`. Confirm 2.7 passes.
- [ ] 2.9 Write a failing test asserting `ScanPreview.tsx` has a delete
      button in its toolbar that opens `DeleteConfirmModal`, and that
      confirming calls `scans.delete` then navigates back to `/scans`.
- [ ] 2.10 Add the delete button + modal wiring to `ScanPreview.tsx`.
      Confirm 2.9 passes.
- [ ] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check
      gate before moving to upload work.

## 3. Upload data-integrity fixes (`image-uploader.ts`)

**Read design.md Decisions 7-10 in full before starting this section** —
an earlier draft of this tier also attempted retry-time re-verification of
already-`'uploaded'` images; that was found unimplementable during review
(no local record of an old upload's remote reference exists) and is
explicitly **out of scope**. Do not re-introduce it. What ships in this
section is: soft-delete guard, retry-skip (skip only, no re-verification),
filtered-index correctness, fresh-upload verification with a bounded-retry
third outcome, and an explicit await so verification work can't outlive
`uploadScan()`'s return.

- [ ] 3.1 Write failing unit tests for the soft-delete guard: `uploadScan()`
      on a scan with `deleted: true` returns `{ success: false }` without
      calling the upload function; `uploadBatch()` skips a deleted scan in
      the batch while still processing the others.
- [ ] 3.2 Implement the soft-delete guard in `uploadScan`/`uploadBatch`.
      Confirm 3.1 passes.
- [ ] 3.3 Write failing unit tests for the retry-skip filter and its
      index-safety (design.md Decisions 9 & 10):
      - A scan with images [A `'uploaded'`, B `'failed'`, C `'pending'`]:
        only B and C are passed to the `bloom-fs` upload call; `total`
        (re-upload count) is 2, not 3; A's status is never touched by this
        call.
      - **Index-safety regression test**: with the same 3-image scan,
        assert that when `bloom-fs`'s callback reports index 0 (of the
        *filtered* 2-item call) as B succeeding and index 1 as C failing,
        the correct `Image` row (B, then C) receives each status update —
        not `scan.images[0]`/`scan.images[1]` (which would be A and B).
        This must fail against a naive `scan.images[index]` implementation
        and pass only once callbacks index into the filtered
        `imagesToUpload` array instead.
      - The "mark as uploading" loop only marks the filtered subset
        (B and C), not A.
      - An all-`'uploaded'` scan makes zero `bloom-fs` upload calls,
        returns `total: 0`, and leaves every image's status untouched (no
        re-verification is attempted for already-`'uploaded'` images —
        this is intentional, not a gap to fill in this task).
- [ ] 3.4 Implement the filtered `imagesToUpload` array (design.md
      Decision 10): build it once from `scan.images.filter(img =>
      img.status !== 'uploaded')`, pass it (not `scan.images`) to
      `uploadImagesFn`, index into it (not `scan.images`) from the
      `result`/`before`/`onProgress` callbacks, and filter the
      "mark as uploading" loop the same way. Confirm 3.3 passes.
- [ ] 3.5 Write failing unit tests for storage-existence verification,
      covering all outcomes from the `upload` spec's "Upload Verifies
      Storage Object Existence Before Marking Uploaded" requirement (all
      of these apply only to images freshly uploaded in the current call —
      not to already-`'uploaded'` images, per 3.3's last bullet):
      - `object_path` lookup + storage check both succeed, object present
        → `'uploaded'`.
      - `object_path` lookup succeeds, storage check confirms object
        missing → `'failed'` with the distinguishing message; a second
        `uploadScan()` call on the same scan now includes that image.
      - `object_path` lookup itself returns null (simulating `bloom-fs`'s
        own discarded internal update failure) → treated as inconclusive,
        not confirmed-missing.
      - Verification call throws/times out on attempts 1-2 but succeeds
        (object present) on attempt 3 → final status `'uploaded'`, exactly
        3 attempts made, with a 500ms delay asserted between attempts
        (use fake timers, not real waits).
      - Verification call fails all 3 attempts → `'failed'` with the
        "verification could not be confirmed" message, distinct from the
        confirmed-missing message.
      - Mock the Supabase client (`this.supabase`, a full
        `SupabaseClient` — not `this.store`, which has no read method) for
        all of the above — do not hit a real network in these tests.
- [ ] 3.6 Implement storage-existence verification using `this.supabase`
      (typing it properly, e.g. `SupabaseClient<Database>`, rather than
      leaving it `any`, given this tier exists because of undetected
      Supabase-call bugs): `this.supabase.from('cyl_images').select
      ('object_path').eq('id', created)`, then a storage existence check,
      wrapped in the bounded-retry-on-inconclusive-failure logic (3 total
      attempts, 500ms fixed delay) from 3.5. This function's only
      responsibility is to return a three-way outcome (present / missing /
      inconclusive-after-retries); mapping that to an `Image.status` write
      is the caller's job. Confirm 3.5 passes.
- [ ] 3.7 Write a failing test for the awaited-verification correctness
      property (design.md Decision 8, `upload` spec's "Upload Awaits
      Verification Before Returning"). Be precise about the mock target —
      a test that mocks a delay inside the existing `uploadImagesFn` mock
      loop (the pattern `tests/unit/image-uploader.test.ts` already uses
      elsewhere) proves nothing here, since that callback does no async
      work after 3.8 lands; it must pass or fail identically with or
      without the fix. Instead:
      - Use a **scan with at least 2 images** (matching the `upload`
        spec's own "multiple images... across worker slots" scenario —
        a single-image test can't distinguish "awaited" from
        "not awaited").
      - Mock the verification/Supabase call itself (not the `bloom-fs`
        callback) with a manually-resolvable deferred promise — e.g.
        `let resolveVerify; const verifyPromise = new Promise(r =>
        {resolveVerify = r})`, returned by the mocked verification call
        for at least one image.
      - Call `uploadScan()`, let `uploadImagesFn`'s mock resolve
        immediately (its callback only records now, per 3.8), then assert
        via a settled-flag or `Promise.race` against a sentinel that the
        `uploadScan()` promise has **not yet resolved** while
        `verifyPromise` is still pending.
      - Call `resolveVerify(...)`, then assert `uploadScan()` **does**
        resolve, and that the returned `UploadResult`'s counts reflect
        every image's final, post-verification status — not just the one
        image whose promise was manually controlled.
- [ ] 3.8 Implement the fix: inside `uploadImagesFn`'s `result` callback,
      only synchronously record `(index, created, error)` into an
      in-memory list — do not perform verification there. After
      `await this.uploadImagesFn(...)` returns, run verification and the
      corresponding status write for every recorded entry, **bounded at
      the same `nWorkers` (4) concurrency as the upload phase** — reuse
      `@salk-hpi/bloom-fs`'s own exported `concurrentMap(array, nWorkers,
      asyncFunc)` rather than an uncapped `Promise.all` (found on review:
      an uncapped `Promise.all` would fan out to the scan's full image
      count — 72 by default — not stay bounded like the upload phase).
      Wrap each entry's verification-and-write work individually (e.g. a
      per-entry try/catch) so one entry's unexpected error doesn't reject
      the whole pass and discard every other entry's already-completed
      status write. Only return `uploadScan()`'s result once every entry
      has settled. Confirm 3.7 passes.
- [ ] 3.9 Add a documentation comment to `nWorkers: 4` matching
      `graviscan-upload.ts`'s existing rationale (3 round-trips per image:
      insert RPC → file upload → update RPC). No behavior change — no test
      needed beyond confirming existing upload tests still pass.
- [ ] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check
      gate before moving to duplicate-check work.

## 4. Duplicate-scan check (#120) + dead-code removal

- [ ] 4.1 Write failing unit tests for a new `checkDuplicateScan(db,
      plantId, experimentId, waveNumber, plantAgeDays)` handler function,
      validating each of the four fields independently (not as a group):
      - Returns `true` when a non-deleted matching scan exists, `false`
        otherwise (including when the only match is soft-deleted).
      - Returns an error (not `false`) for: empty/non-string/missing
        `plantId`; empty/non-string/missing `experimentId`; negative,
        non-integer, or non-numeric `waveNumber`; negative, non-integer,
        or non-numeric `plantAgeDays` — one concrete test per case,
        matching the `ui-management-pages` spec's "Invalid plantId or
        experimentId..." and "Invalid waveNumber or plantAgeDays..."
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
- [ ] 4.5 In `tests/unit/capture-scan-config.test.tsx` (the file that
      already stubs the duplicate-check IPC call for this component's
      other tests — this is where these new tests belong), write failing
      tests asserting `CaptureScan.tsx` calls `checkDuplicate` with
      `(plant_id, experiment_id, wave_number, plant_age_days)` every 2s
      and shows/hides the warning + disables/enables `Start Scan`
      accordingly, replacing the old `getMostRecentScanDate`-based logic.
      This file has no fake-timer setup today — introduce
      `vi.useFakeTimers()`/`vi.advanceTimersByTime()` for the 2s-interval
      assertions rather than real-timer `waitFor`s. Include:
      - The two specific transitions issue #120 itself calls out: changing
        wave number away from a duplicate match clears the warning; changing
        plant ID away from a duplicate match clears the warning (not just
        the steady-state match/no-match cases).
      - An edge case for invalid/unparsed `waveNumber`/`plantAgeDays` (both
        are string form state requiring `parseInt` before use, per
        `CaptureScan.tsx`'s existing pattern at lines ~305-306, ~512-513):
        the check SHALL NOT call `checkDuplicate` with an invalid value,
        matching the existing early-return guard for blank
        `plantQrCode`/`experimentId`.
      - An interval-cleanup test asserting `clearInterval` is called for
        the duplicate-check interval on unmount, using the same
        `vi.spyOn(global, 'clearInterval')` + `renderHook`/`unmount()`
        pattern already proven (but currently disabled) in
        `tests/unit/pages/CaptureScan-event-cleanup.test.tsx:220-323`'s
        `describe('Interval cleanup', ...)` block — port the pattern into
        this actively-running file rather than relying on the skipped one.
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
        longer applies under the new 4-field key, and its current UI
        interaction never fills the wave-number/plant-age-days form
        fields (it only fills plant barcode + selects experiment/
        phenotyper, since the old check didn't need them). The rewritten
        test(s) must also fill in matching wave-number and plant-age-days
        values, or the new check will no-op on invalid/blank input (per
        4.5's edge case) and the test will fail for an unrelated reason.
        Cover the match/no-match/different-day scenarios from the
        `ui-management-pages` spec delta.
      - **Replace**, not just remove, the `getMostRecentScanDate` mock in
        `tests/unit/capture-scan-config.test.tsx` with a `checkDuplicate`
        mock (see 4.5 — this is the same file 4.5's new tests live in).
      - In `tests/unit/pages/CaptureScan-event-cleanup.test.tsx`, remove the
        `getMostRecentScanDate` mock (this file's suite is currently
        `describe.skip`'d, so this is a low-risk cleanup, not a live-test
        fix — the working interval-cleanup pattern from this file is
        ported to `capture-scan-config.test.tsx` in 4.5, not left here).
- [ ] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check
      gate before full E2E.

## 5. Follow-up issues (documentation only, no code)

- [ ] 5.1 File a follow-up issue against the local↔cloud UUID traceability
      gap (pilot #59 equivalent), referencing design.md Decision 5 —
      needs a `@salk-hpi/bloom-fs` type change plus a Supabase schema
      migration. Reference issue #60's 2026-06-17 follow-up comment
      (deterministic storage paths) as related prior art, and note
      design.md Decision 14's finding that this same traceability gap is
      also why delete-then-rescan can orphan indistinguishable duplicate
      data in cloud storage — this follow-up is the natural place to also
      address that.
- [ ] 5.2 File a follow-up issue for the scheduled upload/storage audit
      tool (pilot #61 equivalent), with its scope **explicitly widened**
      per design.md Decisions 9 and 11: it must include a reconciliation/
      write-back capability (flip a historically-corrupted `'uploaded'`
      image back to a re-uploadable status once drift is confirmed, and
      design the lookup strategy — schema addition or business-key join —
      that requires), not just detection/reporting. Also note design.md
      Decision 7's finding that this tier deliberately does not build
      automatic in-line recovery (re-uploading a confirmed-missing object
      to its existing path within the same verification call, as pilot
      #60 itself proposed) — that capability, if wanted, belongs here too.
- [ ] 5.3 File a follow-up tier/issue for the Basler acquisition-metadata
      readback gap (pilot #3 equivalent), referencing design.md Decision 11
      and Non-Goals.
- [ ] 5.4 File a follow-up issue for #110's two unaddressed asks
      (benchmark 4/8/10 workers; consider configurable concurrency) —
      this tier only documents the existing rationale (3.9).
- [ ] 5.5 Comment on #79 explaining the soft-delete-only decision
      (design.md Decision 1/12) and naming **all three** of its
      acceptance criteria this change intentionally doesn't meet: scan
      files are not removed from disk, the `Scan` row is not removed from
      the database (only soft-deleted), and associated `Image` records
      are not cleaned up.

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
- [ ] 6.5 Manually re-confirm three areas that were the most severe gaps
      found in pre-implementation review, since they're easy to
      under-implement without noticing in code review: (a) the
      index-safety regression test (3.3) genuinely fails against a naive
      `scan.images[index]` implementation, not just against no
      implementation at all; (b) the three-way verification-outcome tests
      (3.5) genuinely distinguish confirmed-missing from inconclusive,
      not just present/absent; (c) the awaited-verification test (3.7)
      genuinely fails if the `Promise.all` await in 3.8 is removed, not
      just a happy-path pass.
- [ ] 6.6 Confirm the interval-cleanup test added per 4.5 lives in
      `tests/unit/capture-scan-config.test.tsx` (an actively-running file)
      and not the still-`describe.skip`'d `CaptureScan-event-cleanup.test.tsx`
      — and that it actually fails if `clearInterval` is removed from the
      effect's cleanup.
- [ ] 6.7 `openspec validate add-cylinderscan-delete-upload-integrity --strict`
      passes with no issues.
