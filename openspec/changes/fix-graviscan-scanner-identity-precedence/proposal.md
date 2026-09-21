# Fix GraviScan scanner-identity matching precedence

## Why

GraviScan matches a detected USB scanner to its saved `GraviScanner` row on
`usb_bus`+`usb_device` **first**, falling back to `usb_port` — in
`matchDetectedToDb()` (`src/main/graviscan/scanner-handlers.ts:87-109`) and
`upsertScannerRow()` (`src/main/graviscan/scanner-upsert.ts:56-81`). The operating
system reassigns `usb_device` on every reconnect, so after a re-enumeration a device's
new number can coincide with a _different_ saved scanner's stored `usb_device` and bind
the wrong `scanner_id`. Device numbers were observed climbing 005 → 006 → 007 → 008
within one session on a five-scanner rig where every scanner is the same model.

**This silently misattributes scientific data.** `matchDetectedToDb` is the only join
between "whose plate barcodes" and "which physical scanner": its output becomes
`GraviScan.tsx`'s `saneNames` map, which `useScanSession.ts:897` turns into each
worker's `--device` argument. On a coincidence, scanner A's barcodes are applied to
images produced by a _different_ physical scanner — **and** the legitimate owner gets no
`saneName`, resolves to `?? ''`, fails `buildSubprocessEnv`'s validation and drops out of
the run. That drop-out is not loudly reported: the failure appears as an `error` badge on
the scanner panel and a `scanLog` line, and the dedicated `graviscan:scanner-init-status`
event is forwarded to the renderer but has no subscriber. So the _plates_ are silently not
scanned even though the spawn failure itself is recorded.

On the write path it is worse. `upsertScannerRow` overwrites the mis-matched row's
`usb_port`, `display_name` **and `name`** — and `name` is what
`src/main/graviscan-upload.ts:281` resolves _at upload time_ into `scanner_name` for
every historical scan on that row. So the corruption reaches data that was already
captured and uploaded.

There is a second, independent defect in the same function: the update and create paths
both write `usb_port: payload.usb_port ?? null` (`scanner-upsert.ts:91`, `:119`). The
empty string is **not** nullish, and `detectEpsonScanners` records `usb_port: ''`
whenever `lsusb -t` fails (`src/main/lsusb-detection.ts:185`). So one transient `lsusb -t`
failure overwrites a perfectly good stored port with `''` — destroying the only stable
identity key this system has.

### Why now, and why this lands before the retry fix

The V600 exposes no USB serial number, so `usb_port` is the only stable physical
identifier available (issue #182's 2026-05-06 comment, confirmed across all five rig
scanners). The companion change `fix-graviscan-retry-stale-usb-address` makes the wedge
recovery path **hard-fail** when a scanner's `usb_port` is missing or does not match. That
makes port hygiene a precondition for it, which is why this change ships first.

### The code already contradicts its own specs and issues

- `openspec/specs/scanning/spec.md:1233` already requires `saveScannersToDB` to upsert
  "matching by USB port". The code does not.
- #167 states the bus/device-first ordering as the defect and asks to deduplicate on save
  by `usb_port`.
- #203 asserts as fact that `usb_port` is already "the primary stable-identity key
  (renderer enabledMap + main-process `matchDetectedToDb`)" and that this "resolves #182
  for the common case". **That premise is false on `main`** — the change it credits,
  `fix-scanner-config-save-flow`, exists only on PR #196's unmerged branch. This change is
  what finally makes #203's stated precondition true.
- The matching ladder `firmware_serial → usb_port → composite` was authored in the
  stranded `add-scanner-firmware-serial-identity` proposal (commit `5e294cd`, PR #196),
  with an explicit note that the V600 returns `iSerial 0` so the system must degrade to
  `usb_port`-primary. Its sibling `fix-renderer-empty-scanner-id-collision` states the rule
  outright: "`usb_bus`+`usb_device` alone SHALL NOT be treated as primary identity (the OS
  reassigns `usb_device` on reconnect; coincidental reuse could match unrelated stale
  rows)."

### #243 must be read before reviewing this

#243 was closed 2026-09-10 with a comment stating that `upsertScannerRow` "matches
existing rows first by `(usb_bus, usb_device)`, then falls back to `usb_port` — added
specifically to prevent this failure mode", verified as Tier 0 of the cutover roadmap.
This change inverts precisely that order, so the non-regression argument has to be made
explicitly rather than assumed — see `design.md` Decision 3. #243's own **unresolved**
root-cause hypothesis (that detection's `usb_port` string may differ in notation from the
stored one: `1-10` vs `1-10.0` vs `1-10:1.0`) is a live risk for this change and is
surfaced by Decision 4's startup audit as an accepted trade rather than assumed away (the audit reports it from the database; comparing stored ports against live detection is deferred to the sibling change).

## What Changes

### 1. Invert the precedence in both functions — **BREAKING** (data identity, no migration)

`matchDetectedToDb()` and `upsertScannerRow()` match on `usb_port`, governed by one invariant:

> **A match on `usb_bus`+`usb_device` never assigns, changes or transfers a `usb_port`.**

So the device-number tier is reachable only when _both_ the detected port and the candidate row's
port are unusable, and it may refresh only `usb_bus`/`usb_device`. A scanner that arrives with a
usable port and matches no row is a **new** scanner; it never falls through to a device number.

It is written as an invariant because narrower phrasings kept failing. Three drafts of this rule
each closed the cell under examination and opened another: matching a `null`-port row by device
number still moves a `scanner_id`, a `name`, and FK'd scan and plate-assignment rows onto a
different physical scanner, because scanners inherit addresses other scanners used to have.
`design.md` carries the full 10-cell table; check cells rather than re-reasoning from prose.

Correspondingly, **no row is created for a detected scanner whose `usb_port` is unusable.** Such a
row could never be matched again under this precedence, so creating one manufactures an
unidentifiable record — and one transient topology-query failure would create a duplicate of every
scanner at once. The scanner is reported as unidentifiable instead.

`validateConfig()` and `resetUsb()` are **not** changed: they already match on `usb_port` only
and have no fallback, intentionally. Note `validateConfig()` does not merely report an
unmatched row — it writes `enabled: false` on it, which is what removes such a row from every
read path and from the UI.

Where a port lookup resolves **more than one** row, nothing is written and the ambiguity is
reported. `usb_port` has no uniqueness constraint (`prisma/schema.prisma:237`) and this defect
can itself produce duplicate-port rows; silently picking one decides which row future scans
are attributed through, which is an operator decision. An earlier draft ordered the lookup by
`enabled` then `updatedAt` — that both usurped the decision and picked the wrong row on split
installs, where the history-bearing original is typically the disabled one.

**Why BREAKING:** `usb_port` is nullable and no migration ever backfilled it. Four populations
change behaviour under an unchanged user action:

- rows with a `null` or `''` port — no longer matched-then-overwritten by a coincident device
  number, and deliberately not auto-healed either: the audit reports them and an operator
  resolves them;
- rows whose stored port is usable but no longer matches live detection (relocated, or
  notation drift) — now yield a **new** row, changing which `scanner_id` later plates attach
  to while historical scans stay on the old row;
- installs already holding duplicate ports — the lookup now refuses to write where it
  previously took SQLite's scan-order row, so a Detect that used to silently update now
  reports instead;
- plate assignments keyed on `scanner_id` are orphaned for any scanner that acquires a new
  row, presenting a blank grid for that experiment and wave.

### 2. Stop destroying `usb_port`, and stop disabling the fleet

A stored `usb_port` is henceforth either usable or `null` — never the empty string — and an
unusable value never overwrites a usable one. Under §1's invariant that preservation branch is
in fact unreachable by construction, so it stays in the code as a defensive no-op, gets a comment
saying so, and gets no test: the only way to make such a test green is to hand the mock a row the
real query could never return. There is no create-path coercion left to make either, since no row
is created for a scanner whose port is unusable.

The same transient `lsusb -t` failure has a second effect that must be fixed with it:
`saveScannersToDB` builds `currentUsbPorts` from the payload and filters out empty strings
(`scanner-handlers.ts:436-438`), so when every detected scanner reports `''` that set is empty
while `scanners.length > 0` still holds — and `disableStaleScannerRows(db, [])` disables
**every** enabled row with a non-null port. An existing test pins exactly that
(`scanner-upsert.test.ts:378`). Stale-disabling is therefore skipped when no payload entry
carries a usable port: absence of topology data says nothing about whether the scanners are
present.

Fixing only the port-destruction half would have left the fleet-disable intact, so this is one
fix, not two. Both are in scope rather than follow-ups because §1 is what promotes `usb_port`
to primary identity.

### 3. Read-only, database-only startup port audit

Because §1 is BREAKING with no migration, the system reports — read-only, at startup, to the
durable scan log — rows with a null or empty `usb_port`, duplicate non-empty ports, and
disabled rows still holding a port (the signature of a row stranded by a duplicate).

Three properties matter:

- **It examines all rows, not just enabled ones.** The duplicate-row failure in §1 leaves its
  victim _disabled_, and every read path filters `enabled: true`, so an enabled-only audit
  could not see the population it exists to surface.
- **It uses no USB detection.** That keeps it off the startup critical path. The only
  detection function available in this change is synchronous — `execFileSync` twice, each
  `timeout: 5000` — so up to ~10s of blocked main-process event loop; the async variant
  arrives with the sibling change, which lands second. Comparing stored ports against live
  output is deferred there, and it needs a pairing rule that is unspecifiable precisely when
  notations differ, since that difference is the finding.
- **It hooks into a path that runs.** Not `runStartupScannerValidation()`, which is reachable
  only via `graviscan:validate-scanners` — exposed on the preload bridge
  (`preload.ts:419-420`) and invoked by no renderer or E2E code. Attaching a BREAKING change's
  sole mitigation to dead code would ship a mitigation that never executes.

It audits and reports only. Repair is not automated, because choosing which duplicate is
canonical has data-attribution consequences.

## Impact

- **Affected specs:** `scanning` — 2 ADDED
- **Affected code:**
  - `src/main/graviscan/scanner-upsert.ts` — `upsertScannerRow()` precedence, ambiguity
    refusal, and `usb_port` preservation
  - `src/main/graviscan/scanner-handlers.ts` — `matchDetectedToDb()` (exported for testing);
    `saveScannersToDB`'s stale-disable guard
  - a new startup audit module, invoked from a main-process startup path that executes
- **Affected consumers not edited but behaviourally affected:** `src/renderer/GraviScan.tsx`
  (`saneNames` at session start), `src/main/graviscan/register-handlers.ts:159-186`
  (spawn-on-discovery consumes `upsertScannerRow`'s returned row),
  `runStartupScannerValidation` (`scanner-handlers.ts:158`, the second `matchDetectedToDb`
  caller — and itself dead code)
- **Tests:** `tests/unit/graviscan/scanner-upsert.test.ts`,
  `tests/unit/graviscan/scanner-handlers.test.ts`, plus a new audit test file
- **No schema change,** therefore no migration. A unique constraint on `usb_port` is the honest
  structural consequence of promoting it to primary identity, and is deliberately **not** taken
  here — it needs a migration and a duplicate-resolution policy. Filed instead. One consequence
  of shipping without it: a row holding a usable-but-wrong port cannot be re-pointed by any
  in-app path, since `upsertScannerRow` is the only writer of `usb_port` in the main process and
  can no longer reach such a row. The recorded remedy is the existing per-row disable followed
  by a re-detect.
- **No feature flag.** §1's fallbacks are behaviour-preserving for clean installs and the audit
  is read-only. Rollback is a redeploy of the previous build, after which rows created under the
  new precedence remain and the old code will match _them_ by device number — stated so it is a
  known consequence rather than a surprise.
- **Out of scope:** the retry-path address refresh (`fix-graviscan-retry-stale-usb-address`),
  comparing stored ports against live detection, #203 (identity following the port is accepted),
  #219 (Windows `firmware_serial`), and `display_name`'s positional rewriting on every Detect.

## Related

- Warrants: #167, #203, #243. Precondition for `fix-graviscan-retry-stale-usb-address`
  (#182).
- #196 — the stale PR carrying the three stranded scanner-identity proposals; close or
  rebase separately.
- Filed separately: the absent `usb_port` unique constraint; `graviscan:save-scanners-db`
  having no main-process active-scan guard.
