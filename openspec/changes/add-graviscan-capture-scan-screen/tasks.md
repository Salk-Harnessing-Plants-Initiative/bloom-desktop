## 1. Backend: wave-scoped verify-plates, read AND write (TDD)

- [ ] 1.1 Export `isValidWaveNumber()` from `src/main/database-handlers.ts`
      (currently a bare, un-exported `function` — confirmed no other file
      can import it as-is). No behavior change, just the `export` keyword.
- [ ] 1.2 In `tests/unit/graviscan/verify-plates.test.ts`, write failing
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
      using 1.1's exported `isValidWaveNumber()` (import it, do not
      duplicate the check); **a detected swap's `GraviScan` correction
      `updateMany` includes `wave_number: waveNumber` in its `where`
      clause when `waveNumber` was supplied** — set up a fixture with two
      waves sharing the same `(scanner_id, plate_index, plate_barcode)`
      combination and confirm only the wave-matching rows are touched
      (design.md Decision 2, point 4 — the fix for the wave-scoped-read/
      experiment-wide-write mismatch found in review round 1). This is a
      plain mocked-Prisma Vitest unit test, consistent with every other
      test already in this file (no real DB/integration setup needed).
- [ ] 1.3 Implement the `waveNumber` parameter in `verifyPlates()`
      (`src/main/graviscan/verify-plates.ts`): resolve `accessionId` via
      `db.graviExperimentWaveMetadata.findUnique({ where: {
      experiment_id_wave_number: { experiment_id, wave_number } } })` when
      `waveNumber` is provided, scope the plate **lookup** to
      `plate: { metadata_file_id: accessionId }` instead of the existing
      `plate.metadata_file.experiments.some.id` filter for that call only
      (omitting `waveNumber` keeps today's filter), and add
      `wave_number: waveNumber` to both `GraviScan` swap-correction
      `updateMany` calls' `where` clauses (`verify-plates.ts:713`, `:723`
      — not the `GraviScanPlateAssignment` writes alongside them, which
      per design.md Decision 2 point 5 correctly stay unscoped) when
      `waveNumber` was supplied. Run 1.2's tests green.
- [ ] 1.4 Update `graviscan:verify-plates`'s `ipcMain.handle` signature in
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
      this codebase. No dedicated test file — this is a compile-time-only
      type alias with no runtime behavior of its own; every one of its 8
      values is exercised behaviorally by `QRVerificationBanner.test.tsx`
      (task 11.2) and `useScanSession.test.ts` (task 9.1).
- [ ] Run `npx tsc --noEmit` — confirm no new type errors before Section 3.

## 3. Preload wiring: verifyPlates + events, with real E2E coverage (TDD)

- [ ] 3.1 Add a round-trip `test.describe` block to
      `tests/e2e/graviscan-ipc.e2e.ts` (the actual existing home for
      `gravi.*` IPC round-trip tests, confirmed via its existing
      `test.describe('GraviScan IPC Round-Trip', ...)` block — **not**
      `tests/e2e/renderer-database-ipc.e2e.ts`, which covers the separate
      `db:*` namespace and its own static coverage gate that only scans
      `src/main/database-handlers.ts`; `graviscan:*` handlers registered
      in `src/main/graviscan/register-handlers.ts` are outside that
      gate's scope entirely and would never be counted there, tested or
      not). Write it failing first, exercising
      `window.electron.gravi.verifyPlates(...)` through the real preload
      bridge (not yet exposed) for at least: a `verified` plate, a
      `waveNumber`-scoped lookup that succeeds, a `waveNumber` with no
      linked metadata producing `lookup_failed`, and the wave-scoped
      swap-correction write from task 1.2 exercised end-to-end through
      the real IPC bridge (not just the unit-level Prisma call).
- [ ] 3.2 Add `verifyPlates(plates, experimentId, scanOutputDir?,
      waveNumber?)` (matching the final backend signature from Section 1)
      to `graviAPI` in `src/main/preload.ts`, plus `onVerifyStarted`,
      `onVerifyResult`, `onVerifyComplete` listener wrappers (matching the
      existing `onScanStarted`/`onScanComplete` pattern for cleanup/removal
      semantics). Add corresponding typed signatures to
      `src/types/electron.d.ts`. Run 3.1's test green.
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
      `tests/unit/hooks/useScannerStatus.test.ts` (matching this repo's
      existing convention, e.g. `tests/unit/hooks/useWedgeEvents.test.ts`
      — not a `tests/unit/renderer/hooks/` path, which doesn't exist
      anywhere in this codebase) for `useScannerStatus`: polls
      `getScannerStatus()` and maps each row into a `ScannerPanelState`
      that includes `gridMode` — note `ScannerPanelState`
      (`src/types/graviscan.ts`) does **not** carry `gridMode` today (only
      the separate `ScannerStatusRow` does), so this task adds the field
      to `ScannerPanelState` as part of the hook's own type, sourced from
      `getScannerStatus()`'s existing response (no backend change needed,
      per design.md Decision 7). Also cover the PR #213 fix: initial
      scanner rows in `starting` state are polled (not solely
      event-driven) until every assigned scanner leaves `starting`, so a
      lost/never-replayed `webContents.send` init event cannot leave a
      row stuck showing "Connecting..." indefinitely.
- [ ] 5.2 Implement `src/renderer/hooks/useScannerStatus.ts` to satisfy 5.1.

## 6. Hook: useWaveNumber (TDD)

- [ ] 6.1 Write failing tests in `tests/unit/hooks/useWaveNumber.test.ts`
      for `useWaveNumber`: reads/sets the selected wave number, surfaces a
      "suggested next wave" via `getMaxWaveNumber()` + 1, rejects
      negative input.
- [ ] 6.2 Implement `src/renderer/hooks/useWaveNumber.ts` to satisfy 6.1.

## 7. Hook: usePlateAssignments — auto-fill with derived override (TDD)

- [ ] 7.1 Write failing tests in
      `tests/unit/hooks/usePlateAssignments.test.ts` covering:
      - No linked wave metadata → empty, editable positions, and no
        previously-persisted assignment from a *different* wave is loaded
        or displayed (PR #216 regression guard: seed a persisted
        `GraviScanPlateAssignment` row for wave 2, switch to wave 3 with
        no link, confirm the grid is empty, not wave 2's stale data).
      - Linked metadata → auto-fill populates `plantBarcode`/
        `transplantDate`/`customNote`/`selected` in metadata-row order.
      - **Bootstrap case**: a position with no persisted row yet is
        always populated by the fresh auto-fill computation on first
        load — it is never treated as "operator-overridden" merely
        because "no value" trivially differs from a computed one
        (design.md Decision 3, point 2 — regression guard for a gap found
        in review round 2's fresh pass).
      - A manual edit to any of those fields, once persisted, is detected
        as operator-overridden on the *next* same-wave comparison
        (persisted value differs from a freshly recomputed auto-fill
        baseline for the *same* wave) and is preserved rather than
        overwritten when the auto-fill effect re-fires for a non-wave
        reason (simulate a scanner-assignment change).
      - The same override survives an unmount/remount of the hook with
        the manual edit already persisted (regression guard for the
        ephemeral-Set design rejected during review — confirms the
        derived-comparison approach actually survives navigation, per
        design.md Decision 3 point 2 and Decision 4).
      - **Wave-switch hard reset, including the different-metadata
        case**: switching wave ALWAYS unconditionally overwrites every
        position with the new wave's fresh computation (or empties it, if
        unlinked) — never compares against the previous wave's persisted
        values, regardless of whether the new wave has no link, its own
        different link, or (edge case) coincidentally the same values.
        Regression-test specifically the case round 2 of review found
        uncovered: wave 2 has a persisted, operator-overridden value;
        switch to wave 3, which has its **own, different** linked
        metadata (not "no link") — confirm wave 3 shows its own fresh
        auto-fill values, not wave 2's leftover override (design.md
        Decision 3, point 2's `lastAutoFilledWave` mechanism).
      - Entering/changing `plantBarcode` manually (in either mode)
        triggers a case-insensitive match against the loaded
        `AvailablePlate[]` list and auto-populates `transplantDate`/
        `customNote` from the matching plate — the actual PR #223 fix
        (design.md Decision 3, point 4), not merely a side effect of
        fields being editable; confirm entering a barcode with **no**
        match leaves date/note untouched rather than clearing them.
      - `listGraviMetadata()` or `graviPlateAccessions.list()` rejecting
        or returning `{ success: false }` leaves the grid in its
        last-known state with an inline error, not a crash or a
        silently-empty grid.
      - A linked accession that resolves to **zero**
        `GraviPlateAccession` rows is visually/textually distinguished
        (e.g. a warning-styled note) from the "no link exists at all"
        empty state, so an operator can tell "expected manual entry" from
        "likely misconfigured link."
- [ ] 7.2 Implement `src/renderer/hooks/usePlateAssignments.ts` to satisfy
      7.1, persisting via `graviscanPlateAssignments.upsertMany(...)`.
      Manual barcode/date/note edits and auto-filled ones flow through the
      same persistence path.

## 8. Hook: useContinuousMode (TDD)

- [ ] 8.1 Write failing tests in
      `tests/unit/hooks/useContinuousMode.test.ts` for
      `useContinuousMode`: interval/duration form state, rejects a
      zero-or-negative interval before it would ever reach `startScan()`
      (design.md known-bug-avoidance: divide-by-zero guard), assembles
      the `cadenceContext` (`platesPerScanner` from Section 5's real
      `gridMode` values via `createPlateAssignments`, not a hardcoded
      constant) passed to `CadenceWarningBanner`.
- [ ] 8.2 Implement `src/renderer/hooks/useContinuousMode.ts` to satisfy 8.1.

## 9. Backend persistence wiring: GraviScan / GraviScanSession rows

Review found that no caller anywhere in the app today persists `GraviScan`
or `GraviScanSession` rows during a real scan — `session-handlers.ts` has
"zero DB dependency" by its own header comment, and `graviscansCreate()`/
`graviscanSessionsCreate()`/`graviscanSessionsComplete()` exist, fully
tested, with no callers. This isn't a pre-existing gap this tier can defer:
before this tier, there was no renderer to drive a real session at all.
Section 1's wave-scoped write fix (Decision 2, point 4) needs real
`GraviScan.wave_number` values to filter on, and Section 10's
`useScanSession` needs `graviscanSessions.create()`/`.complete()` calls for
ordinary audit/history purposes (independent of the Section 10
localStorage-marker mechanism, which does not depend on these DB rows).

- [ ] 9.1 Write failing tests in `tests/unit/hooks/useScanSession.test.ts`
      (may be combined with task 10.1, same file) for: on `startScan()`
      success, `database.graviscanSessions.create(...)` is called with
      the current `experimentId`/`phenotyperId`/mode/interval/duration;
      on each job completion, `database.graviscans.create(...)` is called
      with the completed job's `experimentId`, `scannerId`, `plateIndex`,
      `waveNumber`, `sessionId`, `cycleNumber`, and image path; on clean
      session completion or a successful cancel,
      `database.graviscanSessions.complete(...)` is called with the
      matching `cancelled` flag.
- [ ] 9.2 Implement this wiring in `src/renderer/hooks/useScanSession.ts`.
      Run 9.1 green.

## 10. Hook: useScanSession — reducer-based state (TDD)

- [ ] 10.1 Write failing tests in
      `tests/unit/hooks/useScanSession.test.ts` covering:
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
      Decision 4/Non-Goals); verification invocation passes the current
      `waveNumber` alongside `experimentId`.
      - **Abnormal-termination marker (design.md Decision 5, revised)**:
        on successful `startScan()`, a `localStorage` entry
        `graviscan:session-in-progress:${experimentId}:${waveNumber}` is
        written with the expected total cycle count; on successful
        `cancelScan()` or clean session completion, that exact key is
        removed; on mount with `getScanStatus()` returning
        `isActive: false`, if a marker exists for the **currently
        selected** experiment+wave, the hook surfaces a non-blocking
        informational state naming the expected cycle count; no marker
        for the current experiment+wave (including one that exists for a
        *different* wave of the same experiment) produces no banner.
      - **Wedge-blocks-start (design.md Decision 6, revised)**: the hook
        (or the component consuming it — whichever owns "Start" gating)
        reads active-wedge state from `WedgeContext` (task 12.0, not a
        second independent `useWedgeEvents()` call) and disables
        starting while any assigned scanner has an active, unacknowledged
        wedge; regression-test that a wedge which occurred **before**
        this hook/component mounted (simulated via context already
        populated at mount time) still correctly blocks Start — this is
        the specific case an independent `useWedgeEvents()` instance
        would miss.
- [ ] 10.2 Implement `src/renderer/hooks/useScanSession.ts` to satisfy
      10.1 (building on 9.2's persistence wiring).

## 11. Hook: useTestScan (TDD)

- [ ] 11.1 Write failing tests in `tests/unit/hooks/useTestScan.test.ts`
      for `useTestScan`: captures one-shot per assigned scanner without
      touching session state; `getOutputDir()` failure surfaces a
      blocking error, no `/tmp` fallback.
- [ ] 11.2 Implement `src/renderer/hooks/useTestScan.ts` to satisfy 11.1.

## 12. Shared wedge context (Layout.tsx)

- [ ] 12.0 Write failing tests in `tests/unit/components/WedgeContext.test.tsx`
      (or add to the existing `tests/unit/components/WedgeBanner.test.tsx`)
      confirming: a `WedgeContext` provider wraps `Layout.tsx`'s existing
      single `useWedgeEvents()` call; both a `WedgeBanner`-like consumer
      and a second, independently-mounted consumer (simulating
      `GraviScan.tsx` mounting/unmounting across navigation) observe the
      **same** wedge state at all times, including a wedge that occurred
      before the second consumer's mount — this is the regression test
      for the bug review found in an independent-`useWedgeEvents()`-call
      design (design.md Decision 6). Implement the context in `Layout.tsx`
      to satisfy, replacing `WedgeBanner`'s direct `useWedgeEvents()` call
      with a context consumer.

## 13. Components (TDD, React Testing Library)

- [ ] 13.1 `CadenceWarningBanner.tsx` — failing tests in
      `tests/unit/components/CadenceWarningBanner.test.tsx`: hidden when
      estimate fits interval, shown with correct copy when it doesn't,
      reactive to DPI/gridMode/scannerCount changes. Implement to satisfy.
- [ ] 13.2 `QRVerificationBanner.tsx` — failing tests in
      `tests/unit/components/QRVerificationBanner.test.tsx`: red (any
      `duplicate_qr`) / amber (`unreadable`/`needs_review`/`incorrect`/
      `lookup_failed`, none `duplicate_qr`) / green (all
      `verified`/`swapped`) grading; `incorrect` renders a label distinct
      from "QR Unreadable"; `lookup_failed` renders its **own** pinned
      title ("Verification Lookup Failed") distinct from both
      "QR Unreadable" and "Manual Review Needed" — not folded into either;
      a batch containing two or more distinct non-green statuses
      simultaneously (e.g. one `unreadable` + one `lookup_failed`, no
      `duplicate_qr`) surfaces **both** causes' detail text, not just one
      picked by an undefined priority order. Implement to satisfy.
- [ ] 13.3 `ScanFormSection.tsx` — failing tests in
      `tests/unit/components/ScanFormSection.test.tsx`: plate fields
      render as editable inputs in both auto-fill and manual modes
      (design.md Decision 3 — no read-only `<span>` for `plantBarcode`
      when auto-filled); `selected` checkbox toggles correctly; the
      "linked but empty accession" warning state from task 7.1 renders
      distinctly from the "no link" empty state; the auto-fill
      IPC-failure inline error from task 7.1 actually renders in this
      component (not just asserted at the hook level). Implement to
      satisfy.
- [ ] 13.4 `ScanControlSection.tsx` — failing tests in
      `tests/unit/components/ScanControlSection.test.tsx`: Start/Cancel/
      continuous-mode controls call the corresponding `useScanSession`/
      `useContinuousMode` handlers; Cancel button disabled state reflects
      an in-flight cancel request; **the already-accepted "overtime"
      banner** (`scan-coordinator.ts`'s existing `overtime` event,
      forwarded via `wiring.ts`) renders when it fires for the current
      cycle; Start button is disabled while `WedgeContext` (task 12.0)
      reports an active wedge for any assigned scanner; a pre-start
      warning appears (not blocking) when the current wave has no linked
      metadata and no plates have been manually filled in; the
      abnormal-termination informational banner from task 10.1 actually
      renders in this component with the expected cycle count (not just
      asserted at the hook level). Implement to satisfy.
- [ ] 13.5 `ScannerStatusPanel.tsx` — failing tests in
      `tests/unit/components/ScannerStatusPanel.test.tsx`: renders
      per-scanner live status from `useScannerStatus`/`useScanSession`
      state. Implement to satisfy.

## 14. Screen: GraviScan.tsx + routing/nav wiring

- [ ] 14.1 Write failing tests in `tests/unit/pages/GraviScan.test.tsx`
      confirming the screen composes Sections 5-13's hooks/components
      correctly (e.g. plate-assignment state reaches `ScanFormSection`,
      session state reaches `ScanControlSection`/`ScannerStatusPanel`).
- [ ] 14.2 Implement `src/renderer/GraviScan.tsx` to satisfy 14.1,
      composing all hooks and components from Sections 5–13.
- [ ] 14.3 Add the `capture-scan` route to `App.tsx`'s `mode ===
      'graviscan'` block; update `tests/unit/pages/App.test.tsx` to cover
      it and to confirm **CylinderScan mode's own `/capture-scan` route
      (`CaptureScan.tsx`) renders unchanged** and is unaffected by this
      change.
- [ ] 14.4 Add a "Capture Scan" entry to `graviscanLinks` in
      `Layout.tsx`; update `tests/unit/pages/Layout.test.tsx` to confirm
      the sidebar link is present in graviscan mode, and confirm
      `WorkflowSteps.tsx`'s existing graviscan step 5 now navigates to a
      rendering `GraviScan.tsx` (not a redirect to Home).

## 15. Verification

- [ ] 15.1 Run `npm run lint && npm run format:check`.
- [ ] 15.2 Run `npm run test:unit` (full suite) — confirm no new failures
      beyond any pre-existing, unrelated ones (document which, matching
      this repo's existing convention of naming pre-existing failures
      rather than silently ignoring them).
- [ ] 15.3 Run `npx tsc --noEmit`.
- [ ] 15.4 Run `npm run test:e2e -- tests/e2e/graviscan-ipc.e2e.ts` (full
      file, not just this tier's new block) and confirm no regressions.
- [ ] 15.5 Start the dev app (per this repo's `dev`/`run` skill) and
      manually exercise the Capture Scan happy path in GraviScan mode:
      select experiment/wave → assign plates (auto-fill + one manual
      override) → start a short continuous scan → observe live progress →
      let it complete → observe the graded QR verification banner →
      navigate away and back to confirm restore-on-navigation and that
      the manual override survived → force-quit and relaunch to confirm
      the abnormal-termination informational banner appears for that
      wave. This is a live-Electron check, not a substitute for the
      automated suites above — required per this project's own prior
      incident where IPC/custom-protocol bugs were invisible to unit
      tests.
- [ ] 15.6 Run `openspec validate add-graviscan-capture-scan-screen
      --strict` and resolve any issues.
