# Tasks — GraviScan scanner-identity matching precedence

## TDD protocol

**Failing tests are committed in their own commit, before the commit that makes them pass.**
Red-green must be visible in `git log`, not asserted here. On PR #365 a `tasks.md` claim of
red-green proved false because tests and implementation landed together, and a coverage claim
proved false because the test passed a parameter explicitly instead of exercising the production
call site. So:

- **No task is checked off on the strength of this file.** Counts below were checked against the
  test source, and an earlier draft of this file still got the inventory wrong — it claimed
  "None *fails* on the inversion" while omitting an entire `describe` block containing a test
  that hard-fails. Verify, do not infer.
- Mock row shapes are audited against `prisma/schema.prisma:231-245` wholesale, not field by
  field as a test happens to need — five defects on PR #365 were "the test passed only because
  the mock was more forgiving than production".
- `vitest.config.ts:39` excludes `src/main/**` from coverage and all thresholds are 0
  (`:45-50`); the CI IPC gate reads only `src/main/database-handlers.ts`. **No CI gate measures
  this change's code.** These tests are the only automated protection.

Commands: `npm run lint`, `npx tsc --noEmit`, `npm run test:unit`.

---

## 0. Prerequisites

- [ ] 0.1 `npm ci` in the worktree (it has no `node_modules`; `npx vitest` fails without it).
- [ ] 0.2 Re-verify #167, #203 and #243 are still in the state `proposal.md` assumes.
- [ ] 0.3 Read #243's closing comment in full before touching `upsertScannerRow`. This change
  reverses the order that comment names as the fix; `design.md` Decision 3 is the argument, and
  it should be re-checked against the issue rather than trusted.

## 1. Red phase — commit failing tests first

- [ ] 1.1 `tests/unit/graviscan/scanner-upsert.test.ts` — the two-sided fallback. Build a
  fixture table and assert each cell, because the whole design turns on which side is
  restricted:
  - row port usable and **different** from a usable payload port, device numbers equal →
    **create** a new row; the existing row's `usb_port`, `name` and `display_name` unchanged;
  - row port `null`, payload port usable, device numbers equal → **update** that row and set
    its `usb_port` (this is the healing path, and it is what a one-sided gate would have lost);
  - row port `''`, same → **update** and set the port;
  - two rows sharing the device number, one with a usable port and one with `null` → binds the
    `null`-port row, never the other;
  - payload port unusable and row port usable → update, and the stored port is **preserved**;
  - **assert `findFirst.mock.calls[0][0].where` to pin that the port query ran first**, and that
    the fallback query carries the row-side port restriction. Otherwise precedence and the
    restriction are only implied by outcomes.
- [ ] 1.2 Same file — ambiguity refusal: two rows both holding `usb_port: '1-2.3'`; assert no
  `update` and no `create` call, and that the ambiguity is reported. **The existing `findFirst`
  mock (`:55-77`) consults only `where` and returns the first array match, and
  `interface MockGraviScanner` (`:24-34`) has no `createdAt`/`updatedAt` at all** — so widen the
  mock to return all matches (or to expose the candidate set) before writing this, or the
  assertion is vacuous. Do not substitute an `orderBy` assertion: this change deliberately has
  no ordering heuristic to assert (`design.md` Decision 6).
- [ ] 1.3 Same file — create path: a payload with `usb_port: ''` and no matching row creates a
  row with `usb_port: null`, not `''`. Then assert the consequence: a later detection reporting
  a usable port for the same device **updates** that row rather than creating a second one.
- [ ] 1.4 Same file — retitle and re-fixture `:141` ("updates the existing row when matched by
  usb_bus + usb_device") and `:159` ("falls back to matching by usb_port when bus/device do not
  match"). Both still **pass** after the inversion but for the wrong reason: `:141`'s fixture has
  port `1-1` *and* bus/device agreeing with the payload, so it passes via the port lookup, and
  `:159`'s row has `usb_bus: null, usb_device: null, usb_port: '1-1'`, so the "fallback" it names
  is now the primary path. Give each a fixture that exercises the path in its title.
- [ ] 1.5 Same file — the fleet-disable guard (§2): a detection pass in which every payload entry
  carries `usb_port: ''` disables **no** row. The existing test `:344` ("handles an empty
  current-port set by disabling all enabled rows") pins today's opposite behaviour and must be
  updated, not duplicated — it is a deliberate inversion.
- [ ] 1.6 `tests/unit/graviscan/scanner-handlers.test.ts` — `matchDetectedToDb()`: a
  re-enumerated device binds to the row owning its port, not the row owning the coincident device
  number; a detected scanner on a usable-but-unknown port is treated as new; the fallback reaches
  only rows whose own port is unusable; an empty-string port does not match another empty-string
  port (the `s.usb_port &&` guard at `scanner-handlers.ts:101` must survive). Export
  `matchDetectedToDb` for direct testing — it is private today, has no direct tests, and is named
  in no standing requirement. Test it directly **and** keep one assertion through
  `detectScanners()` so the production call site is exercised.
- [ ] 1.7 New test file for the startup audit: a null-port row is reported; two rows sharing a
  port are reported naming both; a **disabled** row still holding a port is reported as stranded;
  a clean fixture reports no findings; the audit invokes **no** USB detection; a throwing audit
  does not propagate. Assert no `update`/`delete` call is ever made — read-only is the
  load-bearing property. Include a disabled row in every fixture, since scoping the audit to all
  rows is the fix for the duplicate being otherwise invisible.
- [ ] 1.8 Run `npm run test:unit`; confirm each new test fails **on an assertion**, not on a
  missing import or a mock lacking a method. Record the count.
- [ ] 1.9 **Commit the failing tests alone.** The message SHALL list failing test names in three
  groups: (i) new, intended; (ii) pre-existing tests this change deliberately inverts or
  re-fixtures — `scanner-handlers.test.ts:157`, `scanner-upsert.test.ts:141`, `:159`, `:344`;
  (iii) anything else, **which must be empty**.

### Pre-existing tests: verified impact

`scanner-upsert.test.ts` has **25** tests across describes at `:124`, `:285`, `:357`, `:423`.
`scanner-handlers.test.ts` has a `describe('saveScannersToDB')` at **`:127`** — omitted from an
earlier draft of this inventory — whose tests run straight through `upsertScannerRow`.

| Test | Fate |
|---|---|
| `scanner-handlers.test.ts:157` "should update existing scanner matched by USB bus+device" | **HARD FAIL.** Its mock answers only a bus/device `where` and the payload carries a usable `usb_port: '1-2'`, so the port lookup misses, the restricted fallback finds no unusable-port row, and the create path runs — with `create` left as a bare `vi.fn()` returning `undefined`, so `created.id` throws. Needs re-fixturing (group ii). |
| `scanner-handlers.test.ts:128`, `:196`, `:235`, `:292` | Pass. `:128` stubs `findFirst` null with `create` mocked; `:196`/`:235` key on `usb_port`; `:292` short-circuits. |
| `scanner-upsert.test.ts:141`, `:159` | Pass for the wrong reason; titles become false (task 1.4). |
| `scanner-upsert.test.ts:344` | **Deliberately inverted** by §2 (task 1.5). |
| `scanner-upsert.test.ts:320` "ignores rows with a null usb_port" | Still correct and still wanted — it pins why the healing path matters. |
| `scanner-handlers.test.ts:527` `runStartupScannerValidation` | Passes before and after, but only because its fixture row omits `usb_port`/`usb_bus`/`usb_device` and pre-sets `scanner_id` — it never exercises `matchDetectedToDb`. A mock-fidelity gap; fold a real fixture into task 1.6. |
| `register-handlers.test.ts` (71), `WedgeBanner.test.tsx` (11) | Unaffected. |

No Python test is affected — this change touches no Python.

## 2. Green phase

- [ ] 2.1 `scanner-upsert.ts` — `upsertScannerRow()` port-primary; the bus/device fallback
  restricted to rows whose own `usb_port` is unusable (`OR: [{ usb_port: null }, { usb_port: '' }]`);
  refuse to write and report when the port lookup resolves more than one row; preserve a usable
  stored port (`payload.usb_port || existing.usb_port || null`); coerce `''` to `null` on create.
  Keep the `enabled: true` re-detect re-enable behaviour and the disable-not-delete policy
  untouched. Update the now-false `// Prefer match on (usb_bus, usb_device)` comment at `:56` and
  the module doc-comment at `:17-19`.
- [ ] 2.2 `scanner-handlers.ts` — invert `matchDetectedToDb()` the same way, with the same
  row-side restriction; export it.
- [ ] 2.3 `scanner-handlers.ts` — in `saveScannersToDB`, skip the `disableStaleScannerRows` call
  when no payload entry carries a usable `usb_port` (§2's fleet-disable guard).
- [ ] 2.4 `src/main/lsusb-detection.ts` — export `buildUsbPort` (module-private at `:131`,
  absent from the export list at `:235`) so the audit and its tests can name a port exactly as
  detection does.
- [ ] 2.5 Implement the startup audit in its own module, deriving every finding from the database
  with **no** USB detection, examining **all** rows including disabled ones. Invoke it from a
  main-process startup path that actually executes — **not** `runStartupScannerValidation()`,
  which is reachable only via `graviscan:validate-scanners`, exposed at `preload.ts:419-420` and
  invoked by no renderer or E2E code. Identify and name the chosen hook in the implementation
  comment. Read-only, non-blocking, own failures swallowed and logged. Emit one durable
  `scanLog()` line per finding class plus a clean-result line, with a stable greppable prefix —
  and pin that prefix in a test, since the log is the only production signal the audit exists.
- [ ] 2.6 `npm run test:unit` fully green. Confirm 1.8's recorded count is now zero.
- [ ] 2.7 `npm run lint` and `npx tsc --noEmit` clean.
- [ ] 2.8 **Commit the implementation** separately from 1.9.

## 3. Documentation

- [ ] 3.1 Re-read `proposal.md` and `design.md` against the final diff; re-verify every line
  citation. Review rounds found citation drift in earlier drafts, and
  `openspec validate --strict` checks delta structure, not whether prose matches code.
- [ ] 3.2 `npx openspec validate fix-graviscan-scanner-identity-precedence --strict` clean.
  Run it from the **worktree root**, not from inside the change directory, or it reports
  "Unknown item".
- [ ] 3.3 Confirm the archive scenario-name check is not applicable: `validate --strict` does not
  cross-check a delta against the standing spec, and the archive path throws on any scenario
  *name* present in the standing spec but absent from a MODIFIED block. This change is ADDED-only,
  so it cannot trip that — confirm rather than assume. (The check lives in
  `@fission-ai/openspec`'s archive module as `findMissingCurrentScenarios`; cite it by function
  name, since its file path and line numbers move between releases.)
- [ ] 3.4 Annotate #243 with `design.md` Decision 3's argument, so a later reader does not find a
  Tier-0-verified fix apparently reversed with no explanation. Comment on #167 and #203,
  correcting #203's false premise that port-primary matching already ships.
- [ ] 3.5 Write the operator note for the BREAKING change. It must cover each finding class and
  say plainly what can and cannot be done in-app: a null/empty port heals on the next successful
  detection; a duplicate port requires choosing a canonical row; a usable-but-wrong port has
  **no** in-app remedy (`upsertScannerRow` is the only writer of `usb_port` and can no longer
  reach such a row) — the remedy is the existing per-row disable followed by a re-detect. Note
  also that `display_name` is positional and rewritten on every Detect, so labels reshuffle.
- [ ] 3.6 File the `usb_port` unique-constraint issue (Decision 8) and the
  `graviscan:save-scanners-db` missing active-scan guard. Also file the dead
  `graviscan:validate-scanners` path found while choosing the audit hook.

## 4. Hardware validation

- [ ] 4.1 On `pbiob-gh-04`: run the startup audit against the real row and confirm it reports
  clean. Pre-flighted read-only 2026-09-17 — one row, `usb_port: '1-8'` byte-identical to live
  `buildUsbPort()` output, no duplicates, `display_name: null`. Re-confirm at execution time
  (device numbers move). Do **not** run `npm run dev` or `npm run build:python` — they uninstall
  `python-sane` (#361). Run `npm ci` first; leave `~/.bloom/.env` in place (#367).
- [ ] 4.2 Exercise the real write path: click Detect Scanners against the live scanner and confirm
  the existing row is **updated**, not duplicated. This is the one thing mocked tests cannot
  establish — a `findFirst` mock cannot show that the real `where` clause and real Prisma
  semantics agree. Capture the row before and after.
- [ ] 4.3 Synthesise the cases the rig cannot produce naturally, then restore: a second row
  sharing `usb_port: '1-8'` (audit reports it; an upsert refuses to write); a row with
  `usb_port: ''` (audit reports it; an upsert heals it to the live port); a **disabled** row still
  holding a port (audit reports it as stranded). Record the exact DB path and commands, and
  restore the table afterwards.
- [ ] 4.4 **Verify the hub-attached, multi-level port case on the production rig**
  (`graviscan-ms-7c56`), read-only: `ls /sys/bus/usb/devices/` and compare each stored `usb_port`
  against live detection's `usb_port` for a hub-attached V600. Only the single-level case (`1-8`)
  has been verified, and #243's notation hypothesis is unresolved precisely for multi-level paths.
  Record `lsusb --version` per rig — older `usbutils` printed 0-based port numbers, which would
  make every stored path wrong by one per level. **Re-check for an active experiment first**; no
  destructive action is ever in scope on the production rig.
- [ ] 4.5 Record outcomes under the `hardware-validation-evidence` convention
  (passed/failed/blocked/not-executed per item, **naming the commit tested**) and write the
  account to the Obsidian vault at `C:\vaults\graviscan\`.

## 5. Pre-merge

- [ ] 5.1 `/pre-merge`.
- [ ] 5.2 Evidence gate: do not open the PR until 4.1-4.3 are recorded passed and 4.4 is recorded
  passed or blocked-with-cause.
- [ ] 5.3 Open the PR. Reference #167 and #203, note the #243 annotation, mark it BREAKING with
  the operator note from 3.5, and point out that the sibling change's `Scanner USB Port Matching`
  requirement deliberately cross-references this change's requirement and disclaims governing
  `matchDetectedToDb()` — the two deltas are coordinated, so a reviewer need not re-derive it.
- [ ] 5.4 Review cycling to convergence: `/copilot-review` + `/review-pr`, re-running against the
  updated diff after each round. **Every round after the first gives at least one lens the brief
  "did the previous round's fixes introduce defects of their own?"** with those fixes listed — on
  PR #365 three consecutive rounds found exactly that, and on this change's first review that
  lens found a one-sided gate that would have manufactured permanently-unmatchable ghost rows.
  Give one lens the brief to read the **native/C/packaging layer** any assumption rests on.
- [ ] 5.5 Do not merge without explicit go-ahead from the user.
- [ ] 5.6 Only after this merges, proceed with `fix-graviscan-retry-stale-usb-address`, which
  depends on the port hygiene this change establishes.
