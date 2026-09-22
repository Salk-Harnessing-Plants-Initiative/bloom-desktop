# Design — fix GraviScan's stale USB address on scanner reconnect

Each decision below states its current position. A short record of positions that earlier
review rounds superseded is at the bottom, so the decisions themselves stay readable.

## Context

A physical power-cycle is the only way to clear a V600 wedge (#228) and always re-enumerates the
device at a new USB device number. Three code paths build a SANE device name from a value
captured before that happened (see `proposal.md`). Evidence chain and the 2026-09-16 hardware
reproduction are in `proposal.md`.

Two hardware constraints shape everything here.

**The V600 exposes no usable `iSerial`** (#182's 2026-05-06 comment, tested on all five rig
scanners), so `usb_port` is the only stable physical identifier. This change depends on
`fix-graviscan-scanner-identity-precedence` having made that key trustworthy first.

**A device-level USB reset makes V600s worse.** A rig test of `pyusb dev.reset()` took 2/5
working scanners to 0/5; all five then enumerated and opened but timed out on every bulk read and
needed physical power-cycles. Codified as `scanning/spec.md:2655`. No design here reintroduces
one.

## Decisions

### Decision 1 — a shared helper module

`session-handlers.ts` deliberately carries almost no DB dependency (its comment at `:25-28`), and
several paths want the same "refresh this one scanner's address" operation. So it lives in its
own module.

The retry path's DB interface must gain an `update` method, which is in tension with that
read-only rationale. Resolved by declaring `ScannerUsbRefreshDb` (read + write) in the refresh
module and having `ScannerRetryLookupDb` extend it. Note TypeScript will not let the derived
interface _narrow_ `graviScanner`'s shape, so the base row type carries the union of fields both
need; the alternative is a confusing "incorrectly extends" error at implementation time.

### Decision 2 — the shared unit is the pure matcher, not the IO wrapper

`resetUsb()` needs the same _matching_ but must keep its **single** detection pass across all
scanners; calling the IO wrapper in its loop would spawn detection per scanner and give each row
a different view of the bus. So the extracted, shared unit is the pure matcher.

`resetUsb()` currently builds a `Map<usb_port, DetectedScanner>` (`scanner-handlers.ts:792-796`);
the matcher is a linear scan. For a duplicate port, `Map.set` keeps the **last** entry and a
linear scan finds the **first**. Real detection dedupes by port (`lsusb-detection.ts:193-211`) so
this cannot arise there — but it _can_ in mock mode, where `resetUsb`'s mock branch synthesises
`usb_port: s.usb_port || \`1-${i + 1}\`` (`:773`). The matcher's tie-break is therefore specified
as first-in-list-order and tested, rather than left to a map's iteration order.

`resetUsb()` is not reusable from the retry path: it would `coordinator.shutdown()` the whole
fleet and re-`initialize()` it to recover one scanner, losing every other scanner's in-flight row.

### Decision 3 — resolve at spawn time, and the three constraints that makes necessary

`retryScanner()` requires an active session, and `isScanning` is true for `'waiting'` too
(`scan-coordinator.ts:207-209`), so a retry during any interval session takes `addScanner()`'s
queued branch and spawns on the next `cycle-complete`. Refreshing only at click time is therefore
a half-fix.

`ScannerConfig` gains an optional `resolveSaneName`. The insertion point is the single
`ScannerSubprocess` constructor site inside `doSpawnSingleScanner`, reached from all three entry
points — `initialize()`, the queued `addScanner` handler, and the idle path — via
`spawnSingleScanner`. Placing it at the constructor rather than at the top of the function means
the reuse-if-ready no-op does not pay a detection, which matters because `initialize()` runs per
scanner.

The window this opens is real and is spelled out in the spec because it is easy to reintroduce:

- **Generation token.** Today `doSpawnSingleScanner` has no `await` on the normal path between
  entry and `subprocesses.set` (`:610`), and `spawnSingleScanner` installs its in-flight guard
  _after_ the body's first synchronous segment (`:481-490`). `stopScanner` deletes that guard
  first and then early-returns if the map has no entry (`:429-433`). An attempt suspended in
  resolution is therefore in neither structure — uncancellable by `stopScanner` and un-awaited by
  `shutdown()`. Two live workers on one scanner, or a worker spawned against a shut-down
  coordinator, both become reachable. A token captured before resolution and re-checked after,
  invalidated by `stopScanner`/`shutdown`, closes it. The hazard is concentrated on the retry
  path, because only configs carrying a resolver take the new await.
- **Resolver timeout.** `SPAWN_READY_TIMEOUT_MS` wraps `spawn()` only. An unbounded resolver
  could leave the in-flight guard set forever, making that `scannerId` un-spawnable for the
  session while `retriesInFlight` holds the operator's button dead.
- **Logged fallback.** Falling back to the enqueue-time name is the _same_ thing Decision 5
  rejects at click time, so it must not be silent. An absent resolver is ordinary and is not
  logged as a failure; a rejection, a validation failure or a timeout is.

A resolved name must also pass the same device-name validation the spawn applies
(`scanner-subprocess.ts:91-103`), and be discarded in favour of `config.saneName` if it does not
— otherwise a malformed resolved name would fail a spawn that would have succeeded, which
contradicts the requirement that resolution cannot fail a spawn.

#### Decision 3a — a spawn-time resolver failure falls back; it does not fail the spawn

Decided 2026-09-21, because Decisions 3 and 5 appear to contradict each other here and the
implementation has to pick one. Decision 5 says a non-`refreshed` refresh outcome must **fail
hard**, since a fallback after a power-cycle is a guaranteed false positive. Decision 3 says a
failing **resolver** must **fall back and log**. On the retry path the resolver wraps exactly the
refresh Decision 5 governs, so the two rules meet on one code path.

**Decision 3 wins: fall back to `config.saneName` and log with the cause.** The two rules apply
at different points and to different populations:

- Decision 5 governs the **click-time** refresh inside `retryScanner()`. That call happens
  **before** `stopScanner`/`addScanner`, and every non-`refreshed` outcome returns
  `{ success: false }` there, so the operator is told the retry failed and no worker is spawned.
  The guaranteed-false-positive case is therefore already refused, and refused at the point where
  a human is reading the result.
- Decision 3a governs the **spawn-time** resolver, which only runs for a config that *already*
  passed the click-time refresh. A failure here is a narrower and later event: the diagnostic
  flaked, or the resolution timed out, in the window between a successful click-time refresh and
  the next `cycle-complete`.

Failing the spawn there would strand the scanner for the rest of the session — it would take the
`initErrors` path with no operator prompt and no further retry, because `retriesInFlight` has
already been released and the wedge entry already dismissed on the reported success. That trades
a *possible* stale address for a *certain* dead scanner, on hardware where a lost scanner costs
the remaining timepoints of a gravitropism series.

The honest cost, stated rather than hidden: the operator was told the retry succeeded, and a
spawn-time fallback can still put a worker on a stale address, which will fail at
`sane.open()` and surface as the ordinary spawn-failure path. That is why **every**
failure-caused fallback is logged with its cause and distinctly from the absent-resolver case
(`design.md` Risks; task 2.7e) — the scan log is what makes this diagnosable after the fact.
`#363` is the issue that would make it *visible* rather than only diagnosable, and Decision 8
already records it as becoming more load-bearing because of this change.

### Decision 4 — detection on this path must be asynchronous

`detectEpsonScanners()` is `execFileSync` twice (`lsusb-detection.ts:148`, `:161`, each
`timeout: 5000`) — up to ~10s with the **main-process event loop fully blocked**. During an
active session that is not latency but a stall: no IPC handler runs, no subprocess output is
parsed, `scanInterval`'s sleep is delayed with no drift compensation, and because libuv runs the
timers phase before the poll phase, a row whose `cycle-done` arrived on the pipe _during_ the
stall but whose `SCAN_ROW_TIMEOUT_MS` also expired during it can settle as `'timeout'` — #371's
entry condition for permanent false `MISSING` on a healthy scanner.

So an async variant is added. It shares one pure parse-and-dedupe core with the synchronous
function, because task-level "same parsing and dedupe, same result shape" is not a guarantee, and
the dedupe block is the one carrying an unfixed device-number-wrap hazard. Only the
`execFile`/`execFileSync` shells differ. The four existing synchronous call sites are untouched —
including `resetUsb()`'s, which is reachable mid-session, and which is left synchronous
deliberately as out of scope.

#### Decision 4a — concurrent resolvers share in-flight work, not a time-based cache

Decided at implementation time, 2026-09-21, replacing this design's own earlier wording ("detection
results are cached for a short TTL", Risks table).

The **goal** is unchanged: N scanners retried at one cycle boundary must not each spawn two `lsusb`
invocations on a bus that already has a wedged device on it. The **mechanism** is: share the
detection promise only while it is still in flight, and clear it the moment it settles.

A TTL was rejected because it retains a **completed** detection. In the one module whose entire
premise is that a cached USB address goes stale the instant a device re-enumerates, holding a
finished result for even a second reintroduces the defect being fixed — a resolver could be handed
a detection captured *before* the power-cycle it is recovering from. That failure would be rare,
silent, and indistinguishable from #182 itself.

In-flight sharing collapses exactly the same burst, has no staleness window at all, and needs no
test-only reset hook exported from production code (a TTL's module-level timestamp leaked between
tests, which is how this was noticed). Pinned in both directions: one test asserts two concurrent
refreshes cause one detection, another asserts two sequential refreshes cause two.

### Decision 5 — which outcomes fail hard, and how the message is phrased

`usb_port` is fragile: nullable, never backfilled, no uniqueness constraint, and returned as `''`
when `lsusb -t` fails. So each non-`refreshed` outcome needs a distinct meaning and message.

- `not-detected`, `no-stable-port`, `row-missing`, `unusable-address` — fail. After a power-cycle
  the stored address is _always_ wrong, so a fallback is a guaranteed false positive that reports
  success and then fails opaquely.
- `detection-failed` — **retry up to three times with backoff first.** Here the scanner may be
  healthy and the _diagnostic_ failed; `execFile` with a 5s timeout can fail transiently under
  exactly the bus contention a wedge creates. Refusing on one failure would cost a run's
  remaining timepoints for a reason unrelated to the scanner.

`unusable-address` exists separately from `no-stable-port` because a non-integer address can occur
on a row whose port is perfectly good — mock mode short-circuits to the row's stored values, and
`resetUsb` leaves those null between clearing and repopulating them. Reporting `no-stable-port`
there would make the mandated operator message a false statement about the row. Without the guard,
`buildSaneName(null, null)` yields `epkowa:interpreter:null:null`, which mock-mode spawning does
**not** validate — `buildSubprocessEnv`'s `/^\d{3}$/` check sits inside a
`platform === 'linux' && !args.mock` branch (`scanner-subprocess.ts:83`) — so a mock retry would
report success on a nonsense device. Runtime-guarded with `Number.isInteger`, not by the type:
this repo's `tsconfig` sets only `noImplicitAny`, so `null` remains assignable to every member of
the union.

**The message must not name Detect Scanners while a session is active.** That path is not gated
on an active scan (unlike Reset USB), and `saveScannersToDB` calls `disableStaleScannerRows`,
which disables every enabled row whose `usb_port` is absent from the current detection set — i.e.
a powered-off wedged scanner, which is the _likeliest_ reason a retry fails. The prohibition
therefore covers `not-detected` as well as `no-stable-port`, not just the latter. The missing
guard is filed separately.

**The message must identify the scanner usefully.** The rig's real row has `display_name: null`
and `name: 'Perfection V600 Photo'` — the model string, identical across all five production
scanners — and `WedgeBanner` renders `display_name ?? scanner_id`, so a naive message degrades to
a UUID at 2am. Preference order is `display_name`, then `usb_port`, then the identifier; `name` is
explicitly unusable for distinguishing scanners.

### Decision 6 — `usb_bus: null` stops being fatal, and what that gives up

With refresh in place, null columns are recoverable from `usb_port`, so the guard moves from
"null ⇒ fail" to "no usable port ⇒ fail".

That guard was also doing a second, undocumented job: it was the only main-process detection of a
retry racing a `reset-usb`, which nulls both columns (`scanner-handlers.ts:750-753`) and then
sleeps 5s before rewriting them. `graviscan:reset-usb` has **no** `isScanning` guard — the only
such guard in `register-handlers.ts` is on `graviscan:upload-all-scans` (`:433`) — so the
interleaving is reachable over IPC even though the renderer gates the button.

The consequence of removing it, stated plainly: a retry landing inside that 5s window will now
recover an address and spawn a worker that opens the device in the middle of a reset whose whole
purpose is to release the USB bus, on hardware where a botched reset re-wedges V600s. Inferring
"reset in progress" from null columns is unreliable in both directions (a retry landing after the
`shutdown()` but before the `updateMany` always slipped past it), so the right fix is a
handler-level guard on `reset-usb` — filed separately. This change removes a partial protection
and ships before its replacement; that is a real, accepted gap rather than a neutral refactor.

### Decision 7 — verification is designed around a fault CI cannot reach

CI has only mock mode, and mock scanners are deterministically `usb_bus: 1, usb_device: i + 1`
(`scanner-handlers.ts:57-108`) and never re-enumerate. So CI structurally cannot exercise #182.

The insight: **a power-cycle is only one _cause_; the fault is a stale address.** That can be
induced deterministically by writing a wrong `usb_device` while the scanner sits healthy — the
2026-09-16 reproduction with the hardware step removed.

1. **Unit** — the pure matcher, every outcome branch with detection injected, the resolver
   including its token/timeout/fallback behaviour.
2. **Mock-mode E2E** — one real-IPC round trip through live Electron, asserting the handler
   resolves cleanly with no unhandled main-process error. **It does not verify the widened DB
   interface**: mock mode short-circuits before any write, so `update` is never reached. Claiming
   otherwise would be exactly the "the mock is more forgiving than production" trap this project
   has hit five times. Real-Prisma `update` is verified at layer 3 only.
3. **Rig, deterministic (unattended)** — induce staleness, retry over IPC against an **interval**
   session, and assert three things: the call succeeds, the row was corrected, **and the respawned
   worker actually received the refreshed name** (capture its `--device`/`SANE_USB_FILTER`). The
   third is load-bearing: without it the test passes even when the queued spawn used a stale
   captured name, which is the half-fix Decision 3 exists to prevent.
4. **Rig, physical (attended, pre-merge)** — one real wedge induction and power-cycle through the
   UI button, to close #279 item 4 on its own terms.

### Decision 8 — #366 stays separate but gates the same milestone

#366 (queued `addScanner` has no timeout; `retriesInFlight` strands the id when the queued add
never settles) is in the same function and is excluded on the PR #365 lesson: that PR was ~15% its
stated scope and ~85% an unrelated change, and five of seven review rounds plus every
self-inflicted regression came from the half that need not have been there. #182 is correctness;
#366 is liveness.

Two honest qualifications:

- **#366 defeats refresh unless Decision 3 ships.** The queued wait gives the operator no
  feedback, which is what prompts a second power-cycle, which re-enumerates the device and
  invalidates the click-time refresh — while `retriesInFlight` refuses the second retry for that
  whole period. Resolve-at-spawn is what makes refresh immune to the queue's duration.
- **This change alone does not honestly clear #279 item 4.** Retry becomes correct while still
  _appearing_ to do nothing for up to an interval. #366 must land before item 4 is marked passed.

Bounded in the other direction: refresh's detection is async with a 5s timeout per call and at
most three attempts, and every non-`refreshed` outcome returns **before** `addScanner`, which
strictly reduces the paths that can reach #366's unbounded wait. The end-to-end worst case does
grow, though — up to ~25s in resolution and a further 45s in spawn-readiness before any status is
recorded — and that is worth stating because #366's symptom is precisely "no feedback".

## What was checked and found safe

Recorded so the next reviewer does not re-derive it.

- **No mid-session record is made retroactively wrong by the refresh write.** Every reader of
  `usb_bus`/`usb_device` was traced: `retryScanner`, `register-handlers.ts:165-175`,
  `matchDetectedToDb`, `validateConfig`'s mock branch, `resetUsb`, and `ConfigureScanner.tsx`'s
  save payload. None feeds a TIFF tag, a `GraviScan` row, a file path or the cloud upload payload.
  GraviScan writes no `metadata.json` (that is CylinderScan). Session `saneName`s are captured in
  the renderer at page mount.
- **No plate is dropped or duplicated by the retry.** `plates: []` on the respawn is inert
  (`scanOnce` reads `platesPerScanner` from the `startScan` closure); `stopScanner` settles the
  in-flight row as `'stopped'` rather than letting it burn the timeout; the respawn takes effect
  at a cycle boundary; duplicate rows are prevented by the
  `(session_id, scanner_id, plate_index, cycle_number)` upsert at `database-handlers.ts:216`.
- **`ScannerConfig` never crosses the preload boundary,** so a function-valued field cannot hit
  structured clone. The renderer payload is a separate hand-synced `GraviStartScanParams`
  (`src/types/electron.d.ts:101`, with its rationale at `:93-100`: shared code may not import
  from `main/graviscan/`). Every `ScannerConfig` is constructed inside the main process. The field
  still carries a main-process-only doc comment, because `preload.ts` types `startScan`'s params
  loosely enough that TypeScript would not catch a mistake — it would surface as a runtime clone
  error.
- **`wiring.ts`'s `ScannerLookupDb` reads `usb_port` but not `usb_bus`/`usb_device`**, so it
  cannot race the refresh write.
- **A string-literal discriminant narrows correctly** under this repo's `tsconfig`; a
  _boolean_-literal one does not, which is why `WedgeBanner.tsx:48-53` needs its manual cast. The
  outcome union therefore uses a string `status` deliberately.

## Risks

| Risk                                                                                                               | Mitigation                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resolution's new `await` makes double-spawn and spawn-past-shutdown reachable                                      | Generation token, specified as a requirement and tested with `stopScanner`-during-resolution and `shutdown`-during-resolution cases.                                                                                                                                                                                    |
| An unbounded or hung resolver strands a scanner for the session                                                    | Explicit resolver timeout, separate from `SPAWN_READY_TIMEOUT_MS`, with a never-settling-resolver test.                                                                                                                                                                                                                 |
| Several scanners retried in sequence resolve concurrently at one cycle boundary                                    | Each queued add registers its own `cycle-complete` listener and they are not serialized, so N resolvers can run at once — up to 2N `lsusb` invocations on a bus that already has a wedged device. Bounded by the resolver timeout, and concurrent resolvers share a single detection pass via **in-flight deduplication** (see Decision 4a — an earlier draft of this row said "cached for a short TTL", which was implemented differently and deliberately). |
| A failing resolver silently spawns on a stale address                                                              | Failure-caused fallbacks are logged with their cause, distinctly from the absent-resolver case.                                                                                                                                                                                                                         |
| Retry inside `reset-usb`'s 5s null window now proceeds where it used to refuse                                     | Stated in Decision 6 as an accepted gap; the handler-level guard is filed. Unreachable from the UI, reachable over IPC.                                                                                                                                                                                                 |
| `usb_port` notation may differ from live detection (#243's open hypothesis), and a mismatch now hard-fails a retry | The prerequisite change's startup audit reports mismatches before they matter. Rig pre-flight compares byte-exactly; only the single-level case (`1-8`) is verified so far — the production rig's hub-attached multi-level paths need the same check.                                                                   |
| The `lsusb` dedupe keeps the highest `usb_device` as "most recent"; device numbers are reused and wrap at 127      | After a wrap a ghost could win and refresh would persist a dead address. Pinned as a named assumption with tests; the block has partial coverage today, not zero.                                                                                                                                                       |
| A test passing only because the mock is more forgiving than production                                             | Mock-mode spawning skips `saneName` validation entirely, which is how `epkowa:interpreter:null:null` became reachable; guarded by `unusable-address` with its own scenario. Mock row shapes audited against the schema wholesale.                                                                                       |

## Deferred, and named so it is not rediscovered as a defect

- **#182's worker half** — blocked on `libusb-filter.c` caching `SANE_USB_FILTER` per process; see
  `proposal.md`. Filed with the finding and the cheapest falsification (grep an existing wedge-run
  worker log for `libusb-filter] Blocked`).
- `usb_bus`/`usb_device` are **not** audit-grade identity. The audit-grade record is the scan-log
  line, which carries before _and_ after values, the port and the session. A durable per-rebind
  record (the `GraviScannerBinding` table from PR #196's stranded proposal) is deferred: it brings
  append-only enforcement, a reason enum and a confirmation modal.
- `usb_port` is captured in no per-scan artifact, so an image is not self-describing as to which
  physical scanner produced it. Adding `usb_port` and the device name to the TIFF
  `ImageDescription` is the cheap durable fix, and is filed.
- `GRAVISCAN_LOG_RETENTION_DAYS` defaults to 180 days, shorter than the typical
  capture-to-analysis interval. A cutover consideration, not a code change.
- The `usb_bus`/`usb_device` columns remain a cache of a volatile kernel value. This change adds a
  writer where it could have stopped reading them. The write is kept because it keeps the Configure
  Scanner display honest and is what the scan log's before/after references — but **no consumer may
  build a SANE name from the stored value without a live re-resolution**, and that is now stated in
  the spec so the next change does not add a fourth reader.

## Positions superseded by earlier review rounds

Kept only so a reader does not re-litigate them.

- The worker-side sysfs re-resolution (an earlier §3) was cut: correct in isolation, defeated by
  the libusb shim.
- The identity-matching precedence inversion was split into
  `fix-graviscan-scanner-identity-precedence` and made a prerequisite.
- An earlier draft claimed retry and `resetUsb` were "mutually exclusive by specification". They
  are not; the gate is renderer-side only. See Decision 6.
- An earlier draft asserted the precedence rule was "uniform across `validateConfig()` and
  `resetUsb()`". Those two are port-only with no fallback, and that claim moved to the prerequisite
  change, correctly scoped.
- An earlier draft had refresh return a `saneName` and carry a duplicate-port tie-break. Refresh
  resolves an address for one known row and never resolves a port to a row, so the tie-break had no
  referent there; it belongs to the prerequisite change's lookup.
