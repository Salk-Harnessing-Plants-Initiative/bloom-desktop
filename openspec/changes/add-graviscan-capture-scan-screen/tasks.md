## 1. Backend: wave-scoped verify-plates (TDD)

- [ ] 1.1 In `tests/unit/graviscan/verify-plates.test.ts`, write failing
      tests for the new optional `waveNumber` parameter: omitting it
      preserves every existing test's behavior unchanged (regression
      guard, run existing suite as-is first to confirm baseline green);
      supplying a valid `waveNumber` with a matching
      `GraviExperimentWaveMetadata` link scopes the `GraviPlateSectionMapping`
      lookup to that link's `accessionId` (plates from a different wave's
      linked accession, even one linked to the same experiment, SHALL NOT
      match); supplying a `waveNumber` with no matching link classifies
      every plate `lookup_failed` with a warning naming the experiment and
      wave, without falling back to unscoped matching; an invalid
      `waveNumber` (negative, non-integer, non-numeric) fails the whole run
      before any decode or DB access, matching the existing `experimentId`
      string-type validation pattern.
- [ ] 1.2 Implement the `waveNumber` parameter in `verifyPlates()`
      (`src/main/graviscan/verify-plates.ts`): resolve `accessionId` via
      `db.graviExperimentWaveMetadata.findUnique({ where: {
      experiment_id_wave_number: { experiment_id, wave_number } } })` when
      `waveNumber` is provided, and scope the plate lookup to
      `plate: { metadata_file_id: accessionId }` instead of the existing
      `plate.metadata_file.experiments.some.id` filter for that call only
      (omitting `waveNumber` keeps today's filter). Run 1.1's tests green.
- [ ] 1.3 Update `graviscan:verify-plates`'s `ipcMain.handle` signature in
      `src/main/graviscan/register-handlers.ts` to accept and pass through
      an optional `waveNumber`, with the same type validation as
      `experimentId`. Add/update unit coverage for the handler-level
      validation in `tests/unit/graviscan/register-handlers.test.ts` (or
      wherever this handler's existing tests live).
- [ ] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check
      gate before starting Section 2.

## 2. Backend: unify VerificationStatus/VerifyStatus enum

- [ ] 2.1 In `src/types/graviscan.ts`, replace `VerificationStatus` with a
      type matching `src/main/graviscan/verify-plates.ts`'s live
      `VerifyStatus` union exactly: `verified | incorrect | unreadable |
      needs_review | duplicate_qr | swapped | lookup_failed | pending |
      skipped`. Grep for every current usage of `VerificationStatus` and
      confirm each compiles against the corrected union (no `swapped`-only
      renderer branch left unreachable, no live-emitted value like
      `lookup_failed` left unhandled).
- [ ] Run `npx tsc --noEmit` — confirm no new type errors before Section 3.

## 3. Preload wiring: verifyPlates + events

- [ ] 3.1 Add `verifyPlates(plates, experimentId, waveNumber?)` to
      `graviAPI` in `src/main/preload.ts`, plus `onVerifyStarted`,
      `onVerifyResult`, `onVerifyComplete` listener wrappers (matching the
      existing `onScanStarted`/`onScanComplete` pattern for cleanup/removal
      semantics). Add corresponding typed signatures to
      `src/types/electron.d.ts`.
- [ ] 3.2 Add a round-trip test to `tests/e2e/renderer-database-ipc.e2e.ts`
      (or the appropriate existing graviscan e2e file) exercising
      `window.electron.gravi.verifyPlates(...)` through the real preload
      bridge for at least: a `verified` plate, a `waveNumber`-scoped lookup
      that succeeds, and a `waveNumber` with no linked metadata producing
      `lookup_failed` — per this repo's static IPC-coverage gate
      (`scripts/check-ipc-coverage.py`), which counts registered handlers
      regardless of test presence; land this task in the same commit/PR
      push as 3.1, not split across pushes, to avoid a temporary coverage
      dip (same caution `add-wave-scoped-metadata-linking` documented for
      its own IPC registration).
- [ ] 3.3 Run `npm run test:e2e -- tests/e2e/renderer-database-ipc.e2e.ts`
      (or wherever 3.2 landed) against a real Electron+SQLite instance and
      confirm it passes.
- [ ] 3.4 Run `npm run test:e2e:coverage` and confirm the 90% IPC coverage
      gate still passes with the new handler/events counted as tested.

## 4. Renderer utility: cadenceEstimator (TDD)

- [ ] 4.1 Write failing unit tests in
      `tests/unit/renderer/cadenceEstimator.test.ts` for
      `estimateCycleSeconds({ platesPerScanner, dpi, regionMm })` per the
      accepted spec (`ui-management-pages/spec.md:1836`): base-case
      calculation, DPI scaling, region-height scaling.
- [ ] 4.2 Implement `src/renderer/utils/cadenceEstimator.ts` to satisfy 4.1.

## 5. Hook: useScannerStatus (TDD)

- [ ] 5.1 Write failing tests for `useScannerStatus`: polls
      `getScannerStatus()`, maps each row into `ScannerPanelState` including
      `gridMode` (sourced from the existing `getScannerStatus()` response —
      no backend change needed, per design.md Decision 5).
- [ ] 5.2 Implement `src/renderer/hooks/useScannerStatus.ts` to satisfy 5.1.

## 6. Hook: useWaveNumber (TDD)

- [ ] 6.1 Write failing tests for `useWaveNumber`: reads/sets the selected
      wave number, surfaces a "suggested next wave" via
      `getMaxWaveNumber()` + 1, rejects negative input.
- [ ] 6.2 Implement `src/renderer/hooks/useWaveNumber.ts` to satisfy 6.1.

## 7. Hook: usePlateAssignments — auto-fill with override (TDD)

- [ ] 7.1 Write failing tests for `usePlateAssignments` covering: no
      linked wave metadata → empty, editable positions; linked metadata →
      auto-fill populates `plantBarcode`/`transplantDate`/`customNote`/
      `selected` in metadata-row order; a manual edit to any of those
      fields sets that position's dirty flag; the auto-fill effect
      re-running (simulate a scanner-assignment change) preserves a dirty
      position's values while refreshing non-dirty positions; switching
      wave/experiment clears all dirty flags and refreshes auto-fill (or
      empties, if the new wave has no link) — per design.md Decision 3.
- [ ] 7.2 Implement `src/renderer/hooks/usePlateAssignments.ts` to satisfy
      7.1, persisting via `graviscanPlateAssignments.upsertMany(...)` as the
      reference implementation does.

## 8. Hook: useContinuousMode (TDD)

- [ ] 8.1 Write failing tests for `useContinuousMode`: interval/duration
      form state, rejects a zero-or-negative interval before it would ever
      reach `startScan()` (design.md known-bug-avoidance: divide-by-zero
      guard), assembles the `cadenceContext` (`platesPerScanner` from
      Section 5's real `gridMode` values via `createPlateAssignments`, not
      a hardcoded constant) passed to `CadenceWarningBanner`.
- [ ] 8.2 Implement `src/renderer/hooks/useContinuousMode.ts` to satisfy 8.1.

## 9. Hook: useScanSession — reducer-based state (TDD)

- [ ] 9.1 Write failing tests for the `useScanSession` reducer covering:
      `JOB_COMPLETE` action correctly derives progress from the
      post-update state (no ref-mirroring lag/compensation — design.md
      Decision 1); dual-casing event payloads (`scanner_id`/`scannerId`,
      `plate_index`/`plateIndex`) both resolve correctly, matching
      `wiring.ts`'s `resolveScannerId()`/`resolvePlateIndex()` fallback
      pattern; `handleCancelScan` is `async`, its rejection is caught and
      surfaces an error state rather than throwing unhandled (design.md
      known-bug-avoidance); `getOutputDir()` failure surfaces a blocking
      error with no `/tmp` fallback; on-mount restore via `getScanStatus()`
      rehydrates `pendingJobs`/`waveNumber`/elapsed-time/countdown when
      `isActive: true`, and rehydrates nothing when `isActive: false`
      (matching a fresh app launch — design.md Decision 4/Non-Goals);
      verification invocation passes the current `waveNumber` alongside
      `experimentId`.
- [ ] 9.2 Implement `src/renderer/hooks/useScanSession.ts` to satisfy 9.1.

## 10. Hook: useTestScan (TDD)

- [ ] 10.1 Write failing tests for `useTestScan`: captures one-shot per
      assigned scanner without touching session state; `getOutputDir()`
      failure surfaces a blocking error, no `/tmp` fallback.
- [ ] 10.2 Implement `src/renderer/hooks/useTestScan.ts` to satisfy 10.1.

## 11. Components (TDD, React Testing Library)

- [ ] 11.1 `CadenceWarningBanner.tsx` — failing tests: hidden when estimate
      fits interval, shown with correct copy when it doesn't, reactive to
      DPI/gridMode/scannerCount changes. Implement to satisfy.
- [ ] 11.2 `QRVerificationBanner.tsx` — failing tests: red/amber/green
      grading per the `ui-management-pages` spec delta's scenarios
      (including the `incorrect`-vs-`unreadable` and
      `lookup_failed`-vs-`unreadable` distinct-label scenarios). Implement
      to satisfy.
- [ ] 11.3 `ScanFormSection.tsx` — failing tests: plate fields render as
      editable inputs in both auto-fill and manual modes (design.md
      Decision 3 — no read-only `<span>` for `plantBarcode` when
      auto-filled); `selected` checkbox toggles correctly. Implement to
      satisfy.
- [ ] 11.4 `ScanControlSection.tsx` — failing tests: Start/Cancel/
      continuous-mode controls call the corresponding `useScanSession`/
      `useContinuousMode` handlers; Cancel button disabled state reflects
      an in-flight cancel request. Implement to satisfy.
- [ ] 11.5 `ScannerStatusPanel.tsx` — failing tests: renders per-scanner
      live status from `useScannerStatus`/`useScanSession` state.
      Implement to satisfy.

## 12. Screen: GraviScan.tsx + routing/nav wiring

- [ ] 12.1 Implement `src/renderer/GraviScan.tsx`, composing all hooks and
      components from Sections 5–11.
- [ ] 12.2 Add the `capture-scan` route to `App.tsx`'s `mode ===
      'graviscan'` block.
- [ ] 12.3 Add a "Capture Scan" entry to `graviscanLinks` in `Layout.tsx`.
- [ ] 12.4 Write/update component tests confirming `WorkflowSteps.tsx`'s
      existing graviscan step 5 navigates to a rendering `GraviScan.tsx`
      (not a redirect to Home), and that the sidebar link is present in
      graviscan mode per the `ui-management-pages` spec delta's routing
      scenarios.

## 13. Verification

- [ ] 13.1 Run `npm run lint && npm run format:check`.
- [ ] 13.2 Run `npm run test:unit` (full suite) — confirm no new failures
      beyond any pre-existing, unrelated ones (document which, matching
      this repo's existing convention of naming pre-existing failures
      rather than silently ignoring them).
- [ ] 13.3 Run `npx tsc --noEmit`.
- [ ] 13.4 Run `npm run test:e2e:coverage` — confirm the 90% IPC coverage
      gate passes.
- [ ] 13.5 Start the dev app (per this repo's `dev`/`run` skill) and
      manually exercise the Capture Scan happy path in GraviScan mode:
      select experiment/wave → assign plates (auto-fill + one manual
      override) → start a short continuous scan → observe live progress →
      let it complete → observe the graded QR verification banner →
      navigate away and back to confirm restore-on-navigation. This is a
      live-Electron check, not a substitute for the automated suites above
      — required per this project's own prior incident where IPC/
      custom-protocol bugs were invisible to unit tests.
- [ ] 13.6 Run `openspec validate add-graviscan-capture-scan-screen
      --strict` and resolve any issues.
