# Fix GraviScan retry-scanner's stale USB address

## Why

The wedge banner's **"Power-Cycled & Retry"** button does not work. It is the only
documented operator recovery path for a wedged Epson V600, and a V600 wedge can only
be cleared by a physical power-cycle — so when this button fails, the wedge-response
feature has no recovery path at all.

`retryScanner()` (`src/main/graviscan/session-handlers.ts:376`) rebuilds the SANE
device name with `buildSaneName(row.usb_bus, row.usb_device)` from the `GraviScanner`
row. Those two columns are written in exactly two places, **neither of which is on the
retry path**:

- `resetUsb()` — `scanner-handlers.ts:646` (clears them) and `:712-718` (writes fresh values)
- `upsertScannerRow()` — `scanner-upsert.ts:84-124`, reached only via `saveScannersToDB()`,
  i.e. only via the Configure Scanner page's "Detect Scanners" button

`WedgeBanner.tsx:37` calls `retryScanner` directly, so nothing re-detects. Every
physical power-cycle re-enumerates the V600 at a new USB device number, so retry
always rebuilds a **dead address** — and a stale-but-well-formed name like
`epkowa:interpreter:001:007` passes every validation in
`scanner-subprocess.ts:91-105` and reaches libusb as a `SANE_USB_FILTER` for a device
that no longer exists there. The failure surfaces as the misleading
`Failed to open device after 3 attempts`.

**Reproduced on real hardware 2026-09-16** on rig `pbiob-gh-04` (issue #182's
2026-09-16 comment): the DB was synced to `usb_device: 7` immediately before a physical
power-cycle; the device returned at `Bus 001 Device 008`; a scan session started
**successfully** on the live-detected name `epkowa:interpreter:001:008`, proving the
scanner was healthy and openable; `retryScanner` then **failed** on that same device.
The only difference between the success and the failure was the source of the device
name — live `lsusb` versus the stale DB row. Device numbers were observed climbing
005 → 006 → 007 → 008 within a single session.

This is why #279 checklist item 2.4 FAILS, which makes #182 a Tier 2 hard-block on the
production cutover (roadmap:
`docs/superpowers/plans/2026-09-02-graviscan-production-cutover-roadmap.md`).

### The standing spec currently certifies the bug

`openspec/specs/scanning/spec.md:4104` prescribes the broken mechanism *by name* —
a `saneName` "rebuilt from a **fresh database read** of the scanner's current
`usb_bus`/`usb_device`" — and its first scenario pins the literal string
`'epkowa:interpreter:003:007'`. A fresh *database* read is not a fresh *USB identity*.
This requirement therefore cannot be satisfied and #182 fixed at the same time, so a
`MODIFIED` delta on it is mandatory rather than optional.

## What Changes

### 1. Re-detect before rebuilding the SANE name (the #182 fix)

A new module `src/main/graviscan/scanner-usb-refresh.ts` provides:

- `matchScannerByPort(detected, row)` — a **pure** port-primary matcher
- `refreshScannerUsbAddress(db, scannerId, detect?)` — reads the row, runs detection
  once, matches on the stable `usb_port`, persists changed `usb_bus`/`usb_device`, and
  returns a discriminated `RefreshOutcome` (`refreshed` | `not-detected` |
  `no-stable-port` | `detection-failed`)

`retryScanner()` calls `refreshScannerUsbAddress()` **before** `stopScanner()` —
detection is read-only, so a detection failure leaves the running worker untouched
rather than stopping a scanner that then cannot be respawned.

`ScannerRetryLookupDb` (`session-handlers.ts:29-37`) is widened to carry `id`,
`usb_port` and an `update` method; today it exposes only `usb_bus`, `usb_device` and
`enabled`, so it structurally cannot support port matching.

### 2. `resetUsb()` shares the matcher, not the IO wrapper

`resetUsb()` step 5 (`scanner-handlers.ts:687-719`) already implements the correct
logic — match detected→saved **by `usb_port`**, then write fresh `usb_bus`/`usb_device`
— and its own step-2 comment says it preserves `usb_port` "for stable matching". The
fix is to lift that matching out so both paths share one definition.

The shared unit is the **pure matcher**, not `refreshScannerUsbAddress()`. Calling the
IO wrapper per scanner inside `resetUsb()`'s loop would run `lsusb` once per scanner
instead of once per reset, changing its behaviour and cost. `resetUsb()` keeps its
single detection pass.

`resetUsb()` itself is **not** reusable from the retry path: `scanning/spec.md:2379`
and `ui-management-pages/spec.md:2159` specify that Reset USB is blocked while a scan
is active, whereas `scanning/spec.md:4104` specifies that retry **requires** an active
session — and `resetUsb()` would `coordinator.shutdown()` the entire fleet mid-session
to recover one scanner.

### 3. Fix the identity-matching precedence inversion

`matchDetectedToDb()` (`scanner-handlers.ts:87-108`) and `upsertScannerRow()`
(`scanner-upsert.ts:56-80`) both match on `usb_bus`+`usb_device` **first** and fall
back to `usb_port` — the inverse of what `resetUsb()` and `validateConfig()` do, and
the inverse of what the specs already assert. After a re-enumeration a device's *new*
number can coincide with a *different* saved scanner's stored `usb_device`, binding the
wrong `scanner_id`. In `upsertScannerRow()` — the write path — that coincidence
**overwrites the other row's `usb_port` and `display_name`**, scrambling scanner
identity. With device numbers observed climbing 005 → 008 across five scanners, this is
a live data-integrity hazard, not a theoretical one: plates would be attributed to the
wrong physical scanner.

Both are inverted to `usb_port`-primary with `usb_bus`+`usb_device` retained as a
**fallback** — that fallback is the only option left when `lsusb -t` is unavailable and
`usb_port` comes back as `''` (`lsusb-detection.ts:185`).

This is not a new invention. It is the matching priority already authored in the
stranded proposal `add-scanner-firmware-serial-identity` (commit `5e294cd` on
`origin/feat/graviscan-renderer`, PR #196, open and untouched since 2026-05-01):
**`firmware_serial → usb_port → composite`**, with an explicit note that the V600
returns `iSerial 0` so the system must degrade to `usb_port`-primary. Its sibling
proposal `fix-renderer-empty-scanner-id-collision` states the rule outright:

> `usb_bus`+`usb_device` alone SHALL NOT be treated as primary identity (the OS
> reassigns `usb_device` on reconnect; coincidental reuse could match unrelated stale
> rows)

#182's own comment thread independently confirms the hardware constraint: the V600
exposes no usable `iSerial`, so "the USB **path** is the ONLY stable identifier for a
physical port across reconnects/resets... there's no scanner-side identifier we could
use instead." `usb_port`-primary is therefore the correct terminal tier for this
hardware, and `firmware_serial` remains a future insertion point (#219, #203 Option B).

Fixing `upsertScannerRow()` also makes the existing scenario "Save scanner records to
database" (`scanning/spec.md:1229`) — "SHALL upsert `GraviScanner` records matching by
USB port" — true for the first time; the code contradicts it today.

## Impact

- **Affected specs:** `scanning` (1 MODIFIED, 2 ADDED)
- **Affected code:**
  - `src/main/graviscan/scanner-usb-refresh.ts` (new)
  - `src/main/graviscan/session-handlers.ts` — `retryScanner()`, `ScannerRetryLookupDb`
  - `src/main/graviscan/scanner-handlers.ts` — `matchDetectedToDb()`, `resetUsb()` step 5
  - `src/main/graviscan/scanner-upsert.ts` — `upsertScannerRow()` match precedence
- **No renderer change.** `WedgeBanner`'s existing contract already covers this: the
  requirement "Retry failure keeps the entry visible with an inline error"
  (`ui-management-pages/spec.md:2331`) renders the returned `error` inline, keeps the
  entry, and re-arms the Confirm Retry button. #279 item 2.5 confirmed that
  confirmation gate behaves well, so it is deliberately left untouched; this change only
  supplies a more actionable message through the existing channel.
- **No schema change,** therefore no migration. `usb_port` already exists
  (`prisma/schema.prisma:237`).
- **Out of scope:** #366 (the queued `addScanner` has no timeout) is deliberately not
  bundled — see `design.md`. #203 (scanner moved to a *different* port) and #219
  (Windows `firmware_serial`) remain out of scope and unaffected.

## Related

- Fixes #182. Unblocks #279 item 2.4, and thereby one of the six Tier 2 hard-blocks.
- #366 — adjacent, same function, deliberately separate.
- #228 — the underlying V600 wedge root cause (epkowa not calling `libusb_clear_halt`).
- #196 — the stale PR carrying the three stranded scanner-identity proposals. Should be
  closed or rebased on its own, not as part of this change.
