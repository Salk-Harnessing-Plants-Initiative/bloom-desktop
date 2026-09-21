# Tasks — GraviScan scanner-identity matching precedence

## TDD protocol

**Failing tests are committed in their own commit, before the commit that makes them pass.**
Red-green must be visible in `git log`, not asserted here.

**Correction (review round 5, post-implementation `/review-pr`):** this claim was false for
`matchDetectedToDb`, the fleet-disable guard (1.3b), and the fire-and-forget audit safety test
(1.4c) — all three were implemented before their tests, two admitted in their own commit
messages. Verified true only for `upsertScannerRow`'s precedence logic and the audit module
itself. See `design.md` Decision 9 for the root-cause analysis and section 6 below for the fixes
this finding led to, which _were_ built red-then-green.

**Do not predict test outcomes in this file — measure them.** Earlier drafts carried a table
predicting which pre-existing tests would break. It was wrong twice, in opposite directions, and
the second time the error was caused by a hand-written mock that ignores the `where` clause it is
supposedly matching on. Predicting is both expensive and unreliable when mocks diverge from
Prisma. The baseline below was produced by running the suite; every later claim about breakage is
to be produced the same way.

**Measured baseline (2026-09-17, `npm ci` then `npx vitest run` on the five relevant files):**
92 passed, 0 failed — `scanner-upsert.test.ts` 25, `scanner-handlers.test.ts` 27,
`session-handlers.test.ts` 33, `reset-usb-handler.test.ts` 4, `lsusb-detection.test.ts` 3.

Two facts that make mock fidelity the central risk here:

- **`tsc --noEmit` does not typecheck `tests/`** — `tsconfig.json` is `"include": ["src/**/*"]`.
  So no compile gate validates a widened mock against the real interface. Only ESLint and the
  runtime do.
- `vitest.config.ts:39` excludes `src/main/**` from coverage and all thresholds are 0 (`:45-50`);
  the CI IPC gate reads only `src/main/database-handlers.ts`. **No CI gate measures this change's
  code.** These tests are the only automated protection.

Commands: `npm run lint`, `npx tsc --noEmit`, `npm run test:unit`.

---

## 0. Prerequisites

- [x] 0.1 `npm ci` in the worktree — done 2026-09-17.
- [x] 0.2 Re-verify #167, #203 and #243 are still in the state `proposal.md` assumes. Re-checked
      2026-09-21: #243 CLOSED, #167 and #203 both still OPEN — unchanged.
- [x] 0.3 Read #243's closing comment in full before touching `upsertScannerRow`. This change
      reverses the order that comment names as the fix; `design.md` Decision 3 is the argument, and it
      should be re-checked against the issue rather than trusted. Re-read 2026-09-21: the closing
      comment (2026-09-10) confirms `upsertScannerRow` matches `(usb_bus, usb_device)` first, then
      falls back to `usb_port` — the exact order this change inverts. `design.md` Decision 3's
      non-regression argument is what task 3.4 annotates the issue with.

## 1. Red phase

### 1.0 — make the new tests capable of failing for the right reason

- [x] 1.0a Create `src/main/graviscan/scanner-port-audit.ts` as a **signature-only stub**: the
      `ScannerPortAuditDb` interface, the finding union (`no-port` | `duplicate-port` |
      `stranded-disabled`), and `auditScannerPorts(db): Promise<ScannerPortFinding[]>` with body
      `throw new Error('not implemented')`. Without it, task 1.4's tests produce a single Vitest
      collection error so no assertion executes, 1.5's "fails on an assertion" is unachievable, and
      `npm run lint` goes red on `import/no-unresolved` (an error via `plugin:import/recommended`,
      and `eslint --ext .ts,.tsx .` covers `tests/`). Note `tsc` would _not_ go red — it does not see
      `tests/`.
- [x] 1.0b **Rebuild `scanner-upsert.test.ts`'s `makeMockDb` (`:51-115`) into a real predicate
      evaluator** before writing any assertion below. Today `findFirst` (`:55-77`) matches an OR
      across key families — (`usb_bus` AND `usb_device`) OR `usb_port` — and understands neither a
      Prisma `OR:[...]` array nor ANDing the families. Against a correct implementation, several
      assertions in 1.1 would fail for mock reasons rather than production ones. Support: scalar
      equality on every `GraviScanner` column, AND across keys, and `OR: Array<Record<...>>` as a
      disjunction; `findFirst` returns the first match, `findMany` returns all matches and must keep
      answering `disableStaleScannerRows`'s `{ where: { enabled: true } }`. Extend
      `interface MockGraviScanner` (`:24-34`) to the full model — `createdAt`/`updatedAt` are absent
      today — with `new Date()` defaults in `makeRow`.
- [x] 1.0c Give `scanner-handlers.test.ts`'s `createMockDb` (`:26-40`) the same treatment: its
      `findMany` is `mockResolvedValue([])` regardless of `where`, `create` is a bare `vi.fn()`
      returning `undefined`, and several tests install per-test `findFirst.mockImplementation`s that
      answer one key family and ignore everything else. Make `create` return a row. Then **re-run the
      baseline and record which pre-existing tests move**, rather than predicting it.

### 1.1 — matching precedence (`scanner-upsert.test.ts`)

Write one test per cell of `design.md`'s matching table. The invariant under test is: _a
device-number match never assigns, changes or transfers a `usb_port`._

- [x] 1.1a Usable payload port equal to a row's port → that row is updated.
- [x] 1.1b Usable payload port, a different row holds a usable port, device numbers equal → **no
      match**, a new row is created, and the other row's `usb_port`/`name`/`display_name` are
      untouched.
- [x] 1.1c Usable payload port, a row has `usb_port: null` and the same device numbers → **no
      match**; that row's `usb_port` stays `null`; a new row is created. Repeat for `''`. _This is the
      cell that two earlier drafts got wrong in opposite directions — it is the misattribution guard._
- [x] 1.1d Unusable payload port, row port unusable, device numbers equal → matched, and the
      update payload contains **only** `usb_bus`/`usb_device` — no `usb_port` key at all.
- [x] 1.1e Unusable payload port, no matching row → **no row is created**, and the
      could-not-identify report is emitted.
- [x] 1.1f Assert query order and shape: the port lookup runs before any device-number lookup
      (compare `mock.invocationCallOrder`), and the device-number query carries both the address and
      the row-side unusable-port restriction.

### 1.2 — ambiguity refusal (`scanner-upsert.test.ts`)

- [x] 1.2a Two rows sharing a usable `usb_port` → no `update`, no `create`, and a `scanLog` line
      containing the stable prefix `[GraviScan:SAVE] ambiguous usb_port` naming the port and both ids.
- [x] 1.2b Two unusable-port rows sharing `usb_bus`+`usb_device`, with an unusable payload port →
      the same refusal in the device-number tier. (An earlier draft scoped the refusal to the port
      tier only, leaving this tier to take scan order silently.)

### 1.3 — port preservation and the fleet guard

- [x] 1.3a `scanner-upsert.test.ts` — an update whose matched row has an unusable port writes
      `usb_port: null`, never `''`. Note the "unusable payload, _usable_ stored port" case is
      **unreachable by construction** under the invariant, so do not write a test for it; keep
      `|| existing.usb_port ||` in the implementation only as a defensive no-op and say so in a
      comment.
- [x] 1.3b `tests/unit/graviscan/scanner-handlers.test.ts` — the fleet guard: `saveScannersToDB`
      with a non-empty payload whose every entry has `usb_port: ''` disables no row. Model it on the
      sibling test at `:292`. **`scanner-upsert.test.ts:344` and `:198` call
      `disableStaleScannerRows` directly and this change does not modify that function — leave both
      alone.** (An earlier draft told the implementer to invert `:344`, which would have pushed the
      guard into the wrong function and broken `:198`.)

### 1.4 — `matchDetectedToDb` and the audit

- [x] 1.4a `scanner-handlers.test.ts` — `matchDetectedToDb`: the same cells as 1.1b/1.1c/1.1d, plus
      an empty-string port not matching another empty-string port (the `s.usb_port &&` guard at
      `scanner-handlers.ts:101` must survive). Export it for direct testing — it is private today, has
      no direct tests, and is named in no standing requirement. Test it directly **and** keep one
      assertion through `detectScanners()` so the production call site is exercised. Note its candidate
      set is `enabled`-only, unlike `upsertScannerRow`'s; assert that difference rather than
      accidentally relying on it.
- [x] 1.4b New audit test file: a null-port row is reported; a `''`-port row is reported; an
      enabled and a disabled row sharing a port are both named; a disabled row holding a usable port is
      reported as stranded; a clean fixture reports nothing; detection is never invoked; a throwing
      audit does not propagate and produces no unhandled rejection. Assert no `update`/`delete` call is
      ever made — read-only is the load-bearing property.
- [x] 1.4c `tests/unit/graviscan/main-wiring.test.ts` calls `initGraviScan('graviscan', {} as any, …)`
      at `:99`, `:106`, `:112`, `:118`, `:128` — a `{}` database. Add a case proving startup still
      completes with the audit wired in and an unusable `db`, since the audit must swallow its own
      failure and must not leak a rejection from a fire-and-forget call. Done: `scanner-port-audit`
      is now `vi.mock`ed in that file (default `mockResolvedValue([])`), and a new case forces
      `auditScannerPorts` to reject, flushes the fire-and-forget microtask with a
      `setImmediate` round-trip, and asserts `cleanupOldLogs`/`registerGraviScanHandlers` still ran
      and no `unhandledRejection` fired (48 tests, was 47).

### 1.5 — gate and commit

- [x] 1.5a Run `npm run test:unit`. Confirm every new test fails **on an assertion**, not a
      collection error. Record the actual counts.
- [x] 1.5b Re-run the five-file baseline and **record which pre-existing tests moved**, with their
      names. Do not carry forward any earlier prediction.
- [x] 1.5c **Commit the failing tests plus the stub (1.0a) and the mock rebuilds (1.0b, 1.0c)
      alone.** The message lists failing tests in three groups: (i) new, intended; (ii) pre-existing
      tests deliberately re-fixtured or inverted, from 1.5b's measurement; (iii) anything else, which
      must be empty — and if it is not, stop and explain rather than proceeding.

## 2. Green phase

- [x] 2.1 `scanner-upsert.ts` — the port lookup becomes `findMany({ where: { usb_port } })` so
      ambiguity is detectable; `> 1` result refuses. (`findFirst` cannot report a second candidate,
      which is why the ambiguity requirement forces the method change.)
- [x] 2.2 `scanner-upsert.ts` — the device-number tier: reachable only when the payload port is
      unusable, restricted to rows whose own port is unusable, writing only `usb_bus`/`usb_device`.
      Refuse on `> 1` candidate here too.
- [x] 2.3 `scanner-upsert.ts` — refuse to create when the payload port is unusable; preserve a
      usable stored port; coerce `''` to `null`. **Return contract:** `upsertScannerRow` returns
      `GraviScannerRow | null`, where `null` means refused (ambiguous or unidentifiable), and emits one
      `scanLog()` line with a stable greppable prefix naming the port/address and every candidate id.
      `saveScannersToDB` skips `null` results and surfaces them in a new `refused: string[]` field, so
      `savedScanners` never contains `null` and `register-handlers.ts:156-175`'s spawn-on-discovery
      loop needs no change. Keep the `enabled: true` re-detect re-enable behaviour and the
      disable-not-delete policy. Update the now-false `// Prefer match on (usb_bus, usb_device)`
      comment at `:56` and the module doc-comment at `:17-19`.
- [x] 2.4 `scanner-handlers.ts` — `matchDetectedToDb` to the same rules over its `enabled`-only
      candidate set; export it.
- [x] 2.5 `scanner-handlers.ts` — in `saveScannersToDB`, skip `disableStaleScannerRows` when no
      payload entry carries a usable `usb_port`. (`:403`'s `scanners.length > 0` guard already handles
      the genuinely-all-unplugged case, because `detectEpsonScanners` returns an empty array then — so
      this new guard's only effect is the degraded-topology case it targets.)
- [x] 2.6 Implement the audit in `scanner-port-audit.ts`: every finding derived from the database,
      no detection, all rows, read-only, own failures caught. One `scanLog()` line per finding class
      plus a clean-result line, stable greppable prefix, pinned by 1.4b.
- [x] 2.7 Wire it into **`initGraviScan()` (`src/main/graviscan/wiring.ts:453`)**, called from
      `src/main/main.ts:1199` — the real executing GraviScan startup path. It is already mode-gated,
      already holds `db`, and already does startup housekeeping (`cleanupOldLogs()` at `wiring.ts:475`).
      **Invoke it fire-and-forget (`void auditScannerPorts(db).catch(…)`), not awaited** —
      `initGraviScan` is awaited before `database:ready` and `resolveAppReady()`, so awaiting the audit
      would delay startup, which the spec forbids.
- [x] 2.8 `npm run test:unit` green. Confirm 1.5a's recorded count is now zero and the baseline's
      92 are all accounted for. Confirmed 2026-09-21: the five relevant files
      (`scanner-upsert.test.ts` 37, `scanner-handlers.test.ts` 33, `session-handlers.test.ts` 33,
      `reset-usb-handler.test.ts` 4, `lsusb-detection.test.ts` 3, plus `main-wiring.test.ts` 48 after
      1.4c) all pass. The full `npm run test:unit` run has 4 pre-existing failures
      (`scans-export.test.ts`, `database-handlers.test.ts` x2, `electron-cleanup.test.ts`) that are
      outside this change's file set and pass individually except `database-handlers.test.ts`, which
      needs `BLOOM_DATABASE_URL` — not a regression from this diff.
- [x] 2.9 `npm run lint` and `npx tsc --noEmit` clean.
- [x] 2.10 **Commit the implementation** separately from 1.5c.

## 3. Documentation

- [x] 3.1 Re-read `proposal.md` and `design.md` against the final diff; re-verify every line
      citation. Review rounds found citation drift in three successive drafts. Done 2026-09-21:
      checked every file:line citation in both documents against the current worktree (baseline
      `main` citations checked against `main`, post-diff citations checked against `HEAD`). Found
      and fixed five drifted citations: `scanner-handlers.ts:177` → `:158`
      (`runStartupScannerValidation`); `scanner-handlers.ts:646-649` → `:691-694` and `:711-718` →
      `:757-764` (`resetUsb` steps 2 and 5, both docs); `scanner-handlers.ts:404-406` → `:436-438`
      (`currentUsbPorts`, both docs); `scanner-upsert.test.ts:344` → `:378` (the actual
      empty-current-port-set assertion, both docs). Also removed a stale `proposal.md` Impact
      bullet claiming `lsusb-detection.ts` would export `buildUsbPort` — the implementation never
      needed it (the audit reads raw `usb_port` strings from the DB and never reconstructs one),
      and nothing in `src/` or `tests/` references it. All other citations (`scanner-upsert.ts`
      line ranges, `useScanSession.ts:897`, `graviscan-upload.ts:281`, `lsusb-detection.ts:185`,
      `preload.ts:419-420`, `prisma/schema.prisma:237`, `spec.md:1233`) confirmed accurate.
- [x] 3.2 `npx openspec validate fix-graviscan-scanner-identity-precedence --strict` clean, run
      from the **worktree root** (from inside the change directory it reports "Unknown item").
      Confirmed 2026-09-21: "Change 'fix-graviscan-scanner-identity-precedence' is valid".
- [x] 3.3 Confirm the archive scenario-name check is not applicable — this change is ADDED-only, so
      it cannot drop a scenario name from a MODIFIED block. (The check is `findMissingCurrentScenarios`
      in `@fission-ai/openspec`'s archive module; cite it by function name, since its path moves
      between releases.) Confirm rather than assume. Confirmed 2026-09-21:
      `specs/scanning/spec.md` in this change directory has only a single `## ADDED Requirements`
      header (`Scanner Identity Matching Precedence`, `Scanner Port Integrity Audit`) — no
      `MODIFIED` block exists for the check to compare scenario names against.
- [ ] 3.4 Annotate #243 with `design.md` Decision 3's argument. Comment on #167 and #203,
      correcting #203's false premise that port-primary matching already ships.
- [ ] 3.5 Write the operator note. For each finding class say plainly what can be done: a duplicate
      port needs a canonical row chosen; a stranded disabled row needs removing or re-enabling; a
      null/empty port **cannot** be repaired in-app, because `upsertScannerRow` is the only writer of
      `usb_port` and the invariant forbids the device-number tier from assigning one — the remedy is
      the existing per-row disable followed by a re-detect once topology detection works. Note also
      that `display_name` is positional and rewritten on every Detect, so labels reshuffle.
- [ ] 3.6 File: the `usb_port` unique-constraint issue; the `graviscan:save-scanners-db` missing
      active-scan guard; the dead `graviscan:validate-scanners` path found while choosing the hook.

## 4. Hardware validation

### Hardware validation evidence — commit tested `ab0d383`, 2026-09-17

Rig `pbiob-gh-04`, idle (no scan workers), real Epson V600 live at `usb_port` `1-8`, `busnum=1
devnum=9`. Branch deployed as a patch onto `origin/main` @ `92a0a8a` in a scratch branch;
`npm ci` + `npx prisma generate`. Exercised against a **copy** of `~/.bloom/dev.db`
(`BLOOM_DATABASE_URL=file:/tmp/rig-eval.db`), so the live database was never mutated — confirmed
afterwards: mtime unchanged, row still `usb_device=8`. Rig restored to
`eberrigan/fix-graviscan-scan-write-atomicity` @ `daa1cba`, scratch branch and temp files removed.

Method: a rig-only vitest file driving the real `detectScanners`, `saveScannersToDB`,
`matchDetectedToDb` and `auditScannerPorts` against a real `PrismaClient` and real `lsusb` — the
one thing the mocked unit tests structurally cannot cover. Not committed (it needs real hardware
and would fail CI); its content is recorded in the vault write-up. 79 unit tests also re-run green
on the rig.

| Item                                                                                                       | Outcome    | Evidence                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — audit reports the real database                                                                        | **passed** | `findings: []` on the live single-row fixture                                                                                                                                               |
| B — real Prisma accepts the address-tier query _with_ its `OR` restriction, and excludes a usable-port row | **passed** | `findMany({usb_bus:1, usb_device:8, OR:[{usb_port:null},{usb_port:''}]})` → **0 rows**, because the row holds `'1-8'`. The misattribution guard proven against real SQL rather than a mock. |
| C — live scanner binds to its saved row by port despite a moved address                                    | **passed** | `scanner_id` is the real uuid, not a `new:` placeholder; `usb_port: '1-8'`                                                                                                                  |
| D — **the real write path updates, not duplicates** (task 4.2)                                             | **passed** | before `usb_device: 8` → after `usb_device: 9`; same `id` `5566356b-…`, same `usb_port`, same `createdAt`; row count unchanged; `refused: []`                                               |
| E — ambiguous port refuses to write, and the audit reports it                                              | **passed** | `{scanners: [], refused: ['1-8']}`; audit → `duplicate-port` naming both ids                                                                                                                |
| F — unidentifiable scanner creates no row; fleet guard holds                                               | **passed** | `{scanners: [], refused: ['1:99'], disabled: []}`; row count unchanged; all rows still enabled                                                                                              |
| G — a `null`-port row is audited and **not** captured by a usable-port scanner sharing its device number   | **passed** | audit → `no-port`; orphan row's `usb_port` still `null` and its `id` unchanged after a real save. This is the exact cell three review rounds got wrong, now proven on real data.            |

| H — **E2E through real IPC in a live Electron app** | **passed** | `tests/e2e/graviscan-ipc.e2e.ts`, **16/16** on the rig, including the three Configure Scanner page tests that drive detect / save / Reset All USB Connections. This is the cross-process coverage for the changed `saveScannersToDB` return shape (the added `refused` field and the nullable `upsertScannerRow` result). |

**E2E procedure, since it took several attempts.** Run it **on the rig, not a workstation** — and
note the documented prerequisites, which are easy to miss:

- `docs/E2E_TESTING.md` opens with a ⚠️ CRITICAL callout: the **dev server must already be running
  on port 9000**. The tests do not start one; without it Electron opens a blank window and
  `launchElectronApp` fails. The port is **9000**, confirmed empirically — a note in my briefing
  claiming the renderer is on 3000 is wrong.
- On Linux, set **`ELECTRON_DISABLE_SANDBOX=1`** (`docs/E2E_TESTING.md:391`), or Electron aborts
  with `FATAL:setuid_sandbox_host.cc(158)` because `chrome-sandbox` is not root-owned mode 4755 —
  which kills `npm start` and takes the dev server with it. No `sudo` is needed. Also run the suite
  with `CI=true`, which is what makes the test helper add `--no-sandbox`.
- Host the dev server in **tmux** (`tmux new-session -d -s forge "… npm start"`). `setsid` plus
  stream redirection is _not_ sufficient: fork-ts-checker's internal RPC pipe still dies with
  `EPIPE` when the SSH session closes.
- **`launchElectronApp` rewrites `~/.bloom/.env`** with a test stub and restores it in cleanup.
  Back that file up independently first — an interrupted run would otherwise leave the rig holding
  the stub, which re-triggers #367's config-screen deadlock. Verified by md5 before and after here
  (`08105388…` unchanged).

- [x] 4.1 On `pbiob-gh-04`: run the audit against the real row and confirm it reports clean.
      Pre-flighted read-only 2026-09-17 — one row, `usb_port: '1-8'`, no duplicates,
      `display_name: null`. Re-confirm at execution time. Do **not** run `npm run dev` or
      `npm run build:python` — they uninstall `python-sane` (#361). `npm ci` first; leave
      `~/.bloom/.env` in place (#367).
- [x] 4.2 Exercise the real write path: click Detect Scanners against the live scanner and confirm
      the existing row is **updated**, not duplicated. The one thing mocked tests cannot establish — a
      mock cannot show that the real `where` clause and real Prisma semantics agree, which is exactly
      how the round-3 inventory error happened.
- [x] 4.3 Synthesise what the rig cannot produce, then restore: a second row sharing
      `usb_port: '1-8'` (audit reports; upsert refuses); a row with `usb_port: ''` (audit reports;
      upsert refreshes its address without assigning a port); a disabled row still holding a port
      (audit reports as stranded). Record the exact DB path and commands; restore the table afterwards.
- [x] 4.4 **Production rig (`graviscan-ms-7c56`) read-only inspection — done 2026-09-17.** No
      active scan workers at the time. Findings, which settled three open questions and found one
      defect:
  - **Live topology:** 5 V600s, each on its own Renesas controller root hub — ports `9-1`, `11-1`,
    `13-2`, `15-1`, `15-2`, all **single-level**, at device numbers 2/2/2/2/3. `buildUsbPort`
    output matches the sysfs directory names exactly.
  - **The live database is `~/.bloom/data/bloom.db`** (56 MB, written 2026-08-31), _not_
    `~/.bloom/dev.db`, which is a 2026-05-02 leftover describing a long-gone bus-1 topology.
    `.env` sets no `BLOOM_DATABASE_URL`, so the default path applies. Read the right file.
  - **17 rows for 5 scanners.** The 5 enabled rows' `usb_port` values match live detection
    byte-for-byte; their `usb_bus`/`usb_device` are stale (9/4, 11/5, 13/4, 15/6, 15/7 against
    live 9/2, 11/2, 13/2, 15/2, 15/3). So **#182's precondition is live on all five production
    scanners**, and the precedence change binds each correctly and merely refreshes the address —
    the duplicate-row trade of `design.md` Decision 2 does **not** fire on this data.
  - **#243's notation-drift hypothesis is refuted on production too**, and the multi-level case
    this task was written to check does not currently exist there. It _has_ existed: the disabled
    history includes `1-2.3` and `1-2.4` from a hub-attached era, so multi-level paths do occur on
    this hardware over time.
  - **Defect found in this change's own audit:** the `stranded-disabled` predicate as first
    implemented ("disabled and still holds a port") reported **12 of the 17 rows**, every one a
    false positive — legitimate history from earlier cablings, because stale-row handling
    preserves `usb_port` on disable. Narrowed to "disabled _and_ its port is held by another row";
    the corrected predicate reports **0 findings** on production, verified against the live data.
- [ ] 4.4a Re-run the read-only inspection at execution time — device numbers move, and the
      enabled rows' addresses will have changed again. Record `lsusb --version` per rig (older
      `usbutils` printed 0-based port numbers, which would shift every path by one per level).
      **Re-check for an active experiment first**; read-only only, no app launch and no scan.
- [x] 4.5 Record outcomes under the `hardware-validation-evidence` convention (per-item
      passed/failed/blocked/not-executed, **naming the commit tested**) and write the account to the
      Obsidian vault at `C:\vaults\graviscan\`.

## 5. Review round 5 — post-implementation code review (`/review-pr`, first review of the merged diff)

All 4 prior review rounds were pre-implementation (openspec-review, scrutinising the design). This
was the first review to read the actual diff, run 5 parallel lenses (code quality, testing/TDD,
scientific rigor, security, behavioural correctness), and it found a genuine blocking bug 4
pre-implementation rounds could not have caught. See `design.md` Decision 9 for the analysis.

- [x] 5.1 Run `/review-pr` against `main...HEAD`. Findings: 3 BLOCKING, 6 IMPORTANT, 0 from
      security. Full synthesis presented to the user 2026-09-21; not posted to GitHub (no PR
      existed yet at review time).
- [x] 5.2 Fix BLOCKING #1 — a same-payload duplicate `usb_port` across two different detected
      devices silently overwrote the first claimant's row instead of being refused (TDD:
      `8d9a763` red, `4cea2f6` green). `saveScannersToDB` now tracks ports claimed within the
      current call and refuses a second claimant before it reaches `upsertScannerRow`.
- [x] 5.3 Fix BLOCKING #2 — `matchDetectedToDb` had no ambiguity refusal, unlike
      `upsertScannerRow`'s identical `>1` check; a plain `Array.find()` silently bound the first
      candidate on a duplicate port (TDD: `4000f81` red, `353d441` green). Also consolidated the
      previously-triplicated `isUsablePort` predicate into one export from `scanner-upsert.ts`,
      and typed the parameter previously `any[]` as `MatchCandidateRow[]`.
- [x] 5.4 Fix BLOCKING #3 — `refused` was produced by `saveScannersToDB` but never declared on
      `SaveScannersToDBResult` and had zero consumers in `src/` (confirmed by grep, independently,
      by two review lenses); `ConfigureScanner.tsx` checked only `success`, which stays `true` on
      a refusal (TDD: `57b560d` red, `ba0483a` green). Also fixed the catch-all error path's
      missing `refused: []` and the `undefined:undefined` log bug in the same code.
- [x] 5.5 Fix IMPORTANT — `disableStaleScannerRows` (pre-existing, unchanged by §1) skipped only
      exact-null ports; the new invariant treats `''` as equally unusable, so a legacy `''`-port
      row could be auto-disabled by a stale sweep (TDD: `b853d5f` red, `df35c09` green).
- [x] 5.6 Close the test-coverage gap — truth-table cell 7 (unusable payload port, matching device
      numbers, a candidate row holding a _usable_ port) had only a query-shape assertion, never an
      end-to-end observation of the exclusion. Added against the real `matchesWhere` predicate
      evaluator; passed immediately (the underlying code was already correct — a coverage gap, not
      a bug), bundled into `b853d5f`.
- [x] 5.7 Correct the record: the TDD-protocol header's blanket red-green claim was false for
      `matchDetectedToDb`, the fleet-disable guard, and the fire-and-forget audit test (two
      admitted in their own commit messages) — annotated in place rather than silently rewritten.
      Fixed `design.md`/`proposal.md`'s description of a `|| existing.usb_port ||` "defensive
      no-op" branch that was never actually implemented that way (the real code omits the key via
      a conditional spread — functionally equivalent, but the docs described code that isn't
      there). Added two new spec scenarios (same-payload duplicate refusal; refusal reaching the
      operator, not just the log) and updated `proposal.md`'s Impact section; re-ran
      `openspec validate --strict` clean.
- [x] 5.8 Re-run `/pre-merge` (format, lint, typecheck, full unit suite) with all of 5.2-5.7
      applied. Confirmed 2026-09-21: format/lint/typecheck clean; `npm run test:unit` 2070
      passed, 1 failed (the same pre-existing `electron-cleanup.test.ts` timing flake), 3 files
      failed (`scans-export.test.ts`, `database-handlers.test.ts` x2) — all pre-existing, outside
      this change's files, consistent with the baseline recorded at 2.8.
- [x] 5.9 Re-run `/review-pr` against the updated diff. **Give at least one lens the brief "did
      this round's fixes introduce defects of their own?"** — this project's history (PR #365, and
      3 of this change's own pre-implementation rounds) shows fixes routinely regress in exactly
      this way. Done 2026-09-21 as 2 parallel agents (one briefed exactly that; one re-walking all
      10 truth-table cells and the full call chain end to end): **no new BLOCKING or IMPORTANT
      findings.** Both independently confirmed: `claimedPorts` only tracks ports from a successful
      save (never blocks a later entry because an earlier one failed); no circular import between
      `scanner-upsert.ts` and `scanner-port-audit.ts`; `ConfigureScanner.tsx`'s `refusedWarning`
      cannot fire post-unmount (no `await` between the mount check and the set); the same-payload
      duplicate refusal is order-symmetric (whichever entry is first wins — there is no ground
      truth for which is "correct" in a genuine detection-layer glitch, so the fix's contract is
      "at most one write," not "the surviving write is provably right"). One suggestion from both
      agents — a reversed-order mirror test — added and green (`1dda68d`).
- [x] 5.10 Open the PR now that 5.9 came back clean.

## 6. Pre-merge

- [ ] 6.1 `/pre-merge`.
- [ ] 6.2 Evidence gate: do not open the PR until 4.1-4.3 are recorded passed and 4.4 passed or
      blocked-with-cause.
- [ ] 6.3 Open the PR. Reference #167 and #203, note the #243 annotation, mark BREAKING with the
      operator note from 3.5, and point out that the sibling change's `Scanner USB Port Matching`
      requirement deliberately cross-references this one and disclaims governing `matchDetectedToDb()`.
- [ ] 6.4 Review cycling to convergence. **Every round after the first gives at least one lens the
      brief "did the previous round's fixes introduce defects of their own?"** — on this change's
      reviews that lens found, twice, that a fix had closed one matching cell while opening another.
      Give one lens the brief to read the **native/C/packaging layer** any assumption rests on.
- [ ] 6.5 Do not merge without explicit go-ahead from the user.
- [ ] 6.6 Only after this merges, proceed with `fix-graviscan-retry-stale-usb-address`, and
      **re-resolve its line citations by symbol first** — this change rewrites
      `scanner-upsert.ts:56-131`, `scanner-handlers.ts:87-109` and `:402-415`, and the
      `lsusb-detection.ts:235` export list, so every downstream number shifts.
