# Tasks — fix GraviScan retry-scanner's stale USB address

## TDD protocol for this change

**Failing tests are committed in their own commit, before the commit that makes them
pass.** Red-green must be visible in `git log`, not asserted in this file. On PR #365 a
`tasks.md` claim of red-green turned out to be false because tests and implementation
landed together; and a separate coverage claim in that file was false because the test
passed a parameter explicitly instead of exercising the production call site. So:

- Each section below names the commit boundary explicitly.
- No task is checked off on the strength of this file. Coverage claims are spot-checked
  against the test source before being written down.
- Mock row/event shapes are audited against the real Prisma model and the real
  `ScannerSubprocess` event surface, not field-by-field as a test happens to need. Five
  defects on PR #365 were "the test passed only because the mock was more forgiving than
  production."

Commands: `npm run lint`, `npx tsc --noEmit`, `npm run test:unit`.
Note that `vitest.config.ts` excludes `src/main/**` from coverage entirely and the CI
IPC-coverage gate reads only `src/main/database-handlers.ts`, so **no CI gate measures
this change's code**. Unit tests here are the only automated protection.

---

## 1. Red phase — commit failing tests first

- [ ] 1.1 New `tests/unit/graviscan/scanner-usb-refresh.test.ts`. Tests for
  `matchScannerByPort()`: exact port match returns the detected scanner; `usb_port: null`
  returns `null`; `usb_port: ''` returns `null`; a detected entry with `usb_port: ''` does
  not match a row with `usb_port: ''`; the input array is not mutated.
  *Verifies:* the pure matcher never treats an unusable port as a match.
- [ ] 1.2 Same file — `refreshScannerUsbAddress()` per `RefreshOutcome` branch, with
  `detect` injected: `refreshed` + `changed: true` when the device number moved (7→8, and
  assert the `update` call's arguments); `refreshed` + `changed: false` with **no** `update`
  call when unchanged; `refreshed` from `usb_bus: null`; `not-detected` when detection
  succeeds but the port is absent; `no-stable-port` for `null` and for `''`;
  `detection-failed` surfacing the upstream error; row-missing returns `not-detected`
  without calling `detect`; `GRAVISCAN_MOCK=true` returns `refreshed`/`changed: false`
  without calling `detect`.
  *Verifies:* every outcome, and that no branch writes to the DB except the changed-address
  one.
- [ ] 1.3 `tests/unit/graviscan/session-handlers.test.ts` — the #182 regression test:
  given a row at `usb_device: 7` with `usb_port: '1-2.3'` and detection reporting the same
  port at `usb_device: 8`, assert `addScanner` is called with
  `'epkowa:interpreter:001:008'` **and explicitly assert it was not called with
  `'epkowa:interpreter:001:007'`**. This is the 2026-09-16 hardware reproduction expressed
  as a unit test.
  *Verifies:* the exact defect, in the exact direction it failed on the rig.
- [ ] 1.4 Same file — retry's new failure paths: `not-detected`, `no-stable-port` and
  `detection-failed` each resolve `{ success: false }` with a cause-naming message, call
  **neither** `stopScanner` nor `addScanner`, and write a `scanLog` entry. Plus: null
  `usb_bus`/`usb_device` with a usable `usb_port` now **succeeds** (Decision 6 — this
  inverts an existing assertion, so the existing test for it must be updated, not
  duplicated). Plus: refresh runs before `stopScanner` (assert call ordering, not just
  call counts).
  *Verifies:* ordering (Decision 3), the hard-fail choice (Decision 4), and the behaviour
  change in Decision 6.
- [ ] 1.5 Same file — widen `createMockRetryDb` (currently a 3-field row at :79-91, with no
  `id` and no `usb_port`) and `ScannerRetryLookupDb`. Audit the widened mock row against
  `prisma/schema.prisma:231-245` rather than adding only the fields these tests need.
- [ ] 1.6 `tests/unit/graviscan/scanner-upsert.test.ts` — the collision case in both
  directions: given rows `sc-A (port 1-2.3, device 8)` and `sc-B (port 1-4, device 5)`, an
  upsert for `port 1-4, device 8` must update `sc-B` and must leave `sc-A`'s `usb_port` and
  `display_name` untouched; and the `usb_bus`+`usb_device` fallback must still match when
  `usb_port` is absent on both sides. Confirm the 25 existing tests in this file still pass.
  *Verifies:* the write-path precedence inversion cannot scramble identity.
- [ ] 1.7 `tests/unit/graviscan/scanner-handlers.test.ts` — `matchDetectedToDb()` via
  `detectScanners()`: a re-enumerated device must bind to the row owning its port, not the
  row owning the coincident device number; the bus/device fallback still works when no port
  is available. Export `matchDetectedToDb` for direct testing (it is private today and has
  no direct tests, and is named in no spec, so exporting it creates no spec conflict).
- [ ] 1.8 `tests/unit/lsusb-detection.test.ts` — cover the currently-untested
  re-enumeration paths this change depends on: the dedupe-by-`usb_port`-keep-highest-
  `usb_device` block (`lsusb-detection.ts:193-209`, zero coverage today, and it is exactly
  the ghost-entry case #182 produces), and the `lsusb -t` failure fallback that yields
  `usb_port: ''`.
  *Verifies:* the assumption that detection returns one entry per port after a
  re-enumeration, which the whole design rests on.
- [ ] 1.9 Run `npm run test:unit` and confirm every new test **fails for the intended
  reason** (not on a typo or a missing import). Record the failure count.
- [ ] 1.10 **Commit the failing tests alone**, message prefixed `test(graviscan):` and
  noting that they are expected to fail.

## 2. Green phase — implementation

- [ ] 2.1 New `src/main/graviscan/scanner-usb-refresh.ts`: `RefreshOutcome` discriminated
  union, `matchScannerByPort()`, `refreshScannerUsbAddress()` with an injectable `detect`
  defaulting to `detectEpsonScanners`. No coordinator dependency; no `usb_port` write.
- [ ] 2.2 `session-handlers.ts`: widen `ScannerRetryLookupDb` (add `id`, `usb_port`, and
  `update`); call `refreshScannerUsbAddress()` in `retryScanner()` **before**
  `stopScanner()`; map each non-`refreshed` outcome to an operator-actionable error; build
  `saneName` from the refreshed address; extend the `scanLog` lines to carry the refreshed
  address or the refresh-failure cause. Keep the `retriesInFlight` guard and the
  post-`addScanner` status check exactly as they are.
- [ ] 2.3 `scanner-handlers.ts`: `resetUsb()` step 5 uses `matchScannerByPort()` in its
  loop, keeping its **single** detection pass (Decision 2). Verify
  `tests/unit/graviscan/reset-usb-handler.test.ts`'s thin coordinator mock
  (`{ isScanning, initialize, shutdown }`) is still sufficient; if not, widen the mock
  rather than weakening the assertion.
- [ ] 2.4 `scanner-handlers.ts`: invert `matchDetectedToDb()` to port-primary with
  bus/device fallback; export it.
- [ ] 2.5 `scanner-upsert.ts`: invert `upsertScannerRow()`'s lookup to port-primary with
  bus/device fallback. Keep the `enabled: true` re-detect re-enable behaviour and the
  disable-not-delete policy untouched. Update the now-inaccurate "Prefer match on
  (usb_bus, usb_device)" comment and the module doc-comment's matching description.
- [ ] 2.6 Run `npm run test:unit` — all green, including the 25 pre-existing
  `scanner-upsert` tests and the 20 pre-existing `retryScanner` tests.
- [ ] 2.7 `npm run lint` and `npx tsc --noEmit` clean. The `ScannerRetryLookupDb` widening
  must typecheck against the real `PrismaClient` passed at `register-handlers.ts:391-393`.
- [ ] 2.8 **Commit the implementation** separately from task 1.10.

## 3. Documentation — treated as load-bearing

Three consecutive rounds on PR #365 found documentation drift, in a different artifact each
time, and `openspec validate --strict` checks delta *structure*, not whether prose matches
code. So this is a task, not a formality.

- [ ] 3.1 Re-read `proposal.md`, `design.md` and this file against the final diff. Correct
  any line number, function name or behavioural claim that drifted during implementation.
- [ ] 3.2 Confirm the MODIFIED retry requirement's scenarios match what the code actually
  does — in particular that no scenario still implies a bare "fresh database read" is
  sufficient.
- [ ] 3.3 `npx openspec validate fix-graviscan-retry-stale-usb-address --strict` clean.
- [ ] 3.4 Update the `usb_port`-as-stable-identity note in
  `docs/superpowers/plans/2026-09-02-graviscan-production-cutover-roadmap.md`'s Tier 1/Tier 2
  entries for #182 to reflect the shipped fix.

## 4. Hardware validation — layers 2 and 3 of Decision 7

CI structurally cannot exercise #182: mock mode is the only mode CI has, and mock scanners
never re-enumerate. These tasks are the only real verification.

- [ ] 4.1 Pre-flight `pbiob-gh-04`: confirm reachability; confirm the V600's live
  `lsusb`/`lsusb -t` address and **port path**; confirm the `GraviScanner` row's actual
  `usb_port` value is non-empty (the whole design depends on it, and no migration ever
  backfilled it); confirm `dist/bloom-hardware` is newer than
  `python/graviscan/scan_worker.py`. Do **not** run `npm run dev` or `npm run build:python`
  — they uninstall `python-sane` (#361). Use
  `uv sync --extra graviscan-linux --extra dev`, then
  `uv run pyinstaller python/main.spec --clean --noconfirm`, then `npm start`.
  Leave `~/.bloom/.env` in place (#367).
- [ ] 4.2 **Deterministic induced-staleness proof (unattended).** With the scanner healthy
  at its current address, write a deliberately wrong `usb_device` into its row, start a
  session, and call `graviscan:retry-scanner` over IPC. Assert: the call succeeds, **and**
  the row was corrected to the live address. Asserting the row was corrected is what
  distinguishes a real fix from a lucky retry. Capture the before/after row and the
  `scanLog` lines.
- [ ] 4.3 Negative control on the same rig: point the row at a `usb_port` with no device
  attached and confirm the `not-detected` message reaches the operator-visible error rather
  than a generic open failure.
- [ ] 4.4 **Attended physical run (pre-merge, needs a human at the rig).** Induce a wedge by
  cutting scanner power — not by SIGKILLing the worker, which removes the scanner from
  `this.subprocesses` before any scan-error can be raised. Use 4grid/4 plates, because
  `WedgeDetector.onCycleStart()` clears state each cycle and `consecutive_failures` needs
  ≥2 failures in one cycle. Account for `LIBUSB_ENDPOINT_RECOVERY` (#228's own anti-wedge
  shim) when interpreting results. Then power-cycle and click **Power-Cycled & Retry in the
  UI** — driven with Playwright `_electron.launch` under `xvfb-run`, since starting a
  session over IPC leaves the renderer's `isScanning` false and the scan page's controls
  unrendered.
- [ ] 4.5 Record outcomes under the `hardware-validation-evidence` capability's convention
  (passed/failed/blocked/not-executed per item), and write the full empirical account to the
  Obsidian vault at `C:\vaults\graviscan\`, following
  `2026-09-16-issue-279-wedge-response-bench-validation-findings.md`'s conventions.
- [ ] 4.6 Comment on #279 recording item 2.4's new status, and on #182 with the evidence.
  Clean up any scratch files left on the rig.

## 5. Pre-merge

- [ ] 5.1 `/pre-merge` (format check + lint + typecheck + test + build).
- [ ] 5.2 Open the PR referencing this change-id and `Fixes #182`.
- [ ] 5.3 Review cycling to convergence: `/copilot-review` + `/review-pr`, re-running against
  the updated diff after each round of fixes. **At least one lens per round after the first
  gets the explicit brief "did the previous round's fixes introduce defects of their own?"
  with those fixes listed** — on PR #365 three consecutive rounds found exactly that, and
  the lenses hunting for new problems missed them every time. Add a fresh-eyes
  merge-readiness lens told to question the framing all prior rounds inherited.
- [ ] 5.4 Do not merge without explicit go-ahead from the user.
