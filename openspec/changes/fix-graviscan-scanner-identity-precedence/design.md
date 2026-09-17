# Design — GraviScan scanner-identity matching precedence

## Context

The Epson Perfection V600 exposes no USB serial number. This was tested on all five rig
scanners (#182's 2026-05-06 comment): *"Cannot distinguish individual physical scanner
hardware via USB alone… the USB path is the ONLY stable identifier for a physical port
across reconnects/resets… there's no scanner-side identifier we could use instead."*

So `usb_port` — the hierarchical path `lsusb -t` yields, e.g. `1-2.3` — is the terminal
identity tier available, and `usb_bus`/`usb_device` are a **cache of a volatile
kernel-assigned value**. Treating that cache as identity is the defect.

The ladder this change implements is not invented here. The stranded
`add-scanner-firmware-serial-identity` proposal (commit `5e294cd`, PR #196) specifies
`firmware_serial → usb_port → composite`, with an explicit note that the V600 returns
`iSerial 0` so the system must degrade to `usb_port`-primary. `firmware_serial` remains a
future insertion point (#219, #203 Option B).

**Divergence from that ladder, recorded:** its fallback tier is the full composite
`(vendor_id, product_id, name, usb_bus, usb_device)`; this change's fallback is the bare
bus/device pair. On the V600 rig all scanners share `vendor_id`, `product_id` and `name`, so
the composite degenerates to exactly bus+device. The reduction is safe only while that holds;
if mixed models ever share a rig, widen the fallback. #196 also lists
`disableMissingScanners` in its uniformity set; that function matches on `usb_port` only and
has no fallback, so it is unaffected.

## Decisions

### Decision 1 — the fallback is gated on the detected side, not on a lookup miss

The naive fix is to swap the two lookup blocks. That is insufficient: the fallback would then
fire whenever the *port lookup misses*, so a scanner on a genuinely new port would still fall
through to bus/device and capture whichever row happens to share its device number — the
exact hazard this change exists to remove.

So the fallback is reached only when the **detected scanner's own port is unusable** (`null`
or `''`), which is the one case where bus/device is the only discriminator available.

### Decision 2 — the trade this creates, stated rather than hidden

Gating costs something real. Under bus/device-first, a saved row whose stored `usb_port`
notation no longer matches live detection would still be *found* by its device number and
updated in place. Under port-primary-with-gated-fallback it is not found, and a new row is
created — which is #243's original symptom arriving through a new door.

This is accepted deliberately, because the two outcomes are not equally bad:

- A **duplicate row** strands historical scans on the old row. It is visible in the
  Configure Scanner list, detectable by the audit in Decision 4, and recoverable.
- A **misattributed image** applies one scanner's plate barcodes to another scanner's output,
  with `scanner_id` the only identity in the TIFF and no device identity recorded anywhere.
  It is silent, undetectable after the fact, and invalidates the affected plates.

Preferring the recoverable failure over the silent one is the whole point of the change.
Decision 4 exists so the mismatch is surfaced *before* it produces a duplicate.

### Decision 3 — why this does not regress #243

#243 ("`upsertScannerRow` created fresh UUIDs instead of UPDATING existing rows") was closed
2026-09-10 with a comment naming the bus/device-first order as the fix. Inverting it needs an
argument, not an assumption.

The argument: #243's symptom was a row being created while an equivalent row existed and was
findable. Port-primary still finds it — by the key that *survives* the operation #243 was
about. #243's reproduction was Reset USB followed by Detect, and `resetUsb()` explicitly nulls
`usb_bus`/`usb_device` while preserving `usb_port` for exactly this purpose
(`scanner-handlers.ts:646-649`, and its own step-2 comment). So in #243's own scenario the
bus/device key is *absent* and the port key is present — port-primary is strictly more
reliable there, not less.

What does change is the case #243 never resolved: its hypothesis that detection's `usb_port`
string may differ in notation from the stored one. Under bus/device-first that was masked;
under port-primary it surfaces as a duplicate row. That is Decision 2's accepted trade, and
Decision 4 is its mitigation. #243 should be annotated with this rather than silently
reversed.

### Decision 4 — a read-only startup audit instead of a migration

This change is BREAKING with no migration, and the population at risk is invisible: rows with
`null`/`''` ports (never backfilled), duplicate ports (no uniqueness constraint), and ports
whose notation diverges from live detection (#243's open hypothesis). An operator cannot
discover any of that today until recovery fails.

A migration is rejected: repairing these rows means choosing which of two duplicates is
canonical and rewriting a `usb_port` that historical scans are attributed through. That is a
data-attribution decision, and a startup path is the wrong place to make it silently.

So the audit reports and does not repair. It is read-only, non-blocking, and swallows its own
failures. It generalises what would otherwise be a one-rig manual pre-flight into something
every installation performs, and it is the only mechanism by which an operator learns that
wedge recovery will not work for a given scanner before they need it.

### Decision 5 — preserve a usable port rather than overwriting it

`upsertScannerRow` writes `usb_port: payload.usb_port ?? null` on both the update and create
paths. `''` is not nullish, so an empty detected port is persisted — and
`detectEpsonScanners` produces `''` for every scanner whenever `lsusb -t` fails
(`lsusb-detection.ts:185`).

The consequence is a permanent fork from a transient failure: the good port is overwritten
with `''`; `saveScannersToDB` filters empty strings out of its current-ports set
(`scanner-handlers.ts:404-406`) so `disableStaleScannerRows` — which skips only strictly-null
ports (`scanner-upsert.ts:166`) — disables the row; and the next successful detection finds no
port match and creates a duplicate.

Fix: `payload.usb_port || existing.usb_port || null` on update, and coerce `''` to `null` on
create so stale-row handling treats it as unmatchable rather than as absent from the detection
set. This is in scope rather than a follow-up because §1 is what promotes `usb_port` to
primary identity; the gap is one this change's own design creates.

### Decision 6 — no unique constraint, and why that is a decision rather than an omission

Promoting `usb_port` to primary identity argues for `@@unique([usb_port])`. It is not taken
here: existing installations may already hold duplicates (this defect can create them), so the
migration would fail on exactly the databases that most need fixing, and resolving those
duplicates requires the operator decision Decision 4 declines to automate. Deterministic
ordering plus the audit is the proportionate step now; the constraint is filed for when the
audit has shown the field is clean.

## Risks

| Risk | Mitigation |
|---|---|
| A stored port whose notation differs from live detection now yields a duplicate row rather than being healed by device number | Accepted trade, argued in Decision 2. Surfaced by Decision 4's audit before it bites. Pre-flight the production rig's hub-attached (multi-level, e.g. `1-2.3`) ports specifically — only the single-level case has been verified. |
| Duplicate-port rows already exist on damaged installs; `findFirst` is unordered | Deterministic `orderBy: [{ enabled: 'desc' }, { updatedAt: 'desc' }]`, specified and tested. Note `updatedAt` is bumped by *any* write, so "most recently updated" is not "most recently detected"; if a write ever lands on the wrong duplicate it becomes a self-reinforcing winner. The audit reports duplicates so this is visible. |
| Inverting the write path affects every "Detect Scanners" click | Fallback retained and gated; 25 existing tests in `scanner-upsert.test.ts` must stay green; new tests pin the collision in both directions and assert **which query ran first**, so precedence is not merely implied. |
| Identity follows the port, so a physical cable swap of two same-model scanners misattributes images | Known and accepted (#203); stated in the spec itself, not only here, so an auditor reading the standing spec sees the non-guarantee. |
| BREAKING with no migration | Audit (Decision 4) plus an explicit operator note. The constraint that would prevent recurrence is filed, not silently skipped. |
