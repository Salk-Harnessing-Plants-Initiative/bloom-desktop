# Design — GraviScan scanner-identity matching precedence

## Context

The Epson Perfection V600 exposes no USB serial number, tested on all five rig scanners
(#182's 2026-05-06 comment): _"the USB path is the ONLY stable identifier for a physical port
across reconnects/resets… there's no scanner-side identifier we could use instead."_

So `usb_port` is the terminal identity tier available, and `usb_bus`/`usb_device` are a **cache of
a volatile kernel-assigned value**. Treating that cache as identity is the defect.

The ladder is not invented here: the stranded `add-scanner-firmware-serial-identity` proposal
(commit `5e294cd`, PR #196) specifies `firmware_serial → usb_port → composite`, noting the V600
returns `iSerial 0` so the system must degrade to `usb_port`-primary. `firmware_serial` remains a
future insertion point (#219).

**Divergence from that ladder, recorded:** its fallback tier is the full composite
`(vendor_id, product_id, name, usb_bus, usb_device)`; this change's fallback is the bare bus/device
pair. On the V600 rig all scanners share `vendor_id`, `product_id` and `name`, so the composite
degenerates to exactly bus+device. Widen it if mixed models ever share a rig.

## Decisions

### Decision 1 — one invariant, not a set of prohibitions

**A match on `usb_bus`+`usb_device` never assigns, changes or transfers a `usb_port`.** It is
reachable only when _both_ the detected port and the candidate row's port are unusable, and it may
refresh only `usb_bus`/`usb_device`. Separately, a detected scanner whose port is unusable never
causes a row to be **created**.

This is stated as an invariant because three successive drafts of this rule each closed the cell
they were looking at and opened one they were not. The full table, which should be checked
cell-by-cell rather than re-reasoned in prose:

| #   | detected port | row port   | device eq | current code       | draft 2 (detected-side gate) | draft 3 (row-side gate) | **this design**          |
| --- | ------------- | ---------- | --------- | ------------------ | ---------------------------- | ----------------------- | ------------------------ |
| 1   | usable        | = detected | any       | may bind wrong row | update                       | update                  | **update**               |
| 2   | usable        | usable ≠   | yes       | **capture**        | create                       | create                  | **create**               |
| 3   | usable        | usable ≠   | no        | create             | create                       | create                  | **create**               |
| 4   | usable        | null       | yes       | **capture**        | create                       | **capture**             | **create**               |
| 5   | usable        | null       | no        | create             | create                       | create                  | **create**               |
| 6   | usable        | `''`       | yes       | **capture**        | create                       | **capture**             | **create**               |
| 7   | unusable      | usable     | yes       | update             | **create (dup)**             | **create (dup)**        | **refuse create**        |
| 8   | unusable      | usable     | no        | create             | create                       | create                  | **refuse create**        |
| 9   | unusable      | unusable   | yes       | update             | update                       | update                  | **update, address only** |
| 10  | unusable      | unusable   | no        | create             | create                       | create                  | **refuse create**        |

Cells 4 and 6 are why draft 3 was wrong: a `null`-port row has no _port_ claim, but it holds a
`scanner_id`, a `name`, and FK'd `GraviScan` and `GraviScanPlateAssignment` rows. Binding it by
device number can move all of that onto a different physical scanner, because a scanner can
inherit an address another one used to have.

Cell 7 is why draft 3 was wrong a second time: with only the row side restricted, one transient
`lsusb -t` failure makes every detected port `''`, so nothing matches and **every** healthy row is
duplicated — while Decision 7's fleet-disable guard keeps the originals enabled. Three scanners
become six enabled rows. Refusing to create a row for a scanner whose port is unusable removes
that entire source, rather than handling its output afterwards.

The cost is that a legacy `null`-port row is **not** auto-healed; cell 9 only refreshes its
address. That is accepted, and Decision 4's audit is what makes such rows visible. Automatic
healing would require exactly the device-number-assigns-a-port move that cells 4 and 6 prove
unsafe.

Cell 9 retains a narrow residual: both sides portless, so a different scanner on the same address
could refresh that row's `usb_bus`/`usb_device`. Nothing identity-bearing is written, and it can
only happen during a degraded detection pass. Stated rather than eliminated.

### Decision 2 — one trade is accepted, and it is genuinely silent

A row whose stored `usb_port` is _usable but no longer matches_ live detection — because the
scanner was relocated, or because the stored notation differs from what detection now produces —
will yield a **new row** rather than being healed. That is accepted, because healing it by device
number cannot distinguish "same scanner, recorded differently" from "different scanner that holds
that device number now", and the second case silently attributes one scanner's plate barcodes to
another scanner's images.

An earlier draft justified this by claiming the duplicate is "visible in the Configure Scanner list
and detectable by the audit". **That was false**, and the correction matters because the whole
BREAKING justification rests on preferring a _recoverable_ failure over a silent one. In the same
`saveScannersToDB` call that creates the duplicate, `disableStaleScannerRows` disables the old row
(its port is non-null and absent from the current set), and every read path filters
`enabled: true` — so the stranded row vanishes from the UI.

So the honest position is: **the duplicate is recoverable but not self-announcing.** Nothing is
destroyed — `graviscan-upload.ts:281` still resolves `scanner_name` through the disabled row's FK —
but the operator sees one scanner while historical scans hang off an invisible row. Decision 4's
audit is what makes it visible, which is why the audit must cover disabled rows, and why it is not
optional garnish on this change.

The choice is still right. A misattributed image is silent _and_ unrecoverable _and_ invalidates
the affected plates. But it is a choice between two poor outcomes, not between a poor one and a
benign one.

### Decision 3 — why this does not regress #243

#243 ("`upsertScannerRow` created fresh UUIDs instead of UPDATING existing rows") was closed
2026-09-10 with a comment naming the bus/device-first order as the fix. Inverting it needs an
argument.

#243's reproduction was Reset USB followed by Detect. `resetUsb()` step 2 nulls `usb_bus`/
`usb_device` on every enabled row while deliberately preserving `usb_port`
(`scanner-handlers.ts:691-694`, comment: "keep usb_port for matching"). So for any scanner
`resetUsb` could not re-detect, the stored bus/device key is **absent** and the port key is
present: the `usb_port` fallback is what actually fixed #243, and the closing comment credits the
wrong half of the code. Port-primary promotes the key that was doing the work.

(For scanners `resetUsb` _does_ re-detect, step 5 repopulates bus/device at `:757-764`, so the
null state is durable only for the unseen ones — which is the #243 case.)

What genuinely changes is #243's **unresolved** hypothesis: that detection's `usb_port` string may
differ in notation from the stored one. Under bus/device-first that was masked; now it surfaces as
Decision 2's accepted trade. #243 should be annotated with this rather than silently reversed.

### Decision 4 — a read-only, database-only startup audit instead of a migration

The at-risk population is invisible: rows with `null`/`''` ports, duplicate ports, and rows
stranded by a duplicate. An operator cannot discover any of it until recovery fails.

A migration is rejected: repairing these rows means choosing which duplicate is canonical and
rewriting a `usb_port` that historical scans are attributed through — an operator decision, not a
silent startup action.

Three properties are load-bearing:

- **It examines all rows, not just enabled ones.** A row disabled by a duplicate is exactly the
  state Decision 2 needs surfaced, and it is invisible to every other read path.
- **It derives everything from the database, with no USB detection.** This is what keeps it
  non-blocking. The only detection function available in this change is synchronous
  (`execFileSync` twice, each `timeout: 5000`, so up to ~10s of blocked main-process event loop);
  the async variant arrives with the sibling change, which lands second. Comparing stored ports
  against live output is therefore deferred — and it needs a pairing rule anyway, which is
  unspecifiable when the notations differ, since that difference _is_ the finding. A set-difference
  report belongs with the sibling change, where async detection exists.
- **It hooks into a path that actually runs.** Not `runStartupScannerValidation()`, which an
  earlier draft named: that function is reachable only via `graviscan:validate-scanners`, which is
  exposed on the preload bridge (`preload.ts:419-420`) and invoked by **no** renderer or E2E code.
  Attaching the sole mitigation for a BREAKING change to dead code would have shipped a mitigation
  that never executed.

### Decision 5 — preserve a usable port; never persist an empty one

`upsertScannerRow` writes `usb_port: payload.usb_port ?? null` on both paths. `''` is not nullish,
and `detectEpsonScanners` produces `''` for every scanner whenever `lsusb -t` fails
(`lsusb-detection.ts:185`), so an empty port is persisted over a good one.

Fix: never write an unusable port over a usable one, and never persist `''` — a stored port is
either usable or `null`.

Under Decision 1's invariant the preservation branch is **unreachable by construction**:
`existing` is only reachable via the port lookup (where the two ports are equal) or via the
device-number tier (which requires both to be unusable), so there is no state where a usable
stored port meets an unusable payload port. `|| existing.usb_port ||` stays in the implementation
as a defensive no-op with a comment saying so, and **no test is written for it** — the only way to
make such a test green is to hand the mock a row the real query could never return, which is the
mock-more-forgiving-than-production failure this plan exists to avoid.

The earlier `''`→`null`-on-create coercion is superseded: no row is created at all for a scanner
whose port is unusable (Decision 1, cells 7/8/10), so there is no create-path port to coerce.

That refusal has a consequence worth stating rather than burying: on a host where the USB topology
query never succeeds, scanners could never be configured. Detection treats that failure as
optional today and only warns (`lsusb-detection.ts` catches and continues). Refusing is still
right — a portless row can never be matched again under this precedence, so creating one produces
a record that is unidentifiable from birth — but it must be **reported to the operator**, not
silently skipped, which is why the spec requires a could-not-identify report rather than a bare
no-op.

### Decision 6 — an ambiguous port lookup writes nothing

Where a `usb_port` lookup resolves more than one row, nothing is written and the ambiguity is
reported.

An earlier draft instead ordered the lookup `[{ enabled: 'desc' }, { updatedAt: 'desc' }]`. That
was wrong twice over. It has the **write path** silently make exactly the canonical-row choice
Decision 4 says belongs to an operator. And it picks the wrong row on the installs that need help
most: on a split install the history-bearing original is typically the row that was _disabled_
while the newer wrong duplicate is enabled, so `enabled: 'desc'` selects the wrong one and
`updatedAt: 'desc'` then cements it as a self-reinforcing winner.

Refusing to write is honest, matches Decision 4's principle, and only triggers on already-damaged
installs, where silently picking is the worse option. It also avoids inventing a new ordering
convention: every other read path in this module orders `createdAt: 'asc'`.

### Decision 7 — don't disable the fleet on an unavailable topology query

`saveScannersToDB` builds `currentUsbPorts` from the payload and filters out empty strings
(`scanner-handlers.ts:436-438`). When `lsusb -t` fails, _every_ detected scanner carries `''`, so
that set is empty while `scanners.length > 0` still holds — and `disableStaleScannerRows(db, [])`
disables **every** enabled row with a non-null port. An existing test pins this behaviour
(`scanner-upsert.test.ts:378`).

That is the other half of the same transient-failure fork Decision 5 addresses, and fixing only
the port-destruction half would leave the fleet-disable intact. So stale-disabling is skipped when
no payload entry carries a usable port: absence of topology data says nothing about whether the
scanners are present.

### Decision 8 — no unique constraint yet

Promoting `usb_port` to primary identity argues for `@@unique([usb_port])`. Not taken here:
existing installations may already hold duplicates, so the migration would fail on exactly the
databases that most need fixing, and resolving them requires the operator decision Decision 4
declines to automate. Filed for when the audit has shown the field is clean.

One consequence to state plainly: with Decision 1's restriction, a row holding a _usable but
wrong_ port still cannot be re-pointed by any in-app path — `upsertScannerRow` is the only writer
of `usb_port` in the main process, and it can no longer reach such a row. So the notation-mismatch
class the audit reports has no in-app remedy today; the recorded remedy is to remove the stale row
via the existing per-row disable and re-detect. That is a real limitation of shipping without the
constraint or a repair affordance, not an oversight.

## Risks

| Risk                                                                                                                        | Mitigation                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A stored port that is usable but no longer matches live detection yields a duplicate row, silently                          | Accepted trade, argued honestly in Decision 2. The audit (Decision 4) is what surfaces it, including the stranded disabled row. No in-app repair — see Decision 8.                                                                                        |
| Duplicate-port rows already exist on damaged installs                                                                       | The lookup refuses to write and reports (Decision 6) rather than guessing. The audit reports duplicates across all rows.                                                                                                                                  |
| Inverting the write path affects every "Detect Scanners" click                                                              | Fallback retained and two-sided; existing tests must stay green; new tests pin the collision in both directions and assert **which query ran first**.                                                                                                     |
| Identity follows the port, so a physical cable swap of two same-model scanners misattributes images                         | Known and accepted (#203); stated in the spec itself so an auditor sees the non-guarantee.                                                                                                                                                                |
| BREAKING with no migration and no feature flag                                                                              | The audit plus an operator note. Rollback is a redeploy of the previous build, after which rows created under the new precedence remain and the old code will match _them_ by device number — stated so it is a known consequence rather than a surprise. |
| `display_name` is positional and rewritten on every Detect (`ConfigureScanner.tsx` sends `Scanner ${i+1}` from a port sort) | Pre-existing, and a reason the Configure Scanner list is weak recovery evidence. Noted in the operator note; out of scope.                                                                                                                                |
