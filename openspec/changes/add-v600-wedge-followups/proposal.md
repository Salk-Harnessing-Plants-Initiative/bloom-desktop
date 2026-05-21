## Why

The V600 USB-wedge investigation (2026-05-06 to 2026-05-18) found that the
production rig operates correctly at 1200 dpi with per-plate sequential
scanning at 140×140 mm (≥99.79% over multi-hour runs), but surfaced five
filed bloom-desktop bugs that block operational flexibility on
`feature/graviscan-prod`, plus two operationally-needed UX additions.

These follow-ups are catch-up work consolidated into ONE pull request
against `feature/graviscan-prod` rather than seven separate PRs, because
they all stem from the same investigation and need to land together for
the rig to be flexibly operable. Future work returns to one-PR-per-feature.

Investigation summary (frozen 2026-05-18) is on Box at
https://salkinstitute.box.com/s/ar2v9tgtpk1u0s8xrledfijo9z6eewr7.

## What Changes

Seven independently-testable items, scoped to bug-fixes and small additions:

### Scanning capability

- **Extend scan-error events with timing/throughput fields.** Before the
  detector is useful, `python/graviscan/scan_worker.py` SHALL include
  two additional fields on every `scan-error` event payload:
  `bytes_received: int` (default 0) and `wall_seconds: float`. These
  fields are required by the wedge detector's `device_io_120s_zero_bytes`
  signature. They are NOT present on `scan-error` events today.
- **Add wedge detection from scan-error signatures.** The scan-coordinator
  recognizes a V600 wedge from any of: error-message substring
  `sane_start: Invalid argument`, error-message substring
  `Error during device I/O` with `bytes_received == 0` and
  `wall_seconds >= 120` (the empirically-observed libusb timeout
  threshold from investigation summary Section 1.2), or ≥2 consecutive
  `scan-error` events from the same scanner in one cycle. The detector
  does NOT fire if the affected scan ultimately succeeds (recoverable
  transient errors do not page the operator). Closes part of
  [#236](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/236).
- **Add Slack notification on wedge detection.** A `SlackNotifier` module
  in the main process POSTs a structured message to a configurable webhook
  URL (env var). Rate-limited to one notification per (scanner_id,
  session_id) per minute. Absent webhook URL ⇒ feature disabled. Closes
  remainder of [#236](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/236).
- **Add libusb endpoint-recovery wrapper to the LD_PRELOAD shim.**
  Intercept `libusb_bulk_transfer`; on `LIBUSB_ERROR_TIMEOUT` or
  `LIBUSB_ERROR_PIPE` for an IN endpoint, call `libusb_clear_halt()` to
  reset the host/device data toggle. Opt-in/opt-out via env var, defaults
  to ON. Defense-in-depth — not required for production. Closes part of
  [#228](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/228).
- **Remove the harmful `USBDEVFS_RESET` ioctl from the recovery path.**
  `python/graviscan/scan_worker.py:519` currently calls
  `_reset_usb_device()` (which issues `USBDEVFS_RESET` to
  `/dev/bus/usb/<bus>/<dev>`) inside `_reopen_device()` after any scan
  failure. The investigation summary Section 1.2 and issue #228
  explicitly documented this ioctl makes V600 wedges *worse* — it can
  trigger controller FLR (function-level reset) and detach the
  scanner entirely. The fix is to NOT call this from production code
  paths. The method itself stays (for tests, observability, and
  potential future reconsideration) but no production caller
  remains. The remaining recovery sequence
  (`sane.exit()` → sleep → `sane.init()` → `sane.open()`) is
  sufficient for non-wedge transient failures. Closes the remaining
  scope of [#228](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/228).
- **Add runtime DPI validation warning.** When the scan worker is asked
  to scan at a resolution outside the V600-validated set
  `{200, 400, 600, 800, 1200, 1600}`, the worker logs a warning and
  emits a `dpi-warning` event with a documented JSON shape
  (`{"type":"dpi-warning","scanner_id":"<id>","requested_dpi":N,
  "validated_set":[...],"timestamp":"ISO8601"}`) but proceeds with the
  scan attempt. The production code uses `x_resolution`/`y_resolution`
  flags (per [#233](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/233))
  so 1200 dpi IS honored at the device today — this safety net is
  defense-in-depth against future code paths that might bypass the
  trimmed UI dropdown. Closes part of
  [#232](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/232).
- **Add coordinator API for spawning, querying, and stopping a single
  scanner worker.** Adds `ScanCoordinator.addScanner(scannerConfig)`,
  `hasWorker(scannerId)`, and `stopScanner(scannerId)` methods so
  newly-discovered scanners can be brought online — and stale ones
  shut down — without a full re-initialize. `addScanner` is safe to
  call while `isScanning === true` (it queues the spawn for after the
  current cycle completes to avoid mid-cycle event-loop disruption).

### Machine-configuration capability

- **Fix grid_mode UPDATE/CREATE in save-scanners-db.** Add `grid_mode` to
  both Prisma data blocks so per-scanner mode changes persist. Closes
  [#231](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/231).
- **Disable (not delete) stale GraviScanner rows on detect.** The
  `save-scanners-db` handler sets `enabled=false` for rows whose
  `usb_port` is not in the current detection set. The `validate-config`
  handler is switched from delete-stale to disable-stale (preserves the
  FK chain from existing `GraviScan` rows since there is no
  ON DELETE CASCADE). Closes [#230](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/230).
- **Spawn scan_worker for newly-created scanner rows.** After
  `save-scanners-db` upserts, the handler asks the coordinator to spawn
  workers for any newly-created (or newly-re-enabled) `enabled=true`
  rows. No app restart required. Closes [#234](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/234).

### UI-management-pages capability

- **Trim DPI dropdown to validated set.** Restrict the `GRAVISCAN_RESOLUTIONS`
  constant to `{200, 400, 600, 800, 1200, 1600}` so the UI can no longer
  offer 3200/6400. Closes the UI part of
  [#232](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/232).
- **Add per-row Remove button on Configure Scanner page.** Each scanner
  row gets a Remove button that disables (sets `enabled=false`) the row
  via a new `graviscan:disable-scanner` IPC. Operator can manually clean
  up rows that detection missed. Closes the UI part of
  [#230](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/230).
- **Add predictive cadence-won't-be-honored warning.** On the continuous-
  scan form, when the estimated per-cycle wall time (computed from
  scanner count × grid_mode × per-plate time at the selected DPI)
  exceeds the configured interval, show an amber warning banner BEFORE
  the operator starts the session. The estimate is a *mean* prediction
  with ~15% expected variance; the banner deliberately flags
  order-of-magnitude mismatches rather than precise deadlines. Reactive
  `overtime` banner remains unchanged. Closes
  [#235](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/235);
  builds on the cadence root analysis in
  [#225](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/225)
  (this PR does NOT change the cycle-loop behavior — #225's analysis
  remains the canonical reason cycles run back-to-back).

### Configuration capability

- **Add env-var-driven Slack webhook URL.**
  `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL` loaded from `~/.bloom/.env` by
  config-store.ts. Documented in `.env.example` and README; never
  committed.
- **Add env-var-driven libusb-recovery toggle.** `LIBUSB_ENDPOINT_RECOVERY`
  (default `"true"`) controls whether the shim's
  `libusb_clear_halt`-on-timeout wrapper is active. Passed from the main
  process to the scanner subprocess environment alongside the existing
  `SANE_USB_FILTER`.

## Impact

- **Affected specs:** `scanning`, `machine-configuration`,
  `ui-management-pages`, `configuration`
- **Affected code (TypeScript):**
  - `src/main/scan-coordinator.ts` (wedge detection hook, single-scanner
    spawn API, predictive cycle-time helper)
  - `src/main/scanner-subprocess.ts` (LIBUSB_ENDPOINT_RECOVERY env var
    plumbing)
  - `src/main/graviscan-handlers.ts` (grid_mode in UPDATE/CREATE,
    disable-on-detect, post-upsert worker spawn, disable-scanner IPC,
    fix validate-config delete→disable)
  - `src/main/config-store.ts` (load BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL)
  - `src/main/slack-notifier.ts` (NEW)
  - `src/main/wedge-detector.ts` (NEW)
  - `src/main/main.ts` (wire wedge-detector + slack-notifier to
    scan-coordinator events)
  - `src/types/graviscan.ts` (trim `GRAVISCAN_RESOLUTIONS`)
  - `src/renderer/ConfigureScanner.tsx` + `src/renderer/components/graviscan/ScannerConfigSection.tsx`
    (Remove button)
  - `src/renderer/components/graviscan/ScanControlSection.tsx` (predictive
    cadence warning)
  - `src/renderer/types/electron.d.ts` (new IPC type)
- **Affected code (C):**
  - `src/main/native/libusb-filter.c` (extend with libusb_bulk_transfer
    wrapper)
- **Affected code (Python):**
  - `python/graviscan/scan_worker.py` (DPI runtime validation warn)
- **Database:** No schema change. Existing `GraviScanner.enabled` and
  `GraviScanner.grid_mode` columns are now honored end-to-end.
- **Documentation:** `README.md` (env vars), `.env.example` (NEW or
  appended), `docs/CONFIGURATION.md` updates.
- **Hardware tests required on rig:** libusb shim end-to-end (real
  scanimage), Slack notification end-to-end (real wedge event or
  simulated stderr injection), continuous-session regression at 4-plate
  140×140 mm 1200 dpi for ≥5 minutes.

## Out of scope

- **Database schema migration** (no FK changes; existing schema already
  supports the new behavior). Note that the `enabled` column's *semantics*
  do change (rows with `enabled=false` now mean "stale, not currently
  enumerating" rather than implicitly never-existing); this is documented
  in `design.md` and a Prisma schema comment, but no migration is needed.
- **Deleting the `_reset_usb_device()` method itself.** The method
  stays in the codebase (tested, observable) — only the production
  *call site* in `_reopen_device()` is removed. This preserves the
  ability to re-enable via a single-line revert if a future scenario
  needs the kernel-level reset.
- **#228 candidate fixes 2–5.** This proposal scopes only Fix 1 from
  issue #228 (the `libusb_clear_halt`-on-bulk-timeout wrapper). The
  investigation's other proposed mitigations are NOT in scope here:
  Fix 2 (raise libusb global timeout via LD_PRELOAD) is not needed
  given production runs ≥99.79% without it; Fix 3 (per-transfer timeout
  wrapper) similarly unneeded; Fix 4 (retry-count scaling) unneeded;
  Fix 5 (device-selection rework) unneeded. Reference Section 1.3 of
  the investigation summary.
- **Lowering production DPI from 1200 to 600/800** (the investigation
  found the wedge depends on bytes-per-scan, not DPI alone; this is a
  science decision, not a code fix).
- **Replacing the V600 hardware** (Basler / Canon 9000F evaluated in the
  summary, no decision).
- **Backfilling GraviConfig rows with stale resolution values** (e.g.,
  any persisted `resolution=3200` or `6400` from before this PR). If
  such rows exist, the UI dropdown will not offer the stale value as
  selectable — the operator must re-select a value from the trimmed
  set on next open. The Python runtime warn (Task 8) is the
  defense-in-depth that ensures any code path bypassing the dropdown
  still surfaces the issue.
- **Operational cleanup of long-accumulated disabled rows.** Disabled
  rows preserve FK integrity but accumulate over time. A future
  maintenance action (e.g., "Forget all disabled scanners ≥90 days
  old") is out of scope here; file as a separate issue if it becomes
  load-bearing.
