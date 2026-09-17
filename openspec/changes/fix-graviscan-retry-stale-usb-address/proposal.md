# Fix GraviScan's stale USB address on scanner reconnect

## Why

Issue #182 has two halves, and both are open. A physical power-cycle — the only thing that
clears a V600 wedge (#228) — always re-enumerates the scanner at a new USB device number,
and both of GraviScan's reconnect paths rebuild their SANE device name from a value captured
before that happened. A stale-but-well-formed name like `epkowa:interpreter:001:007` passes
every validation in `scanner-subprocess.ts:91-105` and reaches libusb as a `SANE_USB_FILTER`
for a device that is no longer there, so the failure surfaces as the misleading
`Failed to open device after 3 attempts`.

**Half 1 — the operator's "Power-Cycled & Retry" button.** `retryScanner()` builds its name
with `buildSaneName(row.usb_bus, row.usb_device)` (`session-handlers.ts:376`). Those columns
are written in exactly two places, **neither on the retry path**: `resetUsb()`
(`scanner-handlers.ts:646` clears, `:712-718` writes) and `upsertScannerRow()`
(`scanner-upsert.ts:84-124`, reachable only from the Configure Scanner page's "Detect
Scanners" button). `WedgeBanner.tsx:37` calls retry directly, so nothing re-detects.

**Half 2 — the worker's own automatic recovery, which is #182's original subject.** The issue
is titled *"USB device number changes **after scan failure**"* and its body asks to
re-enumerate *"on scan failure"*, with no operator involved. `scan_worker.py` sets
`self.device_name` once in `__init__` (`:249`) from its `--device` argument (`:911`), and
`_reopen_device()` re-opens that frozen name (`:774`) from `_sane_scan`'s retry loop. So a
mid-scan failure that re-enumerates the device sends the automatic recovery at a dead
address, burning 5 scan attempts × 3 reopen attempts and terminating in
`Failed to reopen device after 3 attempts` — which is verbatim the string #279 observed in
the wedge banner. This half plausibly *aggravates* the wedges that #279 exists to validate
recovery from.

**Half 1 reproduced on real hardware 2026-09-16** on rig `pbiob-gh-04` (#182's 2026-09-16
comment): the DB was synced to `usb_device: 7` immediately before a physical power-cycle; the
device returned at `Bus 001 Device 008`; a scan session started **successfully** on the
live-detected name `epkowa:interpreter:001:008`, proving the scanner was healthy and
openable; `retryScanner` then **failed** on that same device. The only difference was the
source of the name — live `lsusb` versus the stale DB row. Device numbers were observed
climbing 005 → 006 → 007 → 008 within a single session.

This is why #279 checklist item 4 FAILS, which makes #182 a Tier 2 hard-block on the
production cutover (`docs/superpowers/plans/2026-09-02-graviscan-production-cutover-roadmap.md`).

### The standing spec currently certifies the bug

`openspec/specs/scanning/spec.md:4104` prescribes the broken mechanism *by name* — a
`saneName` "rebuilt from a **fresh database read** of the scanner's current
`usb_bus`/`usb_device`" — and its first scenario pins the literal
`'epkowa:interpreter:003:007'`. A fresh *database* read is not a fresh *USB identity*. That
requirement cannot be satisfied and #182 fixed at once, so a `MODIFIED` delta on it is
mandatory.

## What Changes

### 1. Re-detect before rebuilding the SANE name (half 1)

A new module `src/main/graviscan/scanner-usb-refresh.ts` provides a **pure** port-primary
matcher and an IO wrapper that reads the row, detects once, matches on the stable `usb_port`,
persists changed `usb_bus`/`usb_device`, and returns a discriminated outcome (`refreshed` |
`not-detected` | `no-stable-port` | `row-missing` | `detection-failed`). `retryScanner()`
calls it **before** `stopScanner()`, so a scanner that cannot be re-resolved is left running
rather than stopped and unrecoverable.

Detection on this path is **asynchronous**. `detectEpsonScanners()` is `execFileSync` twice
over (`lsusb-detection.ts:148` and `:161`, each `timeout: 5000`), which would block the
Electron main-process event loop for up to ~10s *during an active session* — delaying
`scanInterval`'s sleep (a real interval error in a gravitropism time series) and pushing other
scanners' in-flight rows toward `SCAN_ROW_TIMEOUT_MS`. A new async detection variant is added;
the three existing synchronous call sites are left alone.

`ScannerRetryLookupDb` is widened via a new read/write `ScannerUsbRefreshDb` declared in the
refresh module, which `ScannerRetryLookupDb` extends — rather than adding an `update` method
to an interface whose read-only-ness is `session-handlers.ts:25-28`'s stated rationale.

### 2. Resolve the address at spawn time, not enqueue time

`retryScanner()` requires an active session, and `isScanning` is true for both `'scanning'`
and `'waiting'` (`scan-coordinator.ts:207-209`), so `addScanner()` takes its **queued** branch
(`:377-416`) and captures `config.saneName` in a closure that runs on the next
`cycle-complete` — which `register-handlers.ts:137-141` itself describes as "potentially hours
for a continuous session". Refreshing only in `retryScanner()` would therefore fix the address
at click time, not at use time.

`ScannerConfig` gains an optional `resolveSaneName` resolver that the shared spawn path calls
immediately before constructing the `ScannerSubprocess`. An absent, throwing or empty resolver
falls back to `config.saneName`, so resolution can never fail a spawn that would otherwise
have been attempted.

This matters more because of #366: the queued retry has no timeout and no feedback, which is
precisely what would prompt an operator to power-cycle a second time and invalidate the
first refresh. #366 stays separate (see `design.md`), but resolve-at-spawn removes its
ability to reintroduce the staleness.

### 3. Re-resolve the worker's device name on reopen (half 2)

`scan_worker.py` gains a `--usb-port` argument and re-resolves its device name from that port
immediately before each reopen attempt, reading the current bus and device numbers from sysfs
(`/sys/bus/usb/devices/<port>/{busnum,devnum}`) and verifying `idVendor`/`idProduct` before
using them. A missing port, an empty port, a different model at the port, or any failure falls
back to the spawn-time name and behaves exactly as today — the change can only widen the set
of recoverable failures.

sysfs rather than `lsusb` because the worker must recover without help, the kernel names those
directories with exactly the `<bus>-<port-path>` string `buildUsbPort()` already produces, and
a plain file read needs no subprocess. No device-level USB reset is introduced
(`scanning/spec.md:2655`).

### 4. Fix the identity-matching precedence inversion — **BREAKING** (data identity, no migration)

`matchDetectedToDb()` (`scanner-handlers.ts:87-109`) and `upsertScannerRow()`
(`scanner-upsert.ts:56-81`) match on `usb_bus`+`usb_device` **first** and fall back to
`usb_port`. After a re-enumeration a device's *new* number can coincide with a *different*
saved scanner's stored `usb_device`, binding the wrong `scanner_id`.

This is live and silent, and the consequence is worse than "a wrong label". `matchDetectedToDb`
is the only join between "whose plate barcodes" and "which physical scanner": its output
becomes `GraviScan.tsx:114-132`'s `saneNames` map, which `useScanSession.ts:897` turns into
each worker's `--device`. On a coincidence, scanner A's barcodes are applied to images from a
*different* physical scanner, **and** the legitimate owner gets no `saneName`, resolves to
`?? ''`, fails `buildSubprocessEnv` validation and silently drops out of the run. On the write
path, `upsertScannerRow` also overwrites the victim row's `name` — and `name` is what
`graviscan-upload.ts:281` resolves *at upload time* into `scanner_name` for every historical
scan on that row, so the corruption reaches already-captured data.

Both are inverted to `usb_port`-primary. Two details matter:

- The fallback is gated on the **detected** scanner carrying no usable `usb_port` — not on the
  port lookup merely missing. A naive swap would let a scanner on a genuinely new port fall
  through to bus/device and take over whichever row shares its device number, reproducing the
  hazard this change exists to remove.
- The port lookup is made deterministic (`orderBy: [{ enabled: 'desc' }, { updatedAt: 'desc' }]`).
  `usb_port` has no unique constraint (`prisma/schema.prisma:237`), and the current defect can
  itself create duplicate-port rows; an unordered `findFirst` would pick an arbitrary — possibly
  older and disabled — duplicate, which would be a *regression* on exactly the databases this
  bug has already damaged.

**Why BREAKING:** `usb_port` is nullable and no migration ever backfilled it. On an install
whose rows carry `null`/`''` ports, a subsequent "Detect Scanners" can now create a new
`GraviScanner` row instead of updating the existing one, changing which `scanner_id` later
plates attach to — a silent, un-migrated change to persisted scientific identity, triggered by
an unchanged user action. Operators should confirm `usb_port` is populated on all enabled rows
before upgrading. A unique constraint on `usb_port` is the honest structural consequence of
promoting it to primary identity; it is deliberately **not** taken here (it would need a
migration and a duplicate-resolution policy) and is filed instead.

**Issue warrants.** #167 states this ordering as the defect and asks to "deduplicate on save by
`usb_port`". #203 asserts as fact that `usb_port` is already "the primary stable-identity key
(renderer enabledMap + main-process `matchDetectedToDb`)" and that this "resolves #182 for the
common case" — a premise that is **false on `main`**, because the change it credits
(`fix-scanner-config-save-flow`) exists only on PR #196's unmerged branch. This change is what
finally makes #203's stated precondition true. The standing spec already requires
`saveScannersToDB` to upsert "matching by USB port" (`scanning/spec.md:1229`), so the code — not
the spec — is the deviation.

**#243 must be read before reviewing this.** #243 was closed 2026-09-10 with a comment stating
that `upsertScannerRow` "matches existing rows first by `(usb_bus, usb_device)`, then falls back
to `usb_port` … added specifically to prevent this failure mode". Inverting that order does
**not** regress #243: its symptom was *creating fresh UUIDs instead of updating*, and the create
branch is still reached only after **both** keys miss. Port-primary is in fact stronger against
it, because `usb_port` survives `resetUsb()`'s clearing of bus/device while the converse is
false. #243's unresolved root-cause hypothesis — that detection's `usb_port` string may differ
in notation from the stored one (`1-10` vs `1-10.0` vs `1-10:1.0`) — is a live risk now that a
port miss hard-fails a retry, and is pre-flighted byte-exactly on the rig rather than assumed.

## Impact

- **Affected specs:** `scanning` — 4 ADDED, 2 MODIFIED
- **Affected code:**
  - `src/main/graviscan/scanner-usb-refresh.ts` (new)
  - `src/main/lsusb-detection.ts` — async detection variant (note: **not** under `graviscan/`)
  - `src/main/graviscan/session-handlers.ts` — `retryScanner()`, `ScannerRetryLookupDb`
  - `src/main/graviscan/scanner-handlers.ts` — `matchDetectedToDb()`, `resetUsb()` step 5
  - `src/main/graviscan/scanner-upsert.ts` — `upsertScannerRow()` match precedence
  - `src/main/graviscan/scan-coordinator.ts` — `resolveSaneName` at the spawn choke point
  - `src/main/graviscan/scanner-subprocess.ts` — pass `--usb-port` to the worker
  - `src/types/graviscan.ts` — `ScannerConfig.resolveSaneName`
  - `python/graviscan/scan_worker.py` — `--usb-port`, re-resolve on reopen
- **Affected consumers not edited but behaviourally affected:** `src/renderer/GraviScan.tsx`
  (`saneNames` at session start), `src/main/graviscan/register-handlers.ts:159-186`
  (spawn-on-discovery consumes `upsertScannerRow`'s returned address),
  `runStartupScannerValidation` (`scanner-handlers.ts:177`, the second `matchDetectedToDb`
  caller). `wiring.ts`'s `ScannerLookupDb` reads `usb_port` but **not** `usb_bus`/`usb_device`,
  so it cannot race the refresh write.
- **Tests:** `tests/unit/graviscan/scanner-usb-refresh.test.ts` (new),
  `session-handlers.test.ts`, `scanner-upsert.test.ts`, `scanner-handlers.test.ts`,
  `reset-usb-handler.test.ts`, `tests/unit/lsusb-detection.test.ts`,
  `tests/unit/components/WedgeBanner.test.tsx`, `tests/e2e/graviscan-ipc.e2e.ts`,
  `python/tests/` (worker re-resolution)
- **Docs:** `docs/superpowers/plans/2026-09-02-graviscan-production-cutover-roadmap.md`
- **No renderer edit.** `WedgeBanner`'s existing contract already covers the new failures: the
  scenario "Retry failure keeps the entry visible with an inline error"
  (`ui-management-pages/spec.md:2358`, under the requirement "GraviScan Wedge Response Actions"
  at `:2331`) renders the returned `error` inline, keeps the entry, and re-arms Confirm Retry.
  #279 item 5 confirmed that gate behaves well, so it is untouched — but note that item 5's
  *mechanism* changes (a powered-off scanner is now refused before `stopScanner`/`addScanner`
  rather than re-attempted), so its evidence needs re-recording.
- **No schema change,** therefore no migration. `usb_port` already exists.
- **Out of scope:** #366 (queued `addScanner` has no timeout), #203 (scanner moved to a
  different port), #219 (Windows `firmware_serial`), a `usb_port` unique constraint, and the
  per-rebind audit table from the stranded `add-scanner-firmware-serial-identity` proposal.

## Related

- Fixes #182 (both halves). Unblocks #279 item 4, and thereby one of the six Tier 2 hard-blocks.
- Warrants for §4: #167, #203, #243.
- #366 — adjacent, same function, deliberately separate; §2 removes its ability to reintroduce
  the staleness.
- #363 — becomes more load-bearing: a hard-failed retry means the wedged scanner contributes no
  plates for the rest of an unattended run, which is exactly the unseen-outcome gap #363 covers.
- #369 — its note that "#182 will make recovery from the induced wedge fail" becomes obsolete.
- #228 — the V600 wedge root cause.
- #196 — the stale PR carrying the three stranded scanner-identity proposals; close or rebase
  separately, not here.
- Filed separately from this change: the worker-death logging gap (#368) adjacent to §3's
  logging, and new issues for `graviscan:reset-usb` / `graviscan:save-scanners-db` having no
  main-process active-scan guard, and for the absent `usb_port` unique constraint.
