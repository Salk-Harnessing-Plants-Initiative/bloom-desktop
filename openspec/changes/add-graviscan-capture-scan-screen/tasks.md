## 1. Backend: wave-scoped verify-plates, read AND write (TDD)

- [ ] 1.1 In `tests/unit/graviscan/verify-plates.test.ts`, write failing
      tests for the new optional `waveNumber` parameter — **appended as
      the last parameter** in `verifyPlates(db, plates, experimentId,
      scanOutputDir, onProgress, waveNumber)`, not grouped next to
      `experimentId` (design.md Decision 2: this is the only placement
      that doesn't risk silently rebinding an existing positional
      argument at this test file's ~50 existing call sites). Cover:
      omitting it preserves every existing test's behavior unchanged
      (run the existing suite as-is first to confirm baseline green);
      supplying a valid `waveNumber` with a matching
      `GraviExperimentWaveMetadata` link scopes the
      `GraviPlateSectionMapping` **lookup** to that link's `accessionId`
      (plates from a different wave's linked accession, even one linked
      to the same experiment, SHALL NOT match); supplying a `waveNumber`
      with no matching link classifies every plate `lookup_failed` with a
      warning naming the experiment and wave, without falling back to
      unscoped matching; an invalid `waveNumber` (negative, non-integer,
      non-numeric) fails the whole run before any decode or DB access,
      using `database-handlers.ts`'s existing `isValidWaveNumber()`
      helper (import it, do not duplicate the check); **a detected swap's
      `GraviScan` correction `updateMany` includes `wave_number:
      waveNumber` in its `where` clause when `waveNumber` was supplied**
      — set up a fixture with two waves sharing the same
      `(scanner_id, plate_index, plate_barcode)` combination and confirm
      only the wave-matching rows are touched (design.md Decision 2,
      point 4 — this is the fix for the wave-scoped-read/experiment-wide-
      write mismatch found during proposal review).
- [ ] 1.2 Implement the `waveNumber` parameter in `verifyPlates()`
      (`src/main/graviscan/verify-plates.ts`): resolve `accessionId` via
      `db.graviExperimentWaveMetadata.findUnique({ where: {
      experiment_id_wave_number: { experiment_id, wave_number } } })` when
      `waveNumber` is provided, scope the plate **lookup** to
      `plate: { metadata_file_id: accessionId }` instead of the existing
      `plate.metadata_file.experiments.some.id` filter for that call only
      (omitting `waveNumber` keeps today's filter), and add
      `wave_number: waveNumber` to every `GraviScan` swap-correction
      `updateMany`'s `where` clause when `waveNumber` was supplied. Run
      1.1's tests green.
- [ ] 1.3 Update `graviscan:verify-plates`'s `ipcMain.handle` signature in
      `src/main/graviscan/register-handlers.ts` to accept and pass through
      an optional `waveNumber` (same last-position placement, same
      `isValidWaveNumber()` validation). Add/update unit coverage in
      `tests/unit/graviscan/register-handlers.test.ts`, including
      updating its existing exact positional
      `toHaveBeenCalledWith(mockDb, plates, 'exp-1', outputDir,
      expect.any(Function))` assertion to account for the new trailing
      argument.
- [ ] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check
      gate before starting Section 2.

## 2. Renderer: new VerificationStatus type

- [ ] 2.1 In `src/types/graviscan.ts`, **create** a new `VerificationStatus`
      type (no such type exists in this repo today — this is new, not a
      "replace" or "unify" of anything currently present; that framing
      described only the external reference implementation's bug). Match
      `src/main/graviscan/verify-plates.ts`'s real `VerifyStatus` union
      exactly (`verified | incorrect | unreadable | needs_review |
      duplicate_qr | swapped | lookup_failed` — 7 values), plus
      `'pending'` for the DB column's own pre-verification default
      (`schema.prisma:178`). Do **not** include `'skipped'` — it was
      deliberately removed from `VerifyStatus` itself as dead code
      (`openspec/changes/archive/2026-07-30-add-verify-plates-handler/
      tasks.md:157-158`) and has no live producer or consumer anywhere in
      this codebase.
- [ ] Run `npx tsc --noEmit` — confirm no new type errors before Section 3.

## 3. Preload wiring: verifyPlates + events, with real E2E coverage

- [ ] 3.1 Add `verifyPlates(plates, experimentId, scanOutputDir?,
      waveNumber?)` (matching the final backend signature from Section 1)
      to `graviAPI` in `src/main/preload.ts`, plus `onVerifyStarted`,
      `onVerifyResult`, `onVerifyComplete` listener wrappers (matching the
      existing `onScanStarted`/`onScanComplete` pattern for cleanup/removal
      semantics). Add corresponding typed signatures to
      `src/types/electron.d.ts`.
- [ ] 3.2 Add a round-trip `test.describe` block to
      `tests/e2e/graviscan-ipc.e2e.ts` (the actual existing home for
      `gravi.*` IPC round-trip tests — **not**
      `tests/e2e/renderer-database-ipc.e2e.ts`, which covers the separate
      `db:*` namespace and its own static coverage gate that only scans
      `src/main/database-handlers.ts`; `graviscan:*` handlers registered
      in `src/main/graviscan/register-handlers.ts` are outside that
      gate's scope entirely and would never be counted there, tested or
      not — this is a correction from this proposal's first review round,
      which had cited that gate as the reason to land 3.1+3.2 together).
      Exercise `window.electron.gravi.verifyPlates(...)` through the real
      preload bridge for at least: a `verified` plate, a `waveNumber`-
      scoped lookup that succeeds, a `waveNumber` with no linked metadata
      producing `lookup_failed`, and the wave-scoped swap-correction write
      test from 1.1 exercised end-to-end through the real IPC bridge (not
      just the unit-level Prisma call).
- [ ] 3.3 Run `npm run test:e2e -- tests/e2e/graviscan-ipc.e2e.ts` against
      a real Electron+SQLite instance and confirm it passes, alongside the
      full existing file (no regressions in the rest of the `gravi.*`
      suite).

## 4. Renderer utility: cadenceEstimator (TDD)

- [ ] 4.1 Write failing unit tests in
      `tests/unit/renderer/cadenceEstimator.test.ts` for
      `estimateCycleSeconds({ platesPerScanner, dpi, regionMm })` per the
      accepted spec (`ui-management-pages/spec.md:1836`): base-case
      calculation, DPI scaling, region-height scaling.
- [ ] 4.2 Implement `src/renderer/utils/cadenceEstimator.ts` to satisfy 4.1.

## 5. Hook: useScannerStatus (TDD)

- [ ] 5.1 Write failing tests in
      `tests/unit/renderer/hooks/useScannerStatus.test.ts` for
      `useScannerStatus`: polls `getScannerStatus()` and maps each row
      into a `ScannerPanelState` that includes `gridMode` — note
      `ScannerPanelState` (`src/types/graviscan.ts`) does **not** carry
      `gridMode` today (only the separate `ScannerStatusRow` does), so
      this task adds the field to `ScannerPanelState` as part of the
      hook's own type, sourced from `getScannerStatus()`'s existing
      response (no backend change needed, per design.md Decision 7).
      Also cover the PR #213 fix: initial scanner rows in `starting`
      state are polled (not solely event-driven) until every assigned
      scanner leaves `starting`, so a lost/never-replayed
      `webContents.send` init event cannot leave a row stuck showing
      "Connecting..." indefinitely.
- [ ] 5.2 Implement `src/renderer/hooks/useScannerStatus.ts` to satisfy 5.1.

## 6. Hook: useWaveNumber (TDD)

- [ ] 6.1 Write failing tests in
      `tests/unit/renderer/hooks/useWaveNumber.test.ts` for
      `useWaveNumber`: reads/sets the selected wave number, surfaces a
      "suggested next wave" via `getMaxWaveNumber()` + 1, rejects
      negative input.
- [ ] 6.2 Implement `src/renderer/hooks/useWaveNumber.ts` to satisfy 6.1.

## 7. Hook: usePlateAssignments — auto-fill with derived override (TDD)

- [ ] 7.1 Write failing tests in
      `tests/unit/renderer/hooks/usePlateAssignments.test.ts` covering:
      no linked wave metadata → empty, editable positions, and no
      previously-persisted assignment from a *different* wave is loaded
      or displayed (design.md Decision 3, point 3 — the PR #216
      regression guard: seed a persisted `GraviScanPlateAssignment` row
      for wave 2, switch to wave 3 with no link, confirm the grid is
      empty, not wave 2's stale data); linked metadata → auto-fill
      populates `plantBarcode`/`transplantDate`/`customNote`/`selected` in
      metadata-row order; a manual edit to any of those fields is
      detected as operator-overridden on the *next* comparison (persisted
      value differs from a freshly recomputed auto-fill baseline) and is
      preserved rather than overwritten when the auto-fill effect
      re-fires (simulate a scanner-assignment change); the same
      override survives an unmount/remount of the hook with the manual
      edit already persisted (regression guard for the ephemeral-Set
      design rejected during review — confirms the derived-comparison
      approach actually survives navigation, per design.md Decision 3
      point 2 and Decision 4); switching wave/experiment recomputes the
      auto-fill baseline from scratch, so a new wave's positions are
      never compared against the previous wave's persisted values;
      `listGraviMetadata()` or `graviPlateAccessions.list()` rejecting or
      returning `{ success: false }` leaves the grid in its last-known
      state with an inline error, not a crash or a silently-empty grid;
      a linked accession that resolves to **zero** `GraviPlateAccession`
      rows is visually/textually distinguished (e.g. a warning-styled
      note) from the "no link exists at all" empty state, so an operator
      can tell "expected manual entry" from "likely misconfigured link."
- [ ] 7.2 Implement `src/renderer/hooks/usePlateAssignments.ts` to satisfy
      7.1, persisting via `graviscanPlateAssignments.upsertMany(...)`.
      Manual barcode/date/note edits and auto-filled ones flow through the
      same persistence path (design.md Decision 3, point 4 — this is what
      makes PR #223's dropped-metadata-on-manual-pick bug structurally
      impossible here, not merely avoided by convention).

## 8. Hook: useContinuousMode (TDD)

- [ ] 8.1 Write failing tests in
      `tests/unit/renderer/hooks/useContinuousMode.test.ts` for
      `useContinuousMode`: interval/duration form state, rejects a
      zero-or-negative interval before it would ever reach `startScan()`
      (design.md known-bug-avoidance: divide-by-zero guard), assembles
      the `cadenceContext` (`platesPerScanner` from Section 5's real
      `gridMode` values via `createPlateAssignments`, not a hardcoded
      constant) passed to `CadenceWarningBanner`.
- [ ] 8.2 Implement `src/renderer/hooks/useContinuousMode.ts` to satisfy 8.1.

## 9. Hook: useScanSession — reducer-based state (TDD)

- [ ] 9.1 Write failing tests in
      `tests/unit/renderer/hooks/useScanSession.test.ts` covering:
      `JOB_COMPLETE` action correctly derives progress from the
      post-update state (no ref-mirroring lag/compensation — design.md
      Decision 1); dual-casing event payloads (`scanner_id`/`scannerId`,
      `plate_index`/`plateIndex`) both resolve correctly, matching
      `wiring.ts`'s `resolveScannerId()`/`resolvePlateIndex()` fallback
      pattern; `handleCancelScan` is `async`, its rejection is caught and
      surfaces an error state rather than throwing unhandled, and its
      success path clears pending jobs / resets `isScanning` / resets
      scanner states to idle (design.md known-bug-avoidance, both the
      failure and success paths); `getOutputDir()` failure surfaces a
      blocking error with no `/tmp` fallback; on-mount restore via
      `getScanStatus()` rehydrates `pendingJobs`/`waveNumber`/
      elapsed-time/countdown when `isActive: true`, and rehydrates nothing
      when `isActive: false` (matching a fresh app launch — design.md
      Decision 4/Non-Goals); when `isActive: false`, the hook additionally
      queries the most recent `GraviScanSession` for the experiment and
      surfaces a non-blocking informational banner if it has
      `completed_at: null` and `cancelled: false` (design.md Decision 5 —
      abnormal-termination signal; assert no such banner appears for a
      session with `completed_at` set or `cancelled: true`); verification
      invocation passes the current `waveNumber` alongside `experimentId`;
      "Start Scan" is blocked (or the hook exposes a `canStart: false`
      the composing screen/component respects) while `useWedgeEvents()`
      reports an active, unacknowledged wedge for any assigned scanner
      (design.md Decision 6).
- [ ] 9.2 Implement `src/renderer/hooks/useScanSession.ts` to satisfy 9.1.

## 10. Hook: useTestScan (TDD)

- [ ] 10.1 Write failing tests in
      `tests/unit/renderer/hooks/useTestScan.test.ts` for `useTestScan`:
      captures one-shot per assigned scanner without touching session
      state; `getOutputDir()` failure surfaces a blocking error, no
      `/tmp` fallback.
- [ ] 10.2 Implement `src/renderer/hooks/useTestScan.ts` to satisfy 10.1.

## 11. Components (TDD, React Testing Library)

- [ ] 11.1 `CadenceWarningBanner.tsx` — failing tests in
      `tests/unit/renderer/components/CadenceWarningBanner.test.tsx`:
      hidden when estimate fits interval, shown with correct copy when it
      doesn't, reactive to DPI/gridMode/scannerCount changes. Implement
      to satisfy.
- [ ] 11.2 `QRVerificationBanner.tsx` — failing tests in
      `tests/unit/renderer/components/QRVerificationBanner.test.tsx`:
      red (any `duplicate_qr`) / amber (`unreadable`/`needs_review`/
      `incorrect`/`lookup_failed`, none `duplicate_qr`) / green (all
      `verified`/`swapped`) grading; `incorrect` renders a label distinct
      from "QR Unreadable"; `lookup_failed` renders its **own** pinned
      title ("Verification Lookup Failed") distinct from both
      "QR Unreadable" and "Manual Review Needed" — not folded into either;
      a batch containing two or more distinct non-green statuses
      simultaneously (e.g. one `unreadable` + one `lookup_failed`, no
      `duplicate_qr`) surfaces **both** causes' detail text, not just one
      picked by an undefined priority order. Implement to satisfy.
- [ ] 11.3 `ScanFormSection.tsx` — failing tests in
      `tests/unit/renderer/components/ScanFormSection.test.tsx`: plate
      fields render as editable inputs in both auto-fill and manual modes
      (design.md Decision 3 — no read-only `<span>` for `plantBarcode`
      when auto-filled); `selected` checkbox toggles correctly; the
      "linked but empty accession" warning state from task 7.1 renders
      distinctly from the "no link" empty state. Implement to satisfy.
- [ ] 11.4 `ScanControlSection.tsx` — failing tests in
      `tests/unit/renderer/components/ScanControlSection.test.tsx`:
      Start/Cancel/continuous-mode controls call the corresponding
      `useScanSession`/`useContinuousMode` handlers; Cancel button
      disabled state reflects an in-flight cancel request; **the
      already-accepted "overtime" banner** (referenced by the Predictive
      Cadence Warning requirement's own text as something this component
      must coexist with, `ui-management-pages/spec.md` cadence
      requirement) renders when the coordinator's `overtime` event fires
      for the current cycle; Start button is disabled while any assigned
      scanner has an active wedge (design.md Decision 6); a pre-start
      warning appears (not blocking) when the current wave has no linked
      metadata and no plates have been manually filled in, so an operator
      isn't only informed via the post-scan verification banner. Implement
      to satisfy.
- [ ] 11.5 `ScannerStatusPanel.tsx` — failing tests in
      `tests/unit/renderer/components/ScannerStatusPanel.test.tsx`:
      renders per-scanner live status from `useScannerStatus`/
      `useScanSession` state. Implement to satisfy.

## 12. Screen: GraviScan.tsx + routing/nav wiring

- [ ] 12.1 Implement `src/renderer/GraviScan.tsx`, composing all hooks and
      components from Sections 5–11.
- [ ] 12.2 Add the `capture-scan` route to `App.tsx`'s `mode ===
      'graviscan'` block.
- [ ] 12.3 Add a "Capture Scan" entry to `graviscanLinks` in `Layout.tsx`.
- [ ] 12.4 Write component/integration tests (before or alongside 12.1-
      12.3, not solely after) confirming: `WorkflowSteps.tsx`'s existing
      graviscan step 5 navigates to a rendering `GraviScan.tsx` (not a
      redirect to Home); the sidebar link is present in graviscan mode;
      **CylinderScan mode's own `/capture-scan` route (`CaptureScan.tsx`)
      renders unchanged** and is unaffected by this tier's `App.tsx`
      change (a scenario in the `ui-management-pages` spec delta with no
      task covering it until now) — per the delta's routing scenarios.

## 13. Verification

- [ ] 13.1 Run `npm run lint && npm run format:check`.
- [ ] 13.2 Run `npm run test:unit` (full suite) — confirm no new failures
      beyond any pre-existing, unrelated ones (document which, matching
      this repo's existing convention of naming pre-existing failures
      rather than silently ignoring them).
- [ ] 13.3 Run `npx tsc --noEmit`.
- [ ] 13.4 Run `npm run test:e2e -- tests/e2e/graviscan-ipc.e2e.ts` (full
      file, not just this tier's new block) and confirm no regressions.
- [ ] 13.5 Start the dev app (per this repo's `dev`/`run` skill) and
      manually exercise the Capture Scan happy path in GraviScan mode:
      select experiment/wave → assign plates (auto-fill + one manual
      override) → start a short continuous scan → observe live progress →
      let it complete → observe the graded QR verification banner →
      navigate away and back to confirm restore-on-navigation and that
      the manual override survived. This is a live-Electron check, not a
      substitute for the automated suites above — required per this
      project's own prior incident where IPC/custom-protocol bugs were
      invisible to unit tests.
- [ ] 13.6 Run `openspec validate add-graviscan-capture-scan-screen
      --strict` and resolve any issues.
