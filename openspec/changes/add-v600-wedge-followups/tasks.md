# Tasks: V600 wedge investigation follow-ups

All new TypeScript test files MUST include `// @vitest-environment node`
at line 1 (matches existing convention for src/main/ tests).

All tasks are TDD: write the test FIRST, watch it fail, then write the
minimum code to make it pass, then refactor. Each task lists what tests
to write and what behavior they verify.

Task dependencies:
- Task 0 (scan-error field additions) is prerequisite for Task 5
  (WedgeDetector). It must land first or the detector's
  `device_io_120s_zero_bytes` signature has no field to read.
- Task 1 (env-var plumbing) is prerequisite for Task 6 (Slack notifier)
  and Task 4 (libusb-recovery toggle).
- Task 2 (grid_mode persistence) SHOULD land before Task 7
  (spawn-on-discovery) because both touch `save-scanners-db`. The Task
  7 tests must continue to pass alongside Task 2's behavior. If both
  are implemented in the same session, the tests should run together
  to catch regressions.
- Tasks 3, 8, 9, 10 are otherwise mostly independent and may be done
  in any order.

---

## Task 0 — Extend scan-error event payload with timing/bytes fields (scanning, prerequisite for Task 5)

**Goal:** `python/graviscan/scan_worker.py` currently emits `scan-error`
events with payload `{type, scanner_id, plate_index, job_id, error}`
only. The wedge detector (Task 5) requires two additional fields:

- `bytes_received: int` — number of image bytes successfully read
  from the device before failure.
- `wall_seconds: float` — elapsed seconds from the scan start to the
  scan-error emission. Measured with `time.monotonic()` (not wall
  clock).

**Pragmatic instrumentation strategy.** python-sane's `snap()` returns
a fully-decoded PIL Image and does not expose an incremental byte
counter. Since the V600 wedge case (which this feature primarily
targets) fails inside `sane.start()` or before `snap()` returns ANY
data, the pragmatic measurement is:

- If the failure occurs before or during `sane.start()` (most common
  wedge case): `bytes_received = 0`.
- If `snap()` returned a partial image and post-snap processing
  failed: `bytes_received = len(image.tobytes())` (approximate, but
  unambiguous about "got data" vs "got nothing").
- If `snap()` raised mid-stream: `bytes_received = 0` (python-sane
  does not surface partial-byte progress to userspace).

This is a deliberate simplification — the wedge detector's main
signal is "got 0 bytes after 120 s," which this captures precisely.
Future enhancement could intercept libusb to count bytes more
accurately (similar to the libusb-filter shim pattern), but is out
of scope here.

**Timing consistency.** The existing `duration_ms` field (line 320
and 334) uses `time.time()`. For consistency, this task SHALL migrate
`duration_ms` to also use `time.monotonic()` so both timing fields
are immune to system-clock adjustments. Test:
`duration_ms` and `wall_seconds * 1000` are within 10 ms of each
other on a successful + failed scan.

These fields are also useful for operator log inspection beyond the
wedge detector.

**TDD — tests to write FIRST in `python/tests/test_scan_worker_events.py`:**

- *test:* a `scan-error` event from `_emit_scan_error()` includes both
  `bytes_received` and `wall_seconds` keys (in addition to existing
  keys).
- *test:* `bytes_received` is `0` when the failure occurs before any
  bytes are transferred (e.g., `sane.start()` raises).
- *test:* `wall_seconds` reflects the elapsed time from scan start to
  emit (mock `time.monotonic()` with `[0.0, 100.0]` ⇒ expect
  `wall_seconds == 100.0`).
- *test:* existing scan-error fields (`type`, `scanner_id`, `plate_index`,
  `job_id`, `error`) are still present and unchanged.
- *test:* on a successful scan, `duration_ms` field still appears on the
  `scan-complete` event and uses `time.monotonic()` (mock
  `time.monotonic()` with `[0.0, 5.0]` ⇒ expect `duration_ms == 5000`).
- *test:* on a failed scan, the corresponding `scan-error` event's
  `wall_seconds * 1000` and the `duration_ms` field that *would* have
  been emitted on success are within 10 ms (both measured via same
  monotonic clock).

**Checklist:**

- [x] 0.1 Write the tests above (`python/tests/test_scan_worker_events.py`)
- [x] 0.2 Plumb a `bytes_received` accumulator via `self._last_scan_bytes_received`,
      reset in `_scan_plate` and set in `_sane_scan` + `_mock_scan` on
      successful image acquisition
- [x] 0.3 Capture `scan_start = time.monotonic()` at scan start; on
      error emit `wall_seconds = time.monotonic() - scan_start`. Migrated
      `duration_ms` to monotonic() for timing consistency.
- [x] 0.4 Update the scan-error event payload to include both fields;
      scan-complete keeps its existing fields but now uses monotonic timing
- [x] 0.5 Document the event shape in the `_scan_plate` doc-string and
      reference investigation summary Section 1.2 + #236
- [x] 0.6 `pytest python/tests/test_scan_worker_events.py` passes 6/6;
      existing `python/tests/test_scan_worker.py` passes 53/54 (the 1
      failure is the pre-existing Windows-only `fcntl` platform issue in
      `TestUSBResetPathConstruction.test_path_from_device_name`,
      unrelated to this task)

---

## Task 1 — Add env-var loading for new toggles (configuration capability)

**Goal:** Extend `src/main/config-store.ts` to load
`BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL` and `LIBUSB_ENDPOINT_RECOVERY` from
`~/.bloom/.env`. Surface them via existing `loadEnvConfig()` return shape
or a sibling getter. Document in `.env.example` and README.

**TDD — tests to write FIRST in `tests/unit/config-store-env.test.ts`:**

- *test:* `loadEnvConfig` returns `slackWebhookUrl: undefined` when env
  file is absent.
- *test:* `loadEnvConfig` returns `slackWebhookUrl: "https://..."` when
  `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL=https://hooks.slack.com/...` is
  present.
- *test:* `loadEnvConfig` returns `libusbEndpointRecovery: true` (the
  default) when no env-var is set.
- *test:* `loadEnvConfig` returns `libusbEndpointRecovery: false` when
  `LIBUSB_ENDPOINT_RECOVERY=false` is set.
- *test:* `loadEnvConfig` returns `libusbEndpointRecovery: true` for
  case-insensitive truthy values (`"True"`, `"TRUE"`, `"true"`).

**Checklist:**

- [x] 1.1 Write the tests above (`tests/unit/config-store-env.test.ts`,
      14 tests covering absent/present URL, default-true recovery,
      case-insensitive false, both vars together, no regression to
      existing fields)
- [x] 1.2 Add `slack_webhook_url?: string` and
      `libusb_endpoint_recovery?: boolean` (snake_case to match existing
      MachineConfig field convention)
- [x] 1.3 Implement env-var parsing in `config-store.ts:loadEnvConfig`
      with explicit empty-string handling for the URL (treats empty
      as undefined) and default-true for the recovery toggle
- [ ] 1.4 Append (do NOT overwrite) `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL`
      and `LIBUSB_ENDPOINT_RECOVERY` sections to the existing
      `.env.example` at the repo root, with documented placeholders
      and a comment warning operators not to commit real values
- [ ] 1.5 Add a section to `README.md` documenting both env vars and
      where to put them (`~/.bloom/.env`)
- [ ] 1.6 `npx tsc --noEmit` passes; `npm run test:unit` passes

---

## Task 2 — Fix grid_mode persistence in save-scanners-db (machine-configuration)

**Goal:** Add `grid_mode` to the UPDATE and CREATE data blocks of the
`graviscan:save-scanners-db` handler in `src/main/graviscan-handlers.ts`.
This is the smallest item in the proposal and is the highest-priority
operator-blocker.

**TDD — tests to write FIRST in `tests/unit/graviscan-save-scanners.test.ts`:**

- *test:* given an existing `GraviScanner` row with
  `grid_mode='4grid'`, when `save-scanners-db` is called with
  `[{..., grid_mode: '2grid'}]`, the row's `grid_mode` is `'2grid'`
  after the call.
- *test:* given no existing row, when `save-scanners-db` is called with
  `[{..., grid_mode: '2grid'}]`, the created row has
  `grid_mode='2grid'`.
- *test:* given a payload missing `grid_mode`, an existing row's
  `grid_mode` is preserved (not overwritten with null/default).

**Plus an E2E test in `tests/e2e/grid-mode-roundtrip.e2e.ts`:**

- *test:* launch app with a test DB containing one scanner, navigate
  to Configure Scanner, change grid_mode dropdown to `2grid`, click
  Save, navigate away, navigate back, confirm dropdown still shows
  `2grid`. Validates the full UI ↔ IPC ↔ DB round-trip.

**Checklist:**

- [x] 2.1 Write the unit tests above
      (`tests/unit/graviscan-save-scanners.test.ts`, 7 tests covering
      UPDATE persistence, UPDATE fallback to existing value when payload
      omits grid_mode, CREATE persistence, CREATE fallback to "4grid"
      default, and the Prisma data-block field assertions)
- [ ] 2.2 Write the E2E test (deferred — covered by the unit-test
      contract; a manual UI smoke on the rig validates the round-trip)
- [x] 2.3 Add `grid_mode: scanner.grid_mode ?? existing.grid_mode` to
      the UPDATE block (now lives in `src/main/scanner-upsert.ts` —
      extracted from the IPC handler for testability)
- [x] 2.4 Add `grid_mode: scanner.grid_mode ?? '4grid'` to the CREATE
      block (also in `scanner-upsert.ts`)
- [x] 2.5 `npx vitest run tests/unit/graviscan-save-scanners.test.ts`
      passes 7/7; full Vitest run continues to pass. `npx tsc
      --noEmit` is clean after `npx prisma generate`. Manual UI smoke
      to be performed during Task 12 rig validation.

---

## Task 3 — Disable-on-detect for stale scanner rows (machine-configuration)

**Goal:** Two changes to `graviscan-handlers.ts`:
1. `save-scanners-db` sets `enabled=false` for any existing row whose
   `usb_port` is not in the current payload's `usb_port` set.
2. `validate-config` switches from `db.graviScanner.delete()` (lines
   917-922) to `db.graviScanner.update({ data: { enabled: false } })`.

**TDD — tests to write FIRST in `tests/unit/graviscan-stale-rows.test.ts`:**

- *test:* given enabled rows for ports `['1-1','1-2','1-3']`, when
  `save-scanners-db` is called with payload for `['1-1','1-2']`, the
  `1-3` row is set to `enabled=false` (and not deleted).
- *test:* given the same setup, when `validate-config` runs and detects
  no scanner at port `1-3`, the row is set to `enabled=false` (and not
  deleted).
- *test:* given a `GraviScan` row references `scanner_id` of a
  newly-disabled row, the `GraviScan` row remains in the DB (FK
  preserved).
- *test:* re-enabling idempotency: when a scanner with `usb_port='1-3'`
  is detected again, the previously-disabled row is updated back to
  `enabled=true` AND **exactly one row exists for `usb_port='1-3'` after
  the operation** (assert with `count`, not just `findFirst`).
- *test:* `get-scanner-status` does NOT return disabled rows (asserts
  the existing `where: { enabled: true }` filter is intact).

**Checklist:**

- [ ] 3.1 Write the tests above
- [ ] 3.2 Audit all `db.graviScanner.*` call sites in `src/main/`. The
      known sites (as of `feature/graviscan-prod` HEAD) live in
      `src/main/graviscan-handlers.ts` at lines 77, 245, 461, 470,
      490, 616, 633, 668, 702, 830, 922, 987, 2188. For each, confirm
      whether the call should filter `enabled: true`:
      - **MUST filter:** any read path that surfaces scanners to the UI
        or to scan-time decisions (get-scanner-status, validate-config
        success path, worker spawn validation)
      - **MAY include disabled:** historical lookups by `usb_bus +
        usb_device` or `usb_port` during upsert/re-detect path (where
        the goal is to find ANY row for that hardware, including
        previously-disabled ones to re-enable)
      Add a one-line code comment at every call site stating the
      decision and (for the MAY-include-disabled cases) the
      justification. Re-run the audit at PR-ready time to catch any
      newly-introduced query.
- [ ] 3.3 Implement disable-not-deleted-stale logic in `save-scanners-db`
- [ ] 3.4 Change `validate-config` delete→update(enabled=false)
- [ ] 3.5 Ensure re-detect path re-enables (upsert pattern, not
      delete-and-recreate)
- [ ] 3.6 Add a Prisma schema comment above the `GraviScanner.enabled`
      field explicitly stating: "Rows with `enabled=false` are stale
      (detected previously, not currently enumerating). Queries
      counting active scanners MUST filter `enabled=true`. Disable —
      do not delete — to preserve FK chain to `GraviScan.scanner_id`."
- [ ] 3.7 `npm run test:unit` passes; manual UI smoke (move scanner
      cables, click Detect, confirm stale rows disappear from UI but
      DB has them with enabled=false)

---

## Task 3.5 — Remove USBDEVFS_RESET from production recovery path (scanning)

**Goal:** Stop invoking `_reset_usb_device()` from
`_reopen_device()` in `python/graviscan/scan_worker.py:519`. The
investigation summary Section 1.2 and issue #228 explicitly found
this ioctl makes V600 wedges worse (it can trigger controller FLR
and detach the scanner). The method itself stays for testability and
future reconsideration — only the production call site is removed.

**TDD — tests to write FIRST in `python/tests/test_scan_worker_recovery.py`:**

- *test:* `_reopen_device()` does NOT call `_reset_usb_device` (use
  `unittest.mock.patch.object` to spy on the method; assert call
  count is 0 after `_reopen_device()` completes).
- *test:* `_reopen_device()` DOES call `sane.exit()`, then
  `time.sleep(3)`, then `sane.init()`, then `sane.open()` in that
  order (use `unittest.mock` + `mock.call_args_list` to verify
  ordering).
- *test:* `_reset_usb_device()` method is still importable from the
  `ScanWorker` class and runs without raising on a non-Linux
  platform (existing tests at `test_scan_worker.py:364-385` should
  continue to pass).
- *test:* on a simulated SANE-busy transient failure (sane.open
  raises once, then succeeds on retry), `_reopen_device()` completes
  successfully without USBDEVFS_RESET. The existing 3-attempt
  retry-with-backoff in `_reopen_device()` is preserved.

**Checklist:**

- [x] 3.5.1 Write the tests above
      (`python/tests/test_scan_worker_recovery.py`)
- [x] 3.5.2 Remove the `self._reset_usb_device()` call at
      `scan_worker.py:519`
- [x] 3.5.3 Add a doc-comment ABOVE the deletion site explaining:
      "USBDEVFS_RESET removed 2026-05-21 per investigation summary
      Section 1.2 and #228 — kernel-level reset makes V600 wedges
      worse via FLR. _reset_usb_device() method retained for
      testability." 3-second sleep retained with its own
      explanatory comment.
- [x] 3.5.4 Add a doc-comment to `_reset_usb_device()` itself:
      "NOTE (2026-05-21, #228): no longer called by _reopen_device()
      ... retained for testability and potential future
      reconsideration; do NOT re-add a production call site without
      revisiting the investigation summary."
- [x] 3.5.5 `pytest python/tests/test_scan_worker_recovery.py` passes
      7/7. `pytest python/tests/test_scan_worker.py` passes 53/54
      (the 1 failure is the pre-existing Windows-only fcntl issue,
      unrelated). All existing `_reset_usb_device` tests at
      `test_scan_worker.py:364-385` and `test_scan_worker.py:901-938`
      still pass.
- [ ] 3.5.6 Manual rig validation (folded into Task 12): trigger a
      non-wedge SANE-busy condition (e.g., quickly start two
      scanimage processes) and confirm `_reopen_device()` recovers
      without the ioctl

---

## Task 4 — libusb endpoint-recovery wrapper extension (scanning, native code)

**Goal:** Extend `src/main/native/libusb-filter.c` to also intercept
`libusb_bulk_transfer`. On `LIBUSB_ERROR_TIMEOUT` or
`LIBUSB_ERROR_PIPE` for an IN endpoint (high bit set), call
`libusb_clear_halt()` before returning the error. Guard the behavior
with the `LIBUSB_ENDPOINT_RECOVERY` env var (read once at init,
default-on if absent or any value other than "false"). Add an
init-time log line confirming the wrapper is active.

`src/main/scanner-subprocess.ts` passes `LIBUSB_ENDPOINT_RECOVERY` (read
via Task 1's env loading) to the subprocess environment alongside the
existing `SANE_USB_FILTER` and `LD_PRELOAD`.

**TDD — tests to write FIRST:**

This task has TWO test surfaces:

*TypeScript side (`tests/unit/scanner-subprocess-env.test.ts`):*

- *test:* when main-process env has `LIBUSB_ENDPOINT_RECOVERY=false`,
  `ScannerSubprocess.spawn()` passes `LIBUSB_ENDPOINT_RECOVERY=false`
  in the subprocess env.
- *test:* when `LIBUSB_ENDPOINT_RECOVERY` is unset, the subprocess env
  has it as `"true"` (default-on).
- *test:* `LIBUSB_ENDPOINT_RECOVERY` is NOT injected when
  `process.platform !== 'linux'` (no-op on macOS/Windows).
- *test:* `LIBUSB_ENDPOINT_RECOVERY` is NOT injected in mock mode.

*C-shim side:* a C-level test isn't practical inside the JS test
suite. We test indirectly:

*Integration smoke (`tests/integration/test-libusb-shim.sh`):* a small
shell script that builds the .so and runs a Python helper that opens a
mock libusb session and asserts the shim's init log line is on stderr
when the env var is set. Skip on non-Linux. (No build of this script
required for unit tests — it runs on the rig.)

**Checklist:**

- [ ] 4.1 Write the TypeScript tests above
- [ ] 4.2 Add `LIBUSB_ENDPOINT_RECOVERY` env-var read in
      `scanner-subprocess.ts:153-171` block
- [ ] 4.3 Implement the C-side wrapper in `libusb-filter.c`
- [ ] 4.4 Add a one-time init log line on stderr indicating "endpoint
      recovery: on/off"
- [ ] 4.5 Add a build target for the shim. Concrete shape:
      - `scripts/build-libusb-filter.sh` (Linux) wraps
        `gcc -shared -fPIC -ldl -o src/main/native/libusb-filter.so
        src/main/native/libusb-filter.c $(pkg-config --cflags --libs libusb-1.0)`
      - `package.json` adds `"build:native": "bash scripts/build-libusb-filter.sh"`
        and a `prepackage` hook that runs it on Linux only:
        `"prepackage": "node -e \"process.platform==='linux' && require('child_process').execSync('npm run build:native', {stdio:'inherit'})\""`
      - On macOS/Windows the script is a no-op (echoes "skipping
        libusb-filter build on non-Linux")
- [ ] 4.6 Update `forge.config.ts:83` to make the `libusb-filter.so`
      copy conditional on `process.platform === 'linux'`. Today the
      copy unconditionally references the `.so` which causes
      packaging warnings on macOS/Windows even though the file
      doesn't exist there.
- [ ] 4.7 Write `tests/integration/test-libusb-shim.sh` for rig-side
      validation; document how to run it in `docs/SCANNER_TESTING.md`
- [ ] 4.8 `npm run test:unit` passes; on the rig: build the .so, run
      the integration script, verify init log line

---

## Task 5 — Wedge detector module (scanning capability)

**Goal:** Add `src/main/wedge-detector.ts` exporting `WedgeDetector`
class that takes scan-coordinator events and emits `wedge-detected`
events. Pure logic — no I/O, no fetch, no DB.

The detector tracks per-scanner-per-cycle scan-error counts and matches
stderr substrings.

**TDD — tests to write FIRST in `tests/unit/wedge-detector.test.ts`:**

Positive signature matches:

- *test:* receiving a `scan-error` event whose error message contains
  `"sane_start: Invalid argument"` emits exactly one `wedge-detected`
  event with signature `"sane_start_invalid"`.
- *test:* receiving a `scan-error` event whose error contains
  `"Error during device I/O"` AND `bytes_received === 0` AND
  `wall_seconds >= 120` emits one `wedge-detected` with signature
  `"device_io_120s_zero_bytes"`.
- *test:* receiving 2 `scan-error` events from the same scannerId
  within one cycle emits exactly one `wedge-detected` with signature
  `"consecutive_failures"`.

Negative cases (must NOT emit):

- *test:* `device_io` signature requires bytes==0: error message
  matches but `bytes_received > 0` does NOT emit the
  `device_io_120s_zero_bytes` signature.
- *test:* `device_io` signature requires wall>=120: error message
  matches and bytes==0 but `wall_seconds < 120` does NOT emit the
  signature.
- *test:* `device_io` signature requires message match: bytes==0 and
  wall>=120 but error message does NOT contain
  `"Error during device I/O"` does NOT emit the signature.
- *test:* two `sane_start_invalid` events from the same scanner in
  one cycle emit exactly ONE `wedge-detected` (not two — same
  signature dedup within cycle).
- *test:* a single `scan-error` from scannerId A followed by a
  cycle boundary (`cycle-start`) and one more `scan-error` from A
  does NOT emit `consecutive_failures` (counter resets per cycle).
- *test:* a `scan-error` from scanner A followed by `scan-error` from
  scanner B in one cycle does NOT emit a consecutive-failures wedge
  (counter is per scanner).
- *test:* a `scan-error` followed by a `scan-complete` for the SAME
  `(scanner_id, plate_index)` indicates a recovered failure; the
  detector does NOT emit a wedge for the recovered scan (defer
  emission until scan outcome is determined).

Determinism + idempotency:

- *test:* the detector is deterministic: feeding the same event
  stream twice produces identical `wedge-detected` event sequences.
- *test:* duplicate `cycle-start` events with the same `cycle_number`
  are idempotent (counter is reset only once; no double-reset issue).

**Checklist:**

- [ ] 5.1 Write the tests above
- [ ] 5.2 Implement `WedgeDetector` class with `onScanError()`,
      `onCycleStart()`, and an EventEmitter or callback for
      `wedge-detected`
- [ ] 5.3 Wire the detector to `scan-coordinator` events in `main.ts`
      (small change — guarded by feature flag or always-on if cheap)
- [ ] 5.4 `npm run test:unit` passes

---

## Task 6 — Slack notifier module (scanning capability)

**Goal:** Add `src/main/slack-notifier.ts` exporting `SlackNotifier`
class. Takes `wedge-detected` events and POSTs to a configurable
webhook URL with rate-limit. Uses Node's built-in `fetch`.

Rate-limit: at most one notification per `(scanner_id, session_id)`
per minute. Implemented with an in-memory `Map<key, lastSentMs>`.

**TDD — tests to write FIRST in `tests/unit/slack-notifier.test.ts`:**

Behavior:

- *test:* when constructed without a webhook URL, calling `notify()`
  is a no-op (no fetch, no error).
- *test:* with a webhook URL, calling `notify()` once issues exactly
  one fetch POST to that URL.
- *test:* the POST body is JSON with `text` containing scanner ID, USB
  path, session ID, cycle number, signature, a power-cycle CTA, and
  the investigation-summary Box URL.

Rate limiting:

- *test:* calling `notify()` twice within 60 s for the same
  `(scanner_id, session_id)` issues only one fetch (second is
  rate-limited).
- *test:* the rate-limit key persists across cycles within the same
  session: two wedges for the same scanner in cycle 3 and cycle 4
  (both within the same session) within 60 s issue only one fetch.
- *test:* calling `notify()` twice within 60 s for the same scanner_id
  but DIFFERENT session_id issues two fetches (different rate-limit
  key).
- *test:* calling `notify()` twice >60 s apart for the same
  `(scanner_id, session_id)` issues two fetches.

Failure modes (defense against URL leakage and hung fetches):

- *test:* a fetch failure (network error) is logged but does NOT throw
  or crash the caller.
- *test:* a non-2xx response is logged but does NOT throw.
- *test:* a fetch that hangs is aborted after a configured 10-second
  timeout. Setup: mock `globalThis.fetch` to return a Promise that
  never resolves; spy on `AbortController.prototype.abort`; use
  `vi.useFakeTimers()`; call `notify()`; advance time by 10000 ms;
  assert `AbortController.prototype.abort` was called exactly once;
  assert the fetch Promise rejects (with the abort reason);
  assert the notifier's `notify()` Promise resolves (no throw to
  caller); assert `console.error` was called with a sanitized
  message.
- *test:* the logged error message does NOT contain the webhook URL,
  full request object, or any request headers. Capture
  `console.error` output (`vi.spyOn(console, 'error')`) across all
  failure modes (network error, non-2xx status, timeout). For each
  case, assert NO entry in the `console.error.mock.calls` array
  contains the substrings `"hooks.slack.com"` or
  `"/services/"` or any path segment past the protocol.
- *test:* the same rate-limit key persists across cycle boundaries
  within one session. Setup: configure rate-limit window 60 s; emit
  `wedge-detected` for `(scanner=A, session=S)` in cycle 3 at T=0;
  advance fake time 45 s; emit `cycle-start` (cycle 4) followed by
  another `wedge-detected` for the same `(A, S)`; assert fetch
  called only ONCE. Then advance fake time another 16 s (now T=61);
  emit `wedge-detected` again for `(A, S)`; assert fetch now called
  a second time. Proves the key is per-session, not per-cycle.

**Checklist:**

- [ ] 6.1 Write the tests above (mock `globalThis.fetch` via
      `vi.spyOn(globalThis, 'fetch')` or `vi.fn()`)
- [ ] 6.2 Confirm existing test infrastructure supports fetch mocking
      by writing a small probe test first (one-liner test that mocks
      fetch and asserts it was called) — Electron 28.2.2 bundles Node
      ≥18 so `globalThis.fetch` exists, but verify the Vitest env
      doesn't strip it.
- [ ] 6.3 Implement `SlackNotifier` class with AbortController-based
      timeout (default 10 s). Error logging path SHALL log only a
      sanitized one-line message, never the full URL or request
      object.
- [ ] 6.4 Wire `WedgeDetector` → `SlackNotifier` in `main.ts`. Read
      webhook URL via Task 1's env loading.
- [ ] 6.5 `npm run test:unit` passes; on the rig with a real webhook
      URL set: induce a wedge (or inject a synthetic scan-error via a
      dev-only IPC) and verify Slack message arrives within seconds

---

## Task 7 — Coordinator addScanner API + spawn-on-discovery (scanning + machine-configuration)

**Goal:** Add `ScanCoordinator.addScanner(config)` and
`ScanCoordinator.hasWorker(scannerId)` methods. Refactor
`initialize(scanners[])` to use `addScanner()` internally so worker
spawn logic lives in one place. Then update `graviscan:save-scanners-db`
to call `coordinator.addScanner()` for any newly-created (or
newly-re-enabled) `enabled=true` row.

**TDD — tests to write FIRST:**

*Coordinator (`tests/unit/scan-coordinator-add-scanner.test.ts`):*

- *test:* given an initialized coordinator with workers for `[A, B]`,
  calling `addScanner(C)` spawns a worker for C only; A and B are
  untouched.
- *test:* `addScanner(A)` when A is already in the map and ready is a
  no-op (does not respawn).
- *test:* `hasWorker(scannerId)` returns true when a worker for that
  id is in the map AND is in `ready` state.
- *test:* `hasWorker(scannerId)` returns false when no worker exists,
  OR worker is in `dead`/`initializing` state.
- *test:* `initialize([A, B])` followed by `initialize([B, C])` ends
  with workers `[B, C]` (A shut down, B reused, C newly spawned). This
  is the existing behavior, kept stable.
- *test:* mid-scan safety — when `isScanning === true`, calling
  `addScanner(C)` does NOT spawn the subprocess immediately. The
  request is queued internally. After the current cycle completes
  (`cycle-complete` event), the queued spawn is processed and `C` is
  added to the worker map.

*Handler (`tests/unit/graviscan-save-scanners-spawn.test.ts`):*

- *test:* given a coordinator with no workers, calling
  `save-scanners-db` with a payload containing one new enabled scanner
  results in one `coordinator.addScanner()` call with the correct
  config.
- *test:* given a coordinator with a worker already running for
  scanner_id X, calling `save-scanners-db` with the same X in payload
  does NOT trigger a new spawn.
- *test:* `save-scanners-db` with `enabled=false` rows does NOT spawn
  workers for them.

**Checklist:**

- [ ] 7.1 Write the tests above
- [ ] 7.2 Add `addScanner(config)` and `hasWorker(id)` to
      `ScanCoordinator`
- [ ] 7.3 Refactor `initialize()` to use `addScanner()` per scanner
- [ ] 7.4 Update `graviscan:save-scanners-db` to call
      `coordinator.addScanner()` post-upsert for new/re-enabled rows
- [ ] 7.5 `npm run test:unit` passes; manual UI smoke (plug in a
      scanner on a previously-unseen USB path, click Detect, confirm
      it goes from "discovered" → "connected" without app restart)

---

## Task 8 — DPI dropdown trim + runtime validation warning (ui-management-pages + scanning)

**Goal:** Two related changes:

1. Trim `GRAVISCAN_RESOLUTIONS` in `src/types/graviscan.ts` from
   `[200, 400, 600, 800, 1200, 1600, 3200, 6400]` to
   `[200, 400, 600, 800, 1200, 1600]`.
2. In `python/graviscan/scan_worker.py`, before setting x_resolution
   and y_resolution, check the requested value is in the validated
   set; if not, log a warning and emit a `dpi-warning` event but
   continue with the scan.

**TDD — tests to write FIRST:**

*TypeScript dropdown (`tests/unit/graviscan-resolutions.test.ts`):*

- *test:* `GRAVISCAN_RESOLUTIONS` equals
  `[200, 400, 600, 800, 1200, 1600]` (exact order, exact length).
- *test:* `GRAVISCAN_RESOLUTIONS.includes(1200)` is true (defensive
  test that 1200 — the production value — is still present).

*Python runtime warn (`python/tests/test_scan_worker_dpi.py`):*

- *test:* `_validate_dpi(1200)` returns `True` (no warning).
- *test:* `_validate_dpi(3200)` returns `False` and logs a warning
  containing "outside validated set" and the requested value.
- *test:* `_validate_dpi(750)` returns `False` (not in set).
- *test:* worker scan with `resolution=3200` emits a `dpi-warning`
  event (via EVENT: stdout) but still proceeds to attempt the scan
  (in mock mode the scan completes).
- *test:* the `dpi-warning` event JSON has the EXACT documented shape:
  assert `type === "dpi-warning"`, `scanner_id` is a string,
  `requested_dpi` is an integer (not a string), `validated_set` is
  EXACTLY the list `[200, 400, 600, 800, 1200, 1600]` (same order),
  `timestamp` matches the ISO-8601-with-timezone regex
  `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:\d{2}$/`,
  and no extra unexpected keys are present.
- *test:* clarification — when the requested DPI is unvalidated, the
  worker passes the requested value through to `device.x_resolution`
  and `device.y_resolution` UNMODIFIED (the SANE driver may then round
  internally; the worker does NOT clamp to the max validated value).
  This preserves "warn-then-proceed" semantics rather than silently
  altering the operator's request.

**Checklist:**

- [ ] 8.1 Write the tests above
- [ ] 8.2 Trim `GRAVISCAN_RESOLUTIONS` in `src/types/graviscan.ts:166`
- [ ] 8.3 Add a sibling type `LegacyGraviScanResolution` and a
      type-guard helper `isValidResolution(value: number):
      value is GraviScanResolution` in `src/types/graviscan.ts`
      (per design.md Decision 2c) — for renderer code paths that
      read possibly-stale `GraviConfig.resolution` from the DB
- [ ] 8.4 Verify "(recommended)" tag still attaches to 1200 in
      `ConfigureScanner.tsx:366-377` and
      `ScannerConfigSection.tsx:580-591`
- [ ] 8.5 Find DB-read callers of `config.resolution` in the renderer
      via Grep; update them to use `LegacyGraviScanResolution`
      with the new type-guard helper so a stale 3200 from DB
      doesn't break compilation
- [ ] 8.6 Add `_validate_dpi` helper and `dpi-warning` event emission
      in `scan_worker.py`
- [ ] 8.7 `npm run test:unit` passes; `pytest python/tests/` passes

---

## Task 9 — Per-row Remove scanner UI + IPC (ui-management-pages + machine-configuration)

**Goal:** Add a Remove button to each scanner row on the Configure
Scanner page that calls a new `graviscan:disable-scanner` IPC, which
sets `enabled=false` for that scanner_id. Also kills its
`scan_worker` subprocess via `coordinator.stopScanner(scannerId)` if
one is running.

**TDD — tests to write FIRST:**

*Handler (`tests/unit/graviscan-disable-scanner.test.ts`):*

- *test:* `graviscan:disable-scanner(scannerId)` sets `enabled=false`
  on the matching row.
- *test:* the handler calls `coordinator.stopScanner(scannerId)` if
  the coordinator has a worker for that scanner.
- *test:* the handler returns `{ ok: true }` on success, `{ ok: false,
  error: '...' }` if scanner_id is not found.

*Coordinator (extends `tests/unit/scan-coordinator-add-scanner.test.ts`
or new file):*

- *test:* `coordinator.stopScanner(scannerId)` removes the worker from
  the map and kills its subprocess.
- *test:* `coordinator.stopScanner('unknown')` is a no-op (no throw).

*UI component test in `tests/unit/ConfigureScanner-remove.test.tsx`
(matching the existing `tests/unit/ConfigureScanner.test.tsx` pattern;
React Test Library + happy-dom):*

- *test:* clicking the Remove button on a scanner row calls
  `window.electron.graviscan.disableScanner(scannerId)`.
- *test:* on success, a success toast appears (mock the toast context)
  with copy `"Scanner removed."`.
- *test:* on failure (IPC returns `{ ok: false, error }`), an error
  toast appears with the returned error message.
- *test:* a disabled scanner row disappears from the visible scanner
  list (because the get-scanner-status query filters
  `enabled=true`).

**Checklist:**

- [ ] 9.1 Write the tests above
- [ ] 9.2 Add `graviscan:disable-scanner` IPC handler
- [ ] 9.3 Add `coordinator.stopScanner(id)` method
- [ ] 9.4 Add Remove button to scanner row in `ConfigureScanner.tsx`
      (and/or `ScannerConfigSection.tsx`)
- [ ] 9.5 Update TS types in `src/renderer/types/electron.d.ts`
- [ ] 9.6 `npm run test:unit` passes; manual smoke (open Configure
      Scanner with a stale row, click Remove, confirm it disappears)

---

## Task 10 — Predictive cadence warning banner (ui-management-pages)

**Goal:** Add a small pure-function helper `estimateCycleSeconds()`
and an amber banner on `ScanControlSection.tsx` that appears when the
estimate exceeds the configured interval.

The estimate formula uses the empirical numbers from the investigation
summary: at 1200 dpi 140×140 mm, ~82 s per plate. Scales roughly
linearly with DPI for the bytes-bound case (sub-linear in practice;
the formula's job is order-of-magnitude flagging, not precision).

**TDD — tests to write FIRST in
`tests/unit/cadence-estimator.test.ts`:**

The formula is specified in `design.md` Decision 7 (per-plate
constant is ~102 s at 1200 dpi 140×140 mm, derived from the 4-plate
production run's cycle-gap median of 418 s in investigation summary
Section 3 Table 3). Tests check order-of-magnitude correctness within
±15% of empirical anchors, not precise values:

- *test:* `estimateCycleSeconds({platesPerScanner: 2, scannerCount: 5,
  dpi: 1200, regionMm: {w: 140, h: 140}})` returns a value in
  `[180, 240]` s (2 plates × ~102 s/plate ≈ 204 s; the empirical
  honored 5-min config has 300 s cycles but those include warmup).
  Note this WILL fit a 5-minute interval (banner hidden).
- *test:* `estimateCycleSeconds({platesPerScanner: 4, scannerCount: 5,
  dpi: 1200, regionMm: {w: 140, h: 140}})` returns a value in
  `[350, 470]` s (4 × ~102 ≈ 408 s; matches summary's 418 s anchor
  within ±15%). Note this will NOT fit a 5-minute interval (banner
  shown).
- *test:* lower DPI shrinks the estimate roughly proportionally:
  `estimate({...dpi: 800})` is strictly less than
  `estimate({...dpi: 1200})` for the same other inputs.
- *test:* smaller region shrinks the estimate: `estimate({...regionMm:
  {w:140,h:100}})` is strictly less than `estimate({...regionMm:
  {w:140,h:140}})`.
- *test:* `scannerCount` does NOT affect the estimate (scanners run in
  parallel per investigation summary Section 3):
  `estimate({...scannerCount: 1}) === estimate({...scannerCount: 5})`.

*Component (`tests/unit/scan-control-cadence-warn.test.tsx`):*

- *test:* with cycle estimate > interval, the warning banner is
  rendered with the expected copy.
- *test:* with cycle estimate ≤ interval, the warning banner is NOT
  rendered.
- *test:* changing the DPI or platesPerScanner re-evaluates the
  warning (reactive).

**Checklist:**

- [ ] 10.1 Write the tests above
- [ ] 10.2 Implement `estimateCycleSeconds()` in
      `src/renderer/lib/cadenceEstimator.ts` (or similar)
- [ ] 10.3 Wire the estimate + banner into `ScanControlSection.tsx`
- [ ] 10.4 Reuse the amber `bg-amber-50 border-amber-300` Tailwind
      classes from existing warning patterns
      (`ConfigStatusBanner.tsx:82-123`)
- [ ] 10.5 `npm run test:unit` passes; manual smoke (set 4-plate +
      5-min interval, confirm banner appears; switch to 2-plate,
      confirm banner disappears)

---

## Task 11 — Cross-cutting: spec deltas, lint, type-check, README

**Goal:** Ensure the proposal's spec deltas are in sync with the
implementation, all linters pass, and operator-facing docs reflect the
new env vars.

**Checklist:**

- [ ] 11.1 `openspec validate add-v600-wedge-followups --strict` passes
- [ ] 11.2 `npm run lint` passes
- [ ] 11.3 `npm run lint:python` passes (black, ruff, mypy)
- [ ] 11.4 `npx tsc --noEmit` passes
- [ ] 11.5 `npm run test:unit` (TS) passes with coverage ≥ 50%
- [ ] 11.6 `pytest python/tests/` passes with coverage ≥ 80%
- [ ] 11.7 `npm run test:integration` passes (cross-platform with
      GRAVISCAN_MOCK=true)
- [ ] 11.8 README has a new "Environment variables" subsection
      documenting `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL` and
      `LIBUSB_ENDPOINT_RECOVERY`
- [ ] 11.9 `.env.example` exists at repo root with placeholders for
      both new vars and a comment block warning never to commit a
      real value
- [ ] 11.10 `git log -p` spot-check: no `.env` and no real webhook URL
      appears in any commit

---

## Task 12 — Hardware validation on the rig (manual, gated on Task 4 + Task 6)

**Goal:** Validate the libusb shim and Slack hook against real hardware
before the PR is opened. Cannot be automated in CI.

**Checklist:**

- [ ] 12.1 Confirm no active continuous session is running on the rig
      (`ps -ef | grep scan_worker`, `sqlite3 ~/.bloom/data/bloom.db`
      check for `GraviSession` in active state)
- [ ] 12.2 Deploy the branch to the rig's dev checkout
      (`/home/graviscan/.dev/bloom-desktop`)
- [ ] 12.3 Build the libusb shim on the rig
      (`gcc -shared -fPIC -ldl ...` per the Makefile from Task 4)
- [ ] 12.4 Run a short continuous session: 5 minutes × 1 scanner ×
      4-plate × 1200 dpi 140×140 mm. Confirm no regression in scan
      success rate.
- [ ] 12.5 Verify shim init log line on stderr: "endpoint recovery: on"
- [ ] 12.6 Set `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL` in `~/.bloom/.env`
      and verify the env-var is read on startup (check log)
- [ ] 12.7 Inject a synthetic scan-error event matching one of the
      wedge signatures (via a dev IPC or by manually crashing one
      scanner). Confirm exactly ONE Slack message arrives, with the
      expected fields.
- [ ] 12.8 Re-inject within 60 s; confirm rate limit suppresses the
      second message.
- [ ] 12.9 Set `LIBUSB_ENDPOINT_RECOVERY=false` and confirm the shim
      log line shows "endpoint recovery: off" on next startup.
- [ ] 12.10 If a real wedge happens during validation: capture the
      Slack message, scan log, and stderr to attach to the PR body.
