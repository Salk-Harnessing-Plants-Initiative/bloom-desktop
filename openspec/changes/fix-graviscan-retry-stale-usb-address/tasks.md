# Tasks — fix GraviScan's stale USB address on scanner reconnect

## TDD protocol for this change

**Failing tests are committed in their own commit, before the commit that makes them pass.**
Red-green must be visible in `git log`, not asserted in this file. On PR #365 a `tasks.md`
claim of red-green turned out to be false because tests and implementation landed together,
and a separate coverage claim was false because the test passed a parameter explicitly instead
of exercising the production call site. So:

- Each section names its commit boundary explicitly.
- **No task is checked off on the strength of this file.** Every count and coverage claim below
  was checked against the test source; the first draft of this file claimed "20 pre-existing
  `retryScanner` tests" when there are **13** (`session-handlers.test.ts:460, 487, 519, 541,
  565, 581, 600, 619, 639, 658, 676, 700, 739`; 33 `it()` in the whole file across 6 describes).
  That error was caught in review, in the very file that states this rule.
- **No unit test may reach the real `detectEpsonScanners()`.** Unverified, it spawns a real
  subprocess and the *outcome differs by platform*: on Windows/macOS `lsusb` is absent, so
  `execFileSync` throws `ENOENT` → `detection-failed`; on `ubuntu-latest` `lsusb` exists but
  finds no Epson → `not-detected`. A test asserting either message would pass locally and fail
  in CI, or vice versa, and the change would silently acquire `usbutils` as a CI dependency.
- Mock row and event shapes are audited against `prisma/schema.prisma:231-245` and the real
  `ScannerSubprocess` event surface wholesale, not field-by-field as a test happens to need.
  Five defects on PR #365 were "the test passed only because the mock was more forgiving than
  production" — and one such path (`epkowa:interpreter:null:null`, reachable because mock-mode
  spawning skips `saneName` validation) is a fix in this very change.

Commands: `npm run lint`, `npx tsc --noEmit`, `npm run test:unit`, `npm run test:python`.
`vitest.config.ts:39` excludes `src/main/**` from coverage and all thresholds are 0
(`:45-50`); the CI IPC gate reads only `src/main/database-handlers.ts`
(`scripts/check-ipc-coverage.py:22`). So **no CI gate measures this change's TypeScript**. The
tests written here are the only automated protection. (`pr-checks.yml:218` comments "Enforces
50% minimum coverage" — that comment is false; correct it in passing.)

---

## 0. Prerequisites

- [ ] 0.1 `npm ci` in this worktree. It has no `node_modules`, so `npx vitest` currently fails
  with `Cannot find module 'vitest/config'` — task 1.9 is not executable without this.
- [ ] 0.2 Re-verify #182, #279, #366, #167, #203, #243 are still in the state this proposal
  assumes, per the standing rule to re-check issues at execution time rather than trusting a
  drafting-time snapshot.

## 1. Red phase — commit failing tests first

- [ ] 1.0 Create `src/main/graviscan/scanner-usb-refresh.ts` as a **signature-only stub**: the
  real `RefreshOutcome` union, the real exported signatures of `matchScannerByPort()` and
  `refreshScannerUsbAddress()`, each body `throw new Error('not implemented')`. No logic, no DB
  access, no detection call.
  *Why:* without the module, tasks 1.1/1.2's ~20 assertions produce a single Vitest
  **collection error** ("Failed to load url"), so not one assertion executes, task 1.9's
  "fails for the intended reason" is unachievable (the only error *is* the missing import), and
  both `npx tsc --noEmit` and ESLint (`import/no-unresolved` is an error via
  `plugin:import/recommended`) go red for unrelated reasons. With the stub, every assertion runs
  and fails traceably on `not implemented`, and red-green stays unambiguous because the stub
  demonstrably contains no behaviour.
- [ ] 1.0a `tests/unit/graviscan/session-handlers.test.ts` — add the detection module mock this
  file lacks (it currently mocks only `scan-logger`, `:5-9`), matching the factories in
  `scanner-handlers.test.ts:5-7` and `reset-usb-handler.test.ts:5-7`. Default it in `beforeEach`
  to report `sc-1` at its stored port and address, so the 13 pre-existing `retryScanner` tests
  keep their current meaning. Do **not** add a 5th `detect` parameter to `retryScanner()` — that
  would change the call site at `register-handlers.ts:391`, which
  `register-handlers.test.ts:31-37` cannot see because it mocks `session-handlers` wholesale.
- [ ] 1.0b Extend the existing `vi.mock('.../lsusb-detection', …)` factories in
  `scanner-handlers.test.ts` and `reset-usb-handler.test.ts` to export the new async detection
  function. Both use complete-replacement factories, so once `scanner-handlers.ts` transitively
  imports it via `scanner-usb-refresh.ts`, Vitest fails at import time with "No '<name>' export
  is defined on the mock". **This must land in the same commit as 1.10** or those two files go
  red for a reason unrelated to any new test — the exact ambiguity 1.9 exists to rule out.
- [ ] 1.1 New `tests/unit/graviscan/scanner-usb-refresh.test.ts`, opening with
  `// @vitest-environment node` (config default is `happy-dom`, `vitest.config.ts:11`; every
  sibling main-process test file sets this). `matchScannerByPort()`: exact port match returns
  the detected scanner; `null` returns null; `''` returns null; a detected `usb_port: ''` does
  not match a row with `''`; the input array and its elements are not mutated.
- [ ] 1.2 Same file — `refreshScannerUsbAddress()`, one test per outcome, `detect` injected:
  - `refreshed`/`changed: true` on 7→8, asserting the update payload's **exact** shape
    (`{ where: { id }, data: { usb_bus, usb_device } }`) so the "writes only those two columns"
    clause is actually pinned;
  - `refreshed`/`changed: false` with **no** `update` call;
  - `refreshed` from `usb_bus: null` with a usable port;
  - `not-detected` **carrying `usbPort: '1-2.3'`** (it is what the operator message is built from);
  - `no-stable-port` for `null` and for `''`;
  - `row-missing`, distinct from `not-detected`, with `detect` **not** called;
  - `detection-failed` only after **3** attempts (`expect(detect).toHaveBeenCalledTimes(3)`);
  - transient failure then success → `refreshed`, `detect` called exactly **2** times;
  - `GRAVISCAN_MOCK=true` → `refreshed`/`changed: false`, `detect` **not** called;
  - `GRAVISCAN_MOCK=true` with `usb_bus: null` → `no-stable-port`, and **never** a `saneName`
    containing `null`;
  - duplicate saved rows on one port → the `enabled`, most-recently-updated row wins, and the
    ambiguity is logged.
- [ ] 1.3 `session-handlers.test.ts` — the #182 regression test: row at `usb_device: 7`,
  `usb_port: '1-2.3'`, detection reporting that port at `usb_device: 8`; assert `addScanner`
  called with `'epkowa:interpreter:001:008'` **and explicitly assert it was not called with
  `'epkowa:interpreter:001:007'`**. This is the 2026-09-16 hardware reproduction as a unit test.
- [ ] 1.4 Same file — retry's new failure paths. `not-detected`, `no-stable-port`,
  `detection-failed` and `row-missing` each resolve `{ success: false }`, call **neither**
  `stopScanner` nor `addScanner`, and write a `scanLog` entry. Assert the `not-detected` message
  contains both the literal `'1-2.3'` **and** the row's `display_name`. Assert the
  `no-stable-port` message does **not** mention Detect Scanners. Assert refresh runs **before**
  `stopScanner` (call ordering, not just call counts). Update — do not duplicate — the existing
  `:581` test, whose assertion Decision 6 deliberately inverts: null columns plus a usable port
  now **succeed**.
- [ ] 1.4a Same file — `'retries successfully without a DB write when the address has not moved'`:
  row `usb_bus: 3, usb_device: 7, usb_port: '3-1'`; assert `addScanner` with
  `'epkowa:interpreter:003:007'`, `update` **not** called, `{ success: true }`.
- [ ] 1.4b Same file — `'in mock mode, retries without invoking USB detection'`: `GRAVISCAN_MOCK`
  stubbed true, row `usb_bus: 1, usb_device: 2`; assert detection **not** called and `addScanner`
  called with `'epkowa:interpreter:001:002'`. This is the one retry scenario CI can exercise
  end to end.
- [ ] 1.4c Same file — add `expect(detectMock).not.toHaveBeenCalled()` to the four existing tests
  whose spec clauses now require it: `:600` (disabled), `:619`/`:639` (no/inactive session),
  `:658` (null coordinator). All four currently assert only `success === false` plus a defined
  error, so they would pass whether or not detection ran.
- [ ] 1.5 Same file — widen `ScannerRetryLookupDb` (via `ScannerUsbRefreshDb`) and
  `createMockRetryDb` (`:79-91`), which returns a 3-field row with no `id`, no `usb_port` and no
  `update` — so `graviScanner.update` is `undefined` and throws as soon as a moved address is
  mocked. Audit the widened row against the real model (`id, name, display_name, vendor_id,
  product_id, usb_port, usb_bus, usb_device, enabled, createdAt, updatedAt`).
- [ ] 1.6 New tests for the spawn-time resolver in
  `tests/unit/graviscan/scan-coordinator.test.ts` (there is already a
  `describe('stopScanner() + addScanner() — retry-scanner integration')` at `:3230`): a queued
  spawn calls `resolveSaneName` at `cycle-complete` and constructs the subprocess with the
  resolved name, **not** the enqueue-time name; an absent, throwing, or empty-returning resolver
  falls back to `config.saneName` and the spawn still proceeds.
  *Verifies:* Decision 3 — the half of the fix that unit tests can see and the rig proof cannot
  distinguish without layer 3's third assertion.
- [ ] 1.7 `tests/unit/graviscan/scanner-upsert.test.ts` — the collision in both directions:
  rows `sc-A (port 1-2.3, device 8)` and `sc-B (port 1-4, device 5)`; an upsert for
  `port 1-4, device 8` updates `sc-B` and leaves `sc-A`'s `usb_port`, `name` and `display_name`
  untouched. A detected scanner on a **new** port (`1-9`) with a colliding device number creates
  a new row rather than capturing `sc-A`. The bus/device fallback still matches when neither side
  has a usable port. Duplicate-port rows resolve to the enabled, most recent one. **Assert
  `findFirst.mock.calls[0][0].where` to pin which query ran first** — otherwise precedence is
  only implied. Retitle `:141` ("updates the existing row when matched by usb_bus + usb_device")
  and `:159` ("falls back to matching by usb_port"): both still pass after the inversion but
  their titles become false and they stop covering what they name.
- [ ] 1.8 `tests/unit/graviscan/scanner-handlers.test.ts` — `matchDetectedToDb()`: a
  re-enumerated device binds to the row owning its port, not the row owning the coincident device
  number; a detected scanner on an unknown-but-usable port is treated as new, **not** matched by
  device number; the fallback still works when the detected port is unusable; an empty-string port
  does not match another empty-string port (the `s.usb_port &&` guard at `:104` must survive the
  inversion). Export `matchDetectedToDb` for direct testing — it is private today, has no direct
  tests, and is named in no spec, so exporting creates no spec conflict. Test it directly **and**
  keep one assertion through `detectScanners()` so the production call site is exercised.
- [ ] 1.9 `tests/unit/lsusb-detection.test.ts` — cover the two genuinely uncovered branches of the
  dedupe block (`:193-211`): the `!s.usb_port` early-push at `:199-202`, and the
  `s.usb_device > existing.usb_device` comparison at `:205`. The block itself already executes in
  all three existing tests, so "zero coverage today" (this file's first draft) was wrong. Pin the
  **surviving entry and the result ordering**, not an array index — the block pushes port-less
  entries first and then `byPort.values()`, so it reorders results, and `matchScannerByPort` uses
  `find`. Also cover the `lsusb -t` failure fallback that yields `usb_port: ''`, and add tests
  for the new async detection variant.
- [ ] 1.10 `python/tests/` — worker re-resolution against a **faked sysfs tree** (a tmpdir with
  `busnum`/`devnum`/`idVendor`/`idProduct` files and an injectable root): re-resolves 7→8 and
  opens the new name; unchanged address opens the same name; absent port directory falls back;
  mismatched `idVendor`/`idProduct` falls back; unreadable/malformed file falls back; no
  `--usb-port` argument skips re-resolution entirely. Assert the fallback cases raise no new
  error class.
- [ ] 1.11 `tests/e2e/graviscan-ipc.e2e.ts` — `'retry-scanner round-trips through real IPC in
  mock mode'`: seed a `GraviScanner` row, start a mock session, invoke
  `window.electron.gravi.retryScanner(id)`, assert a `{ success: boolean }`-shaped resolution with
  no unhandled main-process error. There is **no** E2E coverage of `retryScanner` today, and this
  is the only automated check that the widened DB interface is satisfied by the real
  `PrismaClient` across the IPC boundary rather than only at typecheck — the project's standing
  lesson about verifying IPC against live Electron before calling it merge-ready.
- [ ] 1.12 Run `npm run test:unit` and `npm run test:python`; confirm every new test fails **on an
  assertion**, not on a collection error. Record the count.
- [ ] 1.13 **Commit the failing tests plus the stub (1.0) and the mock-factory updates (1.0a,
  1.0b) alone.** The commit message SHALL list failing test names in three groups: (i) new tests,
  intended; (ii) pre-existing tests whose assertions this change deliberately inverts — `:581`;
  (iii) anything else, **which must be empty**. Without that split, 1.12's count cannot
  distinguish "my new tests are red" from "I also broke 13 pre-existing tests and two other files".

### Pre-existing tests this change breaks — full inventory

Accounted for so none is discovered as a surprise mid-implementation. All in
`tests/unit/graviscan/session-handlers.test.ts` unless noted.

| Test | Fate |
|---|---|
| `:460` respawn with "fresh saneName from the db" | **HARD FAIL** + title becomes false |
| `:487` status `'error'` after addScanner | **HARD FAIL** — refresh error replaces it |
| `:519`, `:541` missing/`'dead'` from `getScannerStatuses` | **VACUOUS PASS** — stop testing the silent-failure check |
| `:565` row not found | passes iff the row guard stays before refresh |
| `:581` null `usb_bus` | **deliberately inverted** (task 1.4) |
| `:600` disabled | **VACUOUS PASS** — blind to the new detection clause (1.4c) |
| `:619`, `:639`, `:658` no/inactive session, null coordinator | pass; need the new assertion (1.4c) |
| `:676` rejected `addScanner` | **HARD FAIL** — `addScanner` never reached |
| `:700` concurrent retry | **HARD FAIL**, and misleadingly: `resolveAddScanner` stays `undefined` and throws `TypeError` |
| `:739` sequential retry | **HARD FAIL** — `addScanner` 2→0 |
| `scanner-upsert.test.ts:141`, `:159` | pass, titles become false (task 1.7) |
| `scanner-handlers.test.ts:5-7`, `reset-usb-handler.test.ts:5-7` mock factories | break at import (task 1.0b) |
| `reset-usb-handler.test.ts` coordinator mock (`:25-31`) | stays valid — the matcher takes no coordinator |
| `register-handlers.test.ts` (71), `WedgeBanner.test.tsx` (11) | unaffected |

## 2. Green phase — implementation

- [ ] 2.1 `src/main/lsusb-detection.ts` — add an async detection variant using promisified
  `execFile`, same parsing and dedupe, same result shape. Leave the three existing synchronous
  call sites untouched.
- [ ] 2.2 `src/main/graviscan/scanner-usb-refresh.ts` — replace the stub: `matchScannerByPort()`;
  `refreshScannerUsbAddress()` with `ScannerUsbRefreshDb`, the 5-status `RefreshOutcome`
  (string discriminant — see design.md; a boolean discriminant does not narrow under this
  repo's `tsconfig`), injectable async `detect` defaulting to the new variant, ≤3 attempts with
  backoff, deterministic duplicate-port ordering, a runtime `Number.isInteger` guard on the
  address, and writes confined to `usb_bus`/`usb_device`. No coordinator dependency; no
  `usb_port` write; no `saneName` construction.
- [ ] 2.3 `src/main/graviscan/session-handlers.ts` — `ScannerRetryLookupDb extends
  ScannerUsbRefreshDb`; in `retryScanner()`, keep the row-not-found and `enabled` guards
  **strictly before** refresh (so the "detection SHALL NOT be invoked" clauses hold — note this
  costs a second `findUnique`, or pass the row through to refresh; pick one and say which);
  call refresh before `stopScanner()`; map each non-`refreshed` outcome to an operator-actionable
  message naming `display_name` and, where applicable, the port; build `saneName` from the
  refreshed address; pass a `resolveSaneName` that re-refreshes at spawn time; extend the
  `scanLog` lines to carry `usb_port`, before/after address, session and cycle. Keep
  `retriesInFlight` and the post-`addScanner` status check as they are. Fix the `session=null`
  that #279 item 8 recorded in these same lines while they are being rewritten.
- [ ] 2.4 `src/types/graviscan.ts` + `src/main/graviscan/scan-coordinator.ts` — optional
  `ScannerConfig.resolveSaneName`; call it at the shared spawn choke point immediately before
  constructing `ScannerSubprocess`, falling back to `config.saneName` on absence, throw or empty
  return. Must not block the event loop and must not be able to fail a spawn.
- [ ] 2.5 `scanner-handlers.ts` — `resetUsb()` step 5 uses `matchScannerByPort()` while keeping its
  **single** detection pass; `matchDetectedToDb()` inverted to port-primary with the fallback gated
  on the **detected** side's port being unusable; export it.
- [ ] 2.6 `scanner-upsert.ts` — `upsertScannerRow()` port-primary with
  `orderBy: [{ enabled: 'desc' }, { updatedAt: 'desc' }]`, fallback gated on the payload's port
  being unusable. Keep the re-detect re-enable behaviour and disable-not-delete policy. Update the
  now-false "Prefer match on (usb_bus, usb_device)" comment at `:56` and the module doc-comment's
  matching description at `:17-19`.
- [ ] 2.7 `scanner-subprocess.ts` — pass `--usb-port` through to the worker.
- [ ] 2.8 `python/graviscan/scan_worker.py` — accept `--usb-port`; re-resolve the device name from
  sysfs before each reopen attempt in `_reopen_device()`, verifying `idVendor`/`idProduct`; fall
  back to the spawn-time name on any failure; log each attempt and any name change. Take the sysfs
  root as an injectable parameter so 1.10 can fake it.
- [ ] 2.9 `npm run test:unit` and `npm run test:python` fully green, including all 13 pre-existing
  `retryScanner` tests, the 25 in `scanner-upsert.test.ts` and the 4 in `reset-usb-handler.test.ts`.
  Confirm 1.12's recorded count is now zero.
- [ ] 2.10 `npm run lint` and `npx tsc --noEmit` clean. The widened DB interface must typecheck
  against the real `PrismaClient` passed at `register-handlers.ts:391-393`.
- [ ] 2.11 Correct `pr-checks.yml:218`'s false "Enforces 50% minimum coverage" comment.
- [ ] 2.12 **Commit the implementation** separately from 1.13.

## 3. Documentation — load-bearing

Three consecutive rounds on PR #365 found documentation drift, in a different artifact each time,
and `openspec validate --strict` checks delta *structure*, not whether prose matches code.

- [ ] 3.1 Re-read `proposal.md`, `design.md` and this file against the final diff. Re-verify every
  line-number citation; round 1 of review found four wrong ones in the first draft
  (`lsusb-detection.ts:146,159` → `:148,:161`; `scanner-handlers.ts:63` → `:60`/`:72`;
  `ui-management-pages/spec.md:2331` cited as a Requirement when the text is a Scenario at
  `:2358`; `:2159` cited for active-scan gating when the text is at `:2170-2174`).
- [ ] 3.2 Confirm no scenario still implies a bare "fresh database read" is sufficient, and that
  the precedence requirement does not claim behaviour for `validateConfig()`/`resetUsb()` that
  they do not have.
- [ ] 3.3 `npx openspec validate fix-graviscan-retry-stale-usb-address --strict` clean.
- [ ] 3.4 Update #182's Tier 1/Tier 2 entries in
  `docs/superpowers/plans/2026-09-02-graviscan-production-cutover-roadmap.md`. Do not overstate:
  #279 does not close (item 2's Slack half is unverified and item 7 is unrun), and #364 does not
  clear when #279 does.
- [ ] 3.5 File the issues this change deliberately does not fix: `graviscan:reset-usb` and
  `graviscan:save-scanners-db` have no main-process active-scan guard (only
  `graviscan:upload-all-scans` does, `register-handlers.ts:433`); `usb_port` has no unique
  constraint despite now being primary identity; `usb_port` and the device name are absent from
  the TIFF `ImageDescription`, so images are not self-describing as to which scanner produced them.

## 4. Hardware validation — layers 3 and 4 of Decision 9

CI structurally cannot exercise #182: mock mode is the only mode CI has, and mock scanners never
re-enumerate. These are the only real verification.

- [ ] 4.1 Pre-flight `pbiob-gh-04`. Confirm reachability. Confirm the V600's live `lsusb`/`lsusb -t`
  address **and port path**. Read the `GraviScanner` row's actual `usb_port` and compare it
  **byte-exactly** against live `buildUsbPort()` output — not merely "non-empty" — because #243's
  unresolved hypothesis is that notations diverge (`1-10` vs `1-10.0` vs `1-10:1.0`), and a port
  miss now hard-fails a retry. Confirm no duplicate `usb_port` rows. Confirm
  `dist/bloom-hardware` is newer than `python/graviscan/scan_worker.py`.
  Do **not** run `npm run dev` or `npm run build:python` — they uninstall `python-sane` (#361).
  Use `uv sync --extra graviscan-linux --extra dev`, then
  `uv run pyinstaller python/main.spec --clean --noconfirm`, then `npm start`. Run `npm ci` first
  (the rig's `node_modules` drifts from the branch lockfile). Leave `~/.bloom/.env` in place (#367).
- [ ] 4.2 **Deterministic induced-staleness proof (unattended).** Record the exact DB path and the
  exact commands used, and restore the row afterwards. With the scanner healthy at its current
  address, write a deliberately wrong `usb_device`, start an **interval** session (not `scanOnce`),
  and call `graviscan:retry-scanner`. Drive it through the same `_electron.launch` + `xvfb-run`
  harness as 4.4, since a session started purely over IPC leaves the renderer's `isScanning` false.
  Assert all three of: the call succeeds; the row was corrected to the live address; **and the
  respawned worker actually received the refreshed name** (capture its `--device` / `SANE_USB_FILTER`).
  The third is load-bearing — without it this passes even if the queued spawn used a stale captured
  name, which is the half-fix Decision 3 exists to prevent. Also record the retry call's wall-clock
  duration, so the async-detection change has a measured basis.
- [ ] 4.3 Negative control: point the row at a `usb_port` with no device attached; confirm the
  `not-detected` message reaches the operator-visible error naming the scanner and port, rather
  than a generic open failure. Restore the row afterwards.
- [ ] 4.4 **Attended physical run (pre-merge; needs a human at the rig).** Induce a wedge by cutting
  scanner power — not by SIGKILLing the worker, which removes the scanner from `this.subprocesses`
  before any scan-error can be raised. Use 4grid/4 plates, because `WedgeDetector.onCycleStart()`
  clears state each cycle and `consecutive_failures` needs ≥2 failures in one cycle. Record whether
  `LIBUSB_ENDPOINT_RECOVERY` is enabled and, if the wedge does not reproduce with it active, record
  the item as **blocked, cause: shim active** rather than failed. Then power-cycle and click
  **Power-Cycled & Retry in the UI**. Record the session state (`scanning` vs `waiting`) at click
  time, so a #366 queue wait is distinguishable from a regression.
- [ ] 4.5 Also exercise half 2 while at the rig: cut power mid-scan so the worker's own
  `_reopen_device()` runs against a re-enumerated device, and confirm from the worker log that it
  re-resolved rather than retrying a dead address. This is the half CI and layer 3 cannot reach.
- [ ] 4.6 Re-run #279 item 5 (retry **without** power-cycling): its previous PASS evidence is
  invalidated because a powered-off scanner is now refused before `stopScanner`/`addScanner` rather
  than re-attempted. Take #279 item 7 (banner/counter clear on session end) in the same session —
  #279's run terminated at item 4, so it has never been executed.
- [ ] 4.7 Record outcomes under the `hardware-validation-evidence` capability's convention
  (passed/failed/blocked/not-executed per item, **naming the commit tested**), and write the full
  empirical account to the Obsidian vault at `C:\vaults\graviscan\`, following
  `2026-09-16-issue-279-wedge-response-bench-validation-findings.md`'s conventions.
- [ ] 4.8 Comment on #182 (both halves, with evidence), #279 (items 4, 5, 7), and #369 (its note
  that "#182 will make recovery from the induced wedge fail" is now obsolete). Restore every mutated
  rig row and remove any scratch files.

## 5. Pre-merge

- [ ] 5.1 `/pre-merge` (format check + lint + typecheck + test + build).
- [ ] 5.2 **Evidence gate:** do not open the PR until 4.2, 4.3 and 4.5 are recorded **passed**, and
  4.4 is recorded passed or blocked-with-cause. Otherwise the PR can be reviewed to convergence with
  the only real verification of #182 never having run.
- [ ] 5.3 Open the PR referencing this change-id and `Fixes #182`.
- [ ] 5.4 Review cycling to convergence: `/copilot-review` + `/review-pr`, re-running against the
  updated diff after each round of fixes. **Every round after the first gives at least one lens the
  explicit brief "did the previous round's fixes introduce defects of their own?", with those fixes
  listed** — on PR #365 three consecutive rounds found exactly that, and the lenses hunting for new
  problems missed them every time. Add a fresh-eyes merge-readiness lens told to question the framing
  all prior rounds inherited. Given this change's size, expect more rounds, not fewer.
- [ ] 5.5 Do not merge without explicit go-ahead from the user.
