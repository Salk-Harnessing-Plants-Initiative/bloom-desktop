## ADDED Requirements

### Requirement: scan-error Event Payload Extended with Timing and Bytes Fields

The `python/graviscan/scan_worker.py` worker SHALL emit `scan-error` events with two new payload fields in addition to the existing fields (`type`, `scanner_id`, `plate_index`, `job_id`, `error`):

- `bytes_received: int` — number of image bytes successfully read from
  the device before failure. `0` when the failure occurs before any
  bytes are transferred (e.g., `sane.start()` raises).
- `wall_seconds: float` — elapsed seconds from scan start to error
  emission. Measured via `time.monotonic()` (not wall-clock time).

These fields are required by the `WedgeDetector` module's
`device_io_120s_zero_bytes` signature. They are additive and do not
break existing consumers of `scan-error` events.

#### Scenario: scan-error includes bytes_received and wall_seconds

- **GIVEN** a SANE scan fails mid-stream after transferring 5 MB of
  data over 87 seconds
- **WHEN** the worker emits a `scan-error` event
- **THEN** the event payload SHALL include `bytes_received: 5242880`
  (or the actual bytes count) and `wall_seconds: 87.x`
- **AND** SHALL still include the existing fields unchanged

#### Scenario: zero-byte failure reports bytes_received=0

- **GIVEN** a SANE scan fails before any image data is transferred
  (e.g., `sane.start()` raises `LIBUSB_ERROR_TIMEOUT`)
- **WHEN** the worker emits the `scan-error` event
- **THEN** `bytes_received` SHALL be `0`
- **AND** `wall_seconds` SHALL be the elapsed time from scan start to
  emit (typically ~120 s for a libusb-timeout failure)

---

### Requirement: V600 Wedge Detection from Scan-Error Events

The system SHALL provide a `WedgeDetector` module in
`src/main/wedge-detector.ts` that subscribes to scan-error events from
the scan-coordinator and emits a `wedge-detected` event when any of
three signatures is observed. Detection SHALL be event-driven (not
exit-code-driven), matching the existing pattern where SANE/scanimage
exceptions are emitted as `scan-error` events from
`python/graviscan/scan_worker.py`.

The three signatures are:

1. **`sane_start_invalid`** — the scan-error event's `error.message`
   field contains the substring `sane_start: Invalid argument`.
2. **`device_io_120s_zero_bytes`** — the scan-error event's
   `error.message` contains `Error during device I/O`, AND its
   `bytes_received` field is `0`, AND its `wall_seconds` field is
   `>= 120` (matching the empirically-observed libusb timeout
   threshold from investigation summary Section 1.2).
3. **`consecutive_failures`** — two or more scan-error events from the
   same `scanner_id` are observed within the same scan cycle (the
   counter resets on `cycle-start`).

The detector SHALL be pure logic: no I/O, no network calls, no
database writes. It SHALL be deterministic — feeding the same event
sequence twice produces identical `wedge-detected` output.

#### Scenario: sane_start signature emits one wedge event

- **GIVEN** a `WedgeDetector` instance
- **WHEN** a scan-error event arrives with `error.message` containing
  `sane_start: Invalid argument`
- **THEN** the detector SHALL emit exactly one `wedge-detected` event
  with `signature='sane_start_invalid'`
- **AND** the emitted event SHALL include the `scanner_id`,
  `session_id`, and `cycle_number` from the source scan-error event

#### Scenario: device-I/O signature requires all three sub-conditions

- **GIVEN** a `WedgeDetector` instance
- **WHEN** a scan-error event arrives with `error.message` containing
  `Error during device I/O` but `bytes_received > 0`
- **THEN** the detector SHALL NOT emit a `wedge-detected` event for the
  `device_io_120s_zero_bytes` signature (the signature requires all
  three sub-conditions: message match + zero bytes + ≥100 s wall)
- **AND** the detector MAY still emit a `consecutive_failures` event if
  the cycle counter reaches threshold

#### Scenario: consecutive-failures counter is per-scanner per-cycle

- **GIVEN** a `WedgeDetector` instance
- **AND** a cycle is in progress
- **WHEN** scan-error events arrive for scannerId `A`, then `B`, then
  `A` again (all within the same cycle)
- **THEN** the detector SHALL emit one `wedge-detected` event for `A`
  with `signature='consecutive_failures'` (because `A` reached
  count 2)
- **AND** the detector SHALL NOT emit a `wedge-detected` event for `B`
  (because `B` only reached count 1)

#### Scenario: cycle boundary resets the counter

- **GIVEN** a `WedgeDetector` instance
- **AND** scannerId `A` has emitted one scan-error in cycle 1
- **WHEN** a `cycle-start` event arrives (cycle 2 begins)
- **AND** scannerId `A` emits one more scan-error in cycle 2
- **THEN** the detector SHALL NOT emit a `consecutive_failures` event
  (the counter reset on `cycle-start`)

#### Scenario: detector is deterministic and idempotent

- **GIVEN** a fixed sequence of scan-error and cycle-start events
- **WHEN** the events are replayed through two independent
  `WedgeDetector` instances
- **THEN** both instances SHALL emit identical `wedge-detected` event
  sequences (same order, same payloads)

#### Scenario: same-signature dedup within a cycle

- **GIVEN** a `WedgeDetector` instance
- **WHEN** two `scan-error` events from the same scanner_id `A` arrive
  in the same cycle, both with `error.message` containing
  `sane_start: Invalid argument`
- **THEN** the detector SHALL emit exactly ONE `wedge-detected` event
  with signature `sane_start_invalid` (not two — the same signature
  on the same scanner in the same cycle is deduplicated)

#### Scenario: recovered scan does not emit a wedge

- **GIVEN** a `scan-error` event arrives that matches a wedge signature
  for `(scanner_id=A, plate_index=00)`
- **WHEN** a subsequent `scan-complete` event for the same
  `(scanner_id=A, plate_index=00)` arrives in the same cycle (the scan
  recovered)
- **THEN** the detector SHALL NOT emit a `wedge-detected` event for
  this case
- **AND** the consecutive-failure counter for `A` SHALL still
  reflect the failed attempt (in case a subsequent failure brings the
  counter to threshold within the cycle)

#### Scenario: duplicate cycle-start events are idempotent

- **GIVEN** a `WedgeDetector` instance has counters reset for cycle
  number `N`
- **WHEN** a second `cycle-start` event arrives with the same cycle
  number `N`
- **THEN** the detector SHALL NOT reset counters again (it tracks the
  last-seen cycle number and ignores duplicates)
- **AND** subsequent scan-error events SHALL be tracked against the
  existing per-scanner counts

---

### Requirement: Slack Notification on Wedge Detection

The system SHALL provide a `SlackNotifier` module in
`src/main/slack-notifier.ts` that POSTs a structured message to a
configurable Slack webhook URL when the `WedgeDetector` emits a
`wedge-detected` event. The webhook URL SHALL be loaded from the
`BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL` environment variable via
`config-store.ts`.

If the env var is absent (or empty), the notifier SHALL be a no-op:
no fetch call, no error, no log spam.

The notifier SHALL rate-limit at most one notification per
`(scanner_id, session_id)` per 60 seconds. The rate-limit key is the
tuple — different scanners or different sessions are independent.

The Slack message body SHALL be JSON-encoded with a `text` field
containing all of:

- Scanner ID and display name
- USB path
- Session ID
- Cycle number
- Timestamp (ISO 8601 with timezone)
- The matched wedge signature (one of `sane_start_invalid`,
  `device_io_120s_zero_bytes`, `consecutive_failures`)
- Operator call-to-action: `Physical AC power-cycle required.`
- Link to the investigation summary PDF on Box

An example payload SHALL match the following shape:

```json
{
  "text": "🚨 V600 wedge on Scanner 3 (port 17-2)\nSession: 4e23d765-...\nCycle: 47 of 96\nTime: 2026-05-21T14:32:18-07:00\nSignature: sane_start_invalid\nPhysical AC power-cycle required.\nDetails: https://salkinstitute.box.com/s/rj7dcdv8g8wo6kps1qy36ffaj21cwx0x"
}
```

The fetch request SHALL be bounded by a configurable timeout
(default 10 seconds) using `AbortController` so a hung webhook
cannot block the notifier indefinitely.

A fetch failure (network error, non-2xx status, timeout) SHALL be
logged but SHALL NOT throw or crash the caller. The error log message
SHALL NOT contain the webhook URL, the full error object, or any
request headers — only a sanitized one-line description (e.g.,
`"Slack POST failed: timeout after 10s"` or
`"Slack POST failed: HTTP 503"`). This prevents the webhook URL from
leaking into stderr, log files, or any downstream log aggregation.

#### Scenario: Absent webhook URL disables notifications

- **GIVEN** `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL` is unset
- **WHEN** a `wedge-detected` event arrives
- **THEN** the notifier SHALL NOT call fetch
- **AND** SHALL NOT log an error
- **AND** SHALL NOT throw

#### Scenario: First wedge for a scanner+session triggers a Slack POST

- **GIVEN** `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL` is set to a valid URL
- **AND** no prior notification for `(scanner_id=A, session_id=S)` in
  this process
- **WHEN** a `wedge-detected` event arrives for `(A, S)`
- **THEN** the notifier SHALL issue exactly one fetch POST to the
  webhook URL
- **AND** the POST body SHALL include the scanner ID, USB path, session
  ID, cycle number, signature, timestamp, power-cycle CTA, and Box link

#### Scenario: Rate limit suppresses repeats within 60 seconds

- **GIVEN** the notifier has just notified for `(A, S)` at time T
- **WHEN** another `wedge-detected` event for `(A, S)` arrives at time
  T+30 seconds
- **THEN** the notifier SHALL NOT issue a fetch POST
- **AND** the suppressed event SHALL be counted in an internal
  `suppressedCount` metric for observability

#### Scenario: Rate limit is per (scanner_id, session_id)

- **GIVEN** the notifier has just notified for `(A, S1)`
- **WHEN** a `wedge-detected` event for `(A, S2)` arrives within
  60 seconds (same scanner, different session)
- **THEN** the notifier SHALL issue a fetch POST (different
  rate-limit key)

#### Scenario: Rate limit expires after 60 seconds

- **GIVEN** the notifier has just notified for `(A, S)` at time T
- **WHEN** another `wedge-detected` event for `(A, S)` arrives at time
  T+61 seconds
- **THEN** the notifier SHALL issue a fetch POST

#### Scenario: Fetch failure does not crash

- **GIVEN** `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL` is set to an
  unreachable URL
- **WHEN** a `wedge-detected` event arrives and the fetch rejects
- **THEN** the notifier SHALL log the failure
- **AND** SHALL NOT throw or propagate the error to its caller

#### Scenario: Fetch timeout aborts after configured duration

- **GIVEN** the notifier has a timeout of 10 seconds
- **WHEN** a `wedge-detected` event arrives and the fetch hangs
- **THEN** the notifier SHALL abort the request via `AbortController`
  after 10 seconds
- **AND** SHALL log a sanitized failure message
- **AND** SHALL NOT block subsequent `notify()` calls

#### Scenario: Error log does not contain the webhook URL

- **GIVEN** the notifier is configured with
  `https://hooks.slack.com/services/SECRET/PATH`
- **WHEN** a fetch fails with any error (network, status, timeout)
- **AND** the notifier writes a log message via `console.error` or
  the bloom logger
- **THEN** the log message SHALL NOT contain the substring
  `hooks.slack.com` or `/services/SECRET` or any portion of the URL
  past the protocol
- **AND** SHALL NOT contain the request body or headers

---

### Requirement: USBDEVFS_RESET Removed from Recovery Path

The `_reopen_device()` recovery path in `python/graviscan/scan_worker.py` SHALL NOT invoke `_reset_usb_device()` (the helper that issues `USBDEVFS_RESET` ioctl via `/dev/bus/usb/<bus>/<dev>`).

Per investigation summary Section 1.2 ("kernel evidence showed every USB read got a response — the failure is inside the scanner, firmware most likely") and issue #228 ("USBDEVFS_RESET makes wedges worse; controller FLR detaches the scanner entirely; only physical AC power-cycle recovers"), the kernel-level reset is actively harmful on V600 wedges and provides no demonstrated benefit on non-wedge transient failures.

The `_reset_usb_device()` method itself MAY remain in the codebase for testability and potential future reconsideration. No production code path SHALL invoke it. The remaining recovery sequence — `device.cancel()` (line 504–507) → `device.close()` (line 508–511) → `sane.exit()` (line 512–516) → `time.sleep(3)` (line 522) → `sane.init()` (line 532) → `sane.open()` (line 533) — SHALL be sufficient for non-wedge transient failures and SHALL fail fast (via `sane.open()` raising) on wedged scanners rather than compounding the wedge via the `USBDEVFS_RESET` ioctl (which per #228 can trigger controller FLR and detach the scanner entirely).

The 3-second `time.sleep()` at line 522 SHALL be preserved as a conservative bus-settle interval. It is annotated with a doc-comment explaining its retained purpose now that `USBDEVFS_RESET` no longer immediately precedes it.

#### Scenario: Recovery path does not call USBDEVFS_RESET

- **GIVEN** a `ScanWorker` whose most recent scan attempt failed
- **WHEN** `_reopen_device()` is invoked on the next scan attempt
- **THEN** the method SHALL NOT invoke `_reset_usb_device()`
- **AND** the method SHALL invoke (in order): `device.cancel()`, `device.close()`, `sane.exit()`, `time.sleep(3)`, `sane.init()`, `sane.open()`
- **AND** the 3-second sleep SHALL be preserved as a bus-settle interval (allows USB bus to quiesce before `sane.init()`)
- **AND** the existing 3-attempt retry-with-backoff loop around `sane.open()` (lines 530–550) SHALL be preserved

#### Scenario: _reset_usb_device method preserved for testability

- **GIVEN** the codebase after this change
- **WHEN** a test or maintenance script imports `_reset_usb_device` from `scan_worker`
- **THEN** the method SHALL still exist on the `ScanWorker` class
- **AND** SHALL behave identically to its current implementation (issues USBDEVFS_RESET on Linux, silent skip on other platforms)
- **AND** SHALL carry a doc-comment explaining why no production code calls it

#### Scenario: Non-wedge transient failure still recovers

- **GIVEN** a scanner is healthy but a single scan fails (e.g., SANE busy, transient bus contention)
- **WHEN** `_reopen_device()` runs without USBDEVFS_RESET
- **THEN** `sane.init()` + `sane.open()` SHALL succeed (existing retry-with-backoff logic preserved)
- **AND** the next scan attempt in the outer retry loop SHALL proceed normally

---

### Requirement: libusb Endpoint Recovery Wrapper

The `src/main/native/libusb-filter.c` LD_PRELOAD shim SHALL intercept
`libusb_bulk_transfer` in addition to the existing `libusb_open`
interception. On `LIBUSB_ERROR_TIMEOUT` or `LIBUSB_ERROR_PIPE` for an
IN endpoint (endpoint address has the high bit `0x80` set), the
wrapper SHALL call `libusb_clear_halt()` on the endpoint before
returning the error to the caller.

The wrapper SHALL be controlled by the `LIBUSB_ENDPOINT_RECOVERY`
environment variable:

- `LIBUSB_ENDPOINT_RECOVERY=false` ⇒ wrapper is a pass-through (no
  `libusb_clear_halt` call).
- Any other value (or unset) ⇒ wrapper is active (default-on).

The shim SHALL log a single init-time message to stderr indicating
whether endpoint recovery is on or off:

```
[libusb-filter] endpoint recovery: on
```

`src/main/scanner-subprocess.ts` SHALL pass `LIBUSB_ENDPOINT_RECOVERY`
to the subprocess environment when LD_PRELOAD is set (Linux, non-mock).

#### Scenario: Endpoint recovery active by default

- **GIVEN** `LIBUSB_ENDPOINT_RECOVERY` is unset
- **AND** the shim is loaded via LD_PRELOAD into a process
- **WHEN** the shim initializes
- **THEN** the shim SHALL log `endpoint recovery: on` to stderr
- **AND** subsequent `libusb_bulk_transfer` calls that return TIMEOUT
  or PIPE for an IN endpoint SHALL invoke `libusb_clear_halt()` on
  that endpoint

#### Scenario: Explicit opt-out via env var

- **GIVEN** `LIBUSB_ENDPOINT_RECOVERY=false`
- **AND** the shim is loaded via LD_PRELOAD
- **WHEN** the shim initializes
- **THEN** the shim SHALL log `endpoint recovery: off` to stderr
- **AND** subsequent `libusb_bulk_transfer` calls SHALL NOT trigger
  `libusb_clear_halt()` regardless of return code

#### Scenario: Non-IN-endpoint timeout does not call clear_halt

- **GIVEN** endpoint recovery is active
- **WHEN** `libusb_bulk_transfer` is called with an OUT endpoint
  (high bit `0x80` clear) and returns `LIBUSB_ERROR_TIMEOUT`
- **THEN** the shim SHALL NOT call `libusb_clear_halt()`
  (clear-halt-on-out is not the documented recovery for OUT
  endpoints)

#### Scenario: TypeScript env-var injection skips non-Linux platforms

- **GIVEN** the main process is running on macOS or Windows
- **WHEN** `ScannerSubprocess.spawn()` is called
- **THEN** the subprocess env SHALL NOT contain `LIBUSB_ENDPOINT_RECOVERY`
  (and SHALL NOT contain `LD_PRELOAD` — pre-existing platform guard
  remains in effect)

---

### Requirement: Scanner Resolution Runtime Validation

The Python scan worker (`python/graviscan/scan_worker.py`) SHALL
maintain an authoritative validated DPI set:

```python
V600_VALIDATED_DPI = {200, 400, 600, 800, 1200, 1600}
```

Before setting `x_resolution` and `y_resolution` on the SANE device,
the worker SHALL check whether the requested DPI value is in the
validated set. If not, the worker SHALL:

1. Log a warning to stderr including the requested value and the
   validated set.
2. Emit an `EVENT:` line on stdout with a documented JSON shape:

   ```json
   {
     "type": "dpi-warning",
     "scanner_id": "<scanner_id>",
     "requested_dpi": <int>,
     "validated_set": [200, 400, 600, 800, 1200, 1600],
     "timestamp": "<ISO 8601 with timezone>"
   }
   ```

3. Proceed with the scan attempt, passing the requested DPI value
   UNMODIFIED to `device.x_resolution` and `device.y_resolution`. The
   worker SHALL NOT clamp the value to the maximum validated DPI —
   the SANE backend may round internally, and the worker's job is to
   warn, not silently alter the operator's request.

This is defense-in-depth against future code paths that might bypass
the trimmed UI dropdown (e.g., programmatic config imports).

#### Scenario: Validated DPI proceeds silently

- **GIVEN** the worker is asked to scan at `resolution=1200`
- **WHEN** the worker reaches the DPI-setting step
- **THEN** the worker SHALL NOT log a warning
- **AND** SHALL NOT emit a `dpi-warning` event
- **AND** SHALL proceed to set `x_resolution=1200` and
  `y_resolution=1200`

#### Scenario: Unvalidated DPI logs and emits warning

- **GIVEN** the worker is asked to scan at `resolution=3200`
  (outside the validated set)
- **WHEN** the worker reaches the DPI-setting step
- **THEN** the worker SHALL log a stderr warning containing the
  requested value and the validated set
- **AND** SHALL emit `EVENT:` JSON with type `dpi-warning` and
  `requested_dpi=3200`
- **AND** SHALL proceed to attempt the scan

---

### Requirement: Coordinator Single-Scanner Spawn API

The `ScanCoordinator` class SHALL expose `addScanner(config)` and
`hasWorker(scannerId)` public methods.

- `addScanner(config: ScannerConfig): Promise<void>` — spawns a
  `ScannerSubprocess` for the given config and adds it to the
  subprocess map. If a worker for `config.scannerId` is already in
  the map and in `ready` state, this is a no-op. The `ScannerConfig`
  type is the existing shared type at `src/types/graviscan.ts`. When
  `isScanning === true`, the spawn request SHALL be queued internally
  and processed at the start of the next cycle (after
  `cycle-complete`) so that mid-scan event-loop traffic is not
  disrupted.
- `hasWorker(scannerId: string): boolean` — returns `true` if the
  subprocess map contains a worker for that scanner_id AND the
  worker is in `ready` state. Returns `false` otherwise (missing,
  `initializing`, or `dead`).

The existing `initialize(scanners[])` method SHALL be refactored to
use `addScanner()` internally so worker spawn logic lives in one
place.

#### Scenario: addScanner spawns one worker without disturbing existing

- **GIVEN** a `ScanCoordinator` with workers in `ready` state for
  scannerIds `[A, B]`
- **WHEN** `addScanner({scannerId: 'C', ...})` is called
- **THEN** a new `ScannerSubprocess` SHALL be spawned for `C`
- **AND** workers for `A` and `B` SHALL NOT be torn down or respawned
- **AND** after the spawn settles, `hasWorker('A')`, `hasWorker('B')`,
  and `hasWorker('C')` all return `true`

#### Scenario: addScanner is idempotent for already-ready workers

- **GIVEN** a `ScanCoordinator` has a `ready` worker for scannerId `A`
- **WHEN** `addScanner({scannerId: 'A', ...})` is called
- **THEN** the existing worker SHALL be reused (no new subprocess
  spawned)
- **AND** the method SHALL resolve without error

#### Scenario: hasWorker semantics

- **GIVEN** a `ScanCoordinator` has subprocesses in different states
- **WHEN** `hasWorker(scannerId)` is queried
- **THEN** it SHALL return `true` only if the worker is in `ready`
  state
- **AND** it SHALL return `false` for `initializing`, `dead`, or
  missing workers

#### Scenario: addScanner during active scan is queued

- **GIVEN** a `ScanCoordinator` with `isScanning === true` (a cycle
  is in flight)
- **WHEN** `addScanner({scannerId: 'C', ...})` is called
- **THEN** the coordinator SHALL NOT immediately spawn a new
  subprocess
- **AND** the request SHALL be appended to an internal
  `pendingAdditions` queue
- **AND** the method's returned `Promise` SHALL resolve once the
  spawn completes (i.e., on the next cycle boundary)
- **AND** after the next `cycle-complete` event, the queued spawn
  SHALL execute and `hasWorker('C')` SHALL return `true`

---

### Requirement: Coordinator Stop-Scanner API

The `ScanCoordinator` class SHALL expose
`stopScanner(scannerId): Promise<void>` to support per-scanner
shutdown without affecting other workers. The method SHALL kill the
subprocess (or send quit + force-kill after timeout), remove the
entry from the subprocess map, and resolve. If no worker exists for
`scannerId`, the method SHALL resolve without error (idempotent).

#### Scenario: stopScanner removes one worker

- **GIVEN** a `ScanCoordinator` with workers for `[A, B]`
- **WHEN** `stopScanner('A')` is called
- **THEN** the worker for `A` SHALL be killed and removed from the
  subprocess map
- **AND** the worker for `B` SHALL be unaffected
- **AND** after the call, `hasWorker('A')` returns `false` and
  `hasWorker('B')` returns `true`

#### Scenario: stopScanner on unknown id is a no-op

- **GIVEN** a `ScanCoordinator` with no workers
- **WHEN** `stopScanner('does-not-exist')` is called
- **THEN** the method SHALL resolve without error
