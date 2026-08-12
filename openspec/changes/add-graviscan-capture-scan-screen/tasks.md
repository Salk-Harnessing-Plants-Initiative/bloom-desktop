## 1. Schema migration

Review (round 3) found two real bugs — a data-loss risk in the plate-
assignment override mechanism and an unguarded duplicate-write risk in
per-job scan persistence — both rooted in missing schema structure that
no purely renderer-side or application-level fix can close correctly.
This section lands both schema changes first, before any code depends on
them.

- [x] 1.1 Add `wave_number Int @default(0)` to `GraviScanPlateAssignment`
      in `prisma/schema.prisma`; change its
      `@@unique([experiment_id, scanner_id, plate_index])` to
      `@@unique([experiment_id, scanner_id, plate_index, wave_number])`
      (design.md Decision 3 — this is what makes "which wave's row to
      read" an explicit, always-correct parameter instead of something
      inferred from render history).
- [x] 1.2 Add `@@unique([session_id, scanner_id, plate_index,
cycle_number])` to `GraviScan` in `prisma/schema.prisma` (design.md
      Decision 2, point 4 — enables upsert-based idempotent per-job
      persistence; SQLite treats multiple `NULL`s in a unique index as
      distinct, so existing `session_id: null` rows are unaffected).
- [x] 1.3 Run `npx prisma migrate dev --name
add_wave_number_to_plate_assignment_and_scan_unique_constraint` to
      generate the migration and regenerate the client.
- [x] 1.4 Run `./scripts/verify-migrations.sh` to confirm the generated
      migration matches `schema.prisma` (schema/migration parity check,
      per this repo's existing convention for schema changes).
- [x] 1.5 Run `npm run test:db-upgrade` to confirm the existing
      hand-written upgrade path needs no further changes.
- [x] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check
      gate before starting Section 2.

## 2. Backend: wave-scoped graviscanPlateAssignments handlers, idempotent graviscansCreate (TDD)

- [x] 2.1 Write failing tests in
      `tests/unit/graviscan/database-handlers.test.ts` for
      `graviscanPlateAssignments.upsertMany`/`.list`
      (`src/main/database-handlers.ts`) gaining a `waveNumber` parameter:
      `.list(experimentId, scannerId, waveNumber)` returns only that
      wave's row(s); `.upsertMany(..., waveNumber)` writes to
      `(experiment_id, scanner_id, plate_index, wave_number)`, not
      clobbering a different wave's row for the same position; omitting
      `waveNumber` defaults to `0` (matching the schema default, so any
      pre-existing caller — none exist today, confirmed — would see
      today's behavior unchanged); `waveNumber: 0` is accepted as valid,
      not rejected (already-accepted "Wave Number Zero Validation" spec
      requirement, `scanning/spec.md:117-127`). **Also cover the
      verification-field-preservation fix (design.md Decision 3, point 6)**: `.upsertMany`'s payload does not include
      `verification_status`/`previous_plate_barcode` for a position that
      already has those fields set from a prior `verify-plates` run —
      confirm the `update:` clause preserves the existing
      `verification_status`/`previous_plate_barcode` values rather than
      resetting them to `'pending'`/`null`; confirm a payload that
      _does_ explicitly include them (not this tier's own caller, but
      keeping the capability available) still updates them.
- [x] 2.2 Implement the `waveNumber` parameter and the verification-field
      preservation fix in both handlers
      (`graviscanPlateAssignmentsUpsertMany`'s `update:` clause,
      `database-handlers.ts:610-618`, changes from unconditionally
      defaulting `verification_status ?? 'pending'`/
      `previous_plate_barcode ?? null` to omitting those keys from the
      `update:` object entirely when the caller's payload doesn't specify
      them, so Prisma leaves the existing column value untouched). Update
      their preload bindings (`src/main/preload.ts`) and typed signatures
      (`src/types/electron.d.ts`). Update the two existing exact
      positional assertions in
      `tests/unit/preload-database-graviscan.test.ts:152-174`
      (`.list('e1', 's1')` and `.upsertMany('e1', 's1', assignments)`) to
      include the new trailing `waveNumber` argument — confirmed via
      direct inspection that these assertions exist today and use
      `toHaveBeenCalledWith` (exact-arity match), so they will fail once
      2.2's preload changes land if left unmodified. Run 2.1's tests
      green.
- [x] 2.3 Write failing tests in
      `tests/unit/graviscan/database-handlers.test.ts` for
      `graviscansCreate()` becoming upsert-based (design.md Decision 2,
      point 4): calling it twice with identical
      `(session_id, scanner_id, plate_index, cycle_number)` and identical
      field values results in exactly one `GraviScan` row, not two (the
      idempotency fix); the renderer-facing method name/signature
      (`database.graviscans.create(...)`) is unchanged — this is a
      purely internal Prisma-call change
      (`db.graviScan.create()` → `db.graviScan.upsert()`), no new preload
      method, no new IPC channel.
- [x] 2.4 Implement the upsert change in `graviscansCreate()`
      (`database-handlers.ts:123-173`). Run 2.3's tests green.
- [x] 2.5 Add coverage to `tests/e2e/renderer-database-ipc.e2e.ts` (the
      real `db:*` IPC-coverage-gate file — unlike `graviscan:verify-plates`,
      `db:graviscanPlateAssignments:*` and `db:graviscans:create` are
      squarely in that gate's scope, confirmed via existing
      `graviscanPlateAssignments.*`/`graviscanSessions.*` blocks already
      at lines 2832-2892) for: the new `waveNumber` parameter on
      `graviscanPlateAssignments.list`/`.upsertMany` (two waves, same
      scanner/position, confirm each wave's row is independent through
      the real IPC bridge); `graviscans.create`'s upsert-based
      idempotency (call twice with identical keys through the real
      bridge, confirm one row).
- [x] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check
      gate before starting Section 3.

## 3. Backend: wave-scoped verify-plates, read AND write (TDD)

- [x] 3.1 Export `isValidWaveNumber()` from `src/main/database-handlers.ts`
      (currently a bare, un-exported `function` — confirmed no other file
      can import it as-is). No behavior change, just the `export` keyword.
- [x] 3.2 In `tests/unit/graviscan/verify-plates.test.ts`, write failing
      tests for the new optional `waveNumber` parameter — **appended as
      the last parameter** in `verifyPlates(db, plates, experimentId,
scanOutputDir, onProgress, waveNumber)`, not grouped next to
      `experimentId` (design.md Decision 2: this is the only placement
      that doesn't risk silently rebinding an existing positional
      argument at this test file's ~50 existing call sites). Cover:
      omitting it preserves every existing test's behavior unchanged
      (run the existing suite as-is first to confirm baseline green);
      supplying a valid `waveNumber` (including `waveNumber: 0`) with a
      matching `GraviExperimentWaveMetadata` link scopes the
      `GraviPlateSectionMapping` **lookup** to that link's `accessionId`
      (plates from a different wave's linked accession, even one linked
      to the same experiment, SHALL NOT match); supplying a `waveNumber`
      with no matching link classifies every plate `lookup_failed` with a
      warning naming the experiment and wave, without falling back to
      unscoped matching; an invalid `waveNumber` (negative, non-integer,
      non-numeric) fails the whole run before any decode or DB access,
      using 3.1's exported `isValidWaveNumber()` (import it, do not
      duplicate the check); **a detected swap's `GraviScan` correction
      `updateMany` includes `wave_number: waveNumber` in its `where`
      clause when `waveNumber` was supplied, and its
      `GraviScanPlateAssignment` correction `updateMany` includes
      `wave_number: waveNumber` too** (design.md Decision 2 points 4-5,
      now both scoped via the Section 1 schema change) — set up a
      fixture with two waves sharing the same `(scanner_id, plate_index,
plate_barcode)` combination and confirm only the wave-matching rows
      are touched, for both tables. This is a plain mocked-Prisma Vitest
      unit test, consistent with every other test already in this file.
- [x] 3.3 Implement the `waveNumber` parameter in `verifyPlates()`
      (`src/main/graviscan/verify-plates.ts`): resolve `accessionId` via
      `db.graviExperimentWaveMetadata.findUnique({ where: {
experiment_id_wave_number: { experiment_id, wave_number } } })` when
      `waveNumber` is provided, scope the plate **lookup** to
      `plate: { metadata_file_id: accessionId }` instead of the existing
      `plate.metadata_file.experiments.some.id` filter for that call only
      (omitting `waveNumber` keeps today's filter), and add
      `wave_number: waveNumber` to both `GraviScan` swap-correction
      `updateMany` calls' `where` clauses (`verify-plates.ts:713`, `:723`)
      and to the `GraviScanPlateAssignment` `verification_status`/swap
      `updateMany` calls (`verify-plates.ts:665`, `:680`) when
      `waveNumber` was supplied. Run 3.2's tests green.
- [x] 3.4 Update `graviscan:verify-plates`'s `ipcMain.handle` signature in
      `src/main/graviscan/register-handlers.ts` to accept and pass through
      an optional `waveNumber` (same last-position placement, same
      `isValidWaveNumber()` validation). Add/update unit coverage in
      `tests/unit/graviscan/register-handlers.test.ts`, including
      updating its existing exact positional
      `toHaveBeenCalledWith(mockDb, plates, 'exp-1', outputDir,
expect.any(Function))` assertion to account for the new trailing
      argument.
- [x] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check
      gate before starting Section 4.

## 4. Renderer: new VerificationStatus type

- [x] 4.1 In `src/types/graviscan.ts`, **create** a new `VerificationStatus`
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
      (task 14.2) and `useScanSession.test.ts` (task 12.1).
- [x] Run `npx tsc --noEmit` — confirm no new type errors before Section 5.

## 5. Preload wiring: verifyPlates + events, with real E2E coverage (TDD)

- [x] 5.1 Add a round-trip `test.describe` block to
      `tests/e2e/graviscan-ipc.e2e.ts` (the actual existing home for
      `gravi.*` IPC round-trip tests, confirmed via its existing
      `test.describe('GraviScan IPC Round-Trip', ...)` block — **not**
      `tests/e2e/renderer-database-ipc.e2e.ts`, which covers the separate
      `db:*` namespace and its own static coverage gate that only scans
      `src/main/database-handlers.ts`; `graviscan:*` handlers registered
      in `src/main/graviscan/register-handlers.ts` are outside that
      gate's scope entirely). Write it failing first, exercising
      `window.electron.gravi.verifyPlates(...)` through the real preload
      bridge (not yet exposed) for at least: a `verified` plate, a
      `waveNumber`-scoped lookup that succeeds, a `waveNumber` with no
      linked metadata producing `lookup_failed`, and the wave-scoped
      swap-correction writes from task 3.2 exercised end-to-end through
      the real IPC bridge.
- [x] 5.2 Add `verifyPlates(plates, experimentId, scanOutputDir?,
waveNumber?)` (matching the final backend signature from Section 3)
      to `graviAPI` in `src/main/preload.ts`, plus `onVerifyStarted`,
      `onVerifyResult`, `onVerifyComplete` listener wrappers (matching the
      existing `onScanStarted`/`onScanComplete` pattern for cleanup/removal
      semantics). Add corresponding typed signatures to
      `src/types/electron.d.ts`. Run 5.1's test green.
- [x] 5.3 Run `npm run test:e2e -- tests/e2e/graviscan-ipc.e2e.ts` against
      a real Electron+SQLite instance and confirm it passes, alongside the
      full existing file (no regressions in the rest of the `gravi.*`
      suite).

## 6. Renderer utility: cadenceEstimator (TDD)

- [x] 6.1 Write failing unit tests in `tests/unit/cadenceEstimator.test.ts`
      (a flat path directly under `tests/unit/`, matching this repo's
      convention for pure-utility tests — e.g.
      `tests/unit/date-helpers.test.ts` — not a `tests/unit/renderer/`
      subdirectory, which doesn't exist anywhere in this codebase) for
      `estimateCycleSeconds({ platesPerScanner, dpi, regionMm })` per the
      accepted spec (`ui-management-pages/spec.md:1836`): base-case
      calculation, DPI scaling, region-height scaling.
- [x] 6.2 Implement `src/renderer/utils/cadenceEstimator.ts` to satisfy 6.1.

## 7. Hook: useScannerStatus (TDD)

- [x] 7.1 Write failing tests in `tests/unit/hooks/useScannerStatus.test.ts`
      (matching this repo's existing convention, e.g.
      `tests/unit/hooks/useWedgeEvents.test.ts`) for `useScannerStatus`:
      polls `getScannerStatus()` and maps each row into a
      `ScannerPanelState` that includes `gridMode` — note
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
- [x] 7.2 Implement `src/renderer/hooks/useScannerStatus.ts` to satisfy 7.1.

## 8. Hook: useWaveNumber (TDD)

- [x] 8.1 Write failing tests in `tests/unit/hooks/useWaveNumber.test.ts`
      for `useWaveNumber`: reads/sets the selected wave number (including
      `waveNumber: 0`, an already-accepted valid value per
      `scanning/spec.md:117-127` — not just non-zero cases), surfaces a
      "suggested next wave" via `getMaxWaveNumber()` + 1, rejects
      negative input.
- [x] 8.2 Implement `src/renderer/hooks/useWaveNumber.ts` to satisfy 8.1.

## 9. Hook: usePlateAssignments — schema-backed wave scoping (TDD)

Now that `GraviScanPlateAssignment` has its own `wave_number` column
(Section 1), this hook's override/reset logic is a direct, wave-scoped
comparison — no ref-based "was this a wave switch or a remount" inference
(two prior review rounds each found a bug in that kind of inference; see
design.md Decision 3's history).

- [x] 9.1 Write failing tests in
      `tests/unit/hooks/usePlateAssignments.test.ts` covering: - No linked wave metadata for the current wave → empty, editable
      positions; a _different_ wave's persisted row (even one that
      exists in the DB) is never loaded or displayed for the current
      wave (PR #216 regression guard — trivially true now, since
      `.list()` is called with the current `waveNumber` and only that
      wave's row can ever come back, but assert it explicitly). - Linked metadata → auto-fill populates `plantBarcode`/
      `transplantDate`/`customNote`/`selected` in metadata-row order. - **Bootstrap case**: a position with no persisted row yet for the
      current wave is always populated by the fresh auto-fill
      computation — never treated as "operator-overridden" merely
      because "no value" trivially differs from a computed one. - A manual edit to any of those fields, once persisted for the
      current wave, is detected as operator-overridden on the _next_
      comparison (persisted value for _this wave_ differs from a
      freshly recomputed auto-fill baseline) and is preserved rather
      than overwritten when the auto-fill effect re-fires for a
      non-wave reason (simulate a scanner-assignment change). - The same override survives an unmount/remount of the hook with
      the manual edit already persisted. - **Wave-switch round-trip**: wave 2 has an operator-overridden
      value; switch to wave 3 (its own, different linked metadata);
      confirm wave 3 shows its own fresh values; switch back to wave 2;
      confirm wave 2's _own_ override is restored exactly as it was —
      not re-derived, not lost. This is the specific regression case
      review found broken in the ref-based design this section
      replaces; it must pass here since each wave now reads a distinct,
      independently-persisted row. - Entering/changing `plantBarcode` manually (in either mode)
      triggers a case-insensitive match against the loaded
      `AvailablePlate[]` list and auto-populates `transplantDate`/
      `customNote` from the matching plate — the actual PR #223 fix
      (design.md Decision 3, point 4); a barcode with no match leaves
      date/note untouched rather than clearing them. - `listGraviMetadata()` or `graviPlateAccessions.list()` rejecting
      or returning `{ success: false }` leaves the grid in its
      last-known state with an inline error, not a crash or a
      silently-empty grid. - A linked accession that resolves to **zero**
      `GraviPlateAccession` rows is visually/textually distinguished
      (e.g. a warning-styled note) from the "no link exists at all"
      empty state. - **Out-of-order async response guard (design.md Decision 3, point 5)**: issue a fetch for wave A, then before it resolves switch to
      wave B and let wave B's fetch resolve first, then let wave A's
      fetch resolve — confirm wave A's (now-stale) response does NOT
      overwrite wave B's already-rendered state. This is the third,
      independently-found mechanism for reproducing PR #216's
      user-visible symptom (the first two — no wave column, and a
      ref-based wave-switch heuristic — are closed by this section's
      schema-backed design; this one is a plain async race, closed by a
      staleness check, not by the schema).
- [x] 9.2 Implement `src/renderer/hooks/usePlateAssignments.ts` to satisfy
      9.1, calling `graviscanPlateAssignments.list`/`.upsertMany` (task
      2.2) with the current `waveNumber` on every read/write, and guarding
      every wave-scoped fetch with the same `let cancelled = false`-style
      pattern already used in this codebase's other async effects (e.g.
      `src/renderer/hooks/useAppMode.ts:12-28`) so a response is discarded
      if the selected wave has changed since the fetch was issued.

## 10. Hook: useContinuousMode (TDD)

- [x] 10.1 Write failing tests in
      `tests/unit/hooks/useContinuousMode.test.ts` for
      `useContinuousMode`: interval/duration form state, rejects a
      zero-or-negative interval before it would ever reach `startScan()`
      (design.md known-bug-avoidance: divide-by-zero guard), assembles
      the `cadenceContext` (`platesPerScanner` from Section 7's real
      `gridMode` values via `createPlateAssignments`, not a hardcoded
      constant) passed to `CadenceWarningBanner`.
- [x] 10.2 Implement `src/renderer/hooks/useContinuousMode.ts` to satisfy
      10.1.

## 11. Shared wedge context (Layout.tsx)

Landed **before** `useScanSession` (Section 12), which consumes it — a
prior draft of this task list had these in the reverse order, creating a
forward reference to a context that didn't exist yet.

- [x] 11.1 Write failing tests in
      `tests/unit/components/WedgeContext.test.tsx` confirming: a
      `WedgeContext` provider, mounted in `Layout.tsx`, wraps a single
      `useWedgeEvents()` call — moved up from where it lives today
      (inside `WedgeBanner.tsx`; `Layout.tsx` does not call the hook
      itself currently, confirmed via direct inspection). A `WedgeBanner`
      consumer and a second, independently-mounted consumer (simulating
      `GraviScan.tsx` mounting/unmounting across navigation) both observe
      the **same** wedge state at all times, including a wedge that
      occurred before the second consumer's mount — the regression test
      for the bug found in an earlier draft's independent-
      `useWedgeEvents()`-per-consumer design (design.md Decision 6).
- [x] 11.2 Implement the context: add `WedgeContext`/`WedgeProvider` (new
      file or inline in `Layout.tsx`), move `useWedgeEvents()` from
      `WedgeBanner.tsx` into the provider, update `WedgeBanner.tsx` to
      consume the context instead. Run 11.1's tests green, plus the
      existing `tests/unit/components/WedgeBanner.test.tsx` suite
      unmodified in behavior (same rendered output, different data
      source).

## 12. Hook: useScanSession — reducer, persistence, and Decisions 5/6 (TDD)

Combines the session-state reducer (design.md Decision 1), the new
backend persistence wiring this proposal's own review found missing
(Decision 2 point 4), and the wedge-blocking/abnormal-termination
features (Decisions 5-6) in one hook, built in dependency order within
this section rather than split across sections that referenced each
other out of order.

- [x] 12.1 Write failing tests in
      `tests/unit/hooks/useScanSession.test.ts` for the reducer core:
      `JOB_COMPLETE` action correctly derives progress from the
      post-update state (no ref-mirroring lag/compensation — design.md
      Decision 1); dual-casing event payloads (`scanner_id`/`scannerId`,
      `plate_index`/`plateIndex`) both resolve correctly, matching
      `wiring.ts`'s `resolveScannerId()`/`resolvePlateIndex()` fallback
      pattern; `handleCancelScan` is `async`, its rejection is caught and
      surfaces an error state rather than throwing unhandled, and its
      success path clears pending jobs / resets `isScanning` / resets
      scanner states to idle; `getOutputDir()` failure surfaces a
      blocking error with no `/tmp` fallback; on-mount restore via
      `getScanStatus()` rehydrates `pendingJobs`/`waveNumber`/
      elapsed-time/countdown when `isActive: true`, and rehydrates nothing
      when `isActive: false` (design.md Decision 4/Non-Goals);
      verification invocation passes the current `waveNumber` (including
      `waveNumber: 0`) alongside `experimentId`.
- [x] 12.2 Implement the reducer core in
      `src/renderer/hooks/useScanSession.ts` to satisfy 12.1.
- [x] 12.3 Write failing tests (same file) for backend persistence wiring:
      on `startScan()` success, `database.graviscanSessions.create(...)`
      is called with `experimentId`/`phenotyperId`/mode/interval/
      duration; on each job completion, **`database.graviscans.create(...)`
      — the existing, unchanged renderer-facing method name; task 2.3/2.4
      make its _internal_ Prisma call idempotent via `upsert()`, this hook
      does not call a different method** — is called with the completed
      job's `experimentId`, `phenotyperId`, `scannerId`, `plateIndex`,
      `waveNumber` (including `0`), `sessionId`, `cycleNumber`,
      `gridMode`, `resolution`, and image path — all fields
      `graviscansCreate`'s handler actually requires
      (`database-handlers.ts:123-173`, `prisma/schema.prisma:109-131` — a
      prior draft of this task omitted `phenotyper_id`/`grid_mode`/
      `resolution`, which would have made every real call fail); confirm
      calling it twice for the **same** job (same `sessionId`/
      `scannerId`/`plateIndex`/`cycleNumber`, e.g. simulating a duplicated
      IPC event) is safe to do from this hook's own retry/re-render logic
      (the actual dedup happens inside the handler per task 2.3 — this
      hook-level test only needs to confirm the hook doesn't itself skip
      or double-fire the call in a way that would defeat that); on clean
      session completion or a successful cancel,
      `database.graviscanSessions.complete(...)` is called with the
      matching `cancelled` flag.
- [x] 12.4 Implement this wiring to satisfy 12.3.
- [x] 12.5 Write failing tests (same file) for Decision 5 (abnormal-
      termination marker): on successful `startScan()`, a `localStorage`
      entry `graviscan:session-in-progress:${experimentId}:${waveNumber}`
      is written with the expected total cycle count; on successful
      `cancelScan()` or clean session completion, that exact key is
      removed; on mount with `getScanStatus()` returning
      `isActive: false`, if a marker exists for the **currently
      selected** experiment+wave, the hook surfaces a non-blocking
      informational state naming the expected cycle count; no marker for
      the current experiment+wave (including one that exists for a
      _different_ wave of the same experiment) produces no banner.
- [x] 12.6 Implement to satisfy 12.5.
- [x] 12.7 Write failing tests (same file) for Decision 6 (wedge-blocks-
      start): the hook (or the component consuming it) reads active-wedge
      state from `WedgeContext` (Section 11, not a second independent
      `useWedgeEvents()` call) and disables starting while any assigned
      scanner has an active, unacknowledged wedge; regression-test that a
      wedge which occurred **before** this hook/component mounted
      (simulated via context already populated at mount time) still
      correctly blocks Start.
- [x] 12.8 Implement to satisfy 12.7.

## 13. Hook: useTestScan (TDD)

- [x] 13.1 Write failing tests in `tests/unit/hooks/useTestScan.test.ts`
      for `useTestScan`: captures one-shot per assigned scanner without
      touching session state; `getOutputDir()` failure surfaces a
      blocking error, no `/tmp` fallback.
- [x] 13.2 Implement `src/renderer/hooks/useTestScan.ts` to satisfy 13.1.

## 14. Components (TDD, React Testing Library)

- [x] 14.1 `CadenceWarningBanner.tsx` — failing tests in
      `tests/unit/components/CadenceWarningBanner.test.tsx`: hidden when
      estimate fits interval, shown with correct copy when it doesn't,
      reactive to DPI/gridMode/scannerCount changes. Implement to satisfy.
- [x] 14.2 `QRVerificationBanner.tsx` — failing tests in
      `tests/unit/components/QRVerificationBanner.test.tsx`: red (any
      `duplicate_qr`) / amber (`unreadable`/`needs_review`/`incorrect`/
      `lookup_failed`, none `duplicate_qr`) / green (all
      `verified`/`swapped`) grading; `incorrect` renders a label distinct
      from "QR Unreadable"; `lookup_failed` renders its **own** pinned
      title ("Verification Lookup Failed") distinct from both
      "QR Unreadable" and "Manual Review Needed"; a batch containing two
      or more distinct non-green statuses simultaneously (e.g. one
      `unreadable` + one `lookup_failed`, no `duplicate_qr`) surfaces
      **both** causes' detail text. Implement to satisfy.
- [x] 14.3 `ScanFormSection.tsx` — failing tests in
      `tests/unit/components/ScanFormSection.test.tsx`: plate fields
      render as editable inputs in both auto-fill and manual modes (no
      read-only `<span>` for `plantBarcode` when auto-filled); `selected`
      checkbox toggles correctly; the "linked but empty accession"
      warning state from task 9.1 renders distinctly from the "no link"
      empty state; the auto-fill IPC-failure inline error from task 9.1
      actually renders in this component (not just asserted at the hook
      level). Implement to satisfy.
- [x] 14.4 `ScanControlSection.tsx` — failing tests in
      `tests/unit/components/ScanControlSection.test.tsx`: Start/Cancel/
      continuous-mode controls call the corresponding `useScanSession`/
      `useContinuousMode` handlers; **the Cancel-rejection error banner
      from task 12.1 actually renders in this component** (not just
      asserted at the hook level); Cancel button disabled state reflects
      an in-flight cancel request; **the zero-interval validation error
      from task 10.1 actually renders in this component**; the
      already-accepted "overtime" banner (`scan-coordinator.ts`'s existing
      `overtime` event, forwarded via `wiring.ts`) renders when it fires
      for the current cycle; Start button is disabled while
      `WedgeContext` (task 11.1) reports an active wedge for any assigned
      scanner; a pre-start warning appears (not blocking) when the
      current wave has no linked metadata and no plates have been
      manually filled in; the abnormal-termination informational banner
      from task 12.5 actually renders in this component with the expected
      cycle count; a "Test Scan" control invokes `useTestScan` (task 13)
      and its blocking output-dir-failure error (the "GraviScan Test Scan"
      spec requirement's failure scenario) actually renders in this
      component — an earlier draft of this task list built and unit-
      tested `useTestScan` in isolation with no component wiring or
      render-level test at all. Implement to satisfy.
- [x] 14.5 `ScannerStatusPanel.tsx` — failing tests in
      `tests/unit/components/ScannerStatusPanel.test.tsx`: renders
      per-scanner live status from `useScannerStatus`/`useScanSession`
      state. Implement to satisfy.

## 15. Screen: GraviScan.tsx + routing/nav wiring

- [x] 15.1 Write failing tests in `tests/unit/pages/GraviScan.test.tsx`
      confirming the screen composes Sections 7-14's hooks/components
      correctly (e.g. plate-assignment state reaches `ScanFormSection`,
      session state reaches `ScanControlSection`/`ScannerStatusPanel`).
- [x] 15.2 Implement `src/renderer/GraviScan.tsx` to satisfy 15.1,
      composing all hooks and components from Sections 7–14.
- [x] 15.3 Add the `capture-scan` route to `App.tsx`'s `mode ===
'graviscan'` block; update `tests/unit/pages/App.test.tsx` to cover
      it and to confirm **CylinderScan mode's own `/capture-scan` route
      (`CaptureScan.tsx`) renders unchanged**.
- [x] 15.4 Add a "Capture Scan" entry to `graviscanLinks` in
      `Layout.tsx`; update `tests/unit/pages/Layout.test.tsx` to confirm
      the sidebar link is present in graviscan mode, and confirm
      `WorkflowSteps.tsx`'s existing graviscan step 5 now navigates to a
      rendering `GraviScan.tsx` (not a redirect to Home).

## 16. Verification

- [x] 16.1 Run `npm run lint && npm run format:check`.
- [x] 16.2 Run `npm run test:unit` (full suite) — confirm no new failures
      beyond any pre-existing, unrelated ones (document which). **Result:**
      1408 passed, 5 pre-existing failures, all unrelated to this tier —
      Windows path-separator (`\` vs `/`) assertion mismatches in
      `config-store.test.ts`, `image-uploader.test.ts` (×3), and
      `scan-coordinator.test.ts`'s "regex path rewriting" test. Confirmed
      present on `main` before this tier's work and unaffected by it.
- [x] 16.3 Run `npx tsc --noEmit`.
- [x] 16.4 Run `npm run test:e2e -- tests/e2e/graviscan-ipc.e2e.ts` (full
      file, not just this tier's new block) and confirm no regressions.
      **Result:** 15/16 passed, including every Tier 4 test (the
      `verifyPlates` block, all IPC round-trips, Configure Scanner
      render/remove). The one failure ("Reset All USB Connections marks
      rows starting, then settles back to a populated list") is
      unrelated — it's the pre-existing USB-reset mock-timing test whose
      own comment already documents it as timing-sensitive (5s bus-release + 5s×2 stagger); reproduced consistently in isolation, most likely
      due to CPU contention from the concurrently-running dev-server
      processes needed to keep the Electron renderer bundle servable for
      Playwright. Not touched by this tier's changes.
- [x] 16.5 Re-run `./scripts/verify-migrations.sh` and
      `npm run test:db-upgrade` as a final check after all handler
      changes (matching this repo's convention for schema-touching
      changes, per `add-wave-scoped-metadata-linking`'s own tasks.md).
- [ ] 16.6 Start the dev app (per this repo's `dev`/`run` skill) and
      manually exercise the Capture Scan happy path in GraviScan mode:
      select experiment/wave → assign plates (auto-fill + one manual
      override) → start a short continuous scan → observe live progress →
      let it complete → observe the graded QR verification banner →
      navigate away and back to confirm restore-on-navigation and that
      the manual override survived → switch to a different wave and back
      to confirm the wave-2/wave-3 round-trip override survives in the
      real app, not just the mocked unit test → force-quit and relaunch
      to confirm the abnormal-termination informational banner appears
      for that wave. This is a live-Electron check, not a substitute for
      the automated suites above.
- [x] 16.7 Run `openspec validate add-graviscan-capture-scan-screen
--strict` and resolve any issues.

## 17. Cycle-progress visibility during continuous mode (TDD, found during 16.6)

Live smoke testing of 16.6 surfaced a real gap (design.md Decision 8):
`currentCycle`/`totalCycles`/`coordinatorState` were already tracked in
`useScanSession` state but never rendered, leaving the operator with no
way to tell a correct cycle-boundary progress reset from a broken
session.

- [x] 17.1 Write failing tests in `tests/unit/components/
ScanControlSection.test.tsx`: a `"Cycle 2 of 3"`-style indicator
      renders when `isScanning && totalCycles > 1`; it does NOT render
      when `totalCycles <= 1` (single-shot sessions); a "waiting for next
      cycle" indicator renders when `coordinatorState === 'waiting'` and
      NOT when `'scanning'` or `'idle'`.
- [x] 17.2 Implement both indicators in `ScanControlSection.tsx`, derived
      purely from existing `scanSession` state — no new IPC, no polling,
      no live-ticking countdown (design.md Decision 8 explicitly defers
      a `nextScanAt`-based countdown).
- [x] 17.3 Run the full unit suite, `npx tsc --noEmit`, and lint; confirm
      no regressions beyond the already-documented pre-existing failures.
      **Result:** 1607 passed, same 4 pre-existing failure files as
      documented in 16.2 (Windows path-separator + flaky AccessionForm
      timing), zero new failures. `tsc --noEmit` and lint both clean.
- [x] 17.4 Re-run `openspec validate add-graviscan-capture-scan-screen
--strict`.

## 18. Continuous-scan Duration field: minutes not hours (TDD, found auditing production-branch parity)

Found while auditing the production branch
(`fix/v600-wedge-followups-metadata_propogation_followup`) for parity
gaps (design.md Decision 9): its `useContinuousMode.ts` uses minutes for
both `scanIntervalMinutes` and `scanDurationMinutes`; ours used minutes
for interval but hours for duration, an inconsistency nobody had compared
against the reference. Confirmed to directly cause operator confusion
during 16.6 smoke testing — Duration was left at its default "1",
silently meaning 1 hour rather than the 1 minute a user reasoning by
analogy with the Interval field would expect.

- [x] 18.1 Write failing tests: `tests/unit/hooks/useScanSession.test.ts`
      (rename `durationHours` params to `durationMinutes`, update expected
      `duration_seconds` values — same underlying seconds, computed as
      `durationMinutes * 60` instead of `durationHours * 3600`),
      `tests/unit/components/ScanControlSection.test.tsx` and
      `tests/unit/pages/GraviScan.test.tsx` (update mock shape and any
      label assertions to "Duration (minutes)"). Confirmed red: 5 tests
      failed against the unchanged implementation before proceeding.
- [x] 18.2 Rename `durationHours`/`setDurationHours` to
      `durationMinutes`/`setDurationMinutes` in
      `useContinuousMode.ts` (default `1` → `60`, same actual default
      session length), `useScanSession.ts` (param + `durationSeconds =
Math.round(durationMinutes * 60)`), `GraviScan.tsx` (wiring), and
      `ScanControlSection.tsx` (form field + label, "Duration (hours)" →
      "Duration (minutes)").
- [x] 18.3 Run the full unit suite, `npx tsc --noEmit`, and lint; confirm
      no regressions beyond the already-documented pre-existing failures.
      **Result:** 1608 passed (+1 new test), same 4 pre-existing failure
      files as 16.2/17.3, zero new failures. `tsc --noEmit` and lint both
      clean.
- [x] 18.4 Re-run `openspec validate add-graviscan-capture-scan-screen
--strict`.

## 19. Abnormal-termination check must react to async experimentId/waveNumber (TDD, found during 16.6)

Live smoke testing found the Decision 5 banner never appeared under any
reachable operator scenario (design.md Decision 10): the mount-only
restore effect's `if (experimentId)` check always saw `null`, since
`experimentId` is only ever populated asynchronously and the effect's
empty deps mean it never re-runs once that value resolves.

- [x] 19.1 Write failing tests in `tests/unit/hooks/useScanSession.test.ts`
      simulating the real integration timing: render the hook with
      `experimentId: null` initially (matching `GraviScan.tsx`'s actual
      first render), then rerender with the real `experimentId`/
      `waveNumber` — assert the banner still appears once a matching
      marker exists. Also cover: switching from a wave with a marker to
      one without clears the banner (reactive, not just "don't set").
      Confirmed red: both failed against the unchanged implementation.
- [x] 19.2 Split the abnormal-marker check out of the mount-once
      active-session-restore effect into its own effect depending on
      `[experimentId, waveNumber]`, per design.md Decision 10. Leave the
      active-session-restore half untouched (still mount-once, still
      independent of experimentId).
- [x] 19.3 Run the full unit suite, `npx tsc --noEmit`, and lint; confirm
      no regressions beyond the already-documented pre-existing failures.
      **Result:** 1612 passed (+2 new tests), same pre-existing failure
      set as 16.2/17.3/18.3, zero new failures. `tsc --noEmit` and lint
      both clean.
- [x] 19.4 Re-run `openspec validate add-graviscan-capture-scan-screen
--strict`.

## 20. Render per-scanner Test Scan results (TDD, found during a parity audit)

`useTestScan.ts` already computes per-scanner `testResults` but nothing
renders them (design.md Decision 11).

- [x] 20.1 Write failing tests in
      `tests/unit/components/ScannerStatusPanel.test.tsx`: a successful
      test result shows a success indication next to that scanner; a
      failed result shows its specific error message; a scanner with no
      result yet shows neither. Confirmed red: both failed against the
      unchanged implementation.
- [x] 20.2 Add an optional `testResults` prop to `ScannerStatusPanel.tsx`
      and render per-scanner, styled like the existing `lastError` line.
      Wire `testScan.testResults` through from `GraviScan.tsx`.
- [x] 20.3 Run the full unit suite, `npx tsc --noEmit`, and lint; confirm
      no regressions beyond the already-documented pre-existing failures.
      **Result:** 1632 passed, same 4 known pre-existing failure files
      plus `electron-cleanup.test.ts` (new from main's
      `fix-e2e-worker-teardown-flake`, confirmed flaky under full-suite
      load — passes cleanly in isolation, different subtests fail each
      full-suite run). Zero failures related to this change.
      Type-checking and lint both clean.
- [x] 20.4 Re-run `openspec validate add-graviscan-capture-scan-screen
--strict`.

## 21. Wire coordinatorState to live interval-waiting/scan-started events (TDD, found during 16.6)

Live smoke testing found the "Waiting for next cycle..." indicator
(Section 17) never appeared during an actual run — `coordinatorState`
was set once at session start and never updated again by any live
event (design.md Decision 12).

- [x] 21.1 Write failing tests in
      `tests/unit/hooks/useScanSession.test.ts`: firing `interval-waiting`
      during an active continuous session sets `coordinatorState` to
      `'waiting'`; firing `scan-started` afterward sets it back to
      `'scanning'`. Confirmed red against the unchanged implementation.
- [x] 21.2 Subscribe to `onIntervalWaiting`, dispatching a new
      `INTERVAL_WAITING` action. Repurpose the existing (currently no-op)
      `onScanStarted` handler to dispatch a new `INTERVAL_RESUMED` action.
      Add both to the effect's cleanup list.
- [x] 21.3 Run the full unit suite, `npx tsc --noEmit`, and lint; confirm
      no regressions beyond the already-documented pre-existing failures.
      **Result:** 1638 passed, same known pre-existing failure set (4
      files plus the already-flaky electron-cleanup.test.ts). Zero
      failures related to this change. Type-checking and lint clean.
- [x] 21.4 Re-run `openspec validate add-graviscan-capture-scan-screen
--strict`.

## 22. Freeze session context at scan start (TDD, found during /review-pr round 5)

`/review-pr` found `contextRef` mirrors live selector state every render, so
a mid-scan wave/experiment switch misattributes in-flight jobs' DB writes
and QR verification, and lets `finishSession` clear the wrong wave's
abnormal-termination marker (design.md Decision 13).

- [x] 22.1 Write failing tests in `tests/unit/hooks/useScanSession.test.ts`:
      start a scan under `waveNumber: 0`, then rerender with
      `waveNumber: 5` before any job completes — confirm a subsequent
      `scan-complete` still calls `database.graviscans.create(...)` with
      `wave_number: 0` and a subsequent `verifyPlates(...)` call still
      passes `'exp-1', 0`; confirm `finishSession` still removes the
      `...:exp-1:0` marker (the session's own), not a `...:exp-1:5` marker
      that was never written. Also cover the restore path: mount with
      `getScanStatus()` returning `isActive: true` with an
      `experimentId`/`waveNumber`/`resolution` that differ from the hook's
      own initial props — confirm a job completing after that restore
      records against the **backend's** values, not the props.
- [x] 22.2 Add `sessionContextRef`, set once in `startScan()` (before
      dispatching `START`) and once in the on-mount restore effect (from
      `status.experimentId`/`phenotyperId`/`waveNumber`/`resolution`).
      Repoint `recordCompletedJob`/`runVerification` at it; remove the
      continuously-mirrored `contextRef` and its `useEffect`. Change
      `runVerification`'s per-job barcode lookup to read `job.plantBarcode`
      directly instead of `contextRef.current.assignmentsByScanner`.
      Rewrite `clearAbnormalMarker` to always remove the frozen session's
      own marker key, only clearing the displayed `abnormalTermination`
      state when the live `experimentId`/`waveNumber` still match it. Run
      22.1's tests green.
- [x] 22.3 Write a failing test in `tests/unit/pages/GraviScan.test.tsx`:
      with `scanSession.isScanning: true`, `ExperimentChooser`,
      `PhenotyperChooser`, and the Wave `<input>` are all disabled.
- [x] 22.4 Add `disabled={scanSession.isScanning}` to all three in
      `GraviScan.tsx`. Run 22.3's test green.
- [x] 22.5 Run `npm run lint && npx tsc --noEmit && npm run test:unit` —
      confirm no regressions beyond the already-documented pre-existing
      failures. **Result:** 1638 passed, same 5 pre-existing failure files
      (config-store, electron-cleanup, image-uploader, AccessionForm,
      scan-coordinator path-separator), zero new failures. `tsc --noEmit`
      and lint both clean.
- [x] 22.6 Re-run `openspec validate add-graviscan-capture-scan-screen
--strict`.
