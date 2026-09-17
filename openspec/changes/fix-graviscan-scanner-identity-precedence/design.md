# Design — GraviScan scanner-identity matching precedence

## Context

The Epson Perfection V600 exposes no USB serial number, tested on all five rig scanners
(#182's 2026-05-06 comment): *"the USB path is the ONLY stable identifier for a physical port
across reconnects/resets… there's no scanner-side identifier we could use instead."*

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

### Decision 1 — the fallback is restricted on *both* sides

The fallback is reached when the `usb_port` lookup finds no row, **and** is then restricted to rows
whose own `usb_port` is unusable.

Getting this wrong in either direction causes a distinct defect:

- **No restriction** (today's code, or a naive block swap): a detected scanner whose port matches
  no row still matches by device number, so a relocated or re-enumerated scanner captures whichever
  row shares its current device number — the misattribution hazard.
- **Restricted to the detected side only**: rows holding an unusable `usb_port` stop matching
  entirely. They accumulate duplicates on every detection, and because `disableStaleScannerRows`
  leaves a strictly-`null` port untouched (`scanner-upsert.ts:166`, pinned by an existing test),
  such a row stays **enabled and unmatchable indefinitely**. It then appears in
  `getScannerStatus`, so an operator can assign real plate barcodes to a ghost row whose plates are
  never scanned, and `validateConfig` reports it missing forever.

Restricting both sides separates the hazard from the repair. A row holding a *usable* port has a
competing identity claim and must never be captured by a device number. A row holding *no* usable
port has no claim to protect, and a device-number match is the only way it can ever acquire a port.

This also gives the audit's null/empty findings an in-app remedy: such a row heals on the next
successful detection instead of requiring manual SQL.

### Decision 2 — one trade is accepted, and it is genuinely silent

A row whose stored `usb_port` is *usable but no longer matches* live detection — because the
scanner was relocated, or because the stored notation differs from what detection now produces —
will yield a **new row** rather than being healed. That is accepted, because healing it by device
number cannot distinguish "same scanner, recorded differently" from "different scanner that holds
that device number now", and the second case silently attributes one scanner's plate barcodes to
another scanner's images.

An earlier draft justified this by claiming the duplicate is "visible in the Configure Scanner list
and detectable by the audit". **That was false**, and the correction matters because the whole
BREAKING justification rests on preferring a *recoverable* failure over a silent one. In the same
`saveScannersToDB` call that creates the duplicate, `disableStaleScannerRows` disables the old row
(its port is non-null and absent from the current set), and every read path filters
`enabled: true` — so the stranded row vanishes from the UI.

So the honest position is: **the duplicate is recoverable but not self-announcing.** Nothing is
destroyed — `graviscan-upload.ts:281` still resolves `scanner_name` through the disabled row's FK —
but the operator sees one scanner while historical scans hang off an invisible row. Decision 4's
audit is what makes it visible, which is why the audit must cover disabled rows, and why it is not
optional garnish on this change.

The choice is still right. A misattributed image is silent *and* unrecoverable *and* invalidates
the affected plates. But it is a choice between two poor outcomes, not between a poor one and a
benign one.

### Decision 3 — why this does not regress #243

#243 ("`upsertScannerRow` created fresh UUIDs instead of UPDATING existing rows") was closed
2026-09-10 with a comment naming the bus/device-first order as the fix. Inverting it needs an
argument.

#243's reproduction was Reset USB followed by Detect. `resetUsb()` step 2 nulls `usb_bus`/
`usb_device` on every enabled row while deliberately preserving `usb_port`
(`scanner-handlers.ts:646-649`, comment: "keep usb_port for matching"). So for any scanner
`resetUsb` could not re-detect, the stored bus/device key is **absent** and the port key is
present: the `usb_port` fallback is what actually fixed #243, and the closing comment credits the
wrong half of the code. Port-primary promotes the key that was doing the work.

(For scanners `resetUsb` *does* re-detect, step 5 repopulates bus/device at `:711-718`, so the
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
  unspecifiable when the notations differ, since that difference *is* the finding. A set-difference
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

Fix: `payload.usb_port || existing.usb_port || null` on update, and coerce `''` to `null` on create.

Note *why* preserving is safe rather than merely convenient: `existing` is only reachable via the
port lookup (where payload and existing ports are equal, so the payload wins anyway) or via the
device-number fallback (which now requires *both* ports to be unusable). So a genuinely-moved
scanner's new port can never lose to a stale stored one. The gating makes the preservation safe by
construction.

The `''`→`null` coercion on create is only safe *because* of Decision 1's two-sided restriction:
with a one-sided gate it would have produced the permanently-enabled ghost described there.

### Decision 6 — an ambiguous port lookup writes nothing

Where a `usb_port` lookup resolves more than one row, nothing is written and the ambiguity is
reported.

An earlier draft instead ordered the lookup `[{ enabled: 'desc' }, { updatedAt: 'desc' }]`. That
was wrong twice over. It has the **write path** silently make exactly the canonical-row choice
Decision 4 says belongs to an operator. And it picks the wrong row on the installs that need help
most: on a split install the history-bearing original is typically the row that was *disabled*
while the newer wrong duplicate is enabled, so `enabled: 'desc'` selects the wrong one and
`updatedAt: 'desc'` then cements it as a self-reinforcing winner.

Refusing to write is honest, matches Decision 4's principle, and only triggers on already-damaged
installs, where silently picking is the worse option. It also avoids inventing a new ordering
convention: every other read path in this module orders `createdAt: 'asc'`.

### Decision 7 — don't disable the fleet on an unavailable topology query

`saveScannersToDB` builds `currentUsbPorts` from the payload and filters out empty strings
(`scanner-handlers.ts:404-406`). When `lsusb -t` fails, *every* detected scanner carries `''`, so
that set is empty while `scanners.length > 0` still holds — and `disableStaleScannerRows(db, [])`
disables **every** enabled row with a non-null port. An existing test pins this behaviour
(`scanner-upsert.test.ts:344`).

That is the other half of the same transient-failure fork Decision 5 addresses, and fixing only
the port-destruction half would leave the fleet-disable intact. So stale-disabling is skipped when
no payload entry carries a usable port: absence of topology data says nothing about whether the
scanners are present.

### Decision 8 — no unique constraint yet

Promoting `usb_port` to primary identity argues for `@@unique([usb_port])`. Not taken here:
existing installations may already hold duplicates, so the migration would fail on exactly the
databases that most need fixing, and resolving them requires the operator decision Decision 4
declines to automate. Filed for when the audit has shown the field is clean.

One consequence to state plainly: with Decision 1's restriction, a row holding a *usable but
wrong* port still cannot be re-pointed by any in-app path — `upsertScannerRow` is the only writer
of `usb_port` in the main process, and it can no longer reach such a row. So the notation-mismatch
class the audit reports has no in-app remedy today; the recorded remedy is to remove the stale row
via the existing per-row disable and re-detect. That is a real limitation of shipping without the
constraint or a repair affordance, not an oversight.

## Risks

| Risk | Mitigation |
|---|---|
| A stored port that is usable but no longer matches live detection yields a duplicate row, silently | Accepted trade, argued honestly in Decision 2. The audit (Decision 4) is what surfaces it, including the stranded disabled row. No in-app repair — see Decision 8. |
| Duplicate-port rows already exist on damaged installs | The lookup refuses to write and reports (Decision 6) rather than guessing. The audit reports duplicates across all rows. |
| Inverting the write path affects every "Detect Scanners" click | Fallback retained and two-sided; existing tests must stay green; new tests pin the collision in both directions and assert **which query ran first**. |
| Identity follows the port, so a physical cable swap of two same-model scanners misattributes images | Known and accepted (#203); stated in the spec itself so an auditor sees the non-guarantee. |
| BREAKING with no migration and no feature flag | The audit plus an operator note. Rollback is a redeploy of the previous build, after which rows created under the new precedence remain and the old code will match *them* by device number — stated so it is a known consequence rather than a surprise. |
| `display_name` is positional and rewritten on every Detect (`ConfigureScanner.tsx` sends `Scanner ${i+1}` from a port sort) | Pre-existing, and a reason the Configure Scanner list is weak recovery evidence. Noted in the operator note; out of scope. |
