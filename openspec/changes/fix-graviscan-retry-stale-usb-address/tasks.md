# Tasks — fix GraviScan's stale USB address on scanner reconnect

> **Prerequisite:** `fix-graviscan-scanner-identity-precedence` must be merged first. This
> change hard-fails a retry on a `usb_port` miss, so it depends on that change's port
> preservation and startup audit.

## TDD protocol

**Failing tests are committed in their own commit, before the commit that makes them pass.**
Red-green must be visible in `git log`, not asserted here. On PR #365 a `tasks.md` claim of
red-green proved false because tests and implementation landed together, and a coverage claim
proved false because the test passed a parameter explicitly instead of exercising the production
call site. So:

- **No task is checked off on the strength of this file.** Counts below were checked against the
  test source. An earlier draft claimed "20 pre-existing `retryScanner` tests"; there are **13**
  (`session-handlers.test.ts:460, 487, 519, 541, 565, 581, 600, 619, 639, 658, 676, 700, 739`;
  33 `it()` in the whole file across 6 describes). That error was caught in review, in the very
  file stating this rule.
- **No unit test may reach the real `detectEpsonScanners()`.** Unmocked it spawns a real
  subprocess, and the _outcome differs by platform_: on Windows/macOS `lsusb` is absent so
  `execFileSync` throws `ENOENT` → `detection-failed`; on `ubuntu-latest` `lsusb` exists but finds
  no Epson → `not-detected`. A test asserting either message would pass locally and fail in CI, or
  vice versa, and the change would silently acquire `usbutils` as a CI dependency.
- Mock row and event shapes are audited against `prisma/schema.prisma:231-245` and the real
  `ScannerSubprocess` event surface wholesale, not field-by-field as a test happens to need. Five
  defects on PR #365 were "the test passed only because the mock was more forgiving than
  production" — and one such path (`epkowa:interpreter:null:null`, reachable because mock-mode
  spawning skips `saneName` validation) is a fix in this change.

`vitest.config.ts:39` excludes `src/main/**` from coverage and all thresholds are 0 (`:45-50`);
the CI IPC gate reads only `src/main/database-handlers.ts`. **No CI gate measures this change's
code.** These tests are the only automated protection. (`pr-checks.yml:220` comments "Enforces
50% minimum coverage" — false; correct it in passing.)

Commands: `npm run lint`, `npx tsc --noEmit`, `npm run test:unit`.

---

## 0. Prerequisites

- [x] 0.1 `npm ci` in the worktree — done 2026-09-17.
- [ ] 0.2 Confirm `fix-graviscan-scanner-identity-precedence` is merged.
- [ ] 0.3 Re-verify #182, #279, #366 and #371 are still in the state `proposal.md` assumes.
- [ ] 0.4 **Re-resolve every line citation in this file, `design.md` and `proposal.md` by symbol
      before starting.** The prerequisite change rewrites `scanner-upsert.ts:56-131`,
      `scanner-handlers.ts:87-109` and `:402-415`, and the `lsusb-detection.ts:235` export list, so
      every downstream number in these documents shifts.
- [ ] 0.5 **Apply the round-4 review findings below**, which were recorded against this plan on
      2026-09-17 but deliberately not merged into the task body, because the prerequisite's
      implementation will move the code they reference. Work through them first, then the tasks.

### Round-4 findings to apply before starting (recorded 2026-09-17)

1. **Replace the predictive breakage inventory with measurement.** The sibling change's plan made
   this switch after its table was wrong twice in opposite directions. Measured baseline for the
   five relevant files: **92 passing** (`scanner-upsert` 25, `scanner-handlers` 27,
   `session-handlers` 33, `reset-usb-handler` 4, `lsusb-detection` 3). Re-measure after the
   prerequisite merges, then derive the inventory from a run rather than from reading.
   In particular, the current table was written **before** task 1.0a introduced a defaulted
   detection mock, and was never re-derived against it — with that default in place, several rows
   currently marked HARD FAIL/VACUOUS would pass. Do not trust it.
2. **Add task 1.0c — widen `tests/unit/lsusb-detection.test.ts`'s `child_process` mock.** It is a
   complete-replacement factory exporting only `execFileSync` (`:18-20`). The moment
   `lsusb-detection.ts` does `promisify(execFile)` at module scope, `execFile` is `undefined` and
   `promisify` throws **at import**, killing all 3 existing tests plus the new ones. Mock
   `execFile` in Node callback form so `promisify` can wrap it, or import it lazily inside the
   async shell. Must land in the red commit.
3. **Task 1.0b's export list is short by one, and its file list by two.** Once task 2.2 moves
   `buildSaneName` into `lsusb-detection.ts`, every `vi.mock('.../lsusb-detection')` factory must
   also export `buildSaneName` — with a _real_ implementation, since `scanner-handlers.test.ts`
   asserts its output — or files re-exporting it fail at import. Covers
   `scanner-handlers.test.ts:5-7`, `reset-usb-handler.test.ts:5-7`, and the new mock 1.0a adds to
   `session-handlers.test.ts`.
4. **Task 1.5 must supply mock _defaults_, not just a wider type.** `createMockRetryDb`'s 13 call
   sites pass literal `{usb_bus, usb_device, enabled}` rows; if the widening is type-only every
   row has `usb_port: undefined` → `no-stable-port` → all 13 retry tests fail. Take a
   `Partial<Row>` and merge defaults for `id`, `usb_port`, `display_name`, `name` and `update`.
5. **Task 2.4 must pin `scanLog` field order.** Three existing tests assert
   `expect.stringContaining('scanner=sc-1 session=session-42')` — a _contiguous_ substring.
   Append new fields **after** `session=<id>`, or update those assertions in the red commit and
   list them as deliberate.
6. **Task 2.7's "the same check the spawn applies" is not executable.** The spawn's validation
   lives inside `buildSubprocessEnv`, throws rather than returning a boolean, and is gated on
   `platform === 'linux' && !mock`. Add a green task extracting
   `export function isValidSaneName(name: string): boolean` (≥4 colon tokens, `/^\d{3}$/` on the
   bus and address), platform-unconditional, with `buildSubprocessEnv` throwing off it unchanged.
   Otherwise the resolver-validation test is vacuous on non-Linux shards.
7. **Task 2.4 must settle the deferred `findUnique`-vs-pass-the-row choice, not defer it.** It
   determines `refreshScannerUsbAddress`'s signature, which determines the stub in 1.0, which
   determines every assertion in 1.2 — all of which come earlier. Recommend `(db, scannerId)` with
   its own `findUnique`, so `row-missing` stays reachable from the refresh module's own tests.
8. **Split the oversized tasks.** 2.3 is at least five (matcher+union+interface / happy path+write
   / retry+backoff / TTL cache / mock-mode and `unusable-address` guards) and 2.7 is one per
   `design.md` Decision 3 bullet. 1.2's eleven outcome bullets and 1.6's seven concurrency cases
   should be numbered so they are not checked off as single boxes covering ~700 lines of test.
9. **Task 1.7b's E2E test runs on 3 OSes × 4 shards** (`test-e2e-dev`, `fail-fast: false`,
   90-minute timeout), and the full suite is CI-only. Assert only the `{ success: boolean }` shape
   and no unhandled main-process error — nothing platform-dependent — and verify locally with a
   `-g 'retry-scanner'` filter before pushing.
10. **Renumber 1.7 → 1.7b → 1.7a**, and point 1.7's `resetUsb` assertion at
    `reset-usb-handler.test.ts` rather than "same file (or …)".
11. **Task 2.8 changes `resetUsb`'s duplicate-port tie-break** from `Map.set` last-wins to
    first-in-list-order. `design.md` Decision 2 says so; the task does not. Add a
    `reset-usb-handler.test.ts` case pinning the new order with two mock-branch entries on one port.
12. **`tsc --noEmit` does not typecheck `tests/`** (`tsconfig.json` is `"include": ["src/**/*"]`),
    so no compile gate validates any widened mock. Task 1.0's rationale should drop its `tsc`
    claim and keep the two real ones (Vitest collection error, ESLint `import/no-unresolved`).

## 1. Red phase — commit failing tests first

- [ ] 1.0 Create `src/main/graviscan/scanner-usb-refresh.ts` as a **signature-only stub**: the
      real outcome union and the real exported signatures, each body `throw new Error('not
implemented')`. Without it, tasks 1.1/1.2 produce a single Vitest **collection error** so no
      assertion executes, task 1.8's "fails for the intended reason" is unachievable (the only error
      _is_ the missing import), and both `tsc --noEmit` and ESLint (`import/no-unresolved` is an
      error) go red for unrelated reasons. With the stub every assertion runs and fails traceably.
- [ ] 1.0a `tests/unit/graviscan/session-handlers.test.ts` — add the detection module mock this
      file lacks (it mocks only `scan-logger`, `:5-9`), matching the factories in
      `scanner-handlers.test.ts:5-7` and `reset-usb-handler.test.ts:5-7`. Default it in `beforeEach`
      to report `sc-1` at its stored port and address, so the 13 pre-existing `retryScanner` tests
      keep their meaning. Do **not** add a `detect` parameter to `retryScanner()` — that would change
      the call site at `register-handlers.ts:391`, which `register-handlers.test.ts:31-37` cannot see
      because it mocks `session-handlers` wholesale.
- [ ] 1.0b Extend the existing `vi.mock('.../lsusb-detection', …)` factories in
      `scanner-handlers.test.ts` and `reset-usb-handler.test.ts` to export the new async detection
      function. Both use complete-replacement factories, so once `scanner-handlers.ts` transitively
      imports it, Vitest fails at import time with "No '<name>' export is defined on the mock".
      **Must land in the same commit as 1.9** or those two files go red for a reason unrelated to any
      new test.
- [ ] 1.1 New `tests/unit/graviscan/scanner-usb-refresh.test.ts`, opening with
      `// @vitest-environment node` (config default is `happy-dom`, `vitest.config.ts:11`; every
      sibling main-process test file sets this). The pure matcher: exact port match; `null` and `''`
      match nothing; a detected `''` does not match a row's `''`; two detected entries on one port
      resolve to the **first in list order**; the input list and its elements are not mutated.
- [ ] 1.2 Same file — one test per outcome, detection injected:
  - `refreshed`/`changed: true` on 7→8, asserting the update payload's **exact** shape
    (`{ where: { id }, data: { usb_bus, usb_device } }`) so "writes only those two columns" is
    genuinely pinned;
  - `refreshed`/`changed: false` with **no** update call;
  - `refreshed` from `usb_bus: null` with a usable port;
  - `not-detected` **carrying `usbPort: '1-2.3'`** (the operator message is built from it);
  - `no-stable-port` for `null` and for `''`;
  - `row-missing`, with detection **not** attempted;
  - `unusable-address` for mock mode with `usb_bus: null` — and assert no address is returned
    that a caller could format into a name containing `null`;
  - `detection-failed` only after **3** attempts;
  - transient failure then success → `refreshed`, detection attempted exactly **2** times;
  - `GRAVISCAN_MOCK=true` → `refreshed`/`changed: false`, detection **not** attempted;
  - non-blocking: a `setImmediate` scheduled before the call runs while detection is outstanding.
- [ ] 1.3 `session-handlers.test.ts` — the #182 regression test: row at `usb_device: 7`,
      `usb_port: '1-2.3'`, detection reporting that port at `usb_device: 8`; assert `addScanner`
      called with `'epkowa:interpreter:001:008'` **and explicitly assert it was not called with
      `'epkowa:interpreter:001:007'`**. This is the 2026-09-16 hardware reproduction as a unit test.
- [ ] 1.4 Same file — retry's failure paths. `not-detected`, `no-stable-port`, `detection-failed`
      and `unusable-address` each resolve `{ success: false }`, call **neither** `stopScanner` nor
      `addScanner`, and write a `scanLog` entry. Assert the `not-detected` message contains both
      `'1-2.3'` and the row's `display_name`. Assert **both** the `not-detected` and `no-stable-port`
      messages omit any instruction to run Detect Scanners — the prohibition covers both, because a
      powered-off scanner with a good port is the likeliest failure and is exactly what
      `disableStaleScannerRows` would disable. Assert refresh runs **before** `stopScanner` (call
      ordering, not just counts). Update — do not duplicate — the existing `:581` test, whose
      assertion Decision 6 deliberately inverts: null columns plus a usable port now **succeed**.
- [ ] 1.4a Same file — `'retries without a DB write when the address has not moved'`: row
      `usb_bus: 3, usb_device: 7, usb_port: '3-1'`; assert `addScanner` with
      `'epkowa:interpreter:003:007'`, no update call, `{ success: true }`.
- [ ] 1.4b Same file — `'in mock mode, retries without invoking USB detection'`: `GRAVISCAN_MOCK`
      stubbed true, row `usb_bus: 1, usb_device: 2`; assert detection **not** called and `addScanner`
      called with `'epkowa:interpreter:001:002'`. The one retry scenario CI can exercise end to end.
- [ ] 1.4c Same file — the real-installation identifier case: row with `display_name: null`,
      `name: 'Perfection V600 Photo'`, `usb_port: '1-8'`; assert the message contains `'1-8'`, is not
      solely the `scanner_id`, and does not lean on `name`. This is the rig's actual row state
      (pre-flighted 2026-09-17), so a `display_name`-first message degrades to a UUID on exactly the
      hardware this feature runs on.
- [ ] 1.4d Same file — add `expect(detectMock).not.toHaveBeenCalled()` to the four existing tests
      whose spec clauses now require it: `:600` (disabled), `:619`/`:639` (no/inactive session),
      `:658` (null coordinator). All four currently assert only `success === false` plus a defined
      error, so they would pass whether or not detection ran.
- [ ] 1.5 Same file — widen the retry DB interface and `createMockRetryDb` (`:79-91`), which
      returns a 3-field row with no `id`, no `usb_port` and no `update`, so `graviScanner.update` is
      `undefined` and throws as soon as a moved address is mocked. Audit the widened row against the
      real model wholesale.
- [ ] 1.6 `tests/unit/graviscan/scan-coordinator.test.ts` (there is already a
      `describe('stopScanner() + addScanner() — retry-scanner integration')` at `:3230`) — the
      resolver:
  - a queued spawn calls `resolveSaneName` at `cycle-complete` and constructs the subprocess with
    the resolved name, **not** the enqueue-time name;
  - an absent resolver falls back and writes **no** failure log entry;
  - a rejecting resolver, one returning no name, and one returning a name that fails device-name
    validation each fall back to `config.saneName`, the spawn still proceeds, and the fallback is
    logged **with its cause**;
  - resolution is **not** called when an already-ready worker is reused;
  - a `stopScanner()` during the resolver await constructs **no** subprocess and leaves no map
    entry;
  - a `shutdown()` during the resolver await constructs **no** subprocess;
  - a never-settling resolver is abandoned at its timeout, the spawn proceeds on
    `config.saneName`, and the in-flight guard is cleared so a later spawn is not blocked.
    _Verifies:_ Decision 3, including the three hazards the `await` introduces. These are the tests
    that would have caught the double-spawn window, so do not thin them.
- [ ] 1.7 Same file (or `session-handlers.test.ts`) — session start attaches a resolver: a
      session started from a snapshot naming `usb_device: 7` spawns on `…:008` when detection reports 8. Assert `resetUsb`'s re-initialise path attaches **no** resolver. Also assert the factory
      wiring itself (task 2.5): that `startScan` calls `makeSaneNameResolver` once per scanner and
      puts the result on each `ScannerConfig` — `register-handlers.test.ts` mocks `session-handlers`
      wholesale, so nothing else can see that the handler actually supplies the factory. Add a direct
      assertion in `register-handlers.test.ts` that the `startScan` invocation receives a factory
      argument, since that is the seam the wholesale mock hides.
- [ ] 1.7b `tests/e2e/graviscan-ipc.e2e.ts` — `'retry-scanner round-trips through real IPC in mock
mode'`: seed a `GraviScanner` row, start a mock session, invoke
      `window.electron.gravi.retryScanner(id)`, and assert a `{ success: boolean }`-shaped resolution
      with no unhandled main-process error. This is `design.md` Decision 7's layer 2 and it had no
      task. Scope it honestly: mock mode short-circuits before any write, so this verifies the IPC
      round trip and that the handler does not throw — **not** the widened DB interface, which only
      layer 3 reaches. There is no E2E coverage of `retryScanner` today, and the standing project
      lesson is to run real E2E against live Electron before calling IPC work merge-ready.
- [ ] 1.7a `tests/unit/lsusb-detection.test.ts` — cover the two genuinely uncovered branches of
      the dedupe block (`:193-211`): the `!s.usb_port` early-push (`:199-202`) and the
      `s.usb_device > existing.usb_device` comparison (`:205`). The block already executes in all
      three existing tests, so "zero coverage" would be wrong. Pin the **surviving entry and the
      result ordering**, not an array index — the block pushes port-less entries first then
      `byPort.values()`, so it reorders results and the matcher uses a linear scan. Add tests for the
      async variant, and one asserting both variants return identical results for identical input, so
      the shared core is actually shared.
- [ ] 1.8 Run `npm run test:unit`; confirm every new test fails **on an assertion**, not a
      collection error. Record the count.
- [ ] 1.9 **Commit the failing tests plus the stub (1.0) and mock-factory updates (1.0a, 1.0b)
      alone.** The message SHALL list failing test names in three groups: (i) new, intended;
      (ii) pre-existing tests whose assertions this change deliberately inverts — `:581`;
      (iii) anything else, **which must be empty**.

### Pre-existing tests this change breaks — full inventory

All in `tests/unit/graviscan/session-handlers.test.ts` unless noted. No Python test is affected —
this change touches no Python.

| Test                                                                                         | Fate                                                                                          |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `:460` respawn with "fresh saneName from the db"                                             | **HARD FAIL** + title becomes imprecise                                                       |
| `:487` status `'error'` after addScanner                                                     | **HARD FAIL** — refresh error replaces it                                                     |
| `:519`, `:541` missing/`'dead'` from `getScannerStatuses`                                    | **VACUOUS PASS** — stop testing the silent-failure check                                      |
| `:565` row not found                                                                         | passes iff the row guard stays before refresh                                                 |
| `:581` null `usb_bus`                                                                        | **deliberately inverted** (task 1.4)                                                          |
| `:600` disabled                                                                              | **VACUOUS PASS** — blind to the new detection clause (1.4d)                                   |
| `:619`, `:639`, `:658` no/inactive session, null coordinator                                 | pass; need the new assertion (1.4d)                                                           |
| `:676` rejected `addScanner`                                                                 | **HARD FAIL** — `addScanner` never reached                                                    |
| `:700` concurrent retry                                                                      | **HARD FAIL**, and misleadingly: `resolveAddScanner` stays `undefined` and throws `TypeError` |
| `:739` sequential retry                                                                      | **HARD FAIL** — `addScanner` 2→0                                                              |
| `scanner-handlers.test.ts:5-7`, `reset-usb-handler.test.ts:5-7` mock factories               | break at import (task 1.0b)                                                                   |
| `reset-usb-handler.test.ts` coordinator mock (`:25-31`)                                      | stays valid — the matcher takes no coordinator                                                |
| `register-handlers.test.ts` (71), `WedgeBanner.test.tsx` (11), `scanner-upsert.test.ts` (25) | unaffected                                                                                    |

## 2. Green phase

- [ ] 2.1 `src/main/lsusb-detection.ts` — extract the pure parse-and-dedupe core
      (`parseLsusb` + `parseLsusbTree` + the `DetectedScanner` build + the dedupe block) into one
      function, and add an async shell over promisified `execFile` alongside the existing synchronous
      one. Both shells call the same core; task-level "same parsing, same shape" is not a guarantee,
      and the dedupe block carries the unfixed device-number-wrap hazard. Leave the **four** existing
      synchronous call sites (`scanner-handlers.ts:166`, `:262`, `:523`, `:676`) on the sync shell.
- [ ] 2.2 Deduplicate `buildSaneName`. It exists twice with identical bodies —
      `scanner-handlers.ts:39` (whose doc comment already falsely claims single-sourcing) and
      `lsusb-detection.ts:116`, re-exported at `:235` and imported from there by nothing. This change
      moves name construction into two callers, so collapse to one definition and make that doc
      comment true.
      **The collapse must land in `lsusb-detection.ts` (or a new leaf module), not in
      `scanner-handlers.ts`.** `lsusb-detection.ts` _uses_ its own copy internally
      (`sane_name: buildSaneName(dev.bus, dev.device)` inside `detectEpsonScanners`), and
      `scanner-handlers.ts` already imports `detectEpsonScanners` from it — so keeping the
      `scanner-handlers.ts` definition would force `lsusb-detection.ts` to import back from
      `scanner-handlers.ts` and create a genuine runtime circular import. The edge to guard is
      `lsusb-detection → scanner-handlers`, not the refresh module's.
      Three call sites depend on the current location and must keep working: `session-handlers.ts:15`
      imports it from `./scanner-handlers`, `register-handlers.ts:172` calls
      `scannerHandlers.buildSaneName`, and `scanner-handlers.test.ts:20` imports it (with
      `register-handlers.test.ts:18` mocking it). Keep a re-export from `scanner-handlers.ts` or
      update all three.
      Target graph: `lsusb-detection` (leaf, owns `buildSaneName`) ← `scanner-usb-refresh` ←
      `scanner-handlers`; `session-handlers` → `scanner-usb-refresh` + the name builder.
- [ ] 2.3 `src/main/graviscan/scanner-usb-refresh.ts` — replace the stub: the pure matcher; the
      refresh wrapper with `ScannerUsbRefreshDb`, the 6-status outcome union (string discriminant —
      a boolean one does not narrow under this repo's `tsconfig`), injectable async detection, ≤3
      attempts with backoff, a short-TTL shared detection cache so concurrent resolvers do not each
      spawn `lsusb`, a runtime `Number.isInteger` guard, and writes confined to
      `usb_bus`/`usb_device`. No coordinator dependency; no `usb_port` write; no name construction.
- [ ] 2.4 `session-handlers.ts` — retry DB interface extends `ScannerUsbRefreshDb`; keep the
      row-not-found and `enabled` guards **strictly before** refresh so the "detection SHALL NOT be
      invoked" clauses hold (this costs a second `findUnique`, or pass the row through — **pick one
      and record which**); call refresh before `stopScanner()`; map each non-`refreshed` outcome to an
      actionable message per Decision 5's preference order; build the name from the refreshed address;
      attach `resolveSaneName`; extend the `scanLog` lines to carry `usb_port`, before/after address
      and the session id. Fix the `session=null` that #279 item 8 recorded in these same lines while
      rewriting them. Keep `retriesInFlight` and the post-`addScanner` status check as they are.
- [ ] 2.5 Wire a resolver into the session-start path **without giving `startScan` a database
      handle**. `startScan(coordinator, params, sessionFns, onError?)` (`session-handlers.ts:98`) has
      no `db` parameter and its call site (`register-handlers.ts:355`) passes none, so "attach a
      resolver inside `startScan`" would mean adding a DB dependency to the main session entry point
      — a larger intrusion than the retry path's, and directly against Decision 1's rationale that
      `session-handlers.ts` deliberately carries almost no DB dependency.
      Instead add an optional **resolver factory** parameter, `makeSaneNameResolver?: (scannerId:
string) => () => Promise<string>`, and have `register-handlers.ts` — which already holds `db`
      — supply it. `startScan` then only calls the factory per scanner while building its
      `ScannerConfig[]`; it never sees the database.
      **This changes the `startScan` call site, and `register-handlers.test.ts:31-37` mocks
      `session-handlers` wholesale (including `startScan`), so that change is invisible there** —
      exactly the hazard task 1.0a refuses for `retryScanner`. Task 1.7 must therefore assert the
      wiring directly rather than relying on the handler tests.
- [ ] 2.6 `src/types/graviscan.ts` — optional `ScannerConfig.resolveSaneName`, typed to return a
      name or a promise of one, with a doc comment stating main-process-only and never serialisable
      (nothing but convention protects it, since `preload.ts` types `startScan`'s params loosely).
      Assert the invariant in `tests/unit/graviscan-types.test.ts`'s existing `ScannerConfig` block.
- [ ] 2.7 `scan-coordinator.ts` — call the resolver at the single `ScannerSubprocess` constructor
      site inside `doSpawnSingleScanner`; add the per-`scannerId` generation token captured before
      resolution and re-checked after, invalidated by `stopScanner` and `shutdown`; bound resolution
      with its own timeout separate from `SPAWN_READY_TIMEOUT_MS`; validate the resolved name with the
      same check the spawn applies and discard it in favour of `config.saneName` if it fails; log every
      failure-caused fallback with its cause, and **not** the absent-resolver case.
- [ ] 2.8 `scanner-handlers.ts` — `resetUsb()` step 5 uses the shared matcher while keeping its
      **single** detection pass. Verify `reset-usb-handler.test.ts`'s thin coordinator mock is still
      sufficient; if not, widen the mock rather than weakening the assertion.
- [ ] 2.9 `npm run test:unit` fully green, including all 13 pre-existing `retryScanner` tests and
      the 4 in `reset-usb-handler.test.ts`. Confirm 1.8's recorded count is now zero.
- [ ] 2.10 `npm run lint` and `npx tsc --noEmit` clean. The widened DB interface must typecheck
      against the real `PrismaClient` passed at `register-handlers.ts:391-393`.
- [ ] 2.11 Correct `pr-checks.yml:220`'s false coverage comment.
- [ ] 2.12 **Commit the implementation** separately from 1.9.

## 3. Documentation

- [ ] 3.1 Re-read `proposal.md`, `design.md` and this file against the final diff; re-verify every
      line citation. Review rounds found citation drift in both earlier drafts, and
      `openspec validate --strict` checks delta structure, not whether prose matches code.
- [ ] 3.2 Confirm no scenario still implies a bare "fresh database read" is sufficient.
- [ ] 3.3 `npx openspec validate fix-graviscan-retry-stale-usb-address --strict` clean.
- [ ] 3.4 **Dry-run the archive scenario-drop check before opening the PR.**
      `validate --strict` does **not** cross-check a delta against the standing spec, and
      `@fission-ai/openspec`'s archive path (`findMissingCurrentScenarios`, cited by function name since its file path moves between releases) throws at archive time — _after_ merge — on any scenario **name**
      present in the standing spec but absent from a MODIFIED block. Both MODIFIED requirements here
      preserve every original name (retry 7→15, coordinator 10→17, verified 2026-09-17); re-verify
      after any spec edit.
- [ ] 3.5 Update #182's Tier 1/Tier 2 entries in the cutover roadmap. Do not overstate: this
      partially addresses #182, #279 does not close (item 2's Slack half is unverified, item 7 unrun),
      #364 does not clear when #279 does, and item 4 should not be marked passed until #366 lands.
- [ ] 3.6 File the deferred items: #182's worker half with the `libusb-filter.c` finding and its
      one-grep falsification; `graviscan:reset-usb` having no main-process active-scan guard;
      `usb_port` and the device name absent from the TIFF `ImageDescription`.

## 4. Hardware validation — layers 3 and 4 of Decision 7

CI structurally cannot exercise #182: mock mode is the only mode CI has, and mock scanners never
re-enumerate.

### Pre-flight already performed, 2026-09-17 (read-only; rig untouched)

- Rig reachable, `pbiob-gh-04`, kernel `7.0.0-28-generic`, V600 live at
  `Bus 001 Device 009: ID 04b8:013a`.
- `usb_port` notation matches byte-exactly: stored `'1-8'`, and live `lsusb -t` reports
  `Port 008: Dev 009` → `buildUsbPort` → `'1-8'`. #243's notation-drift hypothesis does **not**
  manifest for this single-level path; the production rig's hub-attached multi-level paths
  (`1-2.3`) still need the same check.
- The row is **already stale**: `usb_bus: 1, usb_device: 8` against a live `devnum` of 9. #182's
  precondition exists with no inducement.
- One row only, so the duplicate-port path needs a synthetic row.
- `display_name` is `null`, `name` is `'Perfection V600 Photo'` — see task 1.4c.
- Trap: `usb_port` is `'1-8'` and `usb_device` is `8` while the live device number is `9`. The two
  8s are unrelated; confusing them makes a stale-address test look like a passing one.

- [ ] 4.1 Re-confirm the pre-flight at execution time (device numbers move). Do **not** run
      `npm run dev` or `npm run build:python` — they uninstall `python-sane` (#361). Use
      `uv sync --extra graviscan-linux --extra dev`, then
      `uv run pyinstaller python/main.spec --clean --noconfirm`, then `npm start`. Run `npm ci` first.
      Leave `~/.bloom/.env` in place (#367). Verify `dist/bloom-hardware` is newer than
      `python/graviscan/scan_worker.py`.
- [ ] 4.2 **Deterministic induced-staleness proof (unattended).** Record the exact DB path and
      commands, and restore the row afterwards. Write a deliberately wrong `usb_device`, start an
      **interval** session (not `scanOnce`), and call `graviscan:retry-scanner`. Drive it through the
      same `_electron.launch` + `xvfb-run` harness as 4.4, since a session started purely over IPC
      leaves the renderer's `isScanning` false. Assert all three: the call succeeds; the row was
      corrected; **and the respawned worker actually received the refreshed name** (capture its
      `--device`/`SANE_USB_FILTER`). The third is load-bearing — without it this passes even if the
      queued spawn used a stale captured name. Record the retry's wall-clock duration, so the async
      detection change has a measured basis.
- [ ] 4.3 Negative control: point the row at a `usb_port` with no device attached; confirm the
      `not-detected` message reaches the operator-visible error naming the port, and does **not**
      tell the operator to run Detect Scanners. Restore the row.
- [ ] 4.4 **Attended physical run (pre-merge; needs a human at the rig).** Induce a wedge by
      cutting scanner power — not by SIGKILLing the worker, which removes the scanner from
      `this.subprocesses` before any scan-error can be raised. Use 4grid/4 plates, because
      `WedgeDetector.onCycleStart()` clears state each cycle and `consecutive_failures` needs ≥2
      failures in one cycle. Then power-cycle and click **Power-Cycled & Retry in the UI**. Record the
      session state (`scanning` vs `waiting`) at click time so a #366 queue wait is distinguishable
      from a regression. **If the wedge does not reproduce because `LIBUSB_ENDPOINT_RECOVERY` is
      active, re-run with it set to `false`** (honored by `buildSubprocessEnv`, and already a key in
      the rig's `~/.bloom/.env`) before recording the item as blocked — otherwise "blocked" is a
      self-inflicted, removable cause and this gate becomes ceremonial.
- [ ] 4.5 Also exercise the session-start path (§2, task 2.5): with the page mounted, power-cycle,
      then start a fresh session without reloading, and confirm it spawns on the live address. This is
      the operator's actual workaround and it is untested by anything else.
- [ ] 4.6 Re-run #279 item 5 (retry **without** power-cycling): its previous PASS evidence is
      invalidated, because a powered-off scanner is now refused before `stopScanner`/`addScanner`
      rather than re-attempted. Take #279 item 7 (banner/counter clear on session end) in the same
      session — #279's run terminated at item 4, so item 7 has never been executed.
- [ ] 4.7 Record outcomes under the `hardware-validation-evidence` convention
      (passed/failed/blocked/not-executed per item, **naming the commit tested**) and write the full
      account to the Obsidian vault at `C:\vaults\graviscan\`, following
      `2026-09-16-issue-279-wedge-response-bench-validation-findings.md`'s conventions.
- [ ] 4.8 Comment on #182 (the retry half, with evidence, and noting the worker half stays open),
      #279 (items 4, 5, 7), and #369. Restore every mutated rig row and remove scratch files.

## 5. Pre-merge

- [ ] 5.1 `/pre-merge`.
- [ ] 5.2 Evidence gate: do not open the PR until 4.2, 4.3 and 4.5 are recorded **passed**, and
      4.4 is recorded passed or blocked-with-cause **after** the `LIBUSB_ENDPOINT_RECOVERY=false`
      re-run.
- [ ] 5.3 Open the PR. Reference this change-id, say **partially addresses #182**, and state
      plainly that #279 item 4 should not be marked passed until #366 lands.
- [ ] 5.4 Review cycling to convergence: `/copilot-review` + `/review-pr`, re-running against the
      updated diff after each round. **Every round after the first gives at least one lens the brief
      "did the previous round's fixes introduce defects of their own?"** with those fixes listed — on
      PR #365 three consecutive rounds found exactly that, and on this change's round 2 that lens
      found a round-1 fix had falsified the #243 non-regression argument while leaving the argument in
      place. Give one lens the brief to read the **native/C/packaging layer** any assumption rests on;
      round 1 missed the fatal `libusb-filter.c` assumption because all five lenses read only the
      diff's own languages. Given this change's size, expect more rounds, not fewer.
- [ ] 5.5 Do not merge without explicit go-ahead from the user.
