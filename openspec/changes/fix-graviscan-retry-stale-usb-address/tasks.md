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

### TDD audit — verified against `git log -p`, not against this file (2026-09-21)

Change #1's task file claimed uniform red-green and a review found three pieces were test-after,
two of them admitted in their own commit messages. So this was checked by reading the diffs:

- **Red commit `2afdb79`** touches exactly one file under `src/`:
  `scanner-usb-refresh.ts`, containing the declared signature-only stub. Grepped for logic — it
  holds two `throw new Error('not implemented')` lines and **no** `return`, `if` or `for`. No
  implementation rode along.
- **42 tests failed in that commit**, every one on an assertion or a missing export, none on a
  collection error. Measured table under task 1.8.
- **Green commit `4227016`** carries the implementation. Its test-file changes were audited for
  weakened assertions: **none**. The only assertion changes are in `scan-coordinator.test.ts`,
  and all four went from a fuzzy `stringMatching(/resolv/i)` — which **cannot match**
  "resolution", so it would have passed against anything — to two substantive
  `stringContaining` assertions each. Strictly stronger. Every other test change in that commit
  is harness-only (mock exports, `mockReset`, env cleanup, replacing `any` casts with a declared
  type).
- **One genuine test-after, stated rather than hidden:** the two detection-sharing tests in
  `scanner-usb-refresh.test.ts` ("shares one detection pass between concurrent refreshes" and
  "does not reuse a settled detection for a later refresh") landed in the **green** commit,
  alongside the mechanism they cover. The mechanism was written first, then the tests. They are
  real tests of real behaviour in both directions, but they did not go red before going green,
  and should not be cited as red-green evidence.
- **Eight tests passed vacuously in the red commit** and are listed by name in task 1.8b. They
  became meaningful only at 2.9.

---

## 0. Prerequisites

- [x] 0.1 `npm ci` in the worktree — re-done 2026-09-21 in a **fresh** worktree (the 2026-09-17
      one no longer exists). See "Worktree provisioning" below: `npm ci` alone is not sufficient.
- [x] 0.2 Confirm `fix-graviscan-scanner-identity-precedence` is merged — **merged 2026-09-21**,
      PR #376, squash commit `06cedea`, archived to
      `openspec/changes/archive/2026-09-21-fix-graviscan-scanner-identity-precedence/`.
      Verified via `gh pr view 376` (`state: MERGED`, `mergeCommit: 06cedea…`).
- [x] 0.3 Re-verify #182, #279, #366 and #371 — re-checked live 2026-09-21 via `gh issue view`.
      All four **OPEN** and in the state `proposal.md` assumes:
      - **#182** open; latest comment 2026-09-16 is the real-hardware reproduction on
        `pbiob-gh-04` (DB synced to `usb_device: 7`, device returned at `Device 008`, session
        start succeeded on the live name, `retryScanner` failed on the same device).
      - **#279** open; its latest comment's table still reads item **4 = FAIL** ("#182 fixed
        (assigned), then re-run"), item 2 Slack half unverified, item 7 not executed, items
        1/5/6/8 pass. It also still states #364 does not clear when #279 does.
      - **#366** open, 0 comments. **#371** open, 0 comments.
      - Context issues also still open: #373, #374, #375, #369, #363, #364, #361, #367.
- [x] 0.4 **Re-resolve every line citation by symbol** — done 2026-09-21. Result recorded under
      "Citation re-resolution record" below. **The premise of this task was partly wrong**: PR #376
      touched only four source files, and `lsusb-detection.ts` was **not** among them, so its
      export list did not shift. The real drift is confined to `scanner-handlers.ts`.
- [x] 0.5 **Apply the round-4 review findings below** — applied 2026-09-21 into the task bodies
      (each finding is annotated with where it landed). Finding 1's baseline was **re-measured**,
      not carried over.

### Worktree provisioning (2026-09-21) — `npm ci` alone leaves 4 suites failing

A fresh worktree needs the same DB provisioning the CI unit job does
(`pr-checks.yml:206-219`), or four suites fail on setup with no code change at all:

```bash
npm ci
npm run prisma:generate                                    # fixes 3 suites
BLOOM_DATABASE_URL='file:./dev.db' npx prisma migrate deploy   # creates worktree-local prisma/dev.db
BLOOM_DATABASE_URL='file:./dev.db' npm run test:unit
```

`prisma/dev.db` is gitignored (`.gitignore:97`) and worktree-local — this does **not** touch the
user's `~/.bloom/dev.db` or `~/.bloom/.env`. Without the env var
`tests/unit/graviscan/database-handlers.test.ts` fails on `BLOOM_DATABASE_URL` not found; without
the migrated file `tests/unit/scans-export.test.ts` fails copying `prisma/dev.db`.

**Full-suite baseline after provisioning: 2192 passed, 1 failed, 9 skipped (2202).** The single
failure is `tests/unit/electron-cleanup.test.ts > 1.3 does not throw when a descendant already
exited on its own before the kill step` — pre-existing, unrelated to GraviScan, and
**load-flaky**: it passes 3/3 in isolation and only fails under full-suite parallelism (it spawns
real child processes and races on descendant snapshotting). Do not attribute it to this change.

### Citation re-resolution record (0.4, verified 2026-09-21 against `28716be`)

PR #376 changed only `scanner-handlers.ts`, `scanner-upsert.ts`, `wiring.ts`,
`ConfigureScanner.tsx` and `types/graviscan.ts` (plus tests and specs).

**Unchanged — every citation in these files still resolves exactly. Do not "fix" them:**

| File                    | Citations verified still exact                                            |
| ----------------------- | ------------------------------------------------------------------------- |
| `lsusb-detection.ts`    | `:116` `buildSaneName`, `:148`/`:161` `execFileSync`, `:193-211` dedupe, `:199-202` early-push, `:205` comparison, `:235` export list |
| `session-handlers.ts`   | `:15` import, `:98` `startScan`, `:158-162` `ScannerConfig[]`, `:376` `buildSaneName` |
| `scan-coordinator.ts`   | `:207-209` `isScanning`, `:377-416` `addScanner`, `:429-433` `stopScanner`, `:481-490` in-flight guard, `:610` `subprocesses.set`, `:622` `withTimeout(sub.spawn(), …)` |
| `scanner-subprocess.ts` | `:83` platform gate, `:91-103` name validation, `:99` `/^\d{3}$/`         |
| `register-handlers.ts`  | `:137-141` "potentially hours", `:165-175`, `:172` `buildSaneName`, `:355` `startScan`, `:433` the one `isScanning` guard. **`:391` → `:392`** for the `retryScanner` call |
| tests                   | `session-handlers.test.ts` all 13 retry lines (`:460 :487 :519 :541 :565 :581 :600 :619 :639 :658 :676 :700 :739`), `:5-9` logger mock, `:79-91` `createMockRetryDb`; `scanner-handlers.test.ts:5-7`/`:20`; `reset-usb-handler.test.ts:5-7`/`:25-31`; `lsusb-detection.test.ts:18-20`; `scan-coordinator.test.ts:3230`; `register-handlers.test.ts:18`/`:31-37` |
| specs / config          | `scanning/spec.md:4104` (+`:4112` pins `epkowa:interpreter:003:007`), `scanning/spec.md:2655` (USBDEVFS_RESET requirement), `ui-management-pages/spec.md:2331`/`:2358`, `vitest.config.ts:11`/`:39`/`:45-50`, `pr-checks.yml:220`, `prisma/schema.prisma:231`, `electron.d.ts:93-100`/`:101`, `database-handlers.ts:216`, `scan_worker.py:249`/`:774` |

**Moved — all drift is in `scanner-handlers.ts` (now 919 lines):**

| Doc citation                       | Was        | Now                                  |
| ---------------------------------- | ---------- | ------------------------------------ |
| `buildSaneName`                    | `:39`      | **`:45`**                            |
| `buildMockScanners`                | `:51-81`   | **`:57-108`**                        |
| `resetUsb()`                       | `:646`     | **`:739`**                           |
| `resetUsb` clears `usb_bus/device` | `:646-649` | **`:750-753`**                       |
| `resetUsb` mock-branch `usb_port`  | `:669`     | **`:773`**                           |
| `resetUsb` writes the address      | `:712-718` | **`:815+`** (inside the match loop)  |
| `resetUsb` builds the port Map     | `:688-704` | **`:792-796`**                       |
| the 4 sync `detectEpsonScanners()` | `:166` `:262` `:523` `:676` | **`:216` `:312` `:627` `:780`** |
| `matchDetectedToDb`                | `:87-109`  | **`:118` (`MatchCandidateRow`), `:126` (function)** |
| `scanner-upsert.ts` upsert         | `:56-131`  | **`:50` `isUsablePort`, `:80` `upsertScannerRow`** |

**Beware a second, near-identical block.** `validateConfig()` (`:589`) now contains its own
`detectedByPort` Map (`:649`) and its own `usb_port: s.usb_port || \`1-${i + 1}\`` mock synthesis
(`:620`) — textually identical to `resetUsb`'s at `:792` and `:773`. Task 2.8 targets **`resetUsb`'s**
pair only; grepping for either string lands on `validateConfig` first.

**Newly noticed, not previously cited.** `src/renderer/hooks/useTestScan.ts:119` is a **fourth**
consumer of `saneNames[scannerId] ?? ''`, alongside `useScanSession.ts:897`. It feeds the Test
Scan button from the same once-per-mount `GraviScan.tsx` fetch, so it has the same staleness. It
is **out of scope** here (a single attended diagnostic scan, not a session, and `proposal.md`'s
"three paths" claim is about the session/retry paths), but it is a real fifth reader of a stale
address and belongs in the "do not add a further reader" note — record it in task 3.6's filings
rather than fixing it here.

### Round-4 findings (recorded 2026-09-17) — **all applied 2026-09-21**

Each finding below is annotated `→ applied:` with where it landed in the task body. They are kept
here rather than deleted so a reviewer can check the application against the finding.

1. **Replace the predictive breakage inventory with measurement.** The sibling change's plan made
   this switch after its table was wrong twice in opposite directions. The 2026-09-17 baseline
   recorded here was **92 passing** (`scanner-upsert` 25, `scanner-handlers` 27,
   `session-handlers` 33, `reset-usb-handler` 4, `lsusb-detection` 3).
   In particular, the current table was written **before** task 1.0a introduced a defaulted
   detection mock, and was never re-derived against it — with that default in place, several rows
   currently marked HARD FAIL/VACUOUS would pass. Do not trust it.
   → **applied: re-measured 2026-09-21 on `28716be`. The five files are now 117 passing, not 92**
   — `scanner-upsert` **39** (was 25), `scanner-handlers` **38** (was 27), `session-handlers` 33,
   `reset-usb-handler` 4, `lsusb-detection` 3. Adjacent files, also measured:
   `scan-coordinator` **74**, `register-handlers` **81** (the inventory table below said 71),
   `WedgeBanner` 11, `scanner-port-audit` (new in #376). The predictive table below has been
   replaced by task 1.8a, which derives the inventory from an actual run.
2. **Add task 1.0c — widen `tests/unit/lsusb-detection.test.ts`'s `child_process` mock.** It is a
   complete-replacement factory exporting only `execFileSync` (`:18-20`). The moment
   `lsusb-detection.ts` does `promisify(execFile)` at module scope, `execFile` is `undefined` and
   `promisify` throws **at import**, killing all 3 existing tests plus the new ones. Mock
   `execFile` in Node callback form so `promisify` can wrap it, or import it lazily inside the
   async shell. Must land in the red commit.
   → **applied: new task 1.0c.** Re-confirmed live 2026-09-21 — `lsusb-detection.test.ts:18-20`
   is still exactly `vi.mock('child_process', () => ({ execFileSync: vi.fn() }))`.
3. **Task 1.0b's export list is short by one, and its file list by two.** Once task 2.2 moves
   `buildSaneName` into `lsusb-detection.ts`, every `vi.mock('.../lsusb-detection')` factory must
   also export `buildSaneName` — with a _real_ implementation, since `scanner-handlers.test.ts`
   asserts its output — or files re-exporting it fail at import. Covers
   `scanner-handlers.test.ts:5-7`, `reset-usb-handler.test.ts:5-7`, and the new mock 1.0a adds to
   `session-handlers.test.ts`.
   → **applied: task 1.0b rewritten** to name all three files and both exports. Re-confirmed live
   2026-09-21 — both factories still export `detectEpsonScanners` **only**, and
   `scanner-handlers.test.ts:20` still imports `buildSaneName` from `scanner-handlers` and
   asserts its output.
4. **Task 1.5 must supply mock _defaults_, not just a wider type.** `createMockRetryDb`'s 13 call
   sites pass literal `{usb_bus, usb_device, enabled}` rows; if the widening is type-only every
   row has `usb_port: undefined` → `no-stable-port` → all 13 retry tests fail. Take a
   `Partial<Row>` and merge defaults for `id`, `usb_port`, `display_name`, `name` and `update`.
   → **applied: task 1.5 rewritten.** Re-confirmed live 2026-09-21 — `createMockRetryDb`
   (`session-handlers.test.ts:79-91`) still takes exactly `{usb_bus, usb_device, enabled} | null`
   and returns only `{ graviScanner: { findUnique } }`; there is no `update` and no `id`.
5. **Task 2.4 must pin `scanLog` field order.** Three existing tests assert
   `expect.stringContaining('scanner=sc-1 session=session-42')` — a _contiguous_ substring.
   Append new fields **after** `session=<id>`, or update those assertions in the red commit and
   list them as deliberate.
   → **applied: task 2.4 now mandates append-after-`session=<id>`** so the three contiguous
   substring assertions keep passing untouched.
6. **Task 2.7's "the same check the spawn applies" is not executable.** The spawn's validation
   lives inside `buildSubprocessEnv`, throws rather than returning a boolean, and is gated on
   `platform === 'linux' && !mock`. Add a green task extracting
   `export function isValidSaneName(name: string): boolean` (≥4 colon tokens, `/^\d{3}$/` on the
   bus and address), platform-unconditional, with `buildSubprocessEnv` throwing off it unchanged.
   Otherwise the resolver-validation test is vacuous on non-Linux shards.
   → **applied: new task 2.6a** extracts `isValidSaneName`. Re-confirmed live 2026-09-21 —
   the validation is `scanner-subprocess.ts:91-103` (a `parts.length < 4` throw and a
   `/^\d{3}$/` throw on `parts[2]`/`parts[3]`), still inside the
   `platform === 'linux' && !args.mock` branch opened at `:83`.
7. **Task 2.4 must settle the deferred `findUnique`-vs-pass-the-row choice, not defer it.** It
   determines `refreshScannerUsbAddress`'s signature, which determines the stub in 1.0, which
   determines every assertion in 1.2 — all of which come earlier. Recommend `(db, scannerId)` with
   its own `findUnique`, so `row-missing` stays reachable from the refresh module's own tests.
   → **applied, and the choice is now settled, not deferred: `refreshScannerUsbAddress(db,
   scannerId, opts?)` does its own `findUnique`.** Recorded in task 2.3a as the binding signature
   and in task 2.4 as the accepted cost (retry issues two `findUnique` calls for one scanner —
   negligible against a ≤5s detection, and it keeps `row-missing` reachable from the refresh
   module's own tests without the caller having to fabricate a row).
8. **Split the oversized tasks.** 2.3 is at least five (matcher+union+interface / happy path+write
   / retry+backoff / TTL cache / mock-mode and `unusable-address` guards) and 2.7 is one per
   `design.md` Decision 3 bullet. 1.2's eleven outcome bullets and 1.6's seven concurrency cases
   should be numbered so they are not checked off as single boxes covering ~700 lines of test.
   → **applied: 2.3 split into 2.3a–2.3e, 2.7 split into 2.7a–2.7e, 1.2 numbered 1.2a–1.2k,
   1.6 numbered 1.6a–1.6g.**
9. **Task 1.7b's E2E test runs on 3 OSes × 4 shards** (`test-e2e-dev`, `fail-fast: false`,
   90-minute timeout), and the full suite is CI-only. Assert only the `{ success: boolean }` shape
   and no unhandled main-process error — nothing platform-dependent — and verify locally with a
   `-g 'retry-scanner'` filter before pushing.
   → **applied into task 1.7b**, with the standing rule attached: the full E2E suite is CI-only
   and targeted specs run **on the rig**, never on the user's workstation.
10. **Renumber 1.7 → 1.7b → 1.7a**, and point 1.7's `resetUsb` assertion at
    `reset-usb-handler.test.ts` rather than "same file (or …)".
    → **applied: the red-phase tasks now run 1.0 … 1.7, 1.7a, 1.7b, 1.8** in file order, and
    1.7's `resetUsb`-attaches-no-resolver assertion is pinned to `reset-usb-handler.test.ts`.
11. **Task 2.8 changes `resetUsb`'s duplicate-port tie-break** from `Map.set` last-wins to
    first-in-list-order. `design.md` Decision 2 says so; the task does not. Add a
    `reset-usb-handler.test.ts` case pinning the new order with two mock-branch entries on one port.
    → **applied: task 2.8 now states the tie-break change explicitly, and task 1.7c adds the
    pinning test.** Note the citation drift found in 0.4: `resetUsb`'s Map is now
    `scanner-handlers.ts:792-796` and its mock-branch port synthesis `:773` — `validateConfig`
    has a textually identical pair at `:649`/`:620` that must **not** be edited.
12. **`tsc --noEmit` does not typecheck `tests/`** (`tsconfig.json` is `"include": ["src/**/*"]`),
    so no compile gate validates any widened mock. Task 1.0's rationale should drop its `tsc`
    claim and keep the two real ones (Vitest collection error, ESLint `import/no-unresolved`).
    → **applied: task 1.0's rationale rewritten.** Confirmed live 2026-09-21 — `tsconfig.json`
    is `"include": ["src/**/*"]`, so `tests/` is outside the `tsc --noEmit` gate.

## 1. Red phase — commit failing tests first

- [x] 1.0 Create `src/main/graviscan/scanner-usb-refresh.ts` as a **signature-only stub**: the
      real outcome union and the real exported signatures (binding signature in 2.3a), each body
      `throw new Error('not implemented')`. Without it, tasks 1.1/1.2 produce a single Vitest
      **collection error** so no assertion executes, and task 1.8's "fails for the intended reason"
      is unachievable (the only error _is_ the missing import). With the stub every assertion runs
      and fails traceably.
      **Rationale corrected (round-4 finding 12):** `tsc --noEmit` is **not** one of the reasons —
      `tsconfig.json:20` is `"include": ["src/**/*"]`, so nothing under `tests/` is typechecked and
      no compile gate validates any widened mock in this section. The two real reasons are the
      Vitest collection error and ESLint's `import/no-unresolved`.
- [x] 1.0a `tests/unit/graviscan/session-handlers.test.ts` — add the detection module mock this
      file lacks (it mocks only `scan-logger`, `:5-9`), matching the factories in
      `scanner-handlers.test.ts:5-7` and `reset-usb-handler.test.ts:5-7`. Default it in `beforeEach`
      to report `sc-1` at its stored port and address, so the 13 pre-existing `retryScanner` tests
      keep their meaning. Do **not** add a `detect` parameter to `retryScanner()` — that would change
      the call site at `register-handlers.ts:392` (**was `:391`; re-resolved 0.4**), which
      `register-handlers.test.ts:31-37` cannot see because it mocks `session-handlers` wholesale.
- [x] 1.0b Extend **all three** `vi.mock('.../lsusb-detection', …)` factories — in
      `scanner-handlers.test.ts:5-7`, `reset-usb-handler.test.ts:5-7`, and the new one 1.0a adds to
      `session-handlers.test.ts` — to export **both** the new async detection function **and**
      `buildSaneName`, the latter with a **real** implementation (not `vi.fn()`), because
      `scanner-handlers.test.ts:20` imports `buildSaneName` and asserts its output. All three are
      complete-replacement factories, so the moment `scanner-handlers.ts` re-exports `buildSaneName`
      from `lsusb-detection` (task 2.2) or transitively imports the async function, Vitest fails at
      import time with "No '<name>' export is defined on the mock".
      **Must land in the same commit as 1.9** or those files go red for a reason unrelated to any
      new test. _(round-4 finding 3 — the original task named 2 files and 1 export; it is 3 and 2.)_
- [x] 1.0c `tests/unit/lsusb-detection.test.ts` — widen its `child_process` mock. It is a
      complete-replacement factory exporting **only** `execFileSync` (`:18-20`, re-confirmed
      2026-09-21). The moment `lsusb-detection.ts` does `promisify(execFile)` at module scope,
      `execFile` is `undefined` and `promisify` **throws at import**, killing all 3 existing tests
      plus every new one. Mock `execFile` in Node callback form so `promisify` can wrap it, **or**
      import it lazily inside the async shell — pick one and record which in task 2.1.
      Must land in the red commit. _(round-4 finding 2.)_
- [x] 1.1 New `tests/unit/graviscan/scanner-usb-refresh.test.ts`, opening with
      `// @vitest-environment node` (config default is `happy-dom`, `vitest.config.ts:11`; every
      sibling main-process test file sets this). The pure matcher: exact port match; `null` and `''`
      match nothing; a detected `''` does not match a row's `''`; two detected entries on one port
      resolve to the **first in list order**; the input list and its elements are not mutated.
- [x] 1.2 Same file — one test per outcome, detection injected. _(Numbered per round-4 finding 8
      so these are not checked off as a single box.)_
  - [x] 1.2a `refreshed`/`changed: true` on 7→8, asserting the update payload's **exact** shape
        (`{ where: { id }, data: { usb_bus, usb_device } }`) so "writes only those two columns" is
        genuinely pinned;
  - [x] 1.2b `refreshed`/`changed: false` with **no** update call;
  - [x] 1.2c `refreshed` from `usb_bus: null` with a usable port;
  - [x] 1.2d `not-detected` **carrying `usbPort: '1-2.3'`** (the operator message is built from it);
  - [x] 1.2e `no-stable-port` for `null` and for `''`;
  - [x] 1.2f `row-missing`, with detection **not** attempted;
  - [x] 1.2g `unusable-address` for mock mode with `usb_bus: null` — and assert no address is
        returned that a caller could format into a name containing `null`;
  - [x] 1.2h `detection-failed` only after **3** attempts;
  - [x] 1.2i transient failure then success → `refreshed`, detection attempted exactly **2** times;
  - [x] 1.2j `GRAVISCAN_MOCK=true` → `refreshed`/`changed: false`, detection **not** attempted;
  - [x] 1.2k non-blocking: a `setImmediate` scheduled before the call runs while detection is
        outstanding.
- [x] 1.3 `session-handlers.test.ts` — the #182 regression test: row at `usb_device: 7`,
      `usb_port: '1-2.3'`, detection reporting that port at `usb_device: 8`; assert `addScanner`
      called with `'epkowa:interpreter:001:008'` **and explicitly assert it was not called with
      `'epkowa:interpreter:001:007'`**. This is the 2026-09-16 hardware reproduction as a unit test.
- [x] 1.4 Same file — retry's failure paths. `not-detected`, `no-stable-port`, `detection-failed`
      and `unusable-address` each resolve `{ success: false }`, call **neither** `stopScanner` nor
      `addScanner`, and write a `scanLog` entry. Assert the `not-detected` message contains both
      `'1-2.3'` and the row's `display_name`. Assert **both** the `not-detected` and `no-stable-port`
      messages omit any instruction to run Detect Scanners — the prohibition covers both, because a
      powered-off scanner with a good port is the likeliest failure and is exactly what
      `disableStaleScannerRows` would disable. Assert refresh runs **before** `stopScanner` (call
      ordering, not just counts). Update — do not duplicate — the existing `:581` test, whose
      assertion Decision 6 deliberately inverts: null columns plus a usable port now **succeed**.
- [x] 1.4a Same file — `'retries without a DB write when the address has not moved'`: row
      `usb_bus: 3, usb_device: 7, usb_port: '3-1'`; assert `addScanner` with
      `'epkowa:interpreter:003:007'`, no update call, `{ success: true }`.
- [x] 1.4b Same file — `'in mock mode, retries without invoking USB detection'`: `GRAVISCAN_MOCK`
      stubbed true, row `usb_bus: 1, usb_device: 2`; assert detection **not** called and `addScanner`
      called with `'epkowa:interpreter:001:002'`. The one retry scenario CI can exercise end to end.
- [x] 1.4c Same file — the real-installation identifier case: row with `display_name: null`,
      `name: 'Perfection V600 Photo'`, `usb_port: '1-8'`; assert the message contains `'1-8'`, is not
      solely the `scanner_id`, and does not lean on `name`. This is the rig's actual row state
      (pre-flighted 2026-09-17), so a `display_name`-first message degrades to a UUID on exactly the
      hardware this feature runs on.
- [x] 1.4d Same file — add `expect(detectMock).not.toHaveBeenCalled()` to the four existing tests
      whose spec clauses now require it: `:600` (disabled), `:619`/`:639` (no/inactive session),
      `:658` (null coordinator). All four currently assert only `success === false` plus a defined
      error, so they would pass whether or not detection ran.
- [x] 1.5 Same file — widen the retry DB interface and `createMockRetryDb` (`:79-91`), which
      returns a 3-field row with no `id`, no `usb_port` and no `update`, so `graviScanner.update` is
      `undefined` and throws as soon as a moved address is mocked. Audit the widened row against the
      real model wholesale (`prisma/schema.prisma:231`).
      **The widening must supply mock _defaults_, not just a wider type** (round-4 finding 4). Its
      13 call sites pass literal `{usb_bus, usb_device, enabled}` rows; a type-only widening leaves
      every row at `usb_port: undefined` → `no-stable-port` → **all 13 pre-existing retry tests
      fail**, and they would fail for a reason unrelated to any new assertion. Take a
      `Partial<Row>` and merge defaults for `id`, `usb_port`, `display_name`, `name`, and a
      `graviScanner.update` mock. Re-confirmed live 2026-09-21: the helper still takes exactly
      `{ usb_bus, usb_device, enabled } | null` and returns only `{ graviScanner: { findUnique } }`.
- [x] 1.6 `tests/unit/graviscan/scan-coordinator.test.ts` (there is already a
      `describe('stopScanner() + addScanner() — retry-scanner integration')` at `:3230`) — the
      resolver. _(Numbered per round-4 finding 8.)_
  - [x] 1.6a a queued spawn calls `resolveSaneName` at `cycle-complete` and constructs the
        subprocess with the resolved name, **not** the enqueue-time name;
  - [x] 1.6b an absent resolver falls back and writes **no** failure log entry;
  - [x] 1.6c a rejecting resolver, one returning no name, and one returning a name that fails
        device-name validation each fall back to `config.saneName`, the spawn still proceeds, and
        the fallback is logged **with its cause**;
  - [x] 1.6d resolution is **not** called when an already-ready worker is reused;
  - [x] 1.6e a `stopScanner()` during the resolver await constructs **no** subprocess and leaves
        no map entry;
  - [x] 1.6f a `shutdown()` during the resolver await constructs **no** subprocess;
  - [x] 1.6g a never-settling resolver is abandoned at its timeout, the spawn proceeds on
        `config.saneName`, and the in-flight guard is cleared so a later spawn is not blocked.

  _Verifies:_ Decision 3, including the three hazards the `await` introduces. These are the tests
  that would have caught the double-spawn window, so do not thin them.
- [x] 1.7 `session-handlers.test.ts` — session start attaches a resolver: a session started from a
      snapshot naming `usb_device: 7` spawns on `…:008` when detection reports 8. Also assert the
      factory wiring itself (task 2.5): that `startScan` calls `makeSaneNameResolver` once per
      scanner and puts the result on each `ScannerConfig` — `register-handlers.test.ts:31-37` mocks
      `session-handlers` wholesale, so nothing else can see that the handler actually supplies the
      factory. Add a direct assertion in `register-handlers.test.ts` that the `startScan` invocation
      receives a factory argument, since that is the seam the wholesale mock hides.
- [x] 1.7a **`reset-usb-handler.test.ts`** — assert `resetUsb`'s re-initialise path attaches **no**
      resolver to the `ScannerConfig[]` it builds. _(Round-4 finding 10: this was "same file (or
      …)" under 1.7; it belongs in the file that actually covers `resetUsb`.)_
- [x] 1.7b `tests/unit/lsusb-detection.test.ts` — cover the two genuinely uncovered branches of
      the dedupe block (`:193-211`): the `!s.usb_port` early-push (`:199-202`) and the
      `s.usb_device > existing.usb_device` comparison (`:205`). The block already executes in all
      three existing tests, so "zero coverage" would be wrong. Pin the **surviving entry and the
      result ordering**, not an array index — the block pushes port-less entries first then
      `byPort.values()`, so it reorders results and the matcher uses a linear scan. Add tests for the
      async variant, and one asserting both variants return identical results for identical input, so
      the shared core is actually shared. Depends on 1.0c's widened `child_process` mock.
- [x] 1.7c **`reset-usb-handler.test.ts`** — pin `resetUsb`'s **changed** duplicate-port tie-break
      (task 2.8): two mock-branch entries synthesised onto one `usb_port`, asserting the **first in
      list order** wins, not `Map.set`'s last-wins. _(Round-4 finding 11 — `design.md` Decision 2
      mandates this change and no task previously stated it.)_
- [x] 1.7d `tests/e2e/graviscan-ipc.e2e.ts` — `'retry-scanner round-trips through real IPC in mock
mode'`: seed a `GraviScanner` row, start a mock session, invoke
      `window.electron.gravi.retryScanner(id)`, and assert a `{ success: boolean }`-shaped resolution
      with no unhandled main-process error. This is `design.md` Decision 7's layer 2 and it had no
      task. Scope it honestly: mock mode short-circuits before any write, so this verifies the IPC
      round trip and that the handler does not throw — **not** the widened DB interface, which only
      layer 3 reaches. There is no E2E coverage of `retryScanner` today, and the standing project
      lesson is to run real E2E against live Electron before calling IPC work merge-ready.
      **Assert nothing platform-dependent** (round-4 finding 9): this spec runs on 3 OSes × 4
      shards (`test-e2e-dev`, `fail-fast: false`). Assert only the result shape and the absence of
      an unhandled main-process error. **Verify it on the rig with a `-g 'retry-scanner'` filter
      before pushing** — the full E2E suite is CI-only, and targeted specs run on the rig per
      `docs/E2E_TESTING.md`, never on the user's workstation.
- [x] 1.8 Run `BLOOM_DATABASE_URL='file:./dev.db' npm run test:unit`; confirm every new test fails
      **on an assertion**, not a collection error. Record the count.
      **Measured 2026-09-21 — 42 failing, zero collection errors:**

| File                        | Total (was)  | Failing | Failure reason                                    |
| --------------------------- | ------------ | ------- | ------------------------------------------------- |
| `scanner-usb-refresh.test`  | 20 (new)     | **20**  | stub `not implemented` — traceable, per task 1.0  |
| `lsusb-detection.test`      | 9 (3)        | **4**   | `detectEpsonScannersAsync is not a function`      |
| `session-handlers.test`     | 45 (33)      | **10**  | assertions on refresh/resolver behaviour          |
| `scan-coordinator.test`     | 83 (74)      | **6**   | assertions on the resolver                        |
| `reset-usb-handler.test`    | 6 (4)        | **1**   | duplicate-port tie-break                          |
| `register-handlers.test`    | 82 (81)      | **1**   | factory argument not supplied                     |
| `graviscan-types.test`      | 25 (23)      | 0       | see below                                         |
| `scanner-handlers.test`     | 38 (38)      | 0       | see below                                         |

- [x] 1.8a **Derive the pre-existing-breakage inventory from this run** — done, and it
      **falsifies the prediction table in three places**:
  1. **`scanner-handlers.test.ts` did not break at import.** The table predicted the mock
     factories "break at import (task 1.0b)". Widening the factory in the same commit prevented
     it entirely — all 38 still pass. Same for `reset-usb-handler.test.ts`'s pre-existing 4.
  2. **No pre-existing `session-handlers` test HARD FAILed for the predicted reason.** The
     defaulted detection mock (task 1.0a) preserved all 13 retry tests' meaning, exactly as
     round-4 finding 1 warned the table had never been re-derived against. `:487`, `:519`,
     `:541`, `:676`, `:700` and `:739` all still pass; the table marked four of those HARD FAIL.
     The only pre-existing test whose assertion changed is `:581`, deliberately inverted.
  3. `register-handlers.test.ts` is **82** now (81 measured baseline + 1 new), not the table's 71.
- [x] 1.8b **Eight new tests pass _vacuously_ before implementation. They are characterization,
      not red-green, and must not be counted as evidence of anything until 2.9.** Recorded here
      rather than quietly left in the pass column, because a test that passed immediately proves
      only that it does not contradict today's code:
  - `scan-coordinator`: "an absent resolver spawns on the config name and logs no failure",
    "does not resolve when an already-ready worker is reused", "a never-settling resolver is
    abandoned at its timeout…" — all three pass only because `resolveSaneName` is ignored
    entirely today, so the fallback is trivial. They become meaningful once 2.7 lands.
  - `session-handlers`: "retries without a DB write when the address has not moved", "in mock
    mode, retries without invoking USB detection", "fails without respawning on an unusable
    resolved address in mock mode", "starts a session without a factory, attaching no resolver" —
    pass because retry currently never writes, never detects, and rejects null addresses via the
    old guard 2.4 removes.
  - `lsusb-detection`: the two new dedupe-branch tests pass because that block already behaves
    this way — they are coverage of existing branches (which the task said), not new behaviour.
  - `graviscan-types`: both new `resolveSaneName` tests pass immediately because `tsconfig.json`
    excludes `tests/`, so nothing typechecks them. **The real gate for the type is
    `npx tsc --noEmit` over `src/`**, which only goes red once 2.7 references the field. Verify
    the type there, not here.
- [x] 1.9 **Commit the failing tests plus the stub (1.0) and mock-factory updates (1.0a, 1.0b,
      1.0c) alone.** The message SHALL list failing test names in three groups: (i) new, intended;
      (ii) pre-existing tests whose assertions this change deliberately inverts — `:581`;
      (iii) anything else, **which must be empty**. Group (iii) was empty.

### Pre-existing tests this change breaks — PREDICTION, to be replaced by task 1.8a

> ⚠️ **This table is a hypothesis, not a record.** Round-4 finding 1: the sibling change's
> equivalent table was wrong twice, in opposite directions, and this one was written **before**
> task 1.0a introduced a defaulted detection mock and was never re-derived against it — with that
> default in place several rows marked HARD FAIL/VACUOUS would pass. **Do not check off any task
> against it.** Task 1.8a replaces it with a measured run.
>
> Its counts have already been falsified once: the measured 2026-09-21 baseline is
> `register-handlers.test.ts` **81** (not 71) and `scanner-upsert.test.ts` **39** (not 25).

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
| `scanner-handlers.test.ts:5-7`, `reset-usb-handler.test.ts:5-7` mock factories               | break at import (task 1.0b — **and they need `buildSaneName` too, not just the async fn**)    |
| `lsusb-detection.test.ts:18-20` `child_process` mock                                         | **breaks at import** once `promisify(execFile)` runs at module scope (task 1.0c)              |
| `reset-usb-handler.test.ts` coordinator mock (`:25-31`)                                      | stays valid — the matcher takes no coordinator                                                |
| `register-handlers.test.ts` (**81**, measured), `WedgeBanner.test.tsx` (11), `scanner-upsert.test.ts` (**39**, measured) | predicted unaffected — confirm in 1.8a                          |

## 2. Green phase

- [x] 2.1 `src/main/lsusb-detection.ts` — extract the pure parse-and-dedupe core
      (`parseLsusb` + `parseLsusbTree` + the `DetectedScanner` build + the dedupe block) into one
      function, and add an async shell over promisified `execFile` alongside the existing synchronous
      one. Both shells call the same core; task-level "same parsing, same shape" is not a guarantee,
      and the dedupe block carries the unfixed device-number-wrap hazard. Leave the **four** existing
      synchronous call sites — re-resolved 2026-09-21 to **`scanner-handlers.ts:216`, `:312`,
      `:627`, `:780`** (the doc's `:166`/`:262`/`:523`/`:676` predate PR #376) — on the sync shell.
      **Record here which approach 1.0c's mock requires**: `promisify(execFile)` at module scope
      (needs a callback-form `execFile` in every `child_process` mock) or a lazy import inside the
      async shell. They are not interchangeable from the tests' point of view.
- [x] 2.2 Deduplicate `buildSaneName`. It exists twice with identical bodies —
      `scanner-handlers.ts:45` (**was `:39`**; whose doc comment already falsely claims single-sourcing) and
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
> **Task 2.3 is split into 2.3a–2.3e per round-4 finding 8** — it was at least five pieces under
> one checkbox, covering the whole new module.

- [x] 2.3a `src/main/graviscan/scanner-usb-refresh.ts` — the **types and the pure matcher**:
      `ScannerUsbRefreshDb` (read + write), the 6-status outcome union with a **string**
      discriminant (a boolean-literal one does not narrow under this repo's `tsconfig`, which sets
      only `noImplicitAny` — `design.md`'s "what was checked and found safe"), and the pure port
      matcher with its **first-in-list-order** tie-break. No IO.
      **Binding signature, settled here per round-4 finding 7 (no longer deferred to 2.4):**
      `refreshScannerUsbAddress(db, scannerId, opts?)` — the refresh module does **its own**
      `findUnique`. This keeps `row-missing` reachable from the module's own tests without a
      caller fabricating a row, and it fixes the signature that 1.0's stub and every 1.2
      assertion depend on. Cost, accepted: retry performs two `findUnique` calls for one scanner.
- [x] 2.3b The **happy path and the write**: detect → match on `usb_port` → persist changed
      `usb_bus`/`usb_device`. Writes are confined to exactly those two columns
      (`{ where: { id }, data: { usb_bus, usb_device } }`) and are skipped entirely when the
      address has not moved (`changed: false`). No `usb_port` write. No name construction — the
      module returns an address, never a SANE name.
- [x] 2.3c **Retry and backoff**: `detection-failed` only after **3** attempts with backoff; a
      transient failure followed by success returns `refreshed`. Every other non-`refreshed`
      outcome returns immediately without retrying (Decision 5 — only the diagnostic is retried,
      never the conclusion that the scanner is absent).
- [x] 2.3d **Shared detection for concurrent resolvers**, so N resolvers at one `cycle-complete`
      boundary share a single `lsusb` pass rather than each spawning two (`design.md` Risks).
      **Implemented as in-flight deduplication, not a TTL cache** — see the new `design.md`
      Decision 4a for why the design's own earlier wording was changed rather than followed: a
      TTL retains a *completed* detection, which in this module can hand a resolver a result
      captured before the power-cycle it is recovering from. Pinned in both directions (two
      concurrent refreshes → one detection; two sequential refreshes → two).
- [x] 2.3e **The mock-mode short-circuit and the `unusable-address` guard**: `GRAVISCAN_MOCK=true`
      returns `refreshed`/`changed: false` without invoking detection; a runtime
      `Number.isInteger` check (not a type-level one) rejects null/non-integer addresses as
      `unusable-address`, so no caller can format `epkowa:interpreter:null:null` — which
      mock-mode spawning does **not** validate, since `buildSubprocessEnv`'s `/^\d{3}$/` sits
      inside the `platform === 'linux' && !args.mock` branch (`scanner-subprocess.ts:83`).
- [x] 2.4 `session-handlers.ts` — retry DB interface extends `ScannerUsbRefreshDb`; keep the
      row-not-found and `enabled` guards **strictly before** refresh so the "detection SHALL NOT be
      invoked" clauses hold. **The `findUnique`-vs-pass-the-row choice is settled in 2.3a: the
      refresh module does its own `findUnique`, and retry keeps its existing one for the guards.**
      Call refresh before `stopScanner()`; map each non-`refreshed` outcome to an actionable
      message per Decision 5's preference order (`display_name` → `usb_port` → identifier, never
      `name`); build the name from the refreshed address; attach `resolveSaneName`; extend the
      `scanLog` lines to carry `usb_port`, before/after address and the session id.
      **Append the new fields _after_ `session=<id>`** (round-4 finding 5): three existing tests
      assert `expect.stringContaining('scanner=sc-1 session=session-42')` — a **contiguous**
      substring — at `session-handlers.test.ts:483`, `:515` and `:696` (re-confirmed 2026-09-21).
      Appending after keeps all three passing untouched; inserting between breaks them for a
      reason unrelated to any new assertion.
      Also note the current guard order is `row` → **null-address** → `enabled`
      (`session-handlers.ts:362-373`): Decision 6 removes the middle guard, so the resulting order
      is `row` → `enabled` → refresh, which is what the spec clauses require.
      Fix the `session=${session?.sessionId}` that #279 item 8 recorded (the catch-block line at
      `:401`) while rewriting them. Keep `retriesInFlight` and the post-`addScanner` status check
      as they are — **#366 is explicitly not in scope** (Decision 8).
- [x] 2.5 Wire a resolver into the session-start path **without giving `startScan` a database
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
- [x] 2.6 `src/types/graviscan.ts` — optional `ScannerConfig.resolveSaneName`, typed to return a
      name or a promise of one, with a doc comment stating main-process-only and never serialisable
      (nothing but convention protects it, since `preload.ts` types `startScan`'s params loosely).
      Assert the invariant in `tests/unit/graviscan-types.test.ts`'s existing `ScannerConfig` block.
- [x] 2.6a **Extract `isValidSaneName` first — 2.7d depends on it** (round-4 finding 6). Task 2.7's
      "validate with the same check the spawn applies" is **not executable as written**: the
      spawn's validation lives inside `buildSubprocessEnv`, **throws** rather than returning a
      boolean, and is gated on `platform === 'linux' && !args.mock` (`scanner-subprocess.ts:83`),
      so a resolver-validation test would be **vacuous on the macOS and Windows CI shards**.
      Extract `export function isValidSaneName(name: string): boolean` — ≥4 colon-separated tokens,
      `/^\d{3}$/` on `parts[2]` and `parts[3]` — **platform-unconditional**, and have
      `buildSubprocessEnv` throw off it with its existing messages and its existing platform gate
      unchanged (`scanner-subprocess.ts:91-103`). Behaviour-preserving for the spawn path.

> **Task 2.7 is split into 2.7a–2.7e per round-4 finding 8** — one per `design.md` Decision 3
> bullet, because each is an independently-testable hazard rather than a step.

- [x] 2.7a `scan-coordinator.ts` — call the resolver at the **single** `ScannerSubprocess`
      constructor site inside `doSpawnSingleScanner` (immediately before `subprocesses.set` at
      `:610`), **not** at the top of the function, so the reuse-if-ready no-op does not pay a
      detection on every `initialize()`.
- [x] 2.7b **The generation token.** Per-`scannerId`, captured before resolution and re-checked
      after; invalidated by `stopScanner` and `shutdown`. This is the fix for the window the new
      `await` opens: `spawnSingleScanner` installs its in-flight guard only **after** the body's
      first synchronous segment (`:480-490`) and `stopScanner` deletes that guard **first** then
      early-returns when the map has no entry (`:423-433`), so an attempt suspended in resolution
      is in neither structure — uncancellable and un-awaited. Without this, two live workers for
      one scanner, or a worker spawned against a shut-down coordinator, are both reachable.
- [x] 2.7c **The resolver timeout**, separate from `SPAWN_READY_TIMEOUT_MS` — which wraps
      `sub.spawn()` only (`:622`). An unbounded resolver would strand the in-flight guard, making
      that `scannerId` un-spawnable for the rest of the session while `retriesInFlight` holds the
      operator's button dead.
- [x] 2.7d **Validate the resolved name with `isValidSaneName` (2.6a)** and discard it in favour of
      `config.saneName` when it fails — otherwise a malformed resolved name would fail a spawn that
      would otherwise have succeeded, contradicting "resolution cannot fail a spawn".
- [x] 2.7e **Log every failure-caused fallback with its cause** — a rejection, a missing name, a
      validation failure or a timeout — and **not** the absent-resolver case, which is ordinary.
      A silent failure here is exactly the guaranteed-false-positive Decision 5 rejects at click
      time, arriving after the operator has been told the retry succeeded.
- [x] 2.8 `scanner-handlers.ts` — `resetUsb()` step 5 uses the shared matcher while keeping its
      **single** detection pass. **Re-resolved citations (0.4): `resetUsb` is now `:739`, its port
      Map `:792-796`, its mock-branch `usb_port` synthesis `:773`.** ⚠️ `validateConfig()` (`:589`)
      contains a **textually identical** Map at `:649` and mock synthesis at `:620` — a grep lands
      there first. Do **not** edit `validateConfig`; it is out of scope.
      **This deliberately changes `resetUsb`'s duplicate-port tie-break** from `Map.set`'s
      last-wins to the matcher's **first-in-list-order** (`design.md` Decision 2; round-4 finding
      11 — the task previously did not say so). Unreachable from real detection, which dedupes by
      port, but reachable in mock mode where `usb_port: s.usb_port || \`1-${i + 1}\`` can
      synthesise a collision. Task 1.7c pins the new order.
      Verify `reset-usb-handler.test.ts`'s thin coordinator mock (`:25-31`) is still sufficient;
      if not, widen the mock rather than weakening the assertion.
- [x] 2.9 `BLOOM_DATABASE_URL='file:./dev.db' npm run test:unit` fully green, including all 13
      pre-existing `retryScanner` tests, the 4 in `reset-usb-handler.test.ts` and the 3 in
      `lsusb-detection.test.ts`. Confirm 1.8's recorded count is now zero. Compare the total
      against section 0's measured baseline (2192 passed / 1 load-flaky), not against a
      remembered number.
- [x] 2.10 `npm run lint` and `npx tsc --noEmit` clean. The widened DB interface must typecheck
      against the real `PrismaClient` passed at `register-handlers.ts:392-394` (**was `:391-393`**).
      Note `tsc --noEmit` covers `src/**` only (`tsconfig.json:20`), so it does **not** validate
      any widened test mock — that is what 1.8/2.9 are for.
- [x] 2.11 Correct `pr-checks.yml:220`'s false coverage comment.
- [x] 2.12 **Commit the implementation** separately from 1.9.

## 3. Documentation

- [x] 3.1 Re-read `proposal.md`, `design.md` and this file against the final diff; re-verify every
      line citation. Review rounds found citation drift in both earlier drafts, and
      `openspec validate --strict` checks delta structure, not whether prose matches code.
      **Start from section 0's "Citation re-resolution record"** — the 2026-09-21 pass already
      corrected `scanner-handlers.ts`'s numbers there but did **not** rewrite them inside
      `proposal.md` and `design.md`, which still carry the pre-#376 numbers in their prose
      (`scanner-handlers.ts:39`, `:646`, `:669`, `:688-704`, `:712-718`, `:166`/`:262`/`:523`/`:676`,
      `:87-109`). Those must be updated here, once the diff is final and they stop moving.
- [x] 3.2 Confirm no scenario still implies a bare "fresh database read" is sufficient.
- [x] 3.3 `npx openspec validate fix-graviscan-retry-stale-usb-address --strict` clean.
- [x] 3.4 **Dry-run the archive scenario-drop check before opening the PR.**
      `validate --strict` does **not** cross-check a delta against the standing spec, and
      `@fission-ai/openspec`'s archive path (`findMissingCurrentScenarios`, cited by function name since its file path moves between releases) throws at archive time — _after_ merge — on any scenario **name**
      present in the standing spec but absent from a MODIFIED block. Both MODIFIED requirements here
      preserve every original name (retry 7→15, coordinator 10→17, verified 2026-09-17); re-verify
      after any spec edit.
      **Re-verified 2026-09-21 against the post-#376 standing spec** (which its archive rewrote):
      still intact. `GraviScan Retry-Scanner Action` (`spec.md:4102`) has **7** scenarios, all 7
      present in the delta's 15. `Coordinator Single-Scanner Spawn API` (`spec.md:2813`) has
      **10**, all 10 present in the delta's 17. PR #376 did not drop or rename a scenario in
      either requirement.
- [x] 3.5 Update #182's Tier 1/Tier 2 entries in the cutover roadmap. Do not overstate: this
      partially addresses #182, #279 does not close (item 2's Slack half is unverified, item 7 unrun),
      #364 does not clear when #279 does, and item 4 should not be marked passed until #366 lands.
- [x] 3.6 File the deferred items: #182's worker half with the `libusb-filter.c` finding and its
      one-grep falsification; `graviscan:reset-usb` having no main-process active-scan guard;
      `usb_port` and the device name absent from the TIFF `ImageDescription`.
      **Add one found during 0.4:** `src/renderer/hooks/useTestScan.ts:119` is a **fourth**
      reader of the once-per-mount `saneNames` map (alongside `useScanSession.ts:897`), so the
      Test Scan button has the same post-power-cycle staleness this change fixes for sessions and
      retry. Out of scope here — it is an attended single diagnostic scan, not a session — but it
      is a real additional reader of a stale address and should be filed, not silently left out of
      `design.md`'s "no consumer may build a SANE name from the stored value" note.

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
