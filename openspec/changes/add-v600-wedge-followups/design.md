## Context

The V600 USB-wedge investigation (May 6–18, 2026) characterized the
failure mechanism: V600 scanners stop returning USB data when a single
scan exceeds about 100 MB and require a physical AC power-cycle to
recover. Production at 1200 dpi with the smaller 140×140 mm region
works at 99.79–99.95% over multi-hour runs without code changes
(per `2026-05-18-summary.md` Section 3).

The investigation also surfaced five filed bugs on the
`feature/graviscan-prod` branch ([#228](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/228),
[#230](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/230),
[#231](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/231),
[#232](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/232),
[#234](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/234)) and two
operationally-needed additions filed at the start of this work
([#235](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/235) cadence-warning UX,
[#236](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/236) Slack-on-wedge).

Stakeholders: Elizabeth (rig operator, this branch maintainer),
Benfica/Talmo (review), downstream plant-phenotyping pipeline (depends
on accurate scan metadata).

## Goals / Non-Goals

**Goals:**

- Fix the five filed bugs so the rig is flexibly operable from the UI
  (no SQL workarounds).
- Add real-time operator notification when a V600 wedges so multi-hour
  runs don't sit silent.
- Add defense-in-depth: optional libusb endpoint-recovery shim, runtime
  DPI validation, trimmed DPI dropdown.
- Surface predictive UX when configured cadence cannot be honored.
- Land everything in ONE reviewable PR against `feature/graviscan-prod`
  with passing tests.

**Non-Goals:**

- Change the wedge fix story. The investigation already concluded that
  per-plate sequential scanning at 140×140 mm at 1200 dpi works without
  code patches; this proposal does NOT shift production configuration.
- Migrate the database schema. No `ON DELETE CASCADE` is added; the
  stale-row fix preserves FK integrity by disabling rather than deleting.
- Replace the existing `_reset_usb_device()` ioctl-based USB reset in
  the Python worker. That call's removal needs its own analysis.
- Solve every observability gap (rich error UI, full telemetry, etc.).
  The Slack hook is a narrowly-scoped operator-paging mechanism, not a
  general notification system.

## Decisions

### Decision 1: Wedge detected from events, not exit codes

**What:** The wedge detector subscribes to `scan-error` events emitted
by the existing scanner subprocess pipeline (forwarded by the
coordinator). It pattern-matches the `error.message` field against three
signatures and tracks consecutive-failure counts per scanner per cycle.

**Why:** `python/graviscan/scan_worker.py` catches SANE/scanimage
exceptions and emits them as `scan-error` events (not as non-zero exit
codes). Exit codes 0 and 1 already have distinct meanings (clean / init
failure). Adding new exit codes would require Python-side refactoring
that the investigation didn't validate; events are the existing pattern
and cover all three operational signatures.

**Alternatives considered:**

- *Add new exit codes (e.g., `4 = wedge`).* Cleaner long-term but
  forces the Python worker to classify error types — out of scope and
  unvalidated against real wedge events.
- *Detect only consecutive failures, skip stderr signature matching.*
  Simpler, but would not fire on cycle 1 (one of the recoverable cases
  mentioned in the investigation).

### Decision 2: Stale GraviScanner rows are disabled, not deleted

**What:** `save-scanners-db` and `validate-config` both set
`enabled = false` for rows whose `usb_port` is no longer in the current
detection set. The validate-config handler is changed from
`db.graviScanner.delete()` (the current behavior at line 917-922) to
`db.graviScanner.update({ enabled: false })`. The per-row Remove button
disables, not deletes.

**Why:** The Prisma schema has no `ON DELETE CASCADE` on
`GraviScan.scanner_id` or `GraviScanPlateAssignment.scanner_id`.
Deleting a `GraviScanner` row orphans historical `GraviScan` rows. The
SQL workaround in the wild already uses `enabled=0`, so disable is the
established conservative pattern.

**Alternatives considered:**

- *Add ON DELETE SET NULL and keep delete-on-stale.* Requires a Prisma
  migration and a one-time data backfill — too invasive for this PR
  and unnecessary given the disable-only fix achieves the same operator
  outcome.
- *Keep validate-config's delete behavior, only add disable-on-detect to
  save-scanners-db.* Inconsistent semantics: one code path destroys
  history, another preserves it. Operator behavior unpredictable.

### Decision 3: Slack webhook URL and libusb-recovery toggle are env vars

**What:** Two new env vars loaded by `config-store.ts`:

- `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL` — absent ⇒ Slack hook disabled.
- `LIBUSB_ENDPOINT_RECOVERY` — value `"false"` disables the wrapper
  (default `"true"` ⇒ enabled).

The webhook URL never appears in any committed file. `.env.example` is
added (or appended) with placeholder values and explanatory comments.
`README.md` documents both. `~/.bloom/.env` (on the rig and on every
deployment) holds the real values.

**Why:** Matches the existing `GRAVISCAN_MOCK` / `GRAVISCAN_SYSTEM_NAME`
pattern. The webhook URL is a secret — putting it in the SQLite DB
(GraviConfig) would put it in every DB backup. Env-var configuration is
the simplest deployable answer.

**Alternatives considered:**

- *UI toggle in Machine Configuration page.* More discoverable, but
  puts the secret in the DB and requires more UI surface. Not worth it
  for two rarely-changed values.
- *A new bloom-config.yaml file in `~/.bloom/`.* Adds a third config
  source; doesn't match existing patterns.

### Decision 4: Wedge detector + Slack notifier live in the main process

**What:** Two new TypeScript modules:

- `src/main/wedge-detector.ts` — pure function/class that takes
  `scan-error` events and emits `wedge-detected` events. No I/O.
- `src/main/slack-notifier.ts` — pure function/class that takes
  `wedge-detected` events and POSTs to the webhook (with rate-limit
  state). The HTTP call uses Node's built-in `fetch`.

`src/main/main.ts` wires the coordinator's `scan-event` stream into
the wedge detector, and the detector's `wedge-detected` output into the
notifier.

**Why:** Separation of concerns. The detector can be unit-tested with
fake events. The notifier can be unit-tested with a fake fetch. Wiring
in main.ts is small and stays out of test scope.

**Alternatives considered:**

- *Put detection inside the coordinator class.* Couples the coordinator
  to notification logic. Harder to test.
- *Do detection in the Python worker.* Same coupling concern, plus
  cross-language IPC adds complexity for a feature that's
  TS-process-local anyway.

### Decision 5: DPI runtime validation is warn-only, dropdown trim is hard

**What:** Two complementary defenses:

- The UI dropdown (`GRAVISCAN_RESOLUTIONS` in `src/types/graviscan.ts`)
  is trimmed from `[200, 400, 600, 800, 1200, 1600, 3200, 6400]` to
  `[200, 400, 600, 800, 1200, 1600]`. Users can no longer pick 3200 or
  6400.
- At scan time, `scan_worker.py` checks whether the requested
  x_resolution/y_resolution is in the validated set. If not, it logs
  a warning and emits a `dpi-warning` event but proceeds with the scan
  (the SANE backend will round to whatever it supports).

**Why:** Trim is the practical fix today (operators cannot pick
unvalidated values from the UI). The runtime warn defends against
future code paths that might bypass the dropdown — e.g., a
configuration-import IPC, a programmatic test harness, a stale
`GraviConfig.resolution` row from before this PR.

**Alternatives considered:**

- *Refuse unsupported DPI at scan time (abort the scan).* Too strict
  given the existing dropdown still has 3200/6400 in older client
  builds before the user updates. Warn-then-proceed is gentler.
- *Add a DB migration that backfills old `GraviConfig.resolution`
  values.* Out of scope; current dropdown's set covers the production
  configurations.

### Decision 6: Coordinator gains `addScanner(config)` and `hasWorker(id)`

**What:** Two new public methods on `ScanCoordinator`:

- `addScanner(config: ScannerConfig): Promise<void>` — spawns one new
  `ScannerSubprocess` for the given config. No-op if a worker for that
  scanner_id is already in the map and ready.
- `hasWorker(scannerId: string): boolean` — returns whether a
  subprocess exists in the map for that scanner_id.

The existing `initialize(scanners[])` is refactored to use
`addScanner()` internally, so worker spawn logic lives in one place.

**Why:** Issue #234 needs a way to bring up one newly-discovered
scanner without re-initializing the rest of them. The smallest viable
API is one-method-per-scanner. Refactoring `initialize` to use the new
method avoids two implementations of spawn.

**Alternatives considered:**

- *Just call `initialize(allEnabledScanners)` from save-scanners-db on
  every save.* Would tear down and re-spawn already-running workers —
  unnecessary work and possibly disruptive mid-session.
- *Surface a "restart scanners" button instead of auto-spawn.*
  Operator-visible but adds a click; the auto-spawn is the right cure.

### Decision 7: Predictive cadence warning lives on the continuous-scan form

**What:** A new amber banner in `ScanControlSection.tsx`, visible before
the user clicks Start. Triggered when the predicted cycle wall time
exceeds the configured interval. The prediction is a small pure
function (testable independently) that takes
`(grid_mode, scanner_count, dpi, region_size_mm)` and returns
`estimated_cycle_seconds`.

**Why:** Issue #235 asks for predictive (before-start) feedback. The
reactive `overtime` banner that already exists fires only after the
configured duration is exceeded — too late to redirect the operator.

**Precise formula:**

```
estimateCycleSeconds(platesPerScanner, scannerCount, dpi, regionMm) =
    platesPerScanner * perPlateSec(dpi, regionMm)
```

`scannerCount` does NOT scale the estimate because scanners run in
parallel (per the investigation summary Section 3, all scanners
contribute to a cycle by scanning their own plates simultaneously).
`scannerCount` is still accepted as input so the cadence-banner copy
can name it, and so that future formulas (e.g., factoring USB
contention) can incorporate it.

`perPlateSec(dpi, regionMm)` is calibrated to the two empirical
anchors from the investigation summary:

```
perPlateSec(1200, {w: 140, h: 140}) ≈ 102 s
    # Derived: cycle 418 s (4-plate, summary Section 3 Table 3 row 2)
    # divided by 4 plates = 104.5 s/plate.
    # The honored 2-plate case (300 s, summary row 1) gives ~150 s/plate
    # but is dominated by inter-cycle warmup (2 of 4 plates skipped).
    # We use the 4-plate-derived ~102 s as the better steady-state
    # estimate. See investigation summary Section 3, Table 3, and
    # 2026-05-15-t6-pcie-4grid-production-results.md for cycle-time
    # distribution.

perPlateSec(dpi, regionMm) =
    perPlateSec(1200, {140,140})
    * (dpi / 1200)           # roughly linear in DPI (Y-traversal scan time)
    * (regionMm.h / 140)     # roughly linear in scan-region height
```

The formula is deliberately rough (≤15% variance expected) — its job
is to flag order-of-magnitude mismatches between operator-configured
cadence and observable cycle time, not be exact. Tests target
order-of-magnitude correctness, not precise values.

**Traceability:** The 102 s anchor traces to investigation summary
Section 3, Table 3 row "4 plates per scanner sequential" (cycle-gap
median 418 s, 99.95% over 12.5 h on PCIe). The constant SHALL be a
named module-level constant with a doc-comment pointing to the summary
section so future re-calibration is grounded.

**Alternatives considered:**

- *Block the Start button when cadence won't be honored.* Too
  paternalistic — running back-to-back at ~7 min is a valid choice
  (see Section 3 of the summary), just one the operator should make
  consciously.
- *Just extend the existing overtime banner copy.* Doesn't address the
  before-start need; operators wouldn't see it until 30+ min in.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| The wedge-detection signatures false-positive on a recovered transient error | The detector defers final emission until scan-end (success/failure determined). If the scan ultimately succeeds, no `wedge-detected` event is emitted. Operators are not paged for transient hiccups. |
| The wedge-detection consecutive-failures signature misses wedges that straddle a cycle boundary | Acknowledged. The cycle-boundary reset is intentional (each cycle is a fresh observation window). Boundary-straddling wedges are caught on the next cycle's first failure pair. |
| The Slack webhook URL leaks into stderr/log via fetch error messages | The notifier's error-logging path SHALL log only a sanitized message (`"POST failed (status: <code>, network error)"`). It SHALL NOT log the full error object, the request URL, or any request headers. Unit test verifies. |
| The libusb endpoint-recovery wrapper silently no-ops if epkowa is statically linked | The shim logs `[libusb-filter] endpoint recovery: on/unavailable` at init. `scanner-subprocess.ts` reads this stderr line and surfaces a one-time warning in the bloom log if `unavailable`. |
| Disable-only stale-row fix leaves the DB cluttered over years | Cluttered ≠ broken. The `enabled` column gets a `@@index` (or schema comment) so common `enabled=true` queries stay fast. A future maintenance action ("Forget all disabled scanners ≥90 days old") is filed as future work, NOT scope here. |
| Disabled rows accumulate and bias analytics that count `DISTINCT scanner_id` | The Prisma schema's `GraviScanner` model SHALL carry a comment annotation explicitly stating: "Rows with `enabled=false` represent scanners detected previously but no longer enumerating. Queries counting active scanners MUST filter `enabled=true`. Queries counting historical deployments MUST filter by date range, not by row presence." |
| `addScanner` called mid-scan disrupts the event loop | `addScanner` checks `isScanning` on entry. If true, the spawn is queued via an internal `pendingAdditions` array; the coordinator drains the queue at the start of the next cycle (after `cycle-complete`). Tests cover both paths. |
| Predictive cadence formula gets stale as hardware or DPI sets change | The formula is module-local with named constants and a doc-comment pointing to investigation summary Section 3 Table 3. Future tunings are one-line edits. Test thresholds are loose (`> 300 s and ≤ 450 s` for the 4-plate case) so the formula can vary within ±15% without breaking. |
| Rate-limited Slack notification under-notifies cascading multi-scanner failures | Acceptable: a flood of identical "physical AC power-cycle required" messages doesn't add information. Each scanner has its own rate-limit key, so distinct scanner failures DO each generate a message — only repeats for the same scanner within 60 s are suppressed. |
| Two new env vars increase deployment-config surface area | Documented in README + `.env.example` (appended, not replaced). Both default to safe values (URL absent ⇒ disabled, RECOVERY=true ⇒ on by default — both no-ops if epkowa doesn't dynamically link libusb). |
| Persisted `GraviConfig.resolution` rows may hold stale values (3200/6400) from before the dropdown trim | The dropdown won't render the stale value as selectable. Operators must re-select a valid value on next open. The Python runtime warn (Task 8) covers the case where a stale value reaches the worker via a non-UI code path. |
| Merge conflict risk with PR #227 (the long-running feature/graviscan-prod → main PR) | This PR lands INTO `feature/graviscan-prod`, not into `main`. PR #227's merge to `main` will pick up our changes as part of its rebase/merge. If PR #227 is in active conflict-resolution at the time this PR is reviewed, coordinate with PR #227's owner before merging. |

## Migration Plan

1. **Pre-merge:** No DB migration. Existing `GraviScanner.enabled` and
   `GraviScanner.grid_mode` columns already have correct defaults.
2. **On deploy to rig:** Append to `~/.bloom/.env`:
   - `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL=<webhook>` (or leave absent to
     disable Slack notifications)
   - `LIBUSB_ENDPOINT_RECOVERY=true` (default; can set to `false` to
     opt out)
3. **One-time cleanup of stale rows (operator action):** After deploy,
   click Detect on the Configure Scanner page once. The new
   disable-on-detect logic will mark stale `usb_port` rows as
   `enabled=false`. No SQL required.
4. **Rollback plan:** Revert the merge commit. No data is destroyed
   (disable, not delete). Env vars in `~/.bloom/.env` become inert.
   Trimmed `GRAVISCAN_RESOLUTIONS` resets to the previous set.

## Discovery flow coverage

Issues #230, #231, #232, and #234 share a systemic theme (per #234's
body): the scanner-discovery flow does *some* but not *all* of what
operators expect, with the gaps invisible. This PR addresses all four
manifestations together because they cluster around the same code path
(`graviscan:save-scanners-db`):

| Issue | Gap | Task |
|---|---|---|
| #231 | UPDATE/CREATE silently drop `grid_mode` | Task 2 |
| #230 | No disable-on-detect for stale `usb_port` rows | Task 3 |
| #234 | No worker spawn for newly-created rows | Task 7 |
| #232 | DPI dropdown offers unvalidated values; runtime doesn't validate | Task 8 |

After this PR, the contract for `graviscan:save-scanners-db` is:
"After this IPC returns, the DB rows for enabled scanners and the
coordinator's worker map are in sync; stale rows are disabled but
preserved; `grid_mode` reflects the operator's selection." This is the
systemic fix to the gap, not just the individual bugs.

## Open Questions

- *Where should the predictive cadence warning's per-plate-time
  estimates live so they're easy to update?* Default: a small named
  constant in `src/renderer/lib/cadenceEstimator.ts` with a doc-comment
  pointing to investigation summary Section 3, Table 3. If we later
  want operator tunability, could move to GraviConfig (out of scope).
- *Should the Slack message include a snippet of the failing stderr?*
  Default: no, keep messages short. Operators can find detail in the
  log file (path mentioned in message).
- *Should we also emit a Bloom-API webhook (not just Slack) on wedge
  detection?* Out of scope; the Slack hook is the operator-paging
  mechanism. A Bloom-API hook would be a separate analytics concern.
- *Should the DPI safety net also flag the scan metadata
  (`GraviScan.dpi_mismatch` or similar) so downstream pipelines can
  detect resolution-rounding events?* Deferred. The runtime warn
  already emits a `dpi-warning` event that scan-coordinator can choose
  to persist later. No schema change in this PR.
- *Should a "Forget all disabled scanners ≥N days old" maintenance UI
  action be added?* Deferred. Disable-only is the conservative default;
  cleanup tooling is a future concern.
- *C-shim CI coverage gap.* The libusb wrapper is exercised only on
  Linux + real hardware (rig validation in Task 12). Vitest CI on
  Linux runs the `npm`-side tests but does not build the `.so`.
  Acceptable for this PR (the shim is small and the rig validation is
  manual but explicit); revisit if the shim grows.
