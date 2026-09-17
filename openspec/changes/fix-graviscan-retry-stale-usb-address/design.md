# Design — fix GraviScan retry-scanner's stale USB address

## Context

A physical power-cycle is the only way to clear a V600 wedge (#228), and it always
re-enumerates the device at a new USB device number. `retryScanner()` builds its SANE
name from DB columns that only `resetUsb()` and `saveScannersToDB()` ever write, so it
always builds a dead address. Full evidence chain in `proposal.md`.

The constraint that shapes every decision below: **the V600 exposes no usable
`iSerial`** (#182's 2026-05-06 comment, confirmed across all five rig scanners). The
USB port path is the only stable physical identifier available, so there is no
scanner-side identity to fall back on.

A second hardware constraint bans an obvious approach: `USBDEVFS_RESET` /
`pyusb dev.reset()` **wedges V600s rather than recovering them** — a rig test took 2/5
working scanners to 0/5 working, requiring physical power-cycles to recover. This is
already codified as `scanning/spec.md:2655` ("USBDEVFS_RESET Removed from Recovery
Path"). No design here may reintroduce a device-level USB reset.

## Decisions

### Decision 1 — a shared helper, not re-detection inlined in `retryScanner()`

**Chosen:** a new module `src/main/graviscan/scanner-usb-refresh.ts`.

Re-detection inlined in `retryScanner()` would be the smallest diff, but `session-handlers.ts`
deliberately carries almost no DB dependency (its own comment at :25-28 notes it "otherwise
has zero DB dependency"), and there are already three other call sites that want the same
"refresh this one scanner's USB address" operation:

- `resetUsb()`'s per-scanner loop (shares the matcher today — Decision 2)
- the coordinator on a device-open failure (a plausible follow-up; not built here)
- #159's "Start Scan must check real scanner readiness" work

A separate module also keeps the pure matcher unit-testable without a DB or Electron.

### Decision 2 — the shared unit is the pure matcher, not the IO wrapper

`refreshScannerUsbAddress()` performs IO in a fixed order: read row → detect → match →
write. `resetUsb()` needs the same *matching* but must keep its **single** detection pass
across all scanners. Calling the IO wrapper inside `resetUsb()`'s loop would invoke
`lsusb` once per scanner — N subprocess spawns per reset instead of one, plus a
per-scanner inconsistent view of the bus.

So the extracted, shared unit is:

```ts
export function matchScannerByPort(
  detected: DetectedScanner[],
  row: { usb_port: string | null }
): DetectedScanner | null
```

`resetUsb()` keeps its own `detectEpsonScanners()` call and its own loop, and calls
`matchScannerByPort()` per row. `refreshScannerUsbAddress()` calls it once. One
definition of "which detected device is this row?", two call patterns.

**Rejected:** calling `resetUsb()` itself from the retry path. It is spec-blocked during
an active scan (`scanning/spec.md:2379`, `ui-management-pages/spec.md:2159`) while retry
*requires* an active session (`scanning/spec.md:4104`) — so the two are mutually
exclusive by specification. It would also `coordinator.shutdown()` the whole fleet and
re-`initialize()` it to recover a single scanner mid-session, losing every other
scanner's in-flight row.

### Decision 3 — refresh runs BEFORE `stopScanner()`

Order: `refresh → stop → add`.

Detection is read-only (`lsusb` reads sysfs; it does not open the device, so it is safe
while a worker holds the handle). Running it first means a `not-detected` or
`detection-failed` outcome leaves the existing worker exactly as it was, instead of
stopping a scanner we have just discovered we cannot respawn. In the wedge case the
worker is already stopped by auto-pause, so nothing is lost in the common path either.

### Decision 4 — `no-stable-port` and `detection-failed` fail hard, with actionable text

`usb_port` is fragile: nullable, never backfilled by any migration, no unique constraint
or index, written by exactly one code path, and returned as `''` (empty string, not
null) when `lsusb -t` fails (`lsusb-detection.ts:185`). So "row has no usable
`usb_port`" is a real state that must be handled explicitly.

**Chosen:** both outcomes fail the retry with a specific message, rather than silently
falling back to the stored `usb_bus`/`usb_device`.

**Rejected:** falling back to the stored address. It is superficially attractive as
"no worse than today", but after a power-cycle the stored address is *always* wrong, so
the fallback guarantees the same misleading `Failed to open device after 3 attempts`
that #182 is about — while hiding the actual cause. Failing with
"no stable USB port recorded for this scanner — run Detect Scanners on the Configure
Scanner page" names a fix the operator can actually perform. Mock mode short-circuits
before detection (Decision 5), so this hard-fail cannot regress E2E or non-Linux dev.

**Rejected:** a singleton heuristic ("exactly one detected device and exactly one
enabled row ⇒ they must be the same scanner"). It would rescue the `no-stable-port`
case on a single-scanner bench, but on a multi-scanner rig it can bind a row to the
wrong physical scanner — the precise class of error this change exists to remove. YAGNI.

### Decision 5 — mock mode short-circuits before detection

`GRAVISCAN_MOCK=true` mock scanners are deterministically `usb_bus: 1, usb_device: i+1`
(`scanner-handlers.ts:51-81`) and never re-enumerate, so there is nothing to refresh.
`refreshScannerUsbAddress()` returns `refreshed` with the row's existing values and
`changed: false` without calling `detect`, matching the mock branches already present in
`detectScanners()`, `validateConfig()` and `resetUsb()`.

This is also why **CI structurally cannot exercise #182**: mock mode is the only mode CI
has, and it never changes a device number. The same limitation was documented by
`2026-09-17-validate-graviscan-wedge-response-hardware`. Hence Decision 7.

### Decision 6 — `usb_bus: null` stops being fatal when `usb_port` is present

Today retry fails outright if `usb_bus`/`usb_device` is null. With refresh in place,
null columns are recoverable: re-detection supplies them. The guard therefore moves from
"null ⇒ fail" to "null and no usable `usb_port` ⇒ fail". This is a deliberate
behavioural improvement to the existing scenario "Retry fails without respawning when
USB identity is unknown", not an accident of the refactor.

### Decision 7 — verification is designed around a fault CI cannot reach

A wrong fix here is only detectable on real hardware, so the verification path is part
of the design rather than an afterthought.

The key insight: **a physical power-cycle is only one *cause* of the fault; the fault
itself is DB staleness.** That can be induced deterministically, with no hardware
interaction, by writing a wrong `usb_device` into the row while the scanner sits healthy
at its current address. This is #182's 2026-09-16 reproduction with the hardware step
removed — which makes it repeatable in unit tests *and* on the rig.

Three layers:

1. **Unit** — the pure matcher and every `RefreshOutcome` branch, with `detect` injected.
   Covers what CI can verify.
2. **Rig, deterministic (unattended)** — on `pbiob-gh-04`, write a deliberately wrong
   `usb_device` to the row, call `graviscan:retry-scanner` over IPC, assert it succeeds
   and that the row was corrected to the live address. Asserting the *row was corrected*
   is what distinguishes a real fix from a lucky retry.
3. **Rig, physical (attended, pre-merge)** — one real wedge induction and power-cycle,
   driven through the UI button rather than IPC, to close #279 item 2.4 on its own terms.
   Recorded under the `hardware-validation-evidence` capability and in the Obsidian vault
   at `C:\vaults\graviscan\`.

Layer 3 needs a human at the rig; layers 1 and 2 do not. Layer 2 is the one that makes
this change re-verifiable by anyone later, without waiting for a wedge.

### Decision 8 — #366 is not bundled

#366 (`retryScanner()`'s queued `addScanner` has no timeout; `retriesInFlight` strands
the scannerId when `scanOnce()` throws) lands in the same function and is tempting to
fix here. It is deliberately left out.

PR #365's retrospective is explicit about the cost: that PR was ~15% its stated scope
(atomic write) and ~85% an unrelated coordinator-observability change, and five of its
seven review rounds plus every self-inflicted regression came from the half that did not
need to be there. #182 is a *correctness* fix on the address; #366 is a *liveness* fix on
the coordinator's queueing. Separate failure modes, separate reasoning, separate reviews.

**Interaction checked:** the refresh step cannot worsen #366's hang. It runs strictly
before `addScanner()`, and its only unbounded-looking operation is `detectEpsonScanners()`,
which is `execFileSync` with an explicit `timeout: 5000` on both `lsusb` invocations
(`lsusb-detection.ts:146,159`). Worst case the refresh adds ~10s before the queued wait
that #366 describes — it does not extend that wait, and a `detection-failed` outcome now
returns *before* reaching the queue at all, which strictly reduces the number of paths
that can reach #366's hang.

## Risks

| Risk | Mitigation |
|---|---|
| `usb_port` is `''`/null on rows created where `lsusb -t` failed; no migration ever backfilled it | Explicit `no-stable-port` outcome with operator-actionable text (Decision 4). Pre-flight the rig's actual row values before the layer-2 run. |
| Inverting `upsertScannerRow()`'s precedence changes the write path used by every "Detect Scanners" click | `usb_bus`+`usb_device` retained as fallback, so the `lsusb -t`-unavailable path is unchanged. 25 existing tests in `scanner-upsert.test.ts` must stay green, and new tests pin the collision case in both directions. |
| Port-primary matching means identity follows the *port*, not the device, if a scanner is physically moved | Known, accepted, and already documented as #203; unchanged by this work. Called out so a reviewer does not read it as newly introduced. |
| `resetUsb()`'s coordinator mock (`reset-usb-handler.test.ts:25-31`) is very thin — `{ isScanning, initialize, shutdown }` only | The extracted matcher takes no coordinator, so the mock stays valid. If that changes, widen the mock rather than weakening the assertion. |
| A test passing only because the mock is more forgiving than production — five instances of this class on PR #365 | `createMockRetryDb` (`session-handlers.test.ts:79-91`) currently returns a 3-field row with no `id` and no `usb_port`. Widening it is part of the red phase, and mock row shapes are audited against the real Prisma model rather than field-by-field as needed. |

## Open questions

None. Design questions 1-5 from the brainstorming brief are settled in Decisions 1-4 and
7; the `matchDetectedToDb` question (brief question 3) resolved differently than the
brief assumed — the premise that `usb_port` "is bus/device-derived and equally unstable"
holds only for the **mock** builder (`scanner-handlers.ts:63`) and for the `lsusb -t`
failure path, not for real detection, where it is the `lsusb -t` hierarchical port path.
