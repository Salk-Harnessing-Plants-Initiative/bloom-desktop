# Fix GraviScan scanner-identity matching precedence

## Why

GraviScan matches a detected USB scanner to its saved `GraviScanner` row on
`usb_bus`+`usb_device` **first**, falling back to `usb_port` — in
`matchDetectedToDb()` (`src/main/graviscan/scanner-handlers.ts:87-109`) and
`upsertScannerRow()` (`src/main/graviscan/scanner-upsert.ts:56-81`). The operating
system reassigns `usb_device` on every reconnect, so after a re-enumeration a device's
new number can coincide with a *different* saved scanner's stored `usb_device` and bind
the wrong `scanner_id`. Device numbers were observed climbing 005 → 006 → 007 → 008
within one session on a five-scanner rig where every scanner is the same model.

**This silently misattributes scientific data.** `matchDetectedToDb` is the only join
between "whose plate barcodes" and "which physical scanner": its output becomes
`GraviScan.tsx`'s `saneNames` map, which `useScanSession.ts:897` turns into each
worker's `--device` argument. On a coincidence, scanner A's barcodes are applied to
images produced by a *different* physical scanner — **and** the legitimate owner gets no
`saneName`, resolves to `?? ''`, fails `buildSubprocessEnv`'s validation and drops out of
the run with no error surfaced.

On the write path it is worse. `upsertScannerRow` overwrites the mis-matched row's
`usb_port`, `display_name` **and `name`** — and `name` is what
`src/main/graviscan-upload.ts:281` resolves *at upload time* into `scanner_name` for
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

- `openspec/specs/scanning/spec.md:1229` already requires `saveScannersToDB` to upsert
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
addressed by Decision 4's startup audit rather than assumed away.

## What Changes

### 1. Invert the precedence in both functions — **BREAKING** (data identity, no migration)

`matchDetectedToDb()` and `upsertScannerRow()` match on `usb_port` first. `usb_bus`+
`usb_device` is retained as a fallback, reached **only when the detected scanner (or the
upsert payload) carries no usable `usb_port`** — never merely because a port lookup found
no match. A detected scanner with a usable port that matches no row is a *new* scanner;
matching it by device number is what lets a relocated scanner capture an unrelated row's
identity.

`validateConfig()` and `resetUsb()` are **not** changed: they already match on `usb_port`
only and have no fallback, and that is intentional.

Port lookups are made deterministic — `orderBy: [{ enabled: 'desc' }, { updatedAt: 'desc' }]`
— because `usb_port` has no uniqueness constraint (`prisma/schema.prisma:237`) and the
current defect can itself produce duplicate-port rows. An unordered `findFirst` would pick
an arbitrary, possibly older and disabled, duplicate, which would be a *regression* on
exactly the databases this bug has already damaged.

**Why BREAKING:** `usb_port` is nullable and no migration ever backfilled it. On an install
whose rows carry `null`/`''` ports — or ports whose notation differs from live detection —
a subsequent "Detect Scanners" can now create a **new** `GraviScanner` row instead of
updating the existing one, changing which `scanner_id` later plates attach to, while
historical scans stay on the old row. That is a silent, un-migrated change to persisted
scientific identity triggered by an unchanged user action.

### 2. Stop destroying `usb_port`

`upsertScannerRow` preserves a usable stored port rather than overwriting it with a less
usable value: `payload.usb_port || existing.usb_port || null`. This closes the transient-
`lsusb -t`-failure fork described above. It is in scope rather than a follow-up precisely
because §1 promotes `usb_port` to primary identity — the gap is one this change's own
design creates.

### 3. Read-only startup port audit

Because §1 is BREAKING with no migration, the system reports — read-only, at startup, to
the durable scan log — enabled rows with a null or empty `usb_port`, duplicate non-empty
ports, and ports that do not byte-match live `buildUsbPort()` output. This is the honest
substitute for the migration this change declines to write: it turns a one-rig manual
pre-flight into something every install performs, and it is the only way an operator learns
that wedge recovery will not work for a given scanner *before* they need it at 2am.

It audits and reports only. It repairs nothing, because choosing which of two duplicate
rows is canonical is a decision with data-attribution consequences that belongs to an
operator, not to a startup path.

## Impact

- **Affected specs:** `scanning` — 2 ADDED
- **Affected code:**
  - `src/main/graviscan/scanner-handlers.ts` — `matchDetectedToDb()` (exported for testing)
  - `src/main/graviscan/scanner-upsert.ts` — `upsertScannerRow()` precedence, ordering,
    and `usb_port` preservation
  - one startup audit function, called from GraviScan's existing startup validation path
- **Affected consumers not edited but behaviourally affected:** `src/renderer/GraviScan.tsx`
  (`saneNames` at session start), `src/main/graviscan/register-handlers.ts:159-186`
  (spawn-on-discovery consumes `upsertScannerRow`'s returned row),
  `runStartupScannerValidation` (`scanner-handlers.ts:177`, the second `matchDetectedToDb`
  caller)
- **Tests:** `tests/unit/graviscan/scanner-upsert.test.ts`,
  `tests/unit/graviscan/scanner-handlers.test.ts`, plus a new audit test file
- **No schema change,** therefore no migration. A unique constraint on `usb_port` is the
  honest structural consequence of promoting it to primary identity, and is deliberately
  **not** taken here — it needs a migration and a duplicate-resolution policy. Filed instead.
- **Out of scope:** the retry-path address refresh (`fix-graviscan-retry-stale-usb-address`),
  #203 (scanner moved to a different port — identity following the port is accepted
  behaviour), #219 (Windows `firmware_serial`).

## Related

- Warrants: #167, #203, #243. Precondition for `fix-graviscan-retry-stale-usb-address`
  (#182).
- #196 — the stale PR carrying the three stranded scanner-identity proposals; close or
  rebase separately.
- Filed separately: the absent `usb_port` unique constraint; `graviscan:save-scanners-db`
  having no main-process active-scan guard.
