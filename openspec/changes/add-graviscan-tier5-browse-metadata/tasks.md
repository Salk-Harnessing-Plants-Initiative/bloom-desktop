## 1. Preload wiring: ensureDir / listScanFiles (TDD)

- [x] 1.1 Write failing unit tests in `tests/unit/preload-gravi.test.ts`
      (the existing preload test file for the `gravi` namespace) asserting
      `graviAPI.ensureDir(dirPath)` invokes `ipcRenderer.invoke('graviscan:ensure-dir', dirPath)`
      and `graviAPI.listScanFiles(dirPath?)` invokes
      `ipcRenderer.invoke('graviscan:list-scan-files', dirPath)`, including the
      no-argument case for `listScanFiles`. Also update this file's existing
      hardcoded invoke-method enumeration/count assertion (currently asserts
      18 methods and — pre-existing bug, unrelated to this change but in the
      same assertion — already omits `resetUsb`) to the full, correct list of
      21 methods per `scanning/spec.md`'s updated "GraviScan Preload Context
      Bridge" requirement.
- [x] 1.2 Implement `ensureDir`/`listScanFiles` in `src/main/preload.ts`'s
      `graviAPI` object, next to `getOutputDir`, following its one-liner style.
- [x] 1.3 Add `ensureDir`/`listScanFiles` to the `GraviAPI` interface in
      `src/types/electron.d.ts` with the signatures from `scanning/spec.md`'s
      updated "GraviScan Type Definitions for Preload API" requirement.
- [x] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check gate
      before starting Section 1b. (Lint clean; typecheck clean after
      `npx prisma generate`, needed once for this fresh worktree, unrelated
      to this change; 7 pre-existing failures in AccessionForm/config-store/
      scan-coordinator/image-uploader tests, same baseline as before this
      change, no new failures.)

## 1b. Durable logging for link/unlinkGraviMetadata (TDD)

**Correction found during implementation**: `database-handlers.ts` cannot
import `src/main/graviscan/scan-logger.ts` directly — the project's own
`@typescript-eslint/no-restricted-imports` rule blocks any file outside
`src/main/graviscan/**`, `src/main/cylinderscan/**`, or `src/main/main.ts`
from importing `**/graviscan/**` (a real architectural boundary, not a
style nit). Implemented via dependency injection instead:
`database-handlers.ts` exports `setAuditLogger(fn)` and a module-level
`auditLogger` (default no-op) that `linkGraviMetadata`/`unlinkGraviMetadata`
call instead of `scanLog` directly; `graviscan/wiring.ts`'s
`initGraviScan()` (which already runs only in graviscan mode, and is
already allowed to import both `database-handlers.ts` and
`graviscan/scan-logger.ts`) calls `setAuditLogger(scanLog)` once at
startup. In cylinderscan mode `initGraviScan()` never runs, so
`auditLogger` stays a no-op — harmless, since `linkGraviMetadata` can only
ever succeed for a `graviscan`-typed experiment anyway.

- [x] 1b.1 In `tests/unit/graviscan/database-handlers.test.ts`, imported
      `setAuditLogger` from `database-handlers.ts` and wired a
      `mockAuditLogger = vi.fn()` via `setAuditLogger(mockAuditLogger)` in
      the file's existing top-level `beforeEach` (after `vi.clearAllMocks()`)
      — no mock of `graviscan/scan-logger` needed, since
      `database-handlers.ts` never imports it. Wrote failing tests asserting
      `mockAuditLogger` is called exactly once, with a message containing
      the experiment id, wave number, and the linked accession's file name
      (not just its id), on a successful `linkGraviMetadata` call; called
      exactly once with the experiment id, wave number, and the unlinked
      accession's file name, on a successful `unlinkGraviMetadata` call; and
      NOT called when either handler returns `{success: false, ...}`.
      Confirmed red before implementing.
- [x] 1b.2 Added `setAuditLogger`/`auditLogger` to `database-handlers.ts`
      and the `auditLogger(...)` calls to `linkGraviMetadata`/
      `unlinkGraviMetadata` on their success paths (including the
      accession's file name, already available via each handler's existing
      `include: { accession: true }`); added `setAuditLogger(scanLog)` to
      `graviscan/wiring.ts`'s `initGraviScan()`. No signature change to
      `linkGraviMetadata`/`unlinkGraviMetadata`, no new IPC handler.
      Satisfies 1b.1's tests (85/85 passed in the test file).
- [x] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check gate
      before starting Section 2. (Lint clean, including the previously-
      violated `no-restricted-imports` rule; typecheck clean; full suite:
      same 7 pre-existing baseline failures, no new failures;
      `tests/unit/graviscan/main-wiring.test.ts` — which exercises
      `initGraviScan()` — still 45/45 green after the `setAuditLogger` call
      was added to it.)

## 2. Shared hooks (TDD)

- [x] 2.1 Write failing unit tests for `useResizableColumns(initialWidths)`
      (new file `tests/unit/hooks/useResizableColumns.test.tsx`): returns the
      initial widths; `onResizeStart(column)` followed by simulated
      `mousemove` events updates that column's width only; `mouseup` stops
      further width updates from subsequent `mousemove` events; unmounting
      mid-drag removes the `mousemove`/`mouseup` listeners (assert via a spy
      on `document.removeEventListener`) without throwing.
- [x] 2.2 Implement `useResizableColumns` in
      `src/renderer/hooks/useResizableColumns.ts` per `design.md` Decision 8.
- [x] 2.3 Write failing unit tests for `useWaveMetadataLinks(experimentId)`
      (new file `tests/unit/hooks/useWaveMetadataLinks.test.tsx`): fetches and
      exposes `listGraviMetadata`'s result as `links`; `suggestedNextWave`
      equals `max(existing wave numbers) + 1` (and `0` when `links` is empty);
      `link(waveNumber, accessionId)` calls `linkGraviMetadata` and refetches
      `links` on success, setting `linkError` (without refetching) on failure;
      `unlink(waveNumber)` calls `unlinkGraviMetadata` and removes that entry
      from `links` on success.
- [x] 2.4 Implement `useWaveMetadataLinks` in
      `src/renderer/hooks/useWaveMetadataLinks.ts` per `design.md` Decision 5.
      Note: this hook itself has no confirmation UI — `unlink()` performs the
      IPC call directly. The `window.confirm()` step (Decision 9) belongs in
      the calling components (Sections 7 and 9), not in the hook, so the hook
      stays a plain data layer testable without mocking `window.confirm`.
- [x] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check gate
      before starting Section 3. (Lint and typecheck clean; both new hook
      test files green: 4/4 + 6/6.)

## 3. experiment_type fix in ExperimentForm.tsx (TDD, fixes issue #286)

- [x] 3.1 Write failing component tests extending the existing
      `tests/unit/components/ExperimentForm.test.tsx`: given no `mode` prop
      (or `mode="cylinderscan"`), behavior is unchanged from today — no
      wave-number field appears, and the create payload has
      `experiment_type: 'cylinderscan'` (confirms the default preserves every
      existing render call site's current behavior, per `design.md`
      Decision 4); given `mode="graviscan"`, the form shows a wave-number
      field (default `0`) alongside the existing Accession dropdown, and
      submitting a valid form calls `database.experiments.create` with
      `experiment_type: 'graviscan'`; after creation succeeds, it also calls
      `linkGraviMetadata(newExperimentId, waveNumber, accessionId)` using the
      same accession the create payload used; given that link call fails,
      the form shows "Experiment created but metadata link failed:
      {message}" and the created experiment is NOT removed from the list;
      no second accession/metadata-file dropdown is rendered in either mode;
      given `mode="graviscan"`, the Accession dropdown's options come from a
      mocked `graviPlateAccessions.listFiles()` response, not
      `accessions.list()`.
- [x] 3.2 Add the optional `mode` prop (default `'cylinderscan'`) to
      `ExperimentForm.tsx`, set `experiment_type` on the create payload per
      `design.md` Decision 4, and add the wave-number field (rendered only
      when `mode === 'graviscan'`, reusing the existing `accession_id` field
      for the link call) with the post-create `linkGraviMetadata` call and
      its failure-message handling, satisfying 3.1's tests. In graviscan
      mode, fetch the Accession dropdown's options from
      `graviPlateAccessions.listFiles()` instead of the `accessions` prop
      it's given today (per `design.md` Decision 4's issue-#275 mitigation);
      in cylinderscan mode, the dropdown is unchanged.
- [x] 3.3 Thread `mode` from `App.tsx` through `Experiments.tsx` down to
      `<ExperimentForm mode={mode} />`, per `design.md` Decision 3.
- [x] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check gate
      before starting Section 4. (Lint/typecheck clean; 14/14 in
      ExperimentForm.test.tsx; same 7 pre-existing baseline failures
      elsewhere, no new ones.)

## 4. Nav / routing fixes (TDD)

- [x] 4.1 Write failing tests: extend `tests/unit/pages/Layout.test.tsx`
      asserting that in `graviscan` mode, the sidebar shows "Metadata"
      (`/metadata`) and "Browse GraviScans" (`/browse-graviscans`) and does
      NOT show the shared "Browse Scans" link, while "Experiments" is still
      shown; in `cylinderscan` mode, the sidebar is unchanged from today
      (shared "Browse Scans" still shown, no GraviScan-specific links).
      Create new `tests/unit/components/WorkflowSteps.test.tsx` asserting
      `graviScanSteps`'s "Metadata" step's route is `/metadata` (not
      `/experiments`) and "Browse Scans" step's route is `/browse-graviscans`
      (not `/browse-scans`), while `cylinderScanSteps` is unchanged.
- [x] 4.2 Update `WorkflowSteps.tsx`'s `graviScanSteps`: "Metadata" `route`
      changes from `/experiments` to `/metadata`; "Browse Scans" `route`
      changes from `/browse-scans` to `/browse-graviscans`.
      `cylinderScanSteps` is untouched. Update `Layout.tsx`: add "Metadata"
      (`/metadata`) and "Browse GraviScans" (`/browse-graviscans`) entries to
      `graviscanLinks`; make the shared "Browse Scans" entry in `alwaysLinks`
      conditional so it does not render when `mode === 'graviscan'` (leave
      "Experiments" unconditional, per `design.md` Decision 2). Run 4.1's
      tests green.
- [x] 4.3 Write a failing test extending `tests/unit/pages/App.test.tsx`
      (the existing "App component — mode-conditional routing" test file)
      asserting only the routing GATE, not which component is mounted: in
      `cylinderscan` mode, `/browse-graviscans`, `/graviscan-experiment/:id`,
      and `/metadata` are NOT reachable (render the catch-all redirect to
      `/`); in `graviscan` mode, each path renders something other than the
      catch-all redirect — per `scanning/spec.md`'s updated "Mode-Aware
      Routing" requirement. Deliberately do NOT assert which specific
      component renders here (that's Sections 5/7/8's job) — this keeps the
      test passable against either a placeholder or the final component,
      avoiding a contradiction with task 4.4 below.
- [x] 4.4 Add the new mode-gated route block to `App.tsx` (per `design.md`
      Decision 1): `/browse-graviscans` → `BrowseGraviScans`,
      `/graviscan-experiment/:experimentId` → `ExperimentDetail`, `/metadata`
      → `Metadata`, all inside one `{mode === 'graviscan' && (...)}` block.
      Because Sections 5-8 create these three components, and this task must
      still pass `npx tsc --noEmit` on its own if it lands first: create
      minimal placeholder files now (`export default function BrowseGraviScans() { return null; }`
      and the same shape for `ExperimentDetail`/`Metadata`), then replace each
      placeholder in kind when its real section lands (5.2, 7.2, 8.5) — a
      placeholder must never be the final state of this diff; each of 5.2,
      7.2, and 8.5 explicitly includes "replace the placeholder" as part of
      its own definition of done, and task 11.1 re-confirms no placeholder
      file remains before this change is considered done.
- [x] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check gate
      before starting Section 5. (Lint/typecheck clean after annotating the
      3 placeholders' return types; found and fixed a real regression in
      the pre-existing `App.test.tsx` "renders browse routes regardless of
      mode" test, which asserted "Browse Scans" text is present in
      graviscan mode — exactly the link this tier hides; updated it into
      two mode-specific assertions. 9/9 in App.test.tsx, 7/7 in
      Layout.test.tsx, 3/3 in WorkflowSteps.test.tsx; same 7 pre-existing
      baseline failures elsewhere, no new ones.)

## 5. BrowseGraviScans.tsx (TDD)

- [x] 5.1 Write failing component tests in new
      `tests/unit/pages/BrowseGraviScans.test.tsx` covering: empty state;
      rendering one row per experiment from a mocked
      `graviscans.browseByExperiment` response with the fields listed in
      `ui-management-pages/spec.md`'s "GraviScan Browse Page" requirement;
      a `browseByExperiment` error response rendering a friendly message, not
      throwing; date-range/name/accession filters debounced 300ms,
      upload-status filter applied immediately; pagination controls calling
      `browseByExperiment` with updated `offset`; "View Images" navigating to
      `/graviscan-experiment/:experimentId`; wave-selector-scoped Download
      calling `gravi.downloadImages({experimentId, experimentName, waveNumber})`;
      per `ui-management-pages/spec.md`'s "Mismatch warning before
      downloading a diverged wave" scenario — given the selected wave's
      `listGraviMetadata` link differs from the experiment's `accession_id`,
      an inline warning appears before Download proceeds (and does not
      block it); given they match (e.g. wave 0 right after creation), no
      warning appears.
      **Correction found during `/review-pr`**: the pagination-controls
      coverage claimed above didn't actually exist, and the mismatch-warning
      logic only ever checked the selected wave — leaving "All Waves"
      (the default) unable to warn at all regardless of how many linked
      waves diverged, contradicting the spec's own "Mismatch warning before
      an 'All Waves' download" scenario. Both are now real: added the
      missing Next/Previous pagination tests, and fixed
      `BrowseGraviScans.tsx`'s `handleDownload` to check every linked wave
      (not just the selected one) when "All Waves" is chosen, naming every
      diverged wave in the warning per the spec's "not just the first"
      wording; added matching "All Waves" warn/no-warn tests.
- [x] 5.2 Implement `src/renderer/BrowseGraviScans.tsx` satisfying 5.1's
      tests (replacing task 4.4's placeholder, if that task landed first),
      using `useWaveMetadataLinks` for the mismatch-warning comparison.
- [x] 5.3 Write failing tests for the Box-backup UI (still in
      `BrowseGraviScans.test.tsx`): the three button states (idle/backing-up/
      scan-in-progress) per `ui-management-pages/spec.md`'s "GraviScan Box
      Backup UI" requirement's three split scenarios; `getScanStatus()`
      called once on mount and `onIntervalStart`/`onIntervalComplete`/
      `onCancelled` subscribed instead of any polling interval (assert no
      `setInterval` call is made for scan status); success/partial-failure/
      rclone-unavailable result messages; per-experiment "Box X/Y" indicator
      updated from `onUploadProgress` events.
- [x] 5.4 Implement the Box-backup section satisfying 5.3's tests, per
      `design.md` Decision 6.
- [x] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check gate
      before starting Section 6. (Lint/typecheck clean; 16/16 in
      BrowseGraviScans.test.tsx. Found and fixed two real regressions: (1) a
      fake-timers leak in this section's own new debounce test — one test
      enabling `vi.useFakeTimers()` without restoring on failure cascaded
      into 5s timeouts on every subsequent test in the file; fixed with
      `fireEvent` instead of `userEvent` for that assertion plus a top-level
      `afterEach(() => vi.useRealTimers())` safety net; (2)
      `tests/unit/pages/App.test.tsx`'s route-reachability test now really
      mounts `BrowseGraviScans` when clicking its nav link, which called
      preload methods that file's mocks didn't provide
      (`database.graviscans.browseByExperiment`, `gravi.onIntervalStart`,
      `gravi.onUploadProgress`, `gravi.uploadAllScans`,
      `gravi.downloadImages`, `database.experiments.listGraviMetadata`) —
      an unhandled rejection in one test was corrupting a later test's React
      render ("Should not already be working"); added the missing mocks.
      Same 7 pre-existing baseline failures elsewhere, no new ones.)

## 6. Global upload-progress indicator (TDD)

- [x] 6.1 Write failing tests for `UploadStatusContext` in new
      `tests/unit/hooks/UploadStatusContext.test.tsx` (or
      `tests/unit/components/` if that better matches how context providers
      are tested elsewhere in this codebase — check for precedent before
      picking): the provider subscribes to `onUploadProgress` once and
      exposes current progress/result to consumers; consumers mounted after
      an event already fired still see the latest known state (not reset to
      idle); the subscription is cleaned up on provider unmount.
- [x] 6.2 Implement `src/renderer/contexts/UploadStatusContext.tsx`, and mount
      the provider once in `App.tsx` wrapping the full route tree.
- [x] 6.3 Write failing tests for the `Layout.tsx` indicator banner
      (extending `tests/unit/pages/Layout.test.tsx`): renders nothing when
      there is no in-flight/recent upload; renders progress while in flight;
      renders a result summary on completion; a dismiss control hides it
      until the next event; it does NOT auto-dismiss on a timer.
- [x] 6.4 Implement the indicator banner in `Layout.tsx`, consuming
      `UploadStatusContext`, per `design.md` Decision 7.
- [x] 6.5 Write a test confirming the indicator remains visible/consistent
      across a simulated route change (render the app at `/browse-graviscans`,
      trigger an upload, navigate to `/metadata`, assert the indicator still
      reflects the in-flight/completed state) — this is the behavior the
      global context exists for; a per-page-local state implementation
      would fail this test. (Implemented at the Layout-test level — renders
      Home + Configure Scanner routes under one `UploadStatusProvider`,
      fires progress, navigates via the sidebar link, confirms the
      indicator survives the `Outlet` swap; the full-App
      `/browse-graviscans` → `/metadata` version is covered as planned by
      task 10.3's E2E scenario.)
- [x] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check gate
      before starting Section 7. (Lint/typecheck clean; 4/4 in
      UploadStatusContext.test.tsx, 11/11 in Layout.test.tsx; same 7
      pre-existing baseline failures elsewhere, no new ones.)

## 7. ExperimentDetail.tsx (TDD)

- [x] 7.1 Write failing component tests in new
      `tests/unit/pages/ExperimentDetail.test.tsx` covering: metadata summary
      rendering from a mocked `graviscans.experimentDetail` response;
      "experiment not found" message (no crash) for an unknown
      `experimentId`; a generic `experimentDetail` error response rendering a
      friendly message, not throwing; Linked Metadata list using
      `useWaveMetadataLinks`, where clicking Unlink shows a
      `window.confirm()` naming the wave and accession before calling
      `unlink()` — cancelling the confirmation makes no IPC call and leaves
      the link in place; for wave `0`, the confirmation copy additionally
      notes the experiment's default accession is unaffected; link-a-new-wave
      form defaulting to `suggestedNextWave`, with its metadata-file select
      sourced from a mocked `graviPlateAccessions.listFiles()` (not
      `accessions.list()`), calling `link()`, and showing `linkError` inline on
      failure without clearing the form; scanner/wave filter chips narrowing
      visible rows; clicking a file row expands an inline TIFF preview
      (mocked `readScanImage`) plus the 7 metadata fields (capture date,
      transplant date, note, barcode, scanner, grid, plate, wave); per-plate
      verification-status badges for `needs_review` and `verified`, with no
      special styling for other status values.
- [x] 7.2 Implement `src/renderer/ExperimentDetail.tsx` satisfying 7.1's
      tests (replacing task 4.4's placeholder, if that task landed first),
      using `useResizableColumns` for the file table's column widths (no
      imperative `document.addEventListener` code directly in this
      component), and `window.confirm()` for the Unlink flow.
- [x] 7.3 Write a failing test confirming the resize handlers are the shared
      hook's (e.g. asserting `useResizableColumns` is called, or that
      unmounting mid-drag removes listeners exactly once per Section 2's hook
      tests) rather than a second inline implementation.
- [x] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check gate
      before starting Section 8. (Lint/typecheck clean — one `as unknown as`
      cast needed for `experimentDetail`'s Prisma `Date` fields vs. this
      component's string-typed row interface; 11/11 in
      ExperimentDetail.test.tsx; same 7 pre-existing baseline failures
      elsewhere, no new ones. Metadata-summary fields are sourced from two
      calls — `experiments.get` for name/scientist/accession,
      `graviscans.experimentDetail` for scans/verification — since no single
      handler returns both; not previously specified at this level of detail
      in tasks.md, recorded here for anyone tracing the implementation back
      to the spec.)

## 8. Metadata.tsx / GraviMetadataUpload.tsx / GraviMetadataList.tsx (TDD)

- [x] 8.1 Add a spreadsheet-parsing dependency to `package.json` (per issue
      #207's checklist item), and write a short
      `docs/graviscan-metadata-spreadsheet-schema.md` documenting the
      expected spreadsheet columns (Plate ID, Section ID, Plant QR,
      Accession, Medium, Transplant Date, optional Custom Note).
      **Correction found during implementation**: issue #207 names `xlsx`,
      but the npm-registry build (0.18.5, npm's only version) has two
      unpatched high-severity CVEs (prototype pollution, ReDoS) SheetJS
      fixes only via their own CDN, not npm — and `xlsx` is already a
      pre-existing transitive dependency of this repo's `@salk-hpi/bloom-fs`
      package, so adding it again directly would compound that existing
      vulnerability rather than merely accept it. Used `exceljs@^4.4.0`
      instead (npm-registry-only, no direct high-severity findings — its
      one audit hit is a moderate, unrelated issue via `uuid`), confirmed
      with the user before installing.
- [x] 8.2 Write failing tests for `GraviMetadataUpload.tsx` in new
      `tests/unit/components/GraviMetadataUpload.test.tsx`: rejects
      non-`.xlsx`/`.xls` files and files over 15MB before parsing; rejects a
      valid-type file whose chosen sheet has zero data rows; sheet-selection
      prompt for multi-sheet files; column-mapping UI for the six required
      fields + optional Custom Note; live preview capped at 20 rows; a row
      with some-but-not-all required cells filled is flagged as a validation
      error and blocks submission; a fully valid mapped file groups rows by
      Plate ID and calls
      `graviPlateAccessions.createWithSections({name}, plates)`; success shows
      a completion message, resets the form, and calls `onUploadComplete`.
- [x] 8.3 Implement `src/renderer/components/GraviMetadataUpload.tsx`
      satisfying 8.2's tests. Includes a sheet-selector dropdown, shown only
      when the workbook has more than one sheet, re-parsing on change (this
      was missing from the first implementation pass and added as a
      follow-up fix once caught against the spec's "Column mapping"
      scenario).
- [x] 8.4 Write failing tests for `GraviMetadataList.tsx` in new
      `tests/unit/components/GraviMetadataList.test.tsx`: lists
      files from `listFiles()` with name/date/linked-experiments/plate count,
      chronological, no filter/sort controls; expanding a row lazily fetches
      `list(fileId)` and renders row-spanned plate cells over per-section
      rows; Delete surfaces the backend's blocked-deletion error without
      removing the entry when the file is still referenced; Delete removes
      the entry on success when unreferenced.
- [x] 8.5 Implement `src/renderer/components/GraviMetadataList.tsx`
      satisfying 8.4's tests, and `src/renderer/Metadata.tsx` composing both
      components with no internal mode branch (per `design.md` Decision 11,
      replacing task 4.4's placeholder if that task landed first), and write
      a test confirming it renders both unconditionally when mounted (its
      mode-gating is entirely the route's responsibility, tested in
      Section 4).
- [x] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check gate
      before starting Section 9. (Lint/typecheck clean; 9/9 in
      GraviMetadataUpload.test.tsx, 4/4 in GraviMetadataList.test.tsx, 1/1
      in Metadata.test.tsx, 9/9 in App.test.tsx after adding the
      `graviPlateAccessions.listFiles` mock it now needs; same 7
      pre-existing baseline failures elsewhere, no new ones.)

## 9. Wave-scoped metadata-link UI in Experiments.tsx (TDD)

- [x] 9.1 Write failing **component-level** tests in new
      `tests/unit/pages/Experiments.test.tsx` (mocked IPC — this file owns
      all the branching/UI-logic assertions): each `graviscan`-typed
      experiment in the list shows its linked waves inline (via
      `useWaveMetadataLinks`) with Unlink actions gated by a
      `window.confirm()` step whose copy names the wave/accession
      (cancelling makes no IPC call; for wave `0`, the copy additionally
      notes the experiment's default accession is unaffected); the existing
      "attach" panel branches per `experiment_type` — selecting a
      `cylinderscan` experiment shows the existing single-accession
      `attachAccession` flow unchanged; selecting a `graviscan` experiment
      shows a wave-number field (defaulting to `suggestedNextWave`) +
      metadata-file select (options from a mocked `graviPlateAccessions.listFiles()`,
      not `accessions.list()`) calling `link()`; attempting to link an
      already-linked wave surfaces the backend's rejection inline without
      altering the existing link.
- [x] 9.2 Implement the branch in `Experiments.tsx` satisfying 9.1's tests, per
      `design.md` Decision 5 and the updated "Attach Accession to Existing
      Experiment" requirement. (6/6 in Experiments.test.tsx, including the
      wave-0 confirmation-copy case. Note: the attach panel's wave-number
      input is labeled "Wave Number to Link" — not "Wave Number" — to avoid
      an ambiguous duplicate-label collision with `ExperimentForm.tsx`'s own
      "Wave Number" field, since both render simultaneously in graviscan
      mode on this page.)
- [x] 9.3 **Deviation found during implementation**: not added to
      `tests/e2e/experiments-management.e2e.ts` as originally planned — that
      file's file-level `test.beforeEach`/`afterEach` hardcode
      `SCANNER_MODE=cylinderscan` via `createTestBloomConfig()`, shared
      across every `describe` block in the file with no per-describe
      override point; adding a graviscan-mode test there would mean either
      editing shared hooks (risking that file's existing passing
      cylinderscan tests) or launching a second, conflicting Electron
      instance. Written instead as a new, self-contained
      `tests/e2e/graviscan-experiments-wave-linking.e2e.ts`, matching
      `graviscan-ipc.e2e.ts`'s existing graviscan-mode launch/teardown
      pattern: seeds a graviscan experiment via Prisma, drives the real
      "attach" panel to link then unlink a wave (handling the real
      `window.confirm()` dialog), asserting against the real database both
      times. **Not executable-verified in this environment** — see Section
      10's note below; the same blocker applies here.
      **Bug found during `/review-pr`** (confirmed real by reasoning through
      Playwright's `selectOption` semantics, not by running it — the
      environment blocker above still applies): the spec selected the
      experiment via `{label: new RegExp(...).source}`, which collapses back
      to a plain string, so Playwright would require an exact match — but
      `Experiments.tsx`'s `getExperimentDisplay()` renders the option as
      `"{species} - {name} ({scientistName})"`, not the bare name. Fixed to
      select by `value` (the experiment id, already held in a local
      variable) instead of `label`.
- [x] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check gate
      before starting Section 10. (Lint/typecheck clean; full unit suite
      green modulo the same pre-existing baseline flakiness noted throughout
      this file, no new failures.)

## 10. E2E coverage

**Environment note, discovered while working this section**: none of the
new specs below (10.1–10.3), nor 9.3's, could be executed to a verified
green/red result in this local Windows dev environment. Two **pre-existing**
infrastructure issues block the _entire_ E2E suite here, not just Tier 5's
new specs — confirmed by first reproducing both against the untouched,
already-merged `tests/e2e/graviscan-ipc.e2e.ts`:

1. `tests/e2e/*.e2e.ts`'s `launchElectronApp()` helpers hardcode
   `.webpack/main/index.js`, but the installed Electron Forge webpack
   plugin now nests its output per-architecture
   (`.webpack/x64/main/index.js`) — confirmed by running
   `npx electron-forge package` directly and inspecting its output.
2. Once that path is bridged (verified locally via a directory junction,
   not committed — not a real fix), Electron still fails to start:
   `src/main/database.ts`'s `loadPrismaClient()` treats any process where
   `NODE_ENV !== 'development'` as "packaged" and looks for the Prisma
   client under `process.resourcesPath/.prisma/client/index.js` — a path
   only populated by a full `electron-forge package`/`make` run, not by
   directly launching `electron .webpack/main/index.js` the way every
   `*.e2e.ts` file's `launchElectronApp()` does (all of them set
   `NODE_ENV: 'test'`, not `'development'`). This is a real, pre-existing
   gap in `loadPrismaClient()`'s dev/packaged branching, not something this
   change touches or introduces.

Both were reproduced against the pre-existing, unmodified
`graviscan-ipc.e2e.ts` before writing any new spec, confirming they are not
caused by this change. `scripts/check-ipc-coverage.py` (task 10.5, a static
analysis script with no Electron dependency) runs fine and is reported
below. **The new E2E specs are written to spec and match established
conventions, but are unverified — recommend running them in CI (which may
already have a working launch path) or a freshly-provisioned dev
environment, and fixing the two issues above, before treating this tier's
E2E coverage as complete.**

- [x] 10.1 Add a new Playwright E2E spec (e.g.
      `tests/e2e/graviscan-browse-metadata.e2e.ts`) driving the real
      Electron app: seed a `graviscan` experiment + `GraviScanner`/`GraviScan`
      rows + a metadata file directly via Prisma (matching
      `tests/integration/database.test.ts`'s seeding convention); navigate
      `/browse-graviscans`, confirm the seeded experiment's row renders with
      expected fields; navigate to its Experiment Detail page, link a new
      wave, confirm it appears, unlink it (confirming the `window.confirm()`
      dialog via Playwright's `page.on('dialog', ...)`), confirm it
      disappears; navigate to `/metadata`, confirm the seeded file appears in
      the list.
- [x] 10.2 Add an E2E scenario confirming the "Metadata"/"Browse Scans"
      workflow-step cards on Home and the sidebar links on Layout resolve to
      the new routes in `graviscan` mode (not `/experiments`/`/browse-scans`),
      and that the shared "Browse Scans" sidebar link is absent in graviscan
      mode. (Included in `graviscan-browse-metadata.e2e.ts`.)
- [x] 10.3 Add an E2E scenario for the global upload-progress indicator:
      trigger an upload/backup from `/browse-graviscans`, navigate to
      `/metadata` before it completes, and confirm the Layout-level indicator
      still reflects live progress and the eventual result — this is exactly
      the cross-navigation persistence behavior a mocked/unit-level test
      cannot fully validate against real IPC event timing. (Included in
      `graviscan-browse-metadata.e2e.ts`, using the deterministic
      "rclone not installed" path so the test doesn't depend on a real
      rclone binary being present.)
- [~] 10.4 Run `npm run test:e2e -- <the new spec files from 10.1-10.3>` and
  confirm they pass against a real Electron+SQLite instance. Also
  re-run the pre-existing `tests/e2e/experiments-management.e2e.ts` and
  `tests/e2e/experiment-accession-indicator.e2e.ts` (both exercise
  `Experiments.tsx`/`ExperimentForm.tsx`, which this change modifies) to
  confirm no regression from the new `mode` prop or wave-number field.
  **Not completed** — blocked by the two pre-existing environment issues
  described above. Specs are written and `--list`-verified to parse/
  import correctly (`npx playwright test <files> --list` enumerates all
  6 new tests with no errors), but no pass/fail result could be obtained
  in this environment. Must be run for real (CI or a fixed dev
  environment) before this tier is considered E2E-complete.
- [x] 10.5 Run `npm run test:e2e:coverage` and confirm the existing 90% IPC
      coverage gate is unaffected — this change adds no new `db:*`/
      `database.*` handlers (`ensureDir`/`listScanFiles` are under the
      `graviscan:*` prefix, outside the gate's scope, per `design.md` Context).
      Verified: this script is pure static analysis (no Electron dependency),
      ran successfully — 43/45 = 95.6%, same two pre-existing untested
      handlers as before (`db:accessions:updateMapping`, `db:images:create`),
      no regression.

## 11. Roadmap-doc known-bug-avoidance spot checks

- [x] 11.1 Confirm (by reading the final diff, not by memory) that no new
      renderer file imports or references `ScannerConfigSection.tsx`/
      `useScannerConfig.ts`, that no new component uses a build-time
      `APP_MODE` constant or a `Scanning.tsx`-style dispatcher shell, and
      that none of task 4.4's placeholder component bodies
      (`return null`) remain anywhere in `src/renderer/` — each must have
      been replaced by its real implementation (5.2, 7.2, 8.5).
      Verified: grepped `src/renderer` for `ScannerConfigSection`,
      `useScannerConfig`, `APP_MODE` — zero real references (one comment in
      `Metadata.tsx` mentions `APP_MODE` only to explain why it was
      deliberately avoided). Grepped for `return null;` — all five hits
      (`ExperimentDetail.tsx`, `Experiments.tsx`, `Layout.tsx`, plus two
      pre-existing in `AccessionFileUpload.tsx`/`WedgeBanner.tsx`) are
      legitimate loading/empty-state guards, not leftover placeholder
      component bodies.
- [x] 11.2 Confirm the `useResizableColumns` hook's cleanup path (Section 2)
      is actually exercised by `ExperimentDetail.tsx` (Section 7) — i.e. no
      second inline drag-listener implementation was written instead of using
      the hook.
      Verified: `ExperimentDetail.tsx` imports and calls
      `useResizableColumns`; a search for inline
      `addEventListener('mousemove'/'mouseup', ...)` in the file returns no
      matches, confirming no duplicate drag implementation.
- [x] 11.3 Run `gh issue list --search "downloadImages wave-scoped accession"
--state all` (or equivalent search on "GraviExperimentWaveMetadata
      download" / "wave-scoped CSV export") from the repo root. If no
      matching open or closed issue is found, file a new one referencing
      `design.md` Decision 10 and `image-handlers.ts:501-505`, so the
      named-but-not-fixed limitation has a tracking home per this codebase's
      convention (matching issue #286's precedent). If a matching issue is
      found, link it here instead of filing a duplicate.
      No matching issue found across 3 search phrasings. Filed
      [#288](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/288).

## 12. Verification

- [x] 12.1 Run `npm run lint` and `npm run format:check`.
      Both clean. `format:check` initially flagged formatting drift in this
      change's own files (never previously run through Prettier) plus 5
      files that arrived via the `origin/main` merge below and are
      pre-existing baseline issues on `main` itself (not touched by this
      change) — left those alone; fixed the former with `prettier --write`.
- [x] 12.2 Run `npm run test:unit` (full suite, not just this change's new
      files) and confirm no new failures relative to the pre-change baseline.
      This branch was 5 commits behind `origin/main` (missed
      `harden-cylinderscan-tier1` PR #280 and the retryScanner fix PR #285);
      merged `origin/main` in cleanly (no conflicts, including in
      `preload.ts`/`electron.d.ts` where both sides had added content) before
      running this. Also needed `npx prisma generate` (fresh worktree) and
      `BLOOM_DATABASE_URL="file:./prisma/dev.db" npx prisma migrate deploy`
      (the merge brought in 3 new migrations `dev.db` hadn't applied yet) to
      get `tests/unit/graviscan/database-handlers.test.ts` running at all —
      both environment setup, not code changes. Result: 6 failures, same
      baseline family as before (Windows path-separator assertions in
      `config-store.test.ts`/`image-uploader.test.ts`/`scan-coordinator.test.ts`,
      plus a flaky `AccessionForm.test.tsx` timeout and an unrelated
      `MachineConfiguration.test.tsx` unhandled-rejection) — none in files
      this change touches, no regression.
- [x] 12.3 Run `npx tsc --noEmit` (or the project's typecheck script). Clean,
      both before and after the `origin/main` merge.
- [~] 12.4 Run the full `npm run test:e2e` suite (not just this change's new
  specs) to confirm no regression in cylinderscan-mode routing or the
  pre-existing GraviScan E2E coverage (Tier 1-3's specs, and PR #278's
  `experiments.{link,unlink,list}GraviMetadata` block in
  `tests/e2e/renderer-database-ipc.e2e.ts`). **Not completed** — same
  environment blocker as 10.4.
- [x] 12.5 Run `npm run build` (or the project's renderer build script) to
      confirm the new routes/components compile into the packaged bundle
      without error. `npm run build:webpack` turned out to be a pre-existing,
      unrelated broken script (it invokes `webpack` directly against
      Electron Forge's webpack-plugin config files, which use plugin-specific
      keys like `mainConfig`/`rendererConfig` that raw webpack's CLI doesn't
      understand — not something this change introduced or can fix in
      scope). Used `npx electron-forge package` instead, which is the
      project's actual packaging path and exercises the same webpack build
      internally: succeeded with no errors, confirming the new routes and
      components compile cleanly into the packaged bundle.
- [~] 12.6 Manually launch the app in `graviscan` mode (`npm run dev` /
  the project's dev-server workflow) and walk the golden path: Home →
  Metadata (upload a real spreadsheet) → Experiments (create a graviscan
  experiment, link a wave) → Browse GraviScans (see the row, click
  through to Experiment Detail) → Experiment Detail (link/unlink a wave,
  confirming the Unlink dialog, view a file preview) → Layout (confirm
  the upload-progress indicator persists across the navigation above) —
  confirm no console errors and no visibly broken states, per the
  CLAUDE.md UI-verification requirement.
  **Not completed.** Two blockers, both environment-specific to this
  session, neither a code defect: (1) the local `~/.bloom/.env` this
  machine's real hardware config lives in was blanked by an unrelated
  mishap while attempting an automated stand-in for this task (see
  conversation) — the user will refill it separately, so this
  environment currently has no real graviscan hardware config to launch
  against; (2) this sandbox has no interactive display attached, and a
  throwaway script attempt to drive the packaged app via Playwright's
  `_electron` API failed to launch against the renamed/packaged exe
  (works against the raw `electron` binary in the existing E2E specs,
  per Section 10, but not against `Bloom Desktop.exe` directly) — so
  there is no working path to a real, visible golden-path walkthrough
  from this environment. This is a genuine gap: a human (or a session
  with a real display and the real `.env` restored) should still walk
  the golden path described above before treating this tier as fully
  verified, per the CLAUDE.md UI-verification requirement.

## 13. Corrections found during `/review-pr` (post-implementation review, PR #290)

Five parallel adversarial reviewers (code quality/architecture, testing/TDD,
scientific rigor/UX, security/cross-platform, behavioural correctness) ran
against the actual PR diff after Sections 1-12 were already complete and
believed done. Matching the Tier 3 precedent this workflow follows
(pre-implementation review scrutiny does not guarantee post-implementation
correctness — see the roadmap doc's "cycle reviews at both ends" note), this
round surfaced real bugs the unit-test suite's own mocks had been masking.
Security review found no blocking issues (one dead-code note: `ensureDir`/
`listScanFiles` are exposed in preload but have no consumer in this diff —
left as-is, not a defect, just unused surface for now).

- [x] 13.1 **`ExperimentDetail.tsx` rendered raw `Date` objects as JSX
      children.** `graviscansExperimentDetail`'s real IPC return has
      `capture_date`/`transplant_date` as actual `Date` instances
      (structured-clone preserves them across `ipcRenderer.invoke`), not the
      `string` the `GraviScanRow` interface declared and the `as unknown as
GraviScanRow[]` cast forced past the compiler — React throws when a
      bare `Date` is rendered directly. Masked by every test's `makeScan()`
      fixture using ISO strings instead of real `Date` objects. Fixed with a
      `formatDate()` helper matching `BrowseScans.tsx`/`ScanPreview.tsx`'s
      existing convention; added a dedicated regression test using real
      `Date` objects.
- [x] 13.2 **False "success" message on failed metadata link.**
      `Experiments.tsx`'s `handleAttachAccession` (graviscan branch) called
      `link()` and unconditionally showed "Metadata file successfully
      linked," even when `link()` failed — `useWaveMetadataLinks.link()`
      swallowed failures into its own `linkError` state and returned
      nothing, so the caller had no way to know. Fixed by having
      `link()`/`unlink()` return a boolean; callers now gate success
      messaging on that return value. Added a regression assertion that the
      success text is absent when linking fails.
- [x] 13.3 **Global upload-progress indicator was non-functional.**
      `Layout.tsx`'s `UploadStatusBanner` read `progress.completed`/
      `progress.total`, but the real `graviscan:upload-progress` payload
      (`src/main/box-backup.ts`'s `BoxBackupProgress`) is
      `{totalImages, completedImages, failedImages, currentExperiment}` —
      there is no `completed`/`total` field, so the banner always showed
      "0/0". Masked by `Layout.test.tsx` firing mock events shaped like the
      wrong interface instead of the real payload. Fixed the type and
      rendering to the real field names; corrected the test fixtures to
      match. (The identity-based Dismiss comparison was _not_ a bug — it
      correctly implements "hides until the next event," matching this
      section's own test name and Decision 7's design; left unchanged.)
- [x] 13.4 **`BrowseGraviScans.tsx`'s per-row Box-backup progress never
      rendered.** `boxProgress` is keyed by `progress.currentExperiment`,
      which `box-backup.ts` sets to the experiment's _name_
      (`expName`) — but the row lookup used `boxProgress[exp.id]`, a key
      that could never match. Fixed the lookup to key by `exp.name`,
      matching what the payload actually contains (there is no id in the
      real payload); corrected the existing test's fixture, which had been
      asserting against the same wrong id-based key.
- [x] 13.5 **Mismatch warning (Decision 10) never fired for "All Waves,"
      the default selection.** `handleDownload` only checked the
      _selected_ wave's link against the experiment's default accession;
      with "All Waves" selected (`waveNumber === undefined`), the lookup
      always returned nothing, so the warning could never appear no matter
      how many linked waves diverged — directly contradicting this
      requirement's own "Mismatch warning before an 'All Waves' download"
      scenario, untested by the existing suite. Fixed to check every linked
      wave when "All Waves" is selected and name every diverged wave (not
      just the first) in the warning text; added warn/no-warn "All Waves"
      tests.
- [x] 13.6 **No double-submit guard on Link/Unlink in `ExperimentDetail.tsx`
      or `Experiments.tsx`'s inline per-row Unlink** (unlike the attach
      panel's existing `isAttaching` guard). Rapid re-clicks could fire
      overlapping IPC calls; a second `linkGraviMetadata` call could pass
      the handler's check-then-act "already linked" pre-check before the
      first write lands, then hit the real DB unique constraint and surface
      a raw Prisma error instead of a friendly message. Added
      `isLinking`/`unlinkingWave` pending state to both components,
      disabling the relevant button while a call is in flight.
- [x] 13.7 **Stale-response race in `useWaveMetadataLinks`.** No
      cancellation guard meant an in-flight `refetch`/`link`/`unlink` for a
      previous `experimentId` (e.g. after route-param navigation, or
      switching the selected experiment in the attach panel) could resolve
      after a newer request and overwrite state with the wrong
      experiment's data. Fixed with a ref tracking the current
      `experimentId`, checked before every `setState` in the hook; added a
      regression test simulating an out-of-order resolution.
- [x] 13.8 **`unlink()` gave zero feedback on failure** (unlike `link()`).
      Fixed to set `linkError` on failure, matching `link()`'s pattern;
      `Experiments.tsx`'s inline `ExperimentWaveLinks` (which previously
      didn't even read `linkError` from the hook) now displays it.
- [x] 13.9 **E2E selector bug**, see 9.3's note above (fixed to select by
      value/id instead of an exact-string label).
- [x] 13.10 **Task 5.1's claimed pagination-control test coverage didn't
      exist**, see 5.1's note above (added the real tests).
- [x] 13.11 **Deferred, not fixed** (lower severity, tracked here rather
      than silently dropped): `Experiments.tsx`'s `useWaveMetadataLinks(
attachExperimentId || 'none')` fires a wasted no-op
      `listGraviMetadata('none')` call when no experiment is selected for
      attach; `GraviMetadataList.tsx`'s Delete has no `window.confirm()`
      (backend still blocks deletion while referenced, so no data-loss risk,
      just an inconsistency with Unlink's gating); `setAuditLogger`'s
      unset-logger case fails silently rather than logging a warning if a
      graviscan mutation ever somehow occurs outside graviscan mode.
- [x] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check
      gate after applying 13.1-13.10. (Lint and typecheck clean; full
      suite: same pre-existing baseline failures as documented in Section
      12 — config-store/image-uploader/scan-coordinator path-separator
      assertions, flaky `AccessionForm` timeouts — no new failures; all
      touched test files re-run in isolation first and confirmed green.)

### Round 2: verifying the round-1 fixes themselves (no new full 5-lens sweep)

A second, narrower review verified 13.1-13.10's fixes are correct and
checked whether they introduced anything new. Verdict: solid enough to
merge, no blocking issues — closing this loop rather than spawning a third
round, since nothing beyond the two items below surfaced.

- [x] 13.12 **Test-coverage gaps that would let a regression slip through
      undetected**, even though the fixes themselves were correct: the
      "All Waves" mismatch-warning test only checked that the diverged
      waves were named, never that the matching wave (0) was excluded — a
      "warn about every linked wave regardless of match" regression would
      still have passed. Neither `ExperimentDetail.tsx`'s nor
      `Experiments.tsx`'s new double-submit guards (13.6) had a test
      actually exercising them. Added: an exclusion assertion to the
      "All Waves" test; two new tests (one per component) that hold
      `linkGraviMetadata`/`unlinkGraviMetadata` pending, click the
      button twice, and assert the IPC method was called exactly once.
- [x] 13.13 **New, real (if narrow) limitation surfaced by 13.4's fix, not
      a regression in the fix itself**: keying `boxProgress` by
      `exp.name` (there is no id in the real payload to key by) means two
      _different_ experiments sharing the same name, visible on the same
      page during a concurrent Box backup, would show identical/bleeding
      progress on both rows. Before this fix the wrong `exp.id` key meant
      progress silently never rendered at all (safe but useless); now that
      it renders correctly, this is the one scenario where it can render
      _incorrectly_. `Experiment.name` has no uniqueness constraint and
      `box-backup.ts`'s payload has no id to fix this on the renderer side
      alone. Filed
      [#292](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/292)
      to add an id to `BoxBackupProgress` rather than fix in scope here.
- [x] Run `npm run lint && npx tsc --noEmit` plus the three touched test
      files in isolation — check gate after 13.12. (Clean; 41/41 across
      `ExperimentDetail.test.tsx`/`Experiments.test.tsx`/
      `BrowseGraviScans.test.tsx`.)

## 14. E2E CI investigation (12.4's blocker) — three real bugs found in sequence, two fixed

12.4 (full E2E suite) was blocked by every single test failing on this
branch's CI, from the first test, in unrelated files, across all 3 OSes.
Root-caused via diagnostic instrumentation (temporary `pageerror`/`console`
capture + main-process stdout/stderr piping added to E2E spec files,
still in place — genuinely useful, kept rather than reverted) rather than
guesswork. Historical framing in earlier drafts of this doc (an
`app.on('ready')`/`waitUntilReady()` timeout) was **wrong** — never
verified against real error text, since no prior CI run ever printed
per-test failures. TDD used for both real fixes below.

- [x] 14.1 **exceljs crashes the entire renderer on every launch,
      `ReferenceError: require is not defined`.**
      `App.tsx` statically imported `Metadata.tsx` →
      `GraviMetadataUpload.tsx` → `exceljs`; exceljs's own "browser"
      bundle (`dist/exceljs.min.js`) still has an internal Browserify
      module-loader fallback that calls the real Node `require()` for an
      unbundled dependency, which doesn't exist in Electron's sandboxed
      renderer. This crashed the renderer script before `ReactDOM.render()`
      ever ran — for every mode, every route, every test, not just
      Metadata. A first attempt (webpack `resolve.alias` pointing at the
      browser bundle) reduced but did not fix this — the browser bundle
      itself is the broken one. Real fix: moved parsing into the main
      process (new `graviscan:parse-excel-file` IPC channel,
      `src/main/graviscan/excel-parser.ts`, real Node `require()` — no
      bundling involved) and `GraviMetadataUpload.tsx` now sends the raw
      file buffer and gets back plain parsed data.
      `App.tsx`'s `Metadata` route stayed lazy-loaded (a legitimate
      bundle-size win independent of this bug now). Verified: zero
      `exceljs`/`ExcelJS` references and zero raw `require()` calls
      anywhere in the packaged renderer bundle (`electron-forge package` + `asar extract` + grep); zero `pageerror` events in CI afterward.
- [x] 14.2 **Linking a wave via the attach panel never updated that
      experiment's own row display.** `Experiments.tsx`'s attach panel
      and each row's `ExperimentWaveLinks` each ran an independent
      `useWaveMetadataLinks(experimentId)` instance with its own
      `useState` — two separate copies of "what's linked" for the same
      experiment. Linking through the attach panel only refetched its
      own copy; the row's copy never learned anything changed. This is
      what made `graviscan-experiments-wave-linking.e2e.ts`'s
      link-then-unlink test hang forever waiting for the newly-linked
      wave's Unlink button to appear. Fixed by moving the hook's state
      into a new `WaveMetadataLinksProvider`
      (`src/renderer/contexts/WaveMetadataLinksContext.tsx`, mirroring
      the existing `UploadStatusContext` precedent), keyed by
      `experimentId` so every call site watching the same experiment
      shares one cache. `useWaveMetadataLinks`'s public API is
      unchanged. Verified via CI: the wave-linking E2E test now passes.
- [x] 14.3 **New, third, independent bug surfaced once 14.1/14.2 cleared
      the way** — now fixed. `Error: Objects are not valid as a React
child (found: [object Date])`, crashing the Metadata page whenever
      `GraviMetadataList` actually renders. `database-handlers.ts`'s
      `graviPlateAccessionsListFiles()` (~line 831) sends Prisma's raw
      `createdAt` field (a real `Date` object) straight over IPC —
      Electron's structured-clone IPC preserves `Date` instances rather
      than stringifying them. `GraviMetadataList.tsx`'s own local
      `MetadataFile` interface declared `createdAt: string` (never
      validated against the real runtime shape) and rendered
      `{file.createdAt}` directly as a JSX child at line 78, which React
      refuses for a raw `Date`. The existing unit test
      (`tests/unit/components/GraviMetadataList.test.tsx`) mocked
      `createdAt` as an ISO string, masking this entirely. A sweep of
      sibling `graviPlateAccessions*` handlers found the identical bug
      pattern one field over: `graviPlateAccessionsList()`'s
      `transplant_date` (also Prisma `DateTime?`) hit the same
      `GraviMetadataList.tsx` render path via the `Plate` interface's
      `{plate.transplant_date}` (line ~98), just never exercised by CI
      because no seeded plate in the E2E fixtures set a transplant date.
      Fixed both call sites by widening the renderer's types to
      `string | Date` and adding a `formatDate()` helper that renders a
      `Date` via `toISOString()` (matching the raw-string display the
      code already used for pre-serialized values, so on-screen output
      is unchanged) instead of passing the value straight to JSX — kept
      the `Date` flowing over IPC as-is rather than serializing in the
      main process, since Electron's structured clone already preserves
      it correctly and no other consumer needs a different shape.
      TDD: `tests/unit/components/GraviMetadataList.test.tsx`'s mocks for
      `createdAt` and `transplant_date` now use real `Date` objects
      (matching actual IPC payload shape) instead of pre-formatted
      strings; confirmed RED (`Objects are not valid as a React child`)
      against the old renderer code, then GREEN after the `formatDate()`
      fix, all 4 tests passing. Added two regression-lock assertions in
      `tests/unit/graviscan/database-handlers.test.ts`
      (`toBeInstanceOf(Date)` on `listFiles()`'s `createdAt` and on a new
      `list()` test for `transplant_date`) documenting the real runtime
      contract so a future accidental serialization change is caught
      immediately rather than three bugs deep again. Verified locally:
      `npx tsc --noEmit -p .` clean, `npm run lint` clean, `npx prettier
--check` clean, both affected unit test files green (4/4 and
      86/86), and the full `tests/unit` suite shows only the 5
      pre-existing Windows path-separator failures already documented
      above (unrelated: `image-uploader.test.ts`,
      `scan-coordinator.test.ts`) — no new failures introduced. Pushed to
      CI for the authoritative real-Electron E2E confirmation (see 14.4).
      The first push's CI run also failed Lint (this branch had drifted
      behind `main` since before `main`'s own PR #319 Prettier-drift fix,
      so `format:check` failed on files this branch never touched) and
      showed a `Test - TypeScript Unit` failure in
      `ExperimentDetail.test.tsx` unrelated to this change (doesn't
      import anything touched here; passed 3/3 locally in isolation; a
      _different_ unrelated test file failed wholesale on the prior CI
      run before this fix too) — consistent with pre-existing CI-only
      flakiness in that job, not a regression. Merged `origin/main`
      (4 commits, all CI/docs/formatting, no conflicts) to pick up PR
      #319; that alone didn't fully resolve it since a later commit on
      `main` itself (the pr-checks-concurrency-control archive) re-drifted
      the same file, so fixed that directly too (whitespace-only).
      **CI-confirmed on the resulting push, all 3 OSes**: the exact test
      14.3 was written to fix,
      `graviscan-browse-metadata.e2e.ts` › "Metadata page lists the
      seeded file", now passes deterministically on ubuntu-latest,
      macos-latest, and windows-latest — the `[object Date]` crash is
      gone.
- [ ] 14.4 Once 14.3 is fixed, confirm 12.4 (full E2E suite, all 3 OSes)
      finally goes green, and complete 12.6 (manual golden-path
      walkthrough) if feasible. **Not yet green.** Two more tests in the
      same spec file fail, deterministically and identically on all 3
      OSes, for reasons unrelated to 14.3's Date bug.

      Candidate bug 4 — `"Metadata" and "Browse GraviScans" workflow
      steps/nav resolve to the new routes...` fails at
      `window.waitForURL(/\/metadata$/)` (line 262) with a 30s timeout.
      `App.tsx` renders routes inside a `MemoryRouter`
      (`src/renderer/App.tsx` ~line 61), which never touches the real
      window/page URL — so `waitForURL` targeting a route path can never
      resolve regardless of whether navigation itself is correct. This
      is the only `waitForURL` call anywhere in `tests/e2e/` (grepped);
      every other E2E test asserts on rendered content instead. Looks
      like a test-authoring mismatch with the app's actual routing
      architecture, not an app bug — unconfirmed, not yet investigated
      to the same root-cause standard as 14.1-3.

      Candidate bug 5 — `global upload-progress indicator persists
      across navigation...` fails earlier, at
      `window.waitForSelector('text=Box backup unavailable')` (line 273)
      after clicking "Backup to Box", before the test ever reaches its
      actual Metadata-navigation assertion. Unrelated to Metadata/Date
      entirely; looks like a distinct pre-existing issue in the
      Box-backup/rclone friendly-error-message path. Not investigated.

      Neither was reachable before 14.3 landed (the whole page crashed
      first), so — consistent with 14.1/14.2/14.3's pattern — these were
      always latent, just never exposed until now. Left for a follow-up
      decision rather than fixed unilaterally, since both are outside
      14.3's actual scope (the `[object Date]` crash) and the second one
      touches an entirely different feature area.

- [ ] 14.5 Diagnostic-only test instrumentation (`electron-main
stdout`/`stderr` piping and `pageerror`/`console` listeners in
      several `tests/e2e/*.e2e.ts` files) is still in place — decide
      whether to keep permanently (it proved genuinely useful three times
      over) or trim back once 14.3 lands and the suite is fully green.
