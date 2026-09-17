# Tasks — GraviScan scanner-identity matching precedence

## TDD protocol

**Failing tests are committed in their own commit, before the commit that makes them pass.**
Red-green must be visible in `git log`, not asserted here.

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
- [ ] 0.2 Re-verify #167, #203 and #243 are still in the state `proposal.md` assumes.
- [ ] 0.3 Read #243's closing comment in full before touching `upsertScannerRow`. This change
  reverses the order that comment names as the fix; `design.md` Decision 3 is the argument, and it
  should be re-checked against the issue rather than trusted.

## 1. Red phase

### 1.0 — make the new tests capable of failing for the right reason

- [x] 1.0a Create `src/main/graviscan/scanner-port-audit.ts` as a **signature-only stub**: the
  `ScannerPortAuditDb` interface, the finding union (`no-port` | `duplicate-port` |
  `stranded-disabled`), and `auditScannerPorts(db): Promise<ScannerPortFinding[]>` with body
  `throw new Error('not implemented')`. Without it, task 1.4's tests produce a single Vitest
  collection error so no assertion executes, 1.5's "fails on an assertion" is unachievable, and
  `npm run lint` goes red on `import/no-unresolved` (an error via `plugin:import/recommended`,
  and `eslint --ext .ts,.tsx .` covers `tests/`). Note `tsc` would *not* go red — it does not see
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

Write one test per cell of `design.md`'s matching table. The invariant under test is: *a
device-number match never assigns, changes or transfers a `usb_port`.*

- [x] 1.1a Usable payload port equal to a row's port → that row is updated.
- [x] 1.1b Usable payload port, a different row holds a usable port, device numbers equal → **no
  match**, a new row is created, and the other row's `usb_port`/`name`/`display_name` are
  untouched.
- [x] 1.1c Usable payload port, a row has `usb_port: null` and the same device numbers → **no
  match**; that row's `usb_port` stays `null`; a new row is created. Repeat for `''`. *This is the
  cell that two earlier drafts got wrong in opposite directions — it is the misattribution guard.*
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
  `usb_port: null`, never `''`. Note the "unusable payload, *usable* stored port" case is
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
- [ ] 1.4c `tests/unit/graviscan/main-wiring.test.ts` calls `initGraviScan('graviscan', {} as any, …)`
  at `:99`, `:106`, `:112`, `:118`, `:128` — a `{}` database. Add a case proving startup still
  completes with the audit wired in and an unusable `db`, since the audit must swallow its own
  failure and must not leak a rejection from a fire-and-forget call.

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
- [ ] 2.8 `npm run test:unit` green. Confirm 1.5a's recorded count is now zero and the baseline's
  92 are all accounted for.
- [x] 2.9 `npm run lint` and `npx tsc --noEmit` clean.
- [x] 2.10 **Commit the implementation** separately from 1.5c.

## 3. Documentation

- [ ] 3.1 Re-read `proposal.md` and `design.md` against the final diff; re-verify every line
  citation. Review rounds found citation drift in three successive drafts.
- [ ] 3.2 `npx openspec validate fix-graviscan-scanner-identity-precedence --strict` clean, run
  from the **worktree root** (from inside the change directory it reports "Unknown item").
- [ ] 3.3 Confirm the archive scenario-name check is not applicable — this change is ADDED-only, so
  it cannot drop a scenario name from a MODIFIED block. (The check is `findMissingCurrentScenarios`
  in `@fission-ai/openspec`'s archive module; cite it by function name, since its path moves
  between releases.) Confirm rather than assume.
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

- [ ] 4.1 On `pbiob-gh-04`: run the audit against the real row and confirm it reports clean.
  Pre-flighted read-only 2026-09-17 — one row, `usb_port: '1-8'`, no duplicates,
  `display_name: null`. Re-confirm at execution time. Do **not** run `npm run dev` or
  `npm run build:python` — they uninstall `python-sane` (#361). `npm ci` first; leave
  `~/.bloom/.env` in place (#367).
- [ ] 4.2 Exercise the real write path: click Detect Scanners against the live scanner and confirm
  the existing row is **updated**, not duplicated. The one thing mocked tests cannot establish — a
  mock cannot show that the real `where` clause and real Prisma semantics agree, which is exactly
  how the round-3 inventory error happened.
- [ ] 4.3 Synthesise what the rig cannot produce, then restore: a second row sharing
  `usb_port: '1-8'` (audit reports; upsert refuses); a row with `usb_port: ''` (audit reports;
  upsert refreshes its address without assigning a port); a disabled row still holding a port
  (audit reports as stranded). Record the exact DB path and commands; restore the table afterwards.
- [x] 4.4 **Production rig (`graviscan-ms-7c56`) read-only inspection — done 2026-09-17.** No
  active scan workers at the time. Findings, which settled three open questions and found one
  defect:
  - **Live topology:** 5 V600s, each on its own Renesas controller root hub — ports `9-1`, `11-1`,
    `13-2`, `15-1`, `15-2`, all **single-level**, at device numbers 2/2/2/2/3. `buildUsbPort`
    output matches the sysfs directory names exactly.
  - **The live database is `~/.bloom/data/bloom.db`** (56 MB, written 2026-08-31), *not*
    `~/.bloom/dev.db`, which is a 2026-05-02 leftover describing a long-gone bus-1 topology.
    `.env` sets no `BLOOM_DATABASE_URL`, so the default path applies. Read the right file.
  - **17 rows for 5 scanners.** The 5 enabled rows' `usb_port` values match live detection
    byte-for-byte; their `usb_bus`/`usb_device` are stale (9/4, 11/5, 13/4, 15/6, 15/7 against
    live 9/2, 11/2, 13/2, 15/2, 15/3). So **#182's precondition is live on all five production
    scanners**, and the precedence change binds each correctly and merely refreshes the address —
    the duplicate-row trade of `design.md` Decision 2 does **not** fire on this data.
  - **#243's notation-drift hypothesis is refuted on production too**, and the multi-level case
    this task was written to check does not currently exist there. It *has* existed: the disabled
    history includes `1-2.3` and `1-2.4` from a hub-attached era, so multi-level paths do occur on
    this hardware over time.
  - **Defect found in this change's own audit:** the `stranded-disabled` predicate as first
    implemented ("disabled and still holds a port") reported **12 of the 17 rows**, every one a
    false positive — legitimate history from earlier cablings, because stale-row handling
    preserves `usb_port` on disable. Narrowed to "disabled *and* its port is held by another row";
    the corrected predicate reports **0 findings** on production, verified against the live data.
- [ ] 4.4a Re-run the read-only inspection at execution time — device numbers move, and the
  enabled rows' addresses will have changed again. Record `lsusb --version` per rig (older
  `usbutils` printed 0-based port numbers, which would shift every path by one per level).
  **Re-check for an active experiment first**; read-only only, no app launch and no scan.
- [ ] 4.5 Record outcomes under the `hardware-validation-evidence` convention (per-item
  passed/failed/blocked/not-executed, **naming the commit tested**) and write the account to the
  Obsidian vault at `C:\vaults\graviscan\`.

## 5. Pre-merge

- [ ] 5.1 `/pre-merge`.
- [ ] 5.2 Evidence gate: do not open the PR until 4.1-4.3 are recorded passed and 4.4 passed or
  blocked-with-cause.
- [ ] 5.3 Open the PR. Reference #167 and #203, note the #243 annotation, mark BREAKING with the
  operator note from 3.5, and point out that the sibling change's `Scanner USB Port Matching`
  requirement deliberately cross-references this one and disclaims governing `matchDetectedToDb()`.
- [ ] 5.4 Review cycling to convergence. **Every round after the first gives at least one lens the
  brief "did the previous round's fixes introduce defects of their own?"** — on this change's
  reviews that lens found, twice, that a fix had closed one matching cell while opening another.
  Give one lens the brief to read the **native/C/packaging layer** any assumption rests on.
- [ ] 5.5 Do not merge without explicit go-ahead from the user.
- [ ] 5.6 Only after this merges, proceed with `fix-graviscan-retry-stale-usb-address`, and
  **re-resolve its line citations by symbol first** — this change rewrites
  `scanner-upsert.ts:56-131`, `scanner-handlers.ts:87-109` and `:402-415`, and the
  `lsusb-detection.ts:235` export list, so every downstream number shifts.
