# Design — fix GraviScan's stale USB address on scanner reconnect

## Context

A physical power-cycle is the only way to clear a V600 wedge (#228), and it always
re-enumerates the device at a new USB device number. Both of GraviScan's reconnect paths —
the operator's Retry button and the worker's own `_reopen_device()` — rebuild their SANE
device name from a value captured before that happened. Full evidence chain in `proposal.md`.

Two hardware constraints shape every decision below.

**The V600 exposes no usable `iSerial`** (#182's 2026-05-06 comment, confirmed across all five
rig scanners): *"the USB path is the ONLY stable identifier for a physical port across
reconnects/resets… there's no scanner-side identifier we could use instead."* So `usb_port` is
the terminal identity tier for this hardware, and a `firmware_serial` tier stays a future
insertion point (#219, #203 Option B). That ladder is not invented here — the stranded
`add-scanner-firmware-serial-identity` proposal (commit `5e294cd`, PR #196) specifies
`firmware_serial → usb_port → composite`, with an explicit note that the V600 returns
`iSerial 0` and the system must degrade to `usb_port`-primary.

**A device-level USB reset makes V600s worse, not better.** A rig test of `pyusb dev.reset()`
took 2/5 working scanners to 0/5; all five then enumerated and opened but timed out on every
bulk read, and needed physical power-cycles. This is already codified as `scanning/spec.md:2655`
("USBDEVFS_RESET Removed from Recovery Path"), and `scan_worker.py:757-760` records the removal
in-line. No design here reintroduces one.

**Deliberate divergence from #196's ladder, recorded:** its fallback tier is the full composite
`(vendor_id, product_id, name, usb_bus, usb_device)`; this change's fallback is the bare
bus/device pair. On the V600 rig all five scanners share `vendor_id`, `product_id` and `name`,
so the composite degenerates to exactly bus+device and the two are functionally identical
today. The reduction is safe only while that holds; if mixed models ever share a rig, the
fallback should be widened. #196 also lists `disableMissingScanners` in its uniformity set; that
function matches on `usb_port` only and has no fallback, so it is unaffected — see Decision 6.

## Decisions

### Decision 1 — a shared helper module, not re-detection inlined in `retryScanner()`

Re-detection inlined in `retryScanner()` would be the smallest diff, but `session-handlers.ts`
deliberately carries almost no DB dependency (its own comment at `:25-28`), and there are other
call sites that want the same "refresh this one scanner's address" operation — `resetUsb()`'s
loop (Decision 2), the spawn-time resolver (Decision 3), and #159's future "Start Scan must
check real scanner readiness" work.

A consequence worth naming: task 2.2 widens the retry path's DB interface with an `update`
method, which is in tension with that read-only rationale. Resolved by declaring
`ScannerUsbRefreshDb` (read + write) in the refresh module and having `ScannerRetryLookupDb`
extend it, rather than growing a write method onto a lookup interface.

### Decision 2 — the shared unit is the pure matcher, not the IO wrapper

`refreshScannerUsbAddress()` performs IO in a fixed order: read row → detect → match → write.
`resetUsb()` needs the same *matching* but must keep its **single** detection pass across all
scanners; calling the IO wrapper in its loop would spawn detection once per scanner and give
each row a different view of the bus.

So the extracted, shared unit is the pure `matchScannerByPort(detected, row)`. `resetUsb()`
keeps its own detection call and its own loop.

**Behavioural caveat, not identity:** `resetUsb()` currently builds a `Map<usb_port, DetectedScanner>`
(`scanner-handlers.ts:688-704`) and does O(1) lookups; the shared matcher is a linear `find`.
`Map.set` keeps the **last** entry for a duplicate key while `find` returns the **first**. For
real detection this is moot — `detectEpsonScanners` already dedupes by port
(`lsusb-detection.ts:193-211`). It is **not** moot in mock mode, where `resetUsb`'s mock branch
synthesises `usb_port: s.usb_port || \`1-${i + 1}\`` (`:669`), so a row with `usb_port: '1-2'`
plus a null-port row at `i === 1` produces two entries on `'1-2'`. The tie-break is therefore
specified (prefer `enabled`, then most recent) rather than left to iteration order, and tested.

**Rejected:** calling `resetUsb()` itself from the retry path. It would `coordinator.shutdown()`
the whole fleet and re-`initialize()` it to recover one scanner mid-session, losing every other
scanner's in-flight row.

Note the justification for that rejection is *not* "the two are mutually exclusive by
specification", which an earlier draft of this document claimed. `scanning/spec.md:2379` and
`ui-management-pages/spec.md:2170-2174` gate Reset USB **in the renderer only**;
`graviscan:reset-usb` (`register-handlers.ts:251`) and `resetUsb()` itself have no `isScanning`
guard, and the only such guard in that file is on `graviscan:upload-all-scans` (`:433`). See
Decision 7.

### Decision 3 — resolve the address at spawn time, not only at click time

`retryScanner()` requires an active session, and `isScanning` is true for `'scanning'` **and**
`'waiting'` (`scan-coordinator.ts:207-209`), so a retry during any interval session takes
`addScanner()`'s queued branch (`:377-416`). That branch captures `config` in a closure and
spawns on the next `cycle-complete` — which `register-handlers.ts:137-141` describes in the
repo's own words as "potentially hours for a continuous session".

Refreshing only inside `retryScanner()` would therefore make the address correct *at refresh
time*, not at use time. `ScannerConfig` gains an optional `resolveSaneName` that the shared
spawn path calls immediately before constructing the `ScannerSubprocess`.

The window is not merely theoretical, and #366 is what makes it likely: a queued retry gives
the operator no feedback for a full interval, which is exactly what prompts a second
power-cycle — and a second power-cycle re-enumerates the device, invalidating the first
refresh. Meanwhile `retriesInFlight` refuses the second retry for that whole period. So the
staleness returns through a path the operator is actively pushed toward. Resolve-at-spawn
removes it regardless of how long the queue takes, which is why this is the right fix rather
than bounding the queue (that is #366's job).

Both refreshes are kept: the one in `retryScanner()` gives immediate operator feedback and
corrects the DB row; the resolver guarantees correctness at the moment of use.

### Decision 4 — detection on this path must be asynchronous

`detectEpsonScanners()` is `execFileSync` twice (`lsusb-detection.ts:148` and `:161`, each
`timeout: 5000`) — up to ~10s with the **main-process event loop fully blocked**. Refresh runs
during an active session, where that is not latency but a stall: no IPC handler runs, no
subprocess stdout line is parsed, `scanInterval`'s sleep is delayed (pushing the next cycle's
start out with no drift compensation — a real st→st interval error in a gravitropism series),
and other scanners' row timers resume late. Because libuv runs the timers phase before the poll
phase, a row whose `cycle-done` arrived on the pipe *during* the stall but whose
`SCAN_ROW_TIMEOUT_MS` also expired during it can settle as `'timeout'` — the entry condition
for #371's permanent false `MISSING` on an unrelated, healthy scanner.

So a new async detection variant (promisified `execFile`) is added and used by refresh. The
three existing synchronous call sites are untouched; this is additive.

That the 5s `lsusb -t` stall is most plausible exactly when the USB subsystem has a wedged
device on it — the only situation this feature runs in — is what moves this from a nicety to a
requirement.

### Decision 5 — `no-stable-port`, `not-detected` and `row-missing` fail hard; `detection-failed` retries first

`usb_port` is fragile: nullable, never backfilled by any migration, no unique constraint or
index, written by exactly one code path, and returned as `''` when `lsusb -t` fails
(`lsusb-detection.ts:185`).

- `not-detected` — fail. Nothing is on the bus; the retry cannot succeed, and attempting it
  burns a queued `addScanner` that per #366 can hold the IPC open for a whole cycle.
- `no-stable-port` — fail. After a power-cycle the stored address is *always* wrong, so a
  fallback is a guaranteed false positive that reports success and then fails opaquely.
- `row-missing` — fail, with its own status. Folding it into `not-detected` would produce
  "no scanner detected at port `undefined`", and the retry requirement separately mandates a
  distinct not-found message.
- `detection-failed` — **retry up to three times with backoff first.** Here the scanner may be
  perfectly healthy and the *diagnostic tool* failed; `execFile` with a 5s timeout can fail
  transiently under exactly the bus contention a wedge creates. Refusing on a single failure
  would cost a whole run's remaining timepoints for a reason unrelated to the scanner.

**Rejected:** falling back to the stored address. Superficially "no worse than today", but it
guarantees the same misleading `Failed to open device after 3 attempts` while hiding the cause.

**Rejected:** a singleton heuristic ("one detected device and one enabled row ⇒ same scanner").
On a multi-scanner rig it can bind a row to the wrong physical scanner — the precise error class
this change removes.

**The remedy message must not name Detect Scanners while a session is active.** An earlier draft's
`no-stable-port` text said "run Detect Scanners on the Configure Scanner page". That path is
**not** gated on an active scan (unlike Reset USB), and `saveScannersToDB` calls
`disableStaleScannerRows`, which sets `enabled: false` on every enabled row whose `usb_port` is
absent from the current detection set — which, for a wedged scanner that is powered off, is the
wedged scanner itself. Retry would then fail permanently with "Scanner X is disabled". (The
`usb_port === null` half is spared, because `disableStaleScannerRows` skips strictly-null ports
(`scanner-upsert.ts:166`) — but the `''` half is not.) The message now states plainly that the
scanner cannot be recovered in this session. The missing guard is filed separately.

### Decision 6 — the precedence requirement covers two functions, not four

An earlier draft asserted the precedence was "uniform across `matchDetectedToDb()`,
`upsertScannerRow()`, `validateConfig()` and `resetUsb()`" with a retained bus/device fallback.
That is false for half of them: `validateConfig()` (`scanner-handlers.ts:543-563`) and
`resetUsb()` (`:687-704`) are **port-only with no fallback at all**, and this change adds none.
The requirement now scopes the precedence to the two functions that actually have a fallback and
states the other two's port-only behaviour explicitly.

The fallback is gated on the **detected** side's port being unusable, not on a port lookup
missing — otherwise a scanner on a genuinely new port falls through to bus/device and takes over
whichever row shares its device number, which is the hazard, not the fix.

### Decision 7 — the `usb_bus == null` guard was doing a second job; replace it explicitly

`retryScanner`'s null-columns check carried the comment "likely mid reset-usb"
(`session-handlers.ts:366-370`) and was, in practice, the only main-process detection of a retry
racing a `reset-usb` — `resetUsb()` nulls both columns at `:646-649`, then sleeps 5s before
rewriting them at `:712-718`. Decision 6's predecessor removed that guard as "a behavioural
improvement" without noticing what it also deleted.

Since `graviscan:reset-usb` has no `isScanning` guard, that interleaving is reachable over IPC.
Rather than infer the state from null columns — which is unreliable in both directions — the
retry path treats null columns as recoverable (refresh supplies the address, which is the
improvement) and the missing handler-level guard is filed as its own issue. This change does not
add an `isScanning` guard to `reset-usb`, because doing so would alter Reset USB's contract and
belongs with that issue.

### Decision 8 — the worker re-resolves from sysfs, and can only fail safe

`scan_worker.py` must recover without the coordinator's help, so it needs its own resolution
path. sysfs is used rather than `lsusb`: the kernel names `/sys/bus/usb/devices/<bus>-<port-path>`
with exactly the string `buildUsbPort()` already produces (`lsusb-detection.ts:128-130`), so
`busnum` and `devnum` are two plain file reads with no subprocess, no parsing and no new
dependency. `idVendor`/`idProduct` in the same directory are checked before the resolved address
is trusted, so a different device occupying the port cannot capture the worker.

Every failure mode — no `--usb-port`, empty port, absent directory, unreadable file, mismatched
IDs, malformed contents — falls back to the spawn-time name and behaves exactly as today. The
design constraint is that re-resolution can only **widen** the set of recoverable failures; it
must not be able to turn a currently-recoverable failure into a new one.

This is the half of #182 the issue was originally filed about. It also answers the flow #182's
2026-05-06 comment prescribed: `cancel() → close() → exit()` (already at `scan_worker.py:743-756`),
**re-query for address changes** and **rebuild the device string** (steps 2 and 3, added here),
then `init() → open()` (already at `:773-774`). Only steps 2-3 were missing.

For the operator-retry half, respawning the subprocess accomplishes the same flow and more — a
fresh process gets a fresh address space and a freshly supplied name. One caveat worth stating:
`ScannerSubprocess.shutdown()` falls back to `SIGKILL` on timeout (`scanner-subprocess.ts:391`),
which skips `cancel()/close()/exit()` entirely, and for a *wedged* worker that is the likely
path, not the exotic one. That is pre-existing behaviour and unchanged here, but it is the reason
half 2 is worth fixing independently: a worker that self-heals never reaches the SIGKILL path.

### Decision 9 — verification is designed around a fault CI cannot reach

CI has only mock mode, and mock scanners are deterministically `usb_bus: 1, usb_device: i + 1`
(`scanner-handlers.ts:51-81`) and never re-enumerate. So CI structurally cannot exercise #182 —
the same limitation `2026-09-17-validate-graviscan-wedge-response-hardware` documented.

The key insight: **a power-cycle is only one *cause*; the fault is a stale address.** That can be
induced deterministically by writing a wrong `usb_device` into the row while the scanner sits
healthy at its current address — #182's 2026-09-16 reproduction with the hardware step removed,
repeatable in unit tests *and* on the rig.

Four layers:

1. **Unit** — the pure matcher, every outcome branch with `detect` injected, the spawn-time
   resolver, and the worker's sysfs re-resolution with a faked sysfs tree.
2. **Mock-mode E2E** — one real-IPC round trip through live Electron, which is the only automated
   check that the widened DB interface is satisfied by the real `PrismaClient` at runtime rather
   than merely at typecheck. This project's standing lesson is that unit tests cannot see that.
3. **Rig, deterministic (unattended)** — induce staleness, retry over IPC, and assert both that
   the call succeeds **and** that the row was corrected **and** that the respawned worker actually
   received the refreshed name. The third assertion is load-bearing: without it the test passes
   even if the queued spawn used a stale captured name, which is precisely the half-fix Decision 3
   exists to prevent. Run against an **interval** session, not `scanOnce`, for the same reason.
4. **Rig, physical (attended, pre-merge)** — one real wedge induction and power-cycle, driven
   through the UI button, to close #279 item 4 on its own terms.

Layer 4 needs a human at the rig; 1-3 do not.

### Decision 10 — #366 stays out

#366 (queued `addScanner` has no timeout; `retriesInFlight` strands the scannerId when the
queued add never settles) lands in the same function. It is deliberately excluded.

PR #365's retrospective is explicit about the cost: that PR was ~15% its stated scope and ~85% an
unrelated coordinator-observability change, and five of its seven review rounds plus every
self-inflicted regression came from the half that did not need to be there. #182 is a correctness
fix on the address; #366 is a liveness fix on the queueing.

**But the interaction is real and runs the other way from the earlier draft's claim.** That draft
checked only whether refresh *worsens* #366; it did not check whether #366 *defeats* refresh. It
does — see Decision 3 — which is why resolve-at-spawn is in scope even though the queue itself is
not. With the resolver in place, refresh is immune to the queue's duration.

Bounded in the other direction too: refresh's detection is now async with a 5s timeout per call
and at most three attempts, and `not-detected`/`no-stable-port`/`row-missing`/`detection-failed`
all return **before** `addScanner`, which strictly reduces the set of paths that can reach #366's
unbounded wait.

Note also that shipping a *working* retry into an unbounded queue means the first successful field
use may still present as a hang. The rig runs record the session state at click time so this is
distinguishable from a regression.

## What was checked and found safe

Recorded so the next reviewer does not re-derive it, and so the next change to touch these columns
inherits the analysis.

- **No mid-session record is made retroactively wrong by the refresh write.** Every reader of
  `usb_bus`/`usb_device` was traced: `retryScanner`, `register-handlers.ts:165-175`,
  `matchDetectedToDb`, `validateConfig`'s mock branch, `resetUsb`, and `ConfigureScanner.tsx:222`
  (display). None feeds a TIFF tag, a `GraviScan` row, a file path or the cloud upload payload.
  GraviScan writes no `metadata.json` (that is CylinderScan). A session's `saneName`s are captured
  in the renderer at page mount.
- **No plate is dropped or duplicated by the retry.** `plates: []` on the respawn is inert
  (`scanOnce` reads `platesPerScanner` from the `startScan` closure, not `ScannerConfig.plates`);
  `stopScanner` settles the in-flight row as `'stopped'` rather than letting it burn the timeout;
  the respawn only takes effect at a cycle boundary; and duplicate rows are prevented by the
  `(session_id, scanner_id, plate_index, cycle_number)` upsert at `database-handlers.ts:216`.
- **`wiring.ts`'s `ScannerLookupDb` reads `usb_port` but not `usb_bus`/`usb_device`**, so it cannot
  race the refresh write.
- **A string-literal discriminant narrows correctly under this repo's `tsconfig`**, which sets only
  `noImplicitAny` — no `strict`, no `strictNullChecks`. A *boolean*-literal discriminant does not,
  which is why `WedgeBanner.tsx:48-53` needs its manual cast. `RefreshOutcome` therefore uses a
  string `status` discriminant deliberately; "simplifying" it to `{ ok: true } | { ok: false }`
  would silently require casts at every call site. And because `null` remains assignable to every
  member type without `strictNullChecks`, the union gives **no** protection against the null
  address in Decision 5 — that is guarded at runtime with `Number.isInteger`, not by the type.

## Risks

| Risk | Mitigation |
|---|---|
| `usb_port` is `''`/null on rows created where `lsusb -t` failed; no migration ever backfilled it | Explicit `no-stable-port` outcome with an actionable, non-destructive message (Decision 5). Rig pre-flight reads the actual stored values **byte-exactly** against live `buildUsbPort()` output, per #243's unresolved notation-drift hypothesis. |
| Duplicate non-empty `usb_port` rows exist on installs the current defect already damaged; `findFirst` is unordered | Deterministic `orderBy: [{ enabled: 'desc' }, { updatedAt: 'desc' }]`, specified and tested. A unique constraint is the real structural fix and is filed, not taken here. |
| Inverting `upsertScannerRow()` changes the write path used by every "Detect Scanners" click | Fallback retained and gated on the detected side; 25 existing tests in `scanner-upsert.test.ts` must stay green; new tests pin the collision in both directions and assert **which query ran first**. Marked BREAKING with an operator pre-upgrade check. |
| Identity follows the *port*, so a physical swap of two same-model scanners misattributes images | Known and accepted (#203); now stated in the spec itself rather than only here, so an auditor reading the standing spec sees the non-guarantee. |
| The `lsusb` dedupe keeps the highest `usb_device` as "most recent"; device numbers are reused and wrap at 127 | After a wrap a ghost could win and refresh would persist a dead address. Pinned as a named assumption with tests (the block has only partial coverage today, not zero). |
| Worker sysfs re-resolution could mis-resolve or throw | Every failure falls back to the spawn-time name; `idVendor`/`idProduct` verified before use; re-resolution can only widen recoverable failures. |
| A test passing only because the mock is more forgiving than production — five instances of this class on PR #365 | Mock-mode's spawn path skips the `/^\d{3}$/` `saneName` validation entirely (`scanner-subprocess.ts:83`), which is how `epkowa:interpreter:null:null` became reachable; guarded explicitly and given its own scenario. Mock row shapes are audited against `prisma/schema.prisma` wholesale. |
| Read-then-write with no transaction; a concurrent "Detect Scanners" is last-write-wins | Each Prisma `update` is its own transaction so no row is torn. Accepted; noted because neither path is gated on an active scan. |

## Deferred, and named so it is not rediscovered as a defect

- `usb_bus`/`usb_device` are **not** audit-grade identity. The audit-grade record is the scan-log
  line, which now carries before *and* after values, the port, the session and the cycle. A durable
  per-rebind record (the `GraviScannerBinding` table from #196's stranded proposal) is deferred:
  it brings append-only enforcement, a reason enum and a confirmation modal, and bundling it would
  repeat exactly the scope split Decision 10 refuses.
- `usb_port` is captured in no per-scan artifact, so an image is not self-describing as to which
  physical scanner produced it. Adding `usb_port` and the device name to the TIFF
  `ImageDescription` is the cheap durable fix and is filed separately.
- `GRAVISCAN_LOG_RETENTION_DAYS` defaults to 180 days, shorter than the typical capture-to-analysis
  interval; raising it on the production rig is a cutover consideration, not a code change.
- `ConfigureScanner.tsx:214-216` sorts ports with `localeCompare`, so `'1-10'` sorts before
  `'1-2'` and positional `Scanner N` labels mis-order. Port-primary matching makes `display_name`
  stickier to ports and therefore makes that mis-sort more visible. Evaluated and deliberately not
  fixed here.
