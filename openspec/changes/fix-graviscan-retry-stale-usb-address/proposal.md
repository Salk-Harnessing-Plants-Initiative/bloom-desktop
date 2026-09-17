# Fix GraviScan's stale USB address on scanner reconnect

> **Depends on `fix-graviscan-scanner-identity-precedence`.** That change establishes
> `usb_port` as primary identity, stops it being destroyed by a transient detection failure,
> and adds a startup port audit. This change **hard-fails** a retry when a scanner's
> `usb_port` is missing or does not match live detection, so that port hygiene is its
> precondition. Land the precedence change first.

## Why

The wedge banner's **"Power-Cycled & Retry"** button does not work. A V600 wedge can only be
cleared by a physical power-cycle (#228), so this button is the entire operator recovery path
for the wedge-response feature — and that feature already hard-blocks the production cutover.

`retryScanner()` builds its SANE device name with `buildSaneName(row.usb_bus, row.usb_device)`
(`src/main/graviscan/session-handlers.ts:376`). Those columns are written in exactly two
places, **neither on the retry path**: `resetUsb()` (`scanner-handlers.ts:646` clears,
`:712-718` writes) and `upsertScannerRow()` (reachable only from the Configure Scanner page's
"Detect Scanners" button). `WedgeBanner.tsx:37` calls retry directly, so nothing re-detects.
Every physical power-cycle re-enumerates the device at a new USB device number, so retry always
rebuilds a dead address — and a stale-but-well-formed name like `epkowa:interpreter:001:007`
passes every validation in `scanner-subprocess.ts:91-105` and reaches libusb as a
`SANE_USB_FILTER` for a device that is no longer there. The failure surfaces as the misleading
`Failed to open device after 3 attempts`.

**Reproduced on real hardware 2026-09-16** on rig `pbiob-gh-04` (#182's 2026-09-16 comment): the
DB was synced to `usb_device: 7` immediately before a physical power-cycle; the device returned
at `Bus 001 Device 008`; a scan session started **successfully** on the live-detected name
`epkowa:interpreter:001:008`, proving the scanner was healthy and openable; `retryScanner` then
**failed** on that same device. The only difference was the source of the name — live `lsusb`
versus the stale DB row. Device numbers were observed climbing 005 → 006 → 007 → 008 within one
session. A read-only pre-flight on 2026-09-17 found the rig's row *already* stale
(`usb_device: 8` against a live `devnum` of 9) with no inducement.

This is why #279 checklist item 4 FAILS, making #182 a Tier 2 hard-block on the cutover
(`docs/superpowers/plans/2026-09-02-graviscan-production-cutover-roadmap.md`).

### There are three stale-name paths, not one

1. **The retry button** — above.
2. **Session start.** `GraviScan.tsx:113-132` fetches the `saneNames` map via `detectScanners()`
   in a `useEffect` with `[]` dependencies — once per page mount. `useScanSession.ts:897` reads
   `saneNames[scannerId] ?? ''` into the `startScan` payload and `session-handlers.ts:158-162`
   maps it straight to `ScannerConfig[]`. So the most plausible operator recovery — cancel the
   session, power-cycle, start a new one, without leaving the page — fails with the *identical*
   error. Fixing the button without this would fix the feature and leave the workaround broken.
3. **Spawn-time staleness on the retry path itself.** `retryScanner` requires an active session,
   and `isScanning` is true for both `'scanning'` and `'waiting'`
   (`scan-coordinator.ts:207-209`), so `addScanner()` takes its **queued** branch (`:377-416`),
   capturing `config.saneName` in a closure that runs on the next `cycle-complete` —
   `register-handlers.ts:137-141` describes that delay in the repo's own words as "potentially
   hours for a continuous session". Refreshing only at click time fixes the address at click
   time, not at use time.

### The standing spec currently certifies the bug

`openspec/specs/scanning/spec.md:4104` prescribes the broken mechanism *by name* — a `saneName`
"rebuilt from a **fresh database read** of the scanner's current `usb_bus`/`usb_device`" — and
its first scenario pins the literal `'epkowa:interpreter:003:007'`. A fresh *database* read is
not a fresh *USB identity*, so that requirement cannot be satisfied and #182 fixed at once. A
`MODIFIED` delta on it is mandatory.

## What Changes

### 1. Re-detect before rebuilding the SANE name

A new module `src/main/graviscan/scanner-usb-refresh.ts` provides a **pure** port matcher and an
IO wrapper that reads the row, detects, matches on `usb_port`, persists changed
`usb_bus`/`usb_device`, and returns a discriminated outcome (`refreshed` | `not-detected` |
`no-stable-port` | `unusable-address` | `row-missing` | `detection-failed`). `retryScanner()`
calls it **before** `stopScanner()`, so a scanner that cannot be re-resolved is left running
rather than stopped and unrecoverable.

Detection on this path is **asynchronous**. `detectEpsonScanners()` is `execFileSync` twice over
(`src/main/lsusb-detection.ts:148` and `:161`, each `timeout: 5000`), which would block the
Electron main-process event loop for up to ~10s *during an active session* — delaying
`scanInterval`'s sleep, which is a real interval error in a gravitropism time series, and pushing
other scanners' in-flight rows toward `SCAN_ROW_TIMEOUT_MS`, the entry condition for #371's
permanent false `MISSING` on an unrelated healthy scanner. An async variant is added, sharing one
pure parse-and-dedupe core with the existing synchronous function so the two cannot drift. The
**four** existing synchronous call sites (`scanner-handlers.ts:166`, `:262`, `:523`, `:676`) keep
using the synchronous shell.

### 2. Resolve the address at spawn time, for the retry and session-start paths

`ScannerConfig` gains an optional `resolveSaneName` returning a name or a promise of one, called
by the shared spawn path immediately before constructing the `ScannerSubprocess`. It is attached
by the retry path and by session start; `resetUsb()`'s re-initialisation and the save-scanners
spawn-on-discovery path deliberately do not attach one, because each performs its own detection
in the same operation.

Three constraints make this safe, and each is a defect the design would otherwise introduce:

- **A generation token.** Resolution adds the first `await` between entering the spawn path and
  registering the subprocess in the coordinator's map. `spawnSingleScanner` installs its
  in-flight guard *after* the body's first synchronous segment (`:481-490`), and `stopScanner`
  deletes that guard *first* then early-returns when the map has no entry (`:429-433`). So an
  attempt suspended in resolution would be cancellable by nothing and awaited by nothing —
  permitting two live workers for one scanner, or a worker spawned against an already-shut-down
  coordinator. A per-`scannerId` token, captured before resolution and re-checked after, closes
  both; `stopScanner` and `shutdown` invalidate it.
- **Its own timeout.** `withTimeout(sub.spawn(), SPAWN_READY_TIMEOUT_MS)` covers only `spawn()`.
  An unbounded resolver could strand the in-flight guard and make a scanner un-spawnable for the
  rest of the session, while `retriesInFlight` holds the operator's button dead.
- **Logged fallback.** An absent resolver is ordinary; a *failing* one means the worker is about
  to spawn on a known-stale address, which is the defect this change exists to remove — after
  the operator has been told the retry succeeded. Every failure-caused fallback is logged with
  its cause, distinctly from the no-resolver case.

## Impact

- **Affected specs:** `scanning` — 3 ADDED, 2 MODIFIED
- **Affected code:**
  - `src/main/graviscan/scanner-usb-refresh.ts` (new)
  - `src/main/lsusb-detection.ts` — shared pure core plus an async detection shell
    (note: **not** under `graviscan/`)
  - `src/main/graviscan/session-handlers.ts` — `retryScanner()`, `ScannerRetryLookupDb`, and
    `startScan`'s `ScannerConfig[]` construction (`:158-162`)
  - `src/main/graviscan/scanner-handlers.ts` — `resetUsb()` step 5 uses the shared matcher
  - `src/main/graviscan/scan-coordinator.ts` — resolver call, generation token, resolver timeout
  - `src/types/graviscan.ts` — `ScannerConfig.resolveSaneName`
- **`buildSaneName` is deduplicated.** It exists twice with identical bodies —
  `scanner-handlers.ts:39` (whose own doc comment falsely claims "the format lives in exactly one
  place") and `lsusb-detection.ts:116`, re-exported at `:235` and imported by nothing. This change
  moves name construction from one place into two callers, which makes the duplication
  load-bearing, so it is collapsed to a single definition rather than left to drift.
- **Affected consumers not edited:** `src/renderer/components/WedgeBanner.tsx` needs no change —
  the existing scenario "Retry failure keeps the entry visible with an inline error"
  (`ui-management-pages/spec.md:2358`, under the requirement at `:2331`) renders the returned
  `error` inline, keeps the entry, and re-arms Confirm Retry. #279 item 5 confirmed that gate
  behaves well. Its *mechanism* changes, though — a powered-off scanner is now refused before
  `stopScanner`/`addScanner` rather than re-attempted — so item 5's evidence must be re-recorded.
- **No schema change,** therefore no migration.
- **Out of scope:** the identity-matching precedence inversion (now
  `fix-graviscan-scanner-identity-precedence`, and a prerequisite); the worker-side automatic
  reconnect (see below); #366; #203; #219.

### #182's worker half is deliberately not fixed here

#182's title and body are about the *worker's* automatic reconnect after a scan failure, with no
operator involved: `scan_worker.py` sets `self.device_name` once (`:249`) and `_reopen_device()`
re-opens that frozen name (`:774`). Re-resolving it inside the worker **cannot work**, because
`src/main/native/libusb-filter.c` reads `SANE_USB_FILTER` exactly once per process into a
`static` (guarded by `filter_initialized`) and then blocks any Epson device whose live `bus:addr`
does not match, returning `LIBUSB_ERROR_BUSY`. `buildSubprocessEnv` sets that filter from the
spawn-time name on every real Linux spawn, and the worker's own startup `sane.open()` primes the
cache before any recovery runs. A worker that re-resolved `001:007` → `001:008` would be blocked
by its own filter, and would log a successful re-resolution while nothing was fixed.

Fixing it requires the shim to re-read its filter (or to filter on the stable port path via
`libusb_get_port_numbers()`), plus a `libusb-filter.so` rebuild and packaging re-verification on
real hardware. That is a different change in a different language, and it is filed with this
finding recorded rather than attempted here. So this change **partially addresses #182** and does
not close it.

## Related

- Partially addresses #182 (the operator-retry half). Unblocks #279 item 4.
- Prerequisite: `fix-graviscan-scanner-identity-precedence` (#167, #203, #243).
- **#366 must land before #279 item 4 is marked passed.** This change makes retry *correct*, but
  during an interval session the queued respawn leaves Confirm Retry disabled with no feedback
  for up to a full interval. So "the button doesn't work" becomes "the button appears to do
  nothing for up to an interval". #366 bounds that wait and surfaces the queued state. Keeping
  them separate is right — one is correctness, the other liveness — but item 4's pass/fail is
  ambiguous until both ship, and the cutover block is not honestly cleared by this change alone.
- #363 — becomes more load-bearing: a hard-failed retry means the scanner contributes no plates
  for the rest of an unattended run, which is exactly the unseen-outcome gap #363 covers.
- #369 — its note that "#182 will make recovery from the induced wedge fail" becomes obsolete.
- #371 — §1's async detection removes a way this change could have triggered it.
- Filed separately: #182's worker half with the shim finding; `graviscan:reset-usb` having no
  main-process active-scan guard; `usb_port` and the device name being absent from the TIFF
  `ImageDescription`, so images are not self-describing as to which scanner produced them.
