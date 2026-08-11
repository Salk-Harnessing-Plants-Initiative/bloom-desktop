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

## 14. E2E CI investigation (12.4's blocker) — six issues found in sequence, all resolved, 12.4 green

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
- [x] 14.4 Once 14.3 is fixed, confirm 12.4 (full E2E suite, all 3 OSes)
      finally goes green, and complete 12.6 (manual golden-path
      walkthrough) if feasible. **Not yet green.** Two more tests in the
      same spec file fail, deterministically and identically on all 3
      OSes, for reasons unrelated to 14.3's Date bug.

      **Candidate bug 4 — confirmed as a test bug, fixed.**
      `"Metadata" and "Browse GraviScans" workflow steps/nav resolve to
      the new routes...` failed at `window.waitForURL(/\/metadata$/)`
      (line 262) with a 30s timeout. Downloaded the CI run's
      `playwright-results-ubuntu-latest` artifact and inspected
      `test-failed-1.png`: it shows the app correctly on the Metadata
      page (sidebar "Metadata" item active, "Spreadsheet File" / "Choose
      File" content rendered) at the moment of timeout — proving
      navigation itself works and only the assertion is broken. Root
      cause: `App.tsx` renders routes inside a `MemoryRouter`
      (`src/renderer/App.tsx` ~line 61), which never touches the real
      window/page URL, so `waitForURL` targeting a route path can never
      resolve regardless of correctness. Confirmed this is the only
      `waitForURL` call anywhere in `tests/e2e/` — every other test
      asserts on rendered content instead. Fixed by replacing it with
      `await window.waitForSelector('h1:has-text("Metadata")')`,
      matching `Metadata.tsx`'s actual `<h1>Metadata</h1>` (line 13) and
      the same pattern the "global upload-progress indicator" test
      already uses successfully. No app code changed — this was a
      test-only fix. Verified locally: `tsc --noEmit`, `eslint`, and
      `prettier --check` all clean on the changed file; pushed for CI
      confirmation (E2E tests can't run locally without launching
      Electron, which this session was told not to do without asking).
      **CI-confirmed, all 3 OSes**: this test now passes deterministically
      (ubuntu 4.4s, macOS 7.0s, Windows 6.4s — no timeout, no retry
      needed).

      Neither was reachable before 14.3 landed (the whole page crashed
      first), so — consistent with 14.1/14.2/14.3's pattern — these were
      always latent, just never exposed until now.

- [x] 14.6 **Candidate bug 5 — root-caused and fixed, TDD.**
      `global upload-progress indicator persists across navigation...`
      hung at `window.waitForSelector('text=Box backup unavailable')`
      after clicking "Backup to Box", never reaching its actual
      Metadata-navigation assertion.

      This file had no main-process stdout/stderr capture at all (only
      renderer-side `pageerror`/`console`), so the first step was adding
      that instrumentation (per `accession-excel-upload.e2e.ts`'s
      pattern) and pushing to CI to gather real evidence, per
      systematic-debugging's "gather evidence before hypothesizing"
      step. The resulting log showed `uploadAllScans()` (main process)
      completing correctly and fast — under 30ms — with
      `Box result: { success: false, ..., errors: ['rclone not
      installed'] }`, exactly as expected. So the backend was never the
      problem; something after that was silently wrong. Downloaded the
      CI run's screenshot for the failing test and found the page
      **had** rendered a message — just the wrong one: `"Uploaded
      undefined image(s), undefined skipped"` instead of the rclone
      message.

      Root cause: `register-handlers.ts`'s `wrapHandler` envelopes
      every IPC handler's return value as
      `{success: true, data: T} | {success: false, error: string}`
      (`graviscan:upload-all-scans` → `wrapHandler(() =>
      imageHandlers.uploadAllScans(...))`). `BrowseGraviScans.tsx`'s
      `handleBackupToBox` (~line 240) never unwrapped this envelope —
      it read `result.errors`/`result.failed`/`result.uploaded`/
      `result.skipped` directly off the top-level response instead of
      `response.data.*`, so every field was `undefined` and the code
      fell straight through to the final `else` branch regardless of
      what actually happened. The exact same file's `getScanStatus`
      caller (~line 203) already unwraps this envelope correctly
      (`if (result.success) { setScanActive(result.data.isActive) }`),
      so this was an inconsistency with the file's own established
      convention, not a novel pattern. Compounding factor:
      `uploadAllScans` was typed `Promise<any>` in `electron.d.ts`, so
      TypeScript had no way to catch the missing `.data` — the same
      "type declared but never checked against the real runtime shape"
      class of bug as 14.3 and its `transplant_date` sibling.

      TDD: extracted `uploadAllScans`'s inline return type into a named
      `UploadAllScansResult` interface
      (`src/main/graviscan/image-handlers.ts`) and mirrored it in
      `src/types/graviscan.ts` (matching this codebase's existing
      pattern of independent renderer-side type mirrors, e.g.
      `GetScanStatusResult`); gave `electron.d.ts`'s `uploadAllScans`
      the real `{success, data} | {success, error}` envelope type
      instead of `any`. `tests/unit/pages/BrowseGraviScans.test.tsx`'s
      three existing Box-backup-UI tests mocked `uploadAllScans` with
      the *unwrapped* shape (`{success, uploaded, skipped, failed,
      errors}` with no `.data` nesting) — exactly the same test-mock-
      never-validated-against-real-shape pattern as 14.3's
      `GraviMetadataList.test.tsx`. Updated all three mocks to the real
      envelope shape and added a fourth test for the previously
      untested `wrapHandler`-level failure path
      (`{success: false, error}`, e.g. a thrown exception in the main
      process). Confirmed RED against the un-fixed component — one test
      reproduced the exact `"Uploaded undefined image(s), undefined
      skipped"` text from the CI screenshot. Fixed `handleBackupToBox`
      to check `response.success` first and read the real fields off
      `response.data`, with a new branch surfacing a friendly message
      for the `wrapHandler`-failure case (previously unhandled
      entirely). Confirmed GREEN: all 21 tests in the file pass.
      Verified locally: `tsc --noEmit`, `eslint`, `prettier --check` all
      clean; full `tests/unit` suite shows only the same 5 pre-existing
      Windows path-separator baseline failures, no new failures. No app
      code change was needed beyond `BrowseGraviScans.tsx` — the main
      process, preload bridge, and IPC wiring were all already correct.
      **CI-confirmed the fix itself works**: the same test now gets
      past the "Box backup unavailable" wait in ~1s (previously a full
      30s timeout) and successfully reaches the Metadata page (whose
      date rendering — 14.3's fix — is also visibly correct in the
      failure screenshot). It still fails, but now at a *different*,
      later assertion — see 14.8.

- [x] 14.8 **Candidate bug 6 — root-caused and fixed, test-only.** The
      same test's final assertion,
      `expect(window.locator('[data-testid="upload-status-indicator"]')).toBeVisible()`
      (line 297), failed fast (~1s, not a timeout) with "element(s) not
      found". Traced why: `UploadStatusBanner`
      (`src/renderer/Layout.tsx` ~line 22) only renders once
      `useUploadStatus()`'s `status` has received at least one
      `onUploadProgress` event. But this test's environment is
      deliberately built for deterministic CI failure on both upload
      paths _before_ either ever calls `onProgress`: `runBoxBackup`
      (`src/main/box-backup.ts` ~line 364) returns as soon as
      `isRcloneInstalled()` is false — before its only two `onProgress`
      calls (~lines 475, 527); `uploadAllPendingScans`
      (`src/main/graviscan-upload.ts` ~line 660) returns as soon as
      `validateBloomConfig` rejects the test's intentionally-empty
      `BLOOM_SCANNER_USERNAME`/`PASSWORD`/`BLOOM_ANON_KEY` — before ever
      querying for images or calling `onProgress`.
      `seedExperimentWithMetadata()` (this test file, ~line 156) also
      never creates a `GraviImage` row, so even without the credentials
      short-circuit, the Bloom path's own `scans.length === 0` early
      return would skip `onProgress` too. Net effect: with this test's
      exact setup, `onUploadProgress` can never fire on any real code
      path in CI — Box backup requires rclone (a real binary genuinely
      absent from GitHub-hosted runners) and Bloom upload requires a
      live, authenticated Salk account (not available/desirable in CI).
      Concluded this is a gap in the test's own fixture/trigger
      mechanism, not an app bug: nothing in `design.md` Decision 7
      requires the banner to appear only via a real backup — its actual
      job is to display and persist whatever the
      `graviscan:upload-progress` IPC channel sends, independent of what
      produced it.

      Fixed by having the test simulate a real mid-upload push directly
      over that channel — `const mainWindow = await
      electronApp.browserWindow(window); await
      mainWindow.evaluate((win) => win.webContents.send(
      'graviscan:upload-progress', {...}))` — matching exactly what
      `register-handlers.ts`'s real `onProgress` callback does
      (`win.webContents.send('graviscan:upload-progress', progress)`).
      This exercises the real `UploadStatusContext` →
      `UploadStatusBanner` pipeline end-to-end while keeping the
      existing "Backup to Box" / "Box backup unavailable" steps intact
      (this test was the only E2E-level coverage of 14.6's fix, so
      removing them would have silently dropped that coverage).
      Strengthened the final assertion to check the actual progress text
      (`4/10`), not just element presence. No app code changed — this
      was a test-only fix, the same class as 14.6 (test/fixture design
      gap exposed only once earlier bugs stopped blocking the render
      path). Verified locally: `tsc --noEmit`, `eslint`, `prettier
      --check` all clean on the changed file. Pushed for CI confirmation
      (can't run real Electron E2E locally per this session's
      constraints).

      **12.4 CONFIRMED GREEN, 2026-08-10**: pushed the 14.8 fix
      (commit `1cc255a`), CI run 31446298657. First attempt: all 4
      `graviscan-browse-metadata.e2e.ts` tests passed on all 3 OSes, but
      the ubuntu and macOS `Test - E2E Dev Build` jobs still failed
      overall — on `afterEach`/`beforeEach` hook timeouts in unrelated
      files (`export-page.e2e.ts` on ubuntu; several tests via hook
      timeout on macOS), a pattern absent from the immediately-prior run
      (which had a clean "1 failed / 266 passed" before 14.8's fix) —
      concluded this was transient CI resource contention, not caused by
      this branch's changes. Re-ran only the two failed jobs
      (`gh run rerun 31446298657 --failed`): both passed clean on retry.
      **Final result: the entire `PR Checks` workflow is green,
      including `All Checks Passed`** — every job, all 3 OSes.
      12.6 (manual golden-path walkthrough) was not attempted this
      session per the explicit instruction not to launch the app
      locally without asking first; CI is the verification method used
      throughout 14.1-14.8.

- [ ] 14.9 Diagnostic-only test instrumentation — main-process
      stdout/stderr piping and `pageerror`/`console` listeners in
      several `tests/e2e/*.e2e.ts` files (extended to
      `graviscan-browse-metadata.e2e.ts` during 14.6's investigation) —
      is still in place. Decide whether to keep permanently (it proved
      genuinely useful four times over now, most recently root-causing
      14.6) or trim back now that 12.4 is fully green.

## 15. Round-1 `/review-pr` response — 5 blocking + 11 important findings, all fixed

With 12.4 fully green (Section 14), ran the `/review-pr` skill's 5-subagent
adversarial team (Code Quality, Testing/TDD, Scientific Rigor & UX,
Security & Cross-Platform, Behavioural Correctness) against the full PR
diff. Each subagent independently re-verified the 6 already-documented
bugs are genuinely fixed in the current tree rather than trusting this
file's own account, then found new issues — several of them recurrences
of the exact same "untyped/`any` IPC channel, mock never validated
against the real shape" root cause already named 3+ times in Section 14.
Posted as a `REQUEST_CHANGES` comment on PR #290 (verdict posted as a
comment, not an approval/changes-request, since it's the PR author's own
PR). Fixed all 5 blocking and all 11 important findings below, each with
TDD (failing test confirmed red against the pre-fix code, then a minimal
fix, then green) — commits `7b39cb0` (blocking) and `d77189a`
(important).

- [x] 15.1 **BLOCKING — `readScanImage` double-wrapped IPC envelope broke
      the TIFF preview entirely.** `register-handlers.ts` wrapped
      `imageHandlers.readScanImage()`'s own already-enveloped
      `{success, dataUri, error}` result in `wrapHandler`'s
      `{success, data}` envelope, leaving `dataUri` undefined for every
      real caller. `ExperimentDetail.tsx`'s `FileRow` already correctly
      expected the _unwrapped_ shape, so the fix was main-process only:
      return `readScanImage()`'s result directly (it never throws — every
      internal failure path is caught). Tightened `readScanImage`'s type
      from `Promise<any>` to a named `ReadScanImageResult`. Added an
      assertion in `ExperimentDetail.test.tsx` that the `<img>` itself
      renders with the resolved `dataUri`, not just that the IPC call
      fired — the prior test only checked the latter, which is exactly
      how this shipped undetected.
- [x] 15.2 **BLOCKING — `handleBackupToBox` still misreported one
      failure mode as success.** `uploadAllScans`'s `uploadInProgress`
      guard resolves normally with `{success:false, uploaded:0,
failed:0, errors:['Upload already in progress']}` — matching
      neither the rclone-specific nor the `failed > 0` branch, so it fell
      through to the generic success message ("Uploaded 0 image(s), 0
      skipped") when the backup never ran. Added an explicit
      `!result.success` branch; also now shows the upload count alongside
      the failure count on partial failures (`N uploaded, M error(s)`,
      not just the error count), and added a `catch` for a genuinely
      rejected IPC call (previously `try/finally` only, no `catch`, so a
      real rejection would reset the button with zero user-facing
      explanation).
- [x] 15.3 **BLOCKING — a spreadsheet import could silently "succeed"
      with zero data written.** If a spreadsheet's headers don't
      exactly match the expected field names and the operator never
      manually fixes every mapping, every row's required fields resolve
      to `''`; row validation only fires on _partial_ fill, so an
      all-blank row raises no error, and the import loop skips every row.
      The backend accepted the resulting empty `plates` array with only
      an `Array.isArray` check, returning `{success: true}` for an import
      that wrote nothing — the technician sees "Done uploading!" for a
      no-op. `graviPlateAccessionsCreateWithSections` now rejects an
      empty `plates` array with a clear error, which the renderer's
      already-existing `if (!result.success)` path surfaces correctly
      with no renderer change needed.
- [x] 15.4 **BLOCKING — deleting a metadata file had no confirmation.**
      Unlike every other destructive action in this PR (Unlink in
      `ExperimentDetail.tsx`/`Experiments.tsx`, both `window.confirm`),
      `GraviMetadataList.tsx`'s `handleDelete` fired immediately on
      click. The backend blocks deletion while a file is still
      referenced, so this couldn't corrupt in-use data, but an
      unreferenced file's plate/section data was one accidental click
      from permanent, irreversible loss. Added a `window.confirm` naming
      the file.
- [x] 15.5 **BLOCKING — pagination had no boundary guard, and
      discarded the `total` the backend already returns.**
      `graviscansBrowseByExperiment`'s `total` field was fetched and
      thrown away; `Next` had no `disabled` condition at all, so clicking
      past the last page rendered "No GraviScan data is present" —
      indistinguishable from a genuinely empty result. `Next` is now
      `disabled={offset + PAGE_SIZE >= total}`.
- [x] 15.6 **BLOCKING — spreadsheet Import had no double-submit guard.**
      Every comparable action elsewhere in this PR (Link/Unlink/Backup)
      guards against re-entrancy; `handleImport`/its button did not, and
      the backend has no uniqueness check on the accession name, so a
      rapid double-click could create duplicate metadata-file records
      from one spreadsheet. Added an `isImporting` guard + `disabled`
      state (button also now reads "Importing...").
- [x] 15.7 **IMPORTANT — Box backup used raw `fs.symlinkSync` instead
      of the codebase's own `ensureSymlinkOrCopy()` fallback.** Windows
      restricts unprivileged symlink creation (the default state on most
      lab machines) — exactly the condition `ensureSymlinkOrCopy()`
      already exists to handle for the identical Prisma-client-staging
      problem elsewhere in this codebase. This path was never exercised
      by CI (rclone itself isn't installed on any CI runner, so
      `isRcloneInstalled()` returns false before ever reaching the
      symlink call), so it would have silently made Box backup fully
      non-functional on a stock Windows lab machine with rclone actually
      installed. New `tests/unit/box-backup.test.ts` exports
      `rcloneCopyFiles` and forces `fs.symlinkSync` to throw
      (`vi.spyOn`), confirming the real fallback-to-copy behavior (not
      just that `ensureSymlinkOrCopy()` itself works, which was already
      tested elsewhere).
- [x] 15.8 **IMPORTANT — CSV/formula injection in the Box metadata
      export.** `csvEscape()` only escaped commas/quotes/newlines;
      operator-entered `custom_note`/`accession`/`plate_barcode` values
      starting with `=`, `+`, `-`, or `@` flowed unescaped into
      `metadata.csv`, uploaded to Box for humans to open in Excel/Sheets
      — classic formula-injection surface in a shared-lab context. Now
      prefixes such values with `'` before the existing quote-escaping.
- [x] 15.9 **IMPORTANT — the "Filename" column showed a UUID, not a
      filename.** `ExperimentDetail.tsx`'s `FileRow` rendered `scan.id`
      under the "Filename" header; a scientist couldn't match a table row
      to the real TIFF on disk or in Box. Now shows
      `basename(scan.path)`.
- [x] 15.10 **IMPORTANT — `onUploadProgress`'s payload was untyped
      (`any`), with three independent, unlinked hand-typed mirrors of the
      same shape** (`BoxBackupProgress` in `box-backup.ts`,
      `UploadProgress` in `BrowseGraviScans.tsx`, `UploadProgressData` in
      `Layout.tsx` — the last consumed via an unchecked `as` cast). The
      exact same "declared type never checked against the real runtime
      shape" pattern already named for 14.3/14.6/15.1. Consolidated into
      one `BoxBackupProgress` type (mirrored in `src/types/graviscan.ts`,
      matching this codebase's existing renderer-type-mirror convention),
      typed `onUploadProgress` properly, and removed the unchecked cast.
- [x] 15.11 **IMPORTANT — same-experiment wave link/unlink race across
      two independent UI surfaces.** `link()` triggers a full `refetch()`
      after its own mutation; `unlink()` applies a local optimistic
      filter with no refetch. If `link()`'s refetch (from e.g. the attach
      panel) was still in flight when a concurrent `unlink()` (from e.g.
      a row's own button) applied, the refetch's now-stale snapshot
      (queried before the unlink committed server-side) could land after
      and silently revert it. Added a per-experimentId version counter,
      bumped by every `refetch()` call and by `unlink()`'s own update; a
      refetch whose version was superseded on completion retries once
      (rather than either applying stale data or dropping its own
      update). New test in `WaveMetadataLinksContext.test.tsx`
      reproduces the exact interleaving with a manually-controlled
      pending promise.
- [x] 15.12 **IMPORTANT — the upload-status banner's dismiss compared
      by object reference.** Every `graviscan:upload-progress` IPC
      delivery is a fresh object (structured clone), so a harmless
      duplicate/retry event with _identical_ content would silently undo
      a dismiss (`status === dismissed` almost never holds across two
      separate deliveries). Now compares the four payload fields by
      value.
- [x] 15.13 **IMPORTANT — no warning navigating away mid-spreadsheet-
      upload.** `Metadata.tsx` had no unsaved-work guard; sidebar
      navigation unmounted `GraviMetadataUpload` and silently discarded a
      parsed sheet + column mapping (often manually fixed, given 15.3).
      Added `UnsavedChangesContext` (mounted once in `App.tsx`,
      mirroring `UploadStatusProvider`'s pattern): `GraviMetadataUpload`
      flags itself while a sheet is parsed and not yet done, clearing on
      completion and unconditionally on unmount; `Layout.tsx`'s nav
      `onClick` confirms before allowing navigation away. React has no
      cancelable-unmount lifecycle hook, so this has to intercept the
      _navigation_ itself, before the unmount it would cause.
- [x] 15.14 **IMPORTANT — the same stale-mock-shape pattern recurred a
      third time** in `App.test.tsx` (`uploadAllScans` mocked with the
      pre-fix unwrapped shape) and `UploadStatusContext.test.tsx` (a fake
      `{completed, total}` shape instead of the real
      `{totalImages, completedImages, failedImages, currentExperiment}`).
      Harmless today (neither file's tests exercise the affected
      branches) but the exact landmine class already named twice.
      Updated both to the real shapes.
- [x] 15.15 **IMPORTANT — `useWaveMetadataLinks.test.tsx`'s "stale
      refetch" regression test didn't test the race it claims to.** It
      only resolves two _different_ `experimentId` keys, which trivially
      can't clobber each other in a map keyed by id, regardless of
      whether any real guard exists. Left as-is (still a valid test for
      what it actually covers) with a comment pointing to 15.11's real
      same-key race test instead of duplicating it.
- [x] 15.16 Verified locally after all 16 fixes: `npx tsc --noEmit -p .`,
      `npm run lint`, `npx prettier --check` all clean; full
      `tests/unit` suite shows only the same 5 pre-existing Windows
      path-separator baseline failures (unchanged from Section 14), no
      new failures. Not yet pushed/CI-confirmed as of writing this
      entry — see 15.17.
- [x] 15.17 Pushed all 3 fix commits (`7b39cb0`, `d77189a`, `d5eee01`).
      **CI-confirmed, CI run 31461413595**: 12.4 (full E2E suite, all 3
      OSes) still green, plus every other job (`All Checks Passed`) —
      the 16 fixes introduced no regressions anywhere in the suite.
      Proceeding to a round-2 `/review-pr` pass per explicit instruction
      to iterate (fix → re-review) until no BLOCKING or IMPORTANT
      findings remain.

## 16. Round-2 `/review-pr` response — 1 blocking + 10 important findings, all fixed

Ran the same 5-subagent adversarial team against just the round-1 fix
commit diff (with the full PR diff for context), specifically instructed
to verify the round-1 fixes and hunt for regressions/new gaps. Found 1
new blocking issue and 10 important issues — no round-1 fix was reverted
or broken. Fixed all 11 with TDD (failing test confirmed red against the
pre-fix code, then a minimal fix, then green) — commit `b6b27e5`.

- [x] 16.1 **BLOCKING — a metadata import in flight could be navigated
      away from mid-write.** `hasUnsavedChanges` only produced a
      dismissable `window.confirm`, so an operator could accept "Leave
      anyway?" while `createWithSections`'s IPC call was still pending —
      its eventual `setError`/`setDone` would resolve against an
      unmounted component, and a technician who assumed the (silently
      lost) import never happened could resubmit and create a duplicate
      record. Added `blockNavigation`/`setBlockNavigation` to
      `UnsavedChangesContext`, wired `GraviMetadataUpload.tsx` to set it
      for the duration of `isImporting`, and `Layout.tsx`'s new
      `guardNavigation()` hard-blocks (via `window.alert`, not a
      dismissable confirm) both the sidebar `NavLink`s and the
      machine-config keyboard shortcut while it's true.
- [x] 16.2 **IMPORTANT — the machine-config keyboard shortcut bypassed
      the unsaved-changes guard entirely.** `confirmNavAway` guarded the
      sidebar `NavLink`s' `onClick`, but the `Ctrl/Cmd+Shift+,` shortcut
      called `navigate('/machine-config')` unconditionally — an operator
      mid-import could lose their work via the shortcut even though the
      exact same navigation via a sidebar click was guarded. Now routed
      through the same `guardNavigation()` used by 16.1's fix.
- [x] 16.3 **IMPORTANT — `handleBackupToBox` mislabeled a real partial
      success as a total failure.** Bloom and Box back up in parallel via
      `Promise.allSettled`; their counts are additive but their
      success/failure are independent, so Box fully succeeding
      (contributing to `uploaded`, nothing to `failed`) while Bloom fails
      outright (contributing only an error string) produces
      `{success:false, uploaded>0, failed:0, errors:[...]}` — a shape the
      existing `uploaded > 0 && failed > 0` check didn't catch, so it fell
      through to the generic "Box backup failed" message despite files
      genuinely having been backed up. Changed the condition to
      `uploaded > 0 && errors.length > 0`.
- [x] 16.4 **IMPORTANT — a `NavLink` click on the current route triggered
      a spurious "unsaved changes" confirm.** Clicking the already-active
      sidebar link (a no-op navigation) still ran the unsaved-changes
      check, needlessly interrupting the operator. `confirmNavAway` now
      returns early when `to === location.pathname`.
- [x] 16.5 **IMPORTANT — a spreadsheet row with every required field
      blank was dropped with no indication.** The partial-row validation
      only fires when a row is _partially_ filled (`0 < filled <
required.length`); a fully blank row (e.g. a trailing blank Excel
      row) is silently excluded downstream by the plate-grouping loop's
      `if (!plateId) continue`. Correct behavior for a trailing blank
      row, but the operator had no way to know any rows were dropped.
      Added a `blankRowCount` (memoized over `sheet`/`mapping`) with a
      persistent notice shown as soon as the sheet loads.
- [x] 16.6 **IMPORTANT — `refetch()`'s stale-version retry had no
      bound.** The version-guard added in round-1 (15.11's fix) retries
      indefinitely if it keeps losing the race to a concurrent
      link()/unlink() — fine for the realistic case (a handful of
      supersessions), but nothing stopped genuinely pathological
      rapid-fire mutation from recursing forever. Added a
      `MAX_REFETCH_RETRIES` cap (5); past it, `refetch` logs an error and
      gives up rather than applying stale data.
- [x] 16.7 **IMPORTANT — `refetch()` silently swallowed a failed IPC
      response.** `link()`/`unlink()` both already report their own IPC
      failures via `errorsByExperiment`, but `refetch()` (used for the
      initial fetch, and internally by `ensureFetched`/`link`) had no
      `else` branch on `result.success` — a failed `listGraviMetadata`
      call was indistinguishable from "no links yet" (empty array, no
      error). Added the missing `else` branch.
- [x] 16.8 **IMPORTANT — pagination's `total === PAGE_SIZE` boundary was
      untested.** Existing tests covered `total: 1` and `total: 0` for
      disabling Next, and `total: 45` for re-enabling it, but never the
      exact boundary of the `offset + PAGE_SIZE >= total` comparison
      (`total: 20`). The existing logic was already correct; added the
      missing test.
- [x] 16.9 **IMPORTANT — `csvEscape`'s test coverage only exercised
      leading trigger characters.** The regex is `^`-anchored (only a
      _leading_ `=`, `+`, `-`, or `@` opens a formula), and mid-string
      `-` was already covered (`Col-0`), but mid-string `=`, `+`, and `@`
      were not. Added a parameterized test for all three.
- [x] 16.10 **IMPORTANT — the double-submit test's own comment overclaimed
      what it proved.** The test clicks the Import button twice and
      asserts a single IPC call, but user-event (matching real browsers)
      never dispatches `click` on a `disabled` element at all — so the
      test only proves the `disabled` attribute prevents the duplicate
      call, not that `handleImport`'s own `isImporting` re-entrancy guard
      does anything (it's unreachable through the DOM, since the button
      is the feature's only entry point). Renamed the test and rewrote
      the comment to state this accurately instead of implying the
      internal guard was independently verified.
- [x] 16.11 **IMPORTANT — stale IPC mock shapes in
      `graviscan-ipc-integration.test.ts` (4th recurrence of this
      category).** `readScanImage`/`uploadAllScans`/`downloadImages`'s
      mocks had drifted from their real handler return shapes
      (`ReadScanImageResult`, `UploadAllScansResult`, and
      `downloadImages()`'s `{success, total, copied, errors}`) — none of
      this file's tests exercise these three channels' return values, so
      nothing caught the drift. Updated all three mocks to match the
      real shapes and added a comment explaining why this file in
      particular needs that discipline.
- [x] 16.12 Verified locally after all 11 fixes: `npx tsc --noEmit`,
      `npx eslint`, and `npx prettier --check` all clean on every touched
      file; the 6 affected test files (87 tests) all pass, and a full
      `tests/unit` run shows only the same 5 pre-existing Windows
      path-separator baseline failures (`image-uploader.test.ts`,
      `scan-coordinator.test.ts`, `MachineConfiguration.test.tsx` —
      unrelated files, not touched this round), no new failures.
- [x] 16.13 Pushed commit `b6b27e5` (fix) and `3d7ac5d` (docs). CI run
      31466023905 failed 3 consecutive times (1 original attempt + 2
      reruns) — every time on `Test - E2E Dev Build (macos-latest)`
      alone, every time with the identical
      `TypeError: Cannot read properties of undefined (reading
'waitForLoadState')` inside the shared `launchElectronApp()` test
      helper, but each time in a **completely different, non-overlapping
      set of unrelated test files** (14, then 3, then 13 flaky tests —
      touching scientists/phenotypers management, scan-preview,
      accessions, plant-barcode-validation, renderer-database-ipc, none
      of which touch any file changed in this round). Every other job in
      the matrix (TypeScript, lint, Python, Windows/Ubuntu E2E,
      integration, packaging) passed cleanly on the very first attempt.
      Diagnosed as macOS runner Electron-launch infrastructure
      degradation, independently confirmed by two different round-3
      review subagents (Security & Cross-Platform, Testing Strategy) by
      reading the actual CI logs. Per explicit user decision (asked via
      question tool after the 3rd failure): proceeded to round-3 review
      without a green macOS E2E run rather than continuing to rerun.

## 17. Round-3 `/review-pr` response — 1 blocking + 4 important findings, all fixed

Ran the same 5-subagent adversarial team against round 2's fix commit
(`b6b27e5`) with the full PR diff for context, per the same "verify the
previous round's fixes and hunt for regressions" instruction as round 2. Found 1 new blocking issue (round 2's own fix for 16.3 left a
narrower version of the same mislabeling bug in place) and 4 important
issues, one of which (16.6's retry-cap error-surfacing) was
independently flagged by 4 of the 5 subagents. Fixed all 5 with TDD —
commit `21bd5eb`.

- [x] 17.1 **BLOCKING — `handleBackupToBox`'s round-2 fix corrected the
      success/failure categorization but not the system attribution.**
      `{uploaded: 2, failed: 0, errors: ['Authentication failed: Bloom
session expired']}` (Bloom fails, Box fully succeeds) no longer
      showed as a total failure after 16.3's fix, but still rendered as
      "Box backup completed with 2 uploaded, 1 error(s): Authentication
      failed: Bloom session expired" — a lab technician reads "Box
      backup completed" as good news while the error text names Bloom
      (the record-of-truth database) as what actually failed. The
      sibling `rclone not installed` branch had the same root cause in
      the other direction: it ignored `bloomSuccess`/`bloomUploaded`
      entirely, so a successful Bloom upload alongside a missing-rclone
      Box failure was silently dropped from the message. Fixed by adding
      `bloomSuccess`, `boxSuccess`, `bloomUploaded`, `boxUploaded`,
      `bloomErrors`, `boxErrors` to `UploadAllScansResult` (populated in
      `uploadAllScans()`; consolidated the previously-duplicated
      interface definition in `image-handlers.ts` to import from
      `types/graviscan.ts` instead of re-declaring it, closing off a
      recurrence of the "two independent copies drift apart" bug class
      from 16.11) and rewriting the renderer's message logic to name
      Bloom and/or Box explicitly whenever either fails, including a new
      "Bloom also failed: ..." / "Bloom: N uploaded" note on the
      rclone-not-installed path. Generic messages ("Backup failed: ...",
      previously "Box backup failed: ...") are now reserved for
      whole-operation failures where neither target was actually
      attempted (the `uploadInProgress` guard, a thrown exception) —
      renamed since those aren't Box-specific either.
- [x] 17.2 **IMPORTANT — `WaveMetadataLinksContext`'s retry-cap give-up
      was silent to the user (flagged independently by 4 of 5 round-3
      subagents).** 16.6 bounded the recursive stale-version retry but
      only `console.error`s on giving up — `errorsByExperiment` was left
      unchanged, unlike every other failure path in the file (including
      16.7's own fix earlier in the same function), so exhausting the
      cap left stale wave-link data on screen with zero visible
      indication anything went wrong. Added a
      `setErrorsByExperiment` call on the give-up path
      ("Could not refresh metadata links — please retry.").
- [x] 17.3 **IMPORTANT — `blankRowCount`'s blank-detection didn't match
      the plate-grouping loop's actual skip check.** 16.5's operator-
      facing warning counts a row as blank via `.trim() === ''` on every
      required field, but the loop that actually builds the plates to
      submit skipped rows via `if (!plateId) continue` — a
      whitespace-only Plate ID (`' '`) is truthy, so that row was
      silently imported as a real plate with a blank/whitespace
      `plate_id`, contradicting the "will be skipped" warning the
      operator had just been shown. Aligned the loop's check to
      `if (!plateId?.trim()) continue`.
- [x] 17.4 **IMPORTANT — the keyboard-shortcut hard-block path was
      untested.** 16.1's fix commit explicitly claimed to close "the
      same gap in the machine-config keyboard shortcut," but the
      existing keyboard test only exercised the `hasUnsavedChanges` +
      declined-confirm path — no test dispatched the keyboard shortcut
      against `blockNavigation` specifically. Added a dedicated test
      using the existing `FakeImportingMetadataPage` fixture; verified
      RED by temporarily reverting the keyboard handler's
      `guardNavigation()` call before confirming the fix.
- [x] 17.5 **IMPORTANT — one-render-behind indirection between
      `setIsImporting` and `setBlockNavigation`.** 16.1 synced
      `blockNavigation` to `isImporting` via a separate `useEffect`,
      leaving a sub-render-frame window where `isImporting` is true but
      `blockNavigation` hasn't caught up yet — not humanly triggerable,
      and not something React Testing Library's `act()` model can
      actually observe or discriminate in a unit test (effects flush
      synchronously within the same `act()` call in tests either way),
      but a real design smell independent of testability. Fixed by
      setting `blockNavigation` directly and synchronously inside
      `handleImport` (alongside `setIsImporting`) instead of via a
      derived effect, and removed the now-redundant effect. No
      regression test added for this specific fix, honestly, for the
      reason above — the existing hard-block tests (16.1, 17.4) already
      cover the resulting behavior once `isImporting`/`blockNavigation`
      are both settled.
- [x] 17.6 Also added test coverage (no behavior change) for the
      all-rows-blank case: confirms the existing round-1 backend guard
      (15.3, `graviPlateAccessionsCreateWithSections` rejecting an empty
      `plates` array) is what actually prevents a false "Done
      uploading!" when every row in a sheet is blank — this was a real
      code path with no direct test before.
- [x] 17.7 **Known limitations, deliberately not fixed this round** (all
      SUGGESTION-level or requiring a larger design decision than this
      round's scope):
  1. The navigation guard (`guardNavigation()`) is wired into
     `Layout.tsx`'s sidebar `NavLink`s and its own keyboard handler
     only, not enforced at the router level. Seven other components
     call `navigate()` directly (`BrowseGraviScans.tsx`, `Home.tsx`,
     `ScanPreview.tsx`, `CaptureScan.tsx`, `WorkflowSteps.tsx`) — none
     are currently reachable _from_ `/metadata` mid-import (no
     `navigate()` calls exist in `Metadata.tsx` itself, and the app
     uses `MemoryRouter` with no back/forward), so there is no live
     bypass today, but nothing structurally prevents a future
     "Cancel"/"Skip" button added directly to the metadata page from
     reintroducing the exact bug 16.1 fixed. `useBlocker` (which would
     close this structurally) requires a data router, which this app
     doesn't use (documented constraint from earlier in this project).
  2. `createWithSections`'s IPC call has no client-side timeout or
     cancel — if it hangs (main-process deadlock/busy DB) rather than
     rejecting, `blockNavigation` stays `true` indefinitely with only
     a "please wait" alert and no escape hatch. Confirmed via
     codebase-wide search: no renderer-side IPC call anywhere in this
     app has a timeout/abort wrapper (`Promise.race` is used exactly
     once, main-process-only, for camera-stream teardown) — adding one
     solely here would be a novel, inconsistent one-off pattern rather
     than following an established project convention.
  3. The blank-row warning (16.5) doesn't distinguish "a few trailing
     blank rows" (benign) from "every row is blank because no headers
     mapped" (17.6's scenario) — both read as "N row(s) ... will be
     skipped." No silent data loss either way (17.6 confirms the
     backend guard catches the all-blank case), but the intermediate
     UI state could be clearer.
- [x] 17.8 Verified locally after all 5 fixes: `npx tsc --noEmit`,
      `npx eslint`, and `npx prettier --check` all clean on every
      touched file; the affected test files (223 tests across
      `image-handlers.test.ts`, `register-handlers.test.ts`,
      `graviscan-ipc-integration.test.ts`, `BrowseGraviScans.test.tsx`,
      `GraviMetadataUpload.test.tsx`, `WaveMetadataLinksContext.test.tsx`,
      `Layout.test.tsx`, `App.test.tsx`, `preload-gravi.test.ts`) all
      pass, and a full `tests/unit` run (with `BLOOM_DATABASE_URL` set)
      shows only the same pre-existing Windows path-separator baseline
      failures (`config-store.test.ts`, `image-uploader.test.ts`,
      `scan-coordinator.test.ts` — unrelated files, not touched this
      round), no new failures.
- [x] 17.9 Pushed commits `21bd5eb` (fix) and `251b655` (docs). CI run
      31507201343: `Test - E2E Dev Build (macos-latest)` passed on the
      first attempt; `Test - E2E Dev Build (ubuntu-latest)` failed once
      on a single unrelated flaky test
      (`tests/e2e/export-page.e2e.ts`, nothing to do with this PR) and
      passed on rerun. `Lint - Node.js` failed **three consecutive
      times** — every time on `npm run format:check` flagging
      `openspec/specs/ipc-reliability/spec.md`, a file this PR (and
      this entire multi-round review cycle) has never touched.
      Investigated thoroughly: the file is byte-for-byte identical
      between the git blob and the local working tree (confirmed via
      `git cat-file -p` vs the checked-out file), the exact same
      Prettier version (3.6.2) is pinned via `package-lock.json` on
      both sides, and `npm run format:check` (the identical command
      CI runs, across the full repo glob) passes cleanly locally. This
      is a genuine, deterministic (not flaky) Linux-vs-Windows Prettier
      cross-platform discrepancy on a docs file unrelated to any
      change in this PR — not reproducible or fixable from this
      Windows development environment. Per the same reasoning already
      applied to the round-2/round-3 macOS E2E infrastructure
      flakiness (and the user's explicit decision at that time to
      proceed without a fully green run), treating this as a separate,
      pre-existing repo-health issue and proceeding to round-4 review
      regardless — this check has no bearing on the correctness of any
      code in this PR.

## 18. Round-4 `/review-pr` response — 1 blocking + 3 important findings, all fixed

Ran the same 5-subagent adversarial team against round 3's fix commit
(`21bd5eb`) with the full PR diff for context. Found 1 new blocking
issue (round 3's own dual-attribution fix for 17.1 left a gap when
both targets fail with zero uploads) and 3 important issues, two
flagged independently by multiple subagents. Fixed all 4 with TDD.

- [x] 18.1 **BLOCKING — round 3's Bloom/Box attribution fix (17.1) only
      fired when `result.uploaded > 0 && result.errors?.length > 0`.**
      When both Bloom and Box fail with zero uploads (a realistic
      "both services down" scenario), that condition is false, so
      execution fell through to the generic `!result.success` branch,
      which shows only `errors[0]` and names neither system —
      reintroducing, in a different shape, exactly the conflation bug
      17.1 was meant to close. Changed the gating condition to check
      the per-target success flags directly
      (`!result.bloomSuccess || !result.boxSuccess`) instead of
      `uploaded > 0`, and added a defensive fallback
      (`failures.join('; ')` if populated, else `errors?.[0] ?? 'unknown error'`)
      so a future invariant violation degrades to a labeled message
      instead of a blank one.
- [x] 18.2 **IMPORTANT — `box-backup.ts`'s pre-existing (round-1-era)
      metadata-CSV-copy-failure branch pushed to `result.errors` without
      setting `result.success = false`.** This violated the invariant
      17.1's new attribution logic implicitly assumed ("every pushed
      error corresponds to a `bloomSuccess`/`boxSuccess` flip"), so a
      CSV-only failure (all images copied fine, only the per-wave
      `metadata.csv` failed) would have produced a `boxSuccess: true`
      alongside a populated `boxErrors`, and — worse — an empty,
      unattributed `"N uploaded, M error(s) — "` message once 18.1's
      fallback also found nothing in `failures`. Root-caused and fixed
      in `runBoxBackup()` by setting `result.success = false` alongside
      the existing `errors.push(...)` in that branch. New test in
      `tests/unit/box-backup.test.ts` (`runBoxBackup` describe block,
      with new Prisma-like `db` mock and an rclone `spawn` mock that
      distinguishes the three invocations — version check, image copy,
      CSV copy — by argv shape) asserts `result.success === false` and
      a 'metadata'-mentioning error when only the CSV copy fails.
- [x] 18.3 **IMPORTANT — `BrowseGraviScans.tsx`'s `ExperimentRow` never
      consumed `linkError` from `useWaveMetadataLinks`.** Every other
      consumer of the hook (`ExperimentDetail.tsx`, `Experiments.tsx`)
      renders `linkError` next to the wave selector; this row — the
      exact page an operator uses to pick which wave to download —
      silently left the wave dropdown stale on a failed/retry-exhausted
      metadata fetch with zero on-screen indication. Fixed by
      destructuring `linkError` alongside `links` and rendering
      `{linkError && <p className="text-sm text-red-600">{linkError}</p>}`
      next to the wave `<select>`, matching `Experiments.tsx`'s existing
      convention.
- [x] 18.4 **IMPORTANT — the retry-cap give-up message (added in 17.2)
      said "please retry" but no manual retry affordance exists.**
      `fetchedIds` is never cleared, so there is no user action that
      actually re-triggers a fetch for that `experimentId` — the
      message implied a working mechanism that doesn't exist. Reworded
      to describe the actual state instead of prescribing a
      nonexistent action: "Could not refresh metadata links — the
      displayed wave links may be out of date."
- [x] 18.5 Also reviewed and confirmed already-adequate (no change
      needed): the "reject concurrent uploads" test in
      `tests/unit/graviscan/image-handlers.test.ts` already asserts
      `bloomSuccess`/`boxSuccess` stay `true` with an explanatory
      comment (added in round 3, commit `21bd5eb`) — round 4's minor
      finding about this test predates that fix and no longer applies.
- [x] 18.6 Verified locally after all 4 fixes: `npx tsc --noEmit`,
      `npx eslint`, and `npx prettier --check` all clean on every
      touched file (`src/main/box-backup.ts`,
      `src/renderer/BrowseGraviScans.tsx`,
      `src/renderer/contexts/WaveMetadataLinksContext.tsx`, and their
      test files). A full `npm run test:unit` run shows only the same
      pre-existing Windows path-separator baseline failures
      (`image-uploader.test.ts`, `scan-coordinator.test.ts` — unrelated
      files, not touched this round, same failure class documented in
      17.8), no new failures.
- [x] 18.7 Merged latest `main` into this branch (clean auto-merge, no
      conflicts), picking up an independently-merged PR (#324, "clean up
      orphaned descendant processes and shard E2E CI") that directly
      targets the category of macOS/E2E CI flakiness this review cycle
      had been treating as pre-existing/unrelated since round 2. Then
      root-caused and fixed, with TDD, the local Windows baseline
      failures this branch had been documenting since Section 1
      (`image-uploader.test.ts`/`scan-coordinator.test.ts`/
      `config-store.test.ts`: hardcoded POSIX path-separator assertions
      vs. platform-native `path.join`/`path.dirname` output — rebuilt
      expectations the same way instead of hardcoding a separator;
      `electron-cleanup.test.ts`, new from the PR #324 merge: two tests
      exceeded vitest's default 5000ms timeout on Windows due to
      `powershell.exe Get-CimInstance` overhead — root-caused via an
      isolated run with a raised timeout showing all assertions pass,
      just slower, not a hang — bumped to 20000ms;
      `MachineConfiguration.test.tsx`: a dangling real 100ms mock timer
      could resolve after RTL's `cleanup()` had torn down the test
      environment, surfacing as an unhandled rejection blamed on an
      unrelated later test — fixed by awaiting the loading state's
      resolution before the test ends). Commit `cf4996a`, kept separate
      from feature-code commits since none of it is tier5-specific.
      Confirmed via 3 repeated full local `npm run test:unit` runs: 0
      failing assertions (only `database-handlers.test.ts`'s
      already-documented, pre-existing `BLOOM_DATABASE_URL`
      local-setup-dependent flake remained, unrelated and unaffected).
      Pushed (`bca5777` merge, `cf4996a` fixes) — CI run 31521160041
      passed **fully green for the first time this entire review
      cycle**, including all three platforms' E2E Dev Build jobs.

## 19. Round-5 `/review-pr` response — 1 blocking + 3 important findings, all fixed

Ran the same 5-subagent adversarial team against round 4's fix commit
(`5388bab`, never yet reviewed) plus the test-hygiene bolt-on (`cf4996a`),
with the full PR diff for context. Explicitly instructed agents not to
critique `cf4996a` as tier5 feature work. Found 1 new blocking issue (a
real data/metadata-preservation gap in round 4's own fix) and 3 important
issues, one confirmed independently by 3 of 5 subagents. Fixed all 4 with
TDD — commit `0633d40`.

- [x] 19.1 **BLOCKING — `box-backup.ts`'s round-4 fix (`result.success =
false` on CSV failure, 18.2) made the failure visible once, but the
      wave becomes permanently unretryable.** `runBoxBackup()` selects
      scans via `images: { some: { box_status: { in: ['pending',
'failed'] } } }` — there is no separate per-wave CSV-status field.
      Images are marked `box_status: 'uploaded'` immediately after the
      image-copy step, _before_ the wave's metadata CSV copy even runs.
      So when only the CSV copy fails (all images copied fine), that
      wave has zero pending/failed images left after this run — the next
      "Backup to Box" click silently excludes it from the query entirely,
      never retries the CSV, and reports a plain success with no
      indication anything is still wrong. `metadata.csv` (plate barcode,
      accession, capture/transplant date) stays **permanently missing**
      from Box with no in-app recourse short of manual DB intervention —
      a real, silent metadata-preservation gap, not just a wording issue.
      Confirmed independently by 2 of 5 subagents (one rated BLOCKING,
      one IMPORTANT). Fixed by reverting the wave's just-uploaded images
      back to `box_status: 'failed'` when the CSV copy fails, so the next
      run re-selects and retries the whole wave (images re-copy
      redundantly but harmlessly — rclone overwrites identical files —
      and the CSV gets a real retry). New test in `box-backup.test.ts`
      asserts the images are reverted to a status the retry query will
      pick up, not left at `'uploaded'`.
- [x] 19.2 **IMPORTANT — round 4's "defense-in-depth" `summary` fallback
      in `BrowseGraviScans.tsx` was provably unreachable dead code.**
      Confirmed independently by 3 of 5 subagents: entry into the
      `!result.bloomSuccess || !result.boxSuccess` branch requires one of
      those exact two conditions, and each is exactly what pushes to
      `failures` immediately above — `failures.length` can never be `0`
      inside that branch, so the `result.errors?.[0] ?? 'unknown error'`
      fallback could never execute, and (correctly) had no test
      exercising it. Removed the fallback; `setBackupMessage` now uses
      `failures.join('; ')` unconditionally, with a comment explaining
      why it's always non-empty instead of a misleading
      "defense-in-depth" framing.
- [x] 19.3 **IMPORTANT — the reworded retry-cap message (18.4) was
      honest but left the user with no actual next step.** `fetchedIds`
      is never cleared, so nothing short of reloading the app actually
      re-triggers a fetch for that `experimentId` — the message said the
      data might be stale but didn't say what to do about it. Appended
      "Reload the app to refresh them." so the message ends in an action,
      not just a diagnosis.
- [x] 19.4 **IMPORTANT — `linkError` (18.3) wasn't consulted by the
      diverged-wave divergence check, so a failed metadata fetch was
      silently read as "no divergence" instead of "unknown".**
      `handleDownload`'s diverged-wave detection filters over `links`,
      which stays `[]` on a failed fetch — computing zero divergence in
      that state isn't "confirmed no divergence," it's "never actually
      checked," and an operator could download a CSV with an unverified
      (possibly wrong) accession with no warning at all. Fixed by
      disabling the Download button while `linkError` is set, with a
      `title` explaining why, rather than letting the check silently
      report a false negative.
- [x] 19.5 **Reviewed and deliberately deferred** (SUGGESTION-level,
      raised by only 1 of 5 subagents, or a larger design decision than
      this round's scope):
  1. The dual Bloom/Box failure message names which system(s) failed but
     doesn't visually or textually distinguish "partial failure, data
     safe" from "total failure, data may not be recorded anywhere" —
     severity is inferable by an informed reader but not called out
     explicitly. Would need product/domain confirmation of the exact
     safety semantics to word correctly; not attempted this round to
     avoid asserting an unverified claim.
  2. Raw rclone stderr (e.g. `rclone exited with code 1: ...`) flows
     unfiltered into the operator-facing message via `boxErrors[0]` —
     pre-existing since round 1, not introduced by this round (19.1 just
     made the CSV-failure path reachable again on retry).
  3. Minor inconsistency: `result.errors?.length`/`result.errors?.[0]`
     use optional chaining against fields typed as non-optional in
     `UploadAllScansResult`, while sibling fields in the same function
     (`result.uploaded`, `result.bloomUploaded`) are accessed unguarded.
     Cosmetic only — behavior is identical either way — not worth the
     touch-everywhere churn for a nit.
- [x] 19.6 Verified locally after all 4 fixes: `npx tsc --noEmit`,
      `npx eslint`, and `npx prettier --check` all clean. Full
      `npm run test:unit` (run twice): 0 failing assertions both times
      (only the same pre-existing `database-handlers.test.ts`
      `BLOOM_DATABASE_URL` local-setup flake, documented in 18.7,
      appeared once — non-deterministic, unrelated, unaffected).
- [x] 19.7 A second small `main` merge landed mid-round (an OpenSpec
      archive-housekeeping commit for the already-merged PR #324, moving
      `openspec/changes/fix-e2e-worker-teardown-flake/` to `archive/` and
      updating spec docs — no code). Merged cleanly, no conflicts.

## 20. Round-6 `/review-pr` response — 2 blocking + 1 important finding, all fixed

Ran the same 5-subagent adversarial team against round 5's fix commit
(`0633d40`, never yet reviewed), per the same "verify the previous
round's fixes" pattern. Found 2 new blocking issues — one a genuine
regression of the same class of bug round 5 had just fixed, the other a
factual inaccuracy in round 5's own message copy — and 1 important
issue, plus several test-coverage gaps confirmed real by tracing the
actual code. Fixed all of it with TDD — commit `69d8634`.

- [x] 20.1 **BLOCKING — round 5's `box_status` revert fix (19.1) didn't
      correct `result.filesCopied`, reintroducing a reporting-accuracy
      gap in the very result object the fix was meant to make
      trustworthy.** `result.filesCopied += uploadedIds.length` runs
      _before_ the CSV-copy attempt; when the CSV then fails and those
      images are reverted to `box_status: 'failed'`, `filesCopied` was
      never adjusted. That count flows straight through
      `image-handlers.ts` (`uploaded: bloomResult.uploaded +
boxResult.filesCopied`) into the exact operator-facing message
      19.1 was fixing ("N uploaded, M error(s) — Box failed: ..."), so
      the message could claim images were uploaded in the same run the
      DB now says still need a retry. Confirmed independently by 2 of 5
      subagents. Fixed by decrementing `result.filesCopied` by
      `uploadedIds.length` inside the same revert branch.
- [x] 20.2 **BLOCKING — round 5's reworded retry-cap message ("Reload
      the app to refresh them.", 19.3) is not actually true.** Verified
      directly: `main.ts` sets `mainWindow.menuBarVisible = false` and
      `mainWindow.setMenu(null)`, stripping Electron's default menu —
      which is what normally hosts View → Reload and its Ctrl+R/Cmd+R
      accelerator — and no `globalShortcut` or custom accelerator
      registers a reload anywhere in the codebase. In the packaged app
      there is no in-app reload at all; the only real recourse is fully
      quitting and relaunching. Reworded to "Quit and reopen the app to
      refresh them." — the action that actually resolves the state.
- [x] 20.3 **IMPORTANT — the Download button's disabled-state tooltip
      (19.4) was an independently-authored explanation that didn't
      match the visible red `linkError` paragraph right above it.** A
      technician who hovered saw a third, disconnected sentence rather
      than a restatement of the problem already shown — reads as two
      unrelated issues instead of one. Fixed by reusing the exact
      `linkError` string as the tooltip (`title={linkError ??
undefined}`) instead of a separately-worded message.
- [x] 20.4 Test-hardening, all gaps confirmed real by tracing the actual
      code (not hypothetical):
  1. The `box-backup.test.ts` revert assertion checked
     `['pending', 'failed']).toContain(...)` — loose enough to pass even
     if a future edit reverted to the wrong status. Tightened to the
     exact expected value (`'failed'`), since this string is also shown
     to operators directly via the Upload Status filter.
  2. No test proved the revert loop handles more than one image per
     wave (the shared fixture only had one). Added a 2-image case
     asserting both ids are reverted.
  3. No test proved the revert does _not_ fire when the CSV copy also
     succeeds — the complementary branch a future refactor could
     accidentally break. Added it.
  4. No test proved `linkError` actually clears after a later
     successful mutation — traced that a plausible "does Download ever
     re-enable" test written directly against `BrowseGraviScans` isn't
     reachable from that page alone (`ensureFetched` only fetches once
     per `experimentId`, and this page exposes no `link`/`unlink`
     action to trigger a second one); moved the test to
     `WaveMetadataLinksContext.test.tsx`, the layer where `link()`
     actually clears `errorsByExperiment` on success.
- [x] 20.5 **Reviewed and deliberately deferred** (raised by 1 of 5
      subagents each, or a larger design decision than this round's
      scope):
  1. A wave whose CSV copy fails for a non-transient reason (e.g. a
     permanent Box folder permissions issue, not a blip) will now retry
     forever with the same generic error every run, with no escalation
     or backoff — unlike `WaveMetadataLinksContext`'s
     `MAX_REFETCH_RETRIES` pattern elsewhere in this same PR. Re-trying
     forever is the safer default for a metadata-preservation feature
     (better than the round-5-fixed alternative of silently giving up),
     but a stuck-forever case is indistinguishable from a
     working-as-intended retry to the operator. Would need a
     per-wave failure counter/backoff, a genuinely new mechanism, not a
     small fix.
  2. The plain (non-retry-cap) `listGraviMetadata` failure message in
     `WaveMetadataLinksContext.tsx` shows the raw backend error
     (e.g. "Database is locked") with no "quit and reopen" suffix.
     Unlike 20.2's message, this one isn't factually wrong — the raw
     backend string is itself informative — so left as-is rather than
     appending a blanket restart instruction that may not always apply.
  3. `WaveMetadataLinksProvider`'s context `value` object is a fresh
     literal every render (not `useMemo`'d), so any experiment's
     link/error update re-renders every mounted `ExperimentRow`, not
     just the affected one. A performance nit on a list page, not a
     correctness issue.
- [x] 20.6 Verified locally after all 3 fixes: `npx tsc --noEmit`,
      `npx eslint`, and `npx prettier --check` all clean. Full
      `npm run test:unit`: 1544/1544 real tests passing, only the same
      pre-existing `database-handlers.test.ts` `BLOOM_DATABASE_URL`
      local-setup flake (unrelated, unaffected).

## 21. Round-7 `/review-pr` response — 1 blocking + 1 important finding, all fixed

Ran the same 5-subagent adversarial team against round 6's fix commit
(`69d8634`), explicitly asked to be suspicious of the same fix leaving
yet another gap of the same shape (rounds 4→5→6 each caught the previous
round's own fix reintroducing a variant of the bug it was fixing). Found
exactly that pattern once more, plus a message-content regression. Fixed
both with TDD, plus a scientific-rigor concern about the round-6 message
itself — commit `0d72d02`.

- [x] 21.1 **BLOCKING — round 6's `filesCopied` fix (20.1) left a
      sibling counter with the identical defect.** `completedImages`/
      `failedImages` are incremented per-file during the image-copy step
      and broadcast live via `onProgress` — to `Layout.tsx`'s persistent
      global upload banner and `BrowseGraviScans.tsx`'s per-row "Box
      N/M" indicator — entirely independently of `result.filesCopied`.
      When the CSV copy then fails and those images are reverted to
      `box_status: 'failed'`, this live counter was never corrected or
      re-broadcast: an operator could see "Box 1/1" on a row (implying
      complete success) while the page-level summary correctly said "0
      uploaded" for the same operation — two contradictory numbers
      on-screen simultaneously. Confirmed independently by 2 of 5
      reviewers. Fixed by decrementing `completedImages`, incrementing
      `failedImages`, and re-emitting `onProgress` in the same revert
      branch that already corrects `result.filesCopied`.
- [x] 21.2 **IMPORTANT — round 6's tooltip fix (20.3) achieved string
      consistency by deleting information, and did so with inconsistent
      falsiness semantics.** `title={linkError ?? undefined}` used a
      nullish check while `disabled={!!linkError}` and the visible error
      `<p>` both use truthy checks — latent (all current error producers
      happen to be non-empty strings today) but a real divergence for a
      hypothetical empty-string error. Confirmed independently by 3 of 5
      reviewers. Separately, reusing the raw `linkError` string as the
      _entire_ tooltip lost the specific "why Download is blocked"
      reasoning the original (mismatched) tooltip had — an operator
      hovering now sees only the raw fetch error (e.g. "Database is
      locked") with no indication that divergence-checking specifically
      is what's blocked. Fixed both at once:
      `` `${linkError} — Download is disabled until this is resolved
(wave/accession divergence cannot be checked).` `` behind a truthy
      `linkError ? ... : undefined` check — the tooltip now leads with
      the same visible error text (no more disconnected messages) while
      restoring the lost consequence-specific reasoning.
- [x] 21.3 **Scientific-rigor finding, addressed directly**: round 6's
      "Quit and reopen the app" message is more actionable than round
      5's inert-but-false "Reload the app" — but unlike a harmless lie,
      quitting is a real, disruptive action: `main.ts`'s `before-quit`
      handler unconditionally stops the camera/Python/DAQ subprocesses,
      so quitting mid-scan or mid-backup would interrupt it with zero
      warning in the message itself. Appended "(this will interrupt any
      active scan or backup)" so the instruction's real cost is stated
      up front rather than discovered the hard way.
- [x] 21.4 **Reviewed and deliberately not changed** (a code-comment
      accuracy nit, not a functional bug): the claim "no in-app reload
      exists" is solid for Windows/Linux (`BrowserWindow.setMenu(null)`
      strips the accelerator-hosting menu there) but `setMenu()` is
      documented as not supported on macOS, where the menu bar is
      process-wide via `Menu.setApplicationMenu()` (never called in this
      codebase) — so a default Reload may still exist on macOS
      specifically. This doesn't change the fix: "quit and reopen" is
      still correct and works identically on all three platforms, it's
      just not the _only_ thing that would have worked on macOS.
      Reworded the test's explanatory comment to state this precisely
      instead of a blanket claim.
- [x] 21.5 Test-hardening, all gaps confirmed real by tracing the actual
      code and mock behavior (not hypothetical):
  1. Added a positive-control assertion (`filesCopied` **can** be `1` on
     full success) alongside the existing revert tests' `=== 0`
     assertions — without it, a broken variant that never increments
     `filesCopied` at all would pass every existing test coincidentally.
  2. Added `expect(result.filesCopied).toBe(0)` to the 2-image revert
     test specifically — the single-image test alone can't distinguish
     `-= uploadedIds.length` from a hardcoded `-= 1` (both yield 0 for
     n=1).
  3. Added a mixed-failure test: one image fails its own copy
     (`failedIds`), the other succeeds then gets reverted on CSV
     failure (`uploadedIds`) — the only scenario able to catch a
     double-counting bug (e.g. subtracting `failedIds.length` too,
     which every prior CSV-failure test coincidentally couldn't catch
     since `failedIds` was always empty in those runs).
  4. Added a test for the `completedImages`/`failedImages` progress-
     counter fix (21.1), including making the shared mock actually emit
     rclone's per-file "Copied" info-log line — the existing shared mock
     never did, so `onProgress` had never fired at all in any test
     until now.
- [x] 21.6 Verified locally after all fixes: `npx tsc --noEmit`,
      `npx eslint`, and `npx prettier --check` all clean. Full
      `npm run test:unit`: 1546/1546 real tests passing, only the same
      pre-existing `database-handlers.test.ts` `BLOOM_DATABASE_URL`
      local-setup flake (unrelated, unaffected).
- [x] 21.7 CI note: the push that triggered this round's review
      (`3247057`) hit a one-off `Test - TypeScript Unit` failure in
      `tests/unit/scans-export.test.ts`'s `cleanDatabase()` — a
      `PrismaClientKnownRequestError` (foreign key violation on
      `experiment.deleteMany()`) in a file this entire session has never
      touched. This exact failure signature matches a pre-existing,
      already-documented category of test-isolation flakiness (see
      `tests/unit/global-setup.ts`'s own doc comment describing
      GraviScan-family rows entangled with `Experiment`'s FK under
      shared-`dev.db` test runs) — `Test - TypeScript Unit` had passed
      cleanly on every prior push this session. Not investigated further
      as a regression; the round-7 push provides a fresh CI run to
      confirm it doesn't recur.
- [x] 21.8 CI confirmed: the round-7 push (`e6b0ef8`) re-ran
      `Test - TypeScript Unit` cleanly — 21.7's `scans-export.test.ts`
      failure did not recur, confirming it was the documented flake, not
      a regression from this round's work.

## 22. Round-8 `/review-pr` response — 2 blocking + 1 important finding (plus a raised-3x fix), all addressed

Ran the same 5-subagent adversarial team against round 7's fix commit
(`0d72d02`), explicitly instructed to hunt for any remaining sibling of
the counter-correction defect this cycle has chased since round 4 —
this time by tracing the **entire** `runBoxBackup()` function and the
full `onProgress` consumer chain end to end, not just the branch round 7
touched. Found exactly that pattern once more (a different branch of the
same function), plus an independent, pre-existing bug the full-chain
trace surfaced, plus a self-inflicted regression from round 7's own
tooltip fix. Fixed all of it with TDD, plus finally closed a UX gap
raised (and deferred) across three consecutive rounds — commit `7a3c6bc`.

- [x] 22.1 **BLOCKING — the total-rclone-failure branch (non-zero exit,
      no per-file error info) has the identical uncorrected-counter
      defect round 7 just fixed for the CSV-failure branch, just in a
      different failure path.** When rclone dies mid-transfer (e.g. a
      network drop) after successfully copying and logging some files
      but before finishing, `copyResult.success === false &&
copyResult.erroredFiles.size === 0` — the existing "mark ALL as
      failed" branch pushes every image in the wave (including ones that
      already fired `onFileComplete` and incremented `completedImages`)
      into `failedIds`, but never decremented `completedImages` for
      them. Result: an image could be simultaneously counted
      "completed" in the live progress display and "failed" in the
      persisted `box_status` and error count. Fixed by tracking a
      per-wave `waveCompletedImages` counter (separate from the
      function-scoped running total) and subtracting it from
      `completedImages` in this branch, mirroring 21.1's fix for the
      CSV-failure branch.
- [x] 22.2 **BLOCKING — a pre-existing, unrelated bug the full-chain
      trace surfaced: Bloom and Box progress events share one untyped
      `onProgress`/IPC channel with incompatible field names**
      (`uploadAllScans`'s own doc comment: "does not distinguish
      source, matching the existing wiring"). Bloom's `UploadProgress`
      is `{total, completed, failed, currentFile}`; Box's
      `BoxBackupProgress` is `{totalImages, completedImages,
failedImages, currentExperiment}`. `UploadStatusContext.tsx`
      stored whatever arrived verbatim with no shape check, so every
      Bloom progress tick would render `Layout.tsx`'s global banner as
      "Upload progress: undefined/undefined" — directly undermining
      round 7's own claim that its corrected counters reach that
      banner. Predates this entire review cycle (not introduced by any
      round's fix), but found by exactly the kind of full-consumer-chain
      audit this round asked for. Fixed by ignoring any event that isn't
      actually Box-shaped (`typeof data?.totalImages !== 'number'`) in
      `UploadStatusContext.tsx` — the minimal, safe fix; a full
      redesign (tagging events with a `source` discriminant, or
      separate channels) is a larger change than this round's scope.
- [x] 22.3 **IMPORTANT — round 7's own tooltip fix
      (`` `${linkError} — Download is disabled...` ``, 21.2) produced a
      self-inflicted double-punctuation run-on.** The same round-7
      commit also edited the retry-cap message to end in its own
      parenthetical + period ("...active scan or backup)."), without
      reconciling that the tooltip's concatenation assumed no trailing
      punctuation — concatenated, the result was "...backup). —
      Download is disabled..." (period immediately followed by an
      em-dash), and more generally, any `linkError` that's already a
      full sentence produces an awkward run-on. Fixed by replacing
      concatenation with a fixed, generic tooltip that points back at
      the visible error text ("— see the error above for details.")
      instead of duplicating/appending to it — robust to whatever the
      underlying error string says.
- [x] 22.4 **Addressed a finding raised and deferred across rounds
      6/7/8**: the plain `listGraviMetadata`-failure message (as
      opposed to the rarer retry-cap give-up) had no recourse or warning
      at all — just the bare backend error string. Since `ensureFetched`
      only ever calls `refetch` once per `experimentId`, a failure on
      this very first fetch (a transient DB-lock/IO error being the
      realistic, and more common, trigger) is just as permanently stuck
      as the retry-cap path. Added the same "Quit and reopen the app to
      retry (this will interrupt any active scan or backup)." suffix.
- [x] 22.5 **Reviewed and deliberately deferred** (raised by 1-2 of 5
      subagents each; larger design decisions than this round's scope):
  1. Even with 22.1/21.1's fixes, there's a real (bounded by network-
     timeout-length, not sub-frame) window where the live progress
     banner can show a false "fully complete" ratio for a wave whose
     images copied fine but whose metadata CSV hasn't been attempted
     yet — because `completedImages` is incremented per-file as each
     image copies, before the CSV attempt even starts, not after the
     whole wave (images + CSV) is confirmed durable. A real fix means
     restructuring progress emission from per-file to per-wave
     granularity (losing responsiveness for large multi-file waves) or
     otherwise redesigning what "completed" means mid-wave — a genuine
     design tradeoff, not a small patch, and risks introducing yet
     another sibling bug in the same area this cycle has already
     revisited five times.
  2. `BrowseGraviScans.tsx`'s per-row "Box N/M" indicator displays the
     _run-wide_ `totalImages`/`completedImages` (summed across every
     experiment in the batch) keyed by whichever experiment is
     "current," not a per-experiment count — in a multi-experiment
     backup run, every row shows the same batch-wide denominator, and a
     finished row's display freezes at whatever the global counters
     were at that instant rather than continuing to reflect reality.
     Independently found by 2 of 5 subagents. Predates this round (and
     likely this whole review cycle); fixing it requires computing and
     threading a per-experiment total through `runBoxBackup`, a
     non-trivial restructuring.
  3. The grouping loop's invariant (`imageIds.length === imagePaths
.length === scanRows.length` per wave) that 21.1/22.1's fixes
     implicitly depend on is correct today but unenforced — a future
     change that filters `scanRows` independently (e.g. to exclude
     images missing accession data) could silently decouple them.
     No live bug; noted for future readers.
- [x] 22.6 Verified locally after all fixes: `npx tsc --noEmit`,
      `npx eslint`, and `npx prettier --check` all clean. Full
      `npm run test:unit`: 1548/1548 real tests passing, only the same
      pre-existing `database-handlers.test.ts` `BLOOM_DATABASE_URL`
      local-setup flake (unrelated, unaffected).

## 23. Round-9 `/review-pr` response — 3 blocking + 1 important finding, all fixed

Ran the same 5-subagent adversarial team against round 8's fix commit
(`7a3c6bc`). Two agents performed actual empirical verification rather
than mental simulation — one hand-traced `rcloneCopyFiles`'s error
parser against a real-world rclone error format, the other live-edited
`box-backup.ts` to test a specific mutation, ran the suite, and reverted
— surfacing the single most severe finding of this entire review cycle,
plus a self-inflicted repeat of a bug fixed earlier in the very same
commit being reviewed. Fixed all of it with TDD — commit `0b42a8b`.

- [x] 23.1 **BLOCKING — the most severe finding of this whole review
      cycle: `rcloneCopyFiles` could silently report a fully failed Box
      upload as a full success, permanently.** The per-file error parser
      trusted ANY `level:"error"` JSON log line's extracted token
      (`msg.split(':')[0].trim()`) as a real filename with no check that
      it actually was one. rclone logs global/config failures — an
      expired auth token, exceeded quota, a backend outage — at
      `level:"error"` too, but with no per-file attribution (e.g.
      `"Failed to copy: googleapi: Error 401: Invalid Credentials"`,
      which extracts to the bogus token `"Failed to copy"`). Since that
      token matches none of the real filenames, the caller's per-file
      loop (`erroredFiles.has(filename)`) finds every real file
      "not errored" and marks the ENTIRE wave `box_status: 'uploaded'`
      with `result.success` left at its default `true` — a complete
      backup failure reported as complete success, and because future
      runs only re-select `box_status in ['pending','failed']`, this
      data loss is **permanent** with no automatic retry. This is
      strictly worse than every prior round's finding in this area
      (those made a real failure temporarily mis-reported or
      temporarily unretryable; this one makes a real failure
      permanently indistinguishable from success). Fixed by only
      trusting an extracted `level:"error"` token as a per-file
      attribution when it matches one of the call's own known
      filenames — an unmatched token now correctly falls through to the
      existing (already-safe, since round 5) "mark ALL as failed" path
      instead of the per-file loop.
- [x] 23.2 **BLOCKING — round 8's own plain-fetch-failure fix (22.4)
      reintroduced the exact punctuation-collision bug fixed for the
      Download tooltip earlier in that same commit (22.3).** `` `${result
.error ?? '...'}. Quit and reopen...` `` concatenates the fixed
      suffix directly onto `result.error`, which for the realistic
      trigger (a caught Prisma/backend exception, via
      `database-handlers.ts`'s `errorMessage()`) is raw, unbounded text
      that routinely ends in its own full sentence and period — e.g.
      `"...does not exist in the current database."` — producing
      `"...database.. Quit and reopen..."`. Confirmed independently by 2
      of 5 subagents; only the test fixture's punctuation-free
      `'Database is locked'` literal kept this from being caught
      earlier. Unlike the tooltip (which had a genuinely redundant
      visible-error paragraph it could just point to instead), this
      message IS the primary display text with nothing else to point
      to, so the fix here is different: strip trailing `.`/`!`/`?` from
      `result.error` before appending the suffix, rather than dropping
      the interpolation entirely.
- [x] 23.3 **BLOCKING — the `completedImages`/`failedImages` progress-
      counter test (22.1) had no coverage proving `waveCompletedImages`
      resets per wave rather than per experiment or per function call.**
      Every existing `runBoxBackup` fixture used exactly one wave, so
      "resets every wave" and "never resets" are observationally
      identical — confirmed empirically: hoisting the fix's `let
waveCompletedImages = 0;` out of the per-wave loop and into the
      per-experiment loop still passed every existing test. Added a
      genuinely discriminating two-wave test (wave 0 fully succeeds,
      wave 1 totally fails) and independently reproduced the same
      empirical mutation-testing methodology to confirm it actually
      catches that exact mutant before reverting it.
- [x] 23.4 **IMPORTANT — `Experiments.tsx`'s `ExperimentWaveLinks`
      early-returned `null` whenever `links.length === 0`, before
      `linkError` was ever checked.** Indistinguishable from "no waves
      linked yet" (every experiment's default state) is "the fetch that
      would tell us failed" — so the single most common trigger for a
      wave-metadata fetch failure (an experiment with nothing linked
      yet) showed nothing at all on this page's row, not even the
      recourse message given across three prior review rounds (19.3,
      20.4, 22.4). A single-experiment test would have passed vacuously
      here too — this page's attach panel defaults to the _first_
      experiment and redundantly renders its own `linkError` for the
      same shared `experimentId`, masking the row-level bug. Used two
      experiments (failing only the second's fetch) to properly isolate
      and fix it: render whenever `links.length > 0 || linkError` is
      truthy.
- [x] 23.5 **Reviewed and deliberately deferred** (raised by 1-2 of 5
      subagents each; a preventive/hygiene concern rather than a live
      bug, or purely cosmetic):
  1. `onUploadProgress`'s declared type (`BoxBackupProgress`, in
     `electron.d.ts`) still claims a single fixed shape even though two
     shapes (Bloom's and Box's) actually flow through it — round 8's
     fix (22.2) works around this with a runtime `typeof` guard at the
     one known-affected consumer, but the type itself doesn't force any
     _future_ consumer to add the same guard. Flagged as "the actual
     root cause enabling this whole chain of sibling bugs" by one
     reviewer. A proper fix (a discriminated union, updating every
     consumer to narrow) is a real type-safety improvement but doesn't
     change any currently-observed behavior — deferred as a larger,
     preventive-only change.
  2. The two now-similar "quit and reopen" messages use different verbs
     ("to retry" vs. "to refresh them") despite both describing the
     identical underlying recourse from the identical `refetch()`
     function. Each verb is individually sensible in its own trigger
     context (retry a never-completed fetch vs. refresh already-stale
     displayed data) — reviewed and kept as-is rather than forcing an
     artificial consistency.
  3. Fixed a test comment in `box-backup.test.ts` that incorrectly
     claimed "CSV is never even attempted once every image failed its
     own copy" — the metadata CSV step actually still runs
     unconditionally regardless of whether any image succeeded
     (pre-existing behavior, not asserted by this test, not changed
     this round).
- [x] 23.6 Verified locally after all fixes: `npx tsc --noEmit`,
      `npx eslint`, and `npx prettier --check` all clean. Full
      `npm run test:unit`: 1552/1552 real tests passing, only the same
      pre-existing `database-handlers.test.ts` `BLOOM_DATABASE_URL`
      local-setup flake (unrelated, unaffected).
