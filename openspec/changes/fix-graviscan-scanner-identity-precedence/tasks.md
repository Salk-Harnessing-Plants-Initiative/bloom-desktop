# Tasks — GraviScan scanner-identity matching precedence

## TDD protocol

**Failing tests are committed in their own commit, before the commit that makes them pass.**
Red-green must be visible in `git log`, not asserted here. On PR #365 a `tasks.md` claim of
red-green proved false because tests and implementation landed together, and a coverage claim
proved false because the test passed a parameter explicitly instead of exercising the
production call site. So:

- **No task is checked off on the strength of this file.** Counts below were checked against
  the test source.
- Mock row shapes are audited against `prisma/schema.prisma:231-245` wholesale, not
  field-by-field as a test happens to need — five defects on PR #365 were "the test passed
  only because the mock was more forgiving than production".
- `vitest.config.ts:39` excludes `src/main/**` from coverage and all thresholds are 0
  (`:45-50`); the CI IPC gate reads only `src/main/database-handlers.ts`. **No CI gate
  measures this change's code.** These tests are the only automated protection.

Commands: `npm run lint`, `npx tsc --noEmit`, `npm run test:unit`.

---

## 0. Prerequisites

- [ ] 0.1 `npm ci` in the worktree (it has no `node_modules`; `npx vitest` fails without it).
- [ ] 0.2 Re-verify #167, #203 and #243 are still in the state `proposal.md` assumes, per the
  standing rule to re-check issues at execution time.
- [ ] 0.3 Read #243's closing comment in full before touching `upsertScannerRow`. This change
  reverses the order that comment names as the fix; `design.md` Decision 3 is the argument, and
  it should be re-checked against the issue rather than trusted.

## 1. Red phase — commit failing tests first

- [ ] 1.1 `tests/unit/graviscan/scanner-upsert.test.ts` — precedence, both directions:
  - rows `sc-A (port 1-2.3, device 8)` and `sc-B (port 1-4, device 5)`; upsert for
    `port 1-4, device 8` updates `sc-B` and leaves `sc-A`'s `usb_port`, `name` and
    `display_name` untouched;
  - a detected scanner on a usable but unknown port (`1-9`) with a colliding device number
    creates a new row rather than capturing `sc-A`;
  - the bus/device fallback still matches when the payload's port is unusable;
  - **assert `db.graviScanner.findFirst.mock.calls[0][0].where` to pin which query ran first** —
    otherwise precedence is only implied by outcomes.
- [ ] 1.2 Same file — duplicate-port determinism: two rows on `'1-2.3'`, one
  `enabled: false` created earlier and one `enabled: true` updated later; the enabled, most
  recent row is updated. Assert the `orderBy` actually passed to `findFirst`.
- [ ] 1.3 Same file — `usb_port` preservation (Decision 5): an update whose payload carries
  `usb_port: ''` leaves a stored `'1-2.3'` intact; a create whose payload carries `''` stores
  `null`, not `''`. Then assert the follow-on consequence explicitly: a subsequent detection
  reporting `'1-2.3'` matches the same row instead of creating a duplicate.
- [ ] 1.4 Same file — retitle `:141` ("updates the existing row when matched by usb_bus +
  usb_device") and `:159` ("falls back to matching by usb_port when bus/device do not match").
  Both still **pass** after the inversion because their fixture's port and bus/device agree, but
  their titles become false and they stop covering the paths they name. Give each a fixture
  that actually exercises the path in its title.
- [ ] 1.5 `tests/unit/graviscan/scanner-handlers.test.ts` — `matchDetectedToDb()`: a
  re-enumerated device binds to the row owning its port, not the row owning the coincident
  device number; a detected scanner on a usable-but-unknown port is treated as new, **not**
  matched by device number; the fallback works when the detected port is unusable; an
  empty-string port does not match another empty-string port (the `s.usb_port &&` guard at
  `scanner-handlers.ts:101` must survive the inversion). Export `matchDetectedToDb` for direct
  testing — it is private today, has no direct tests, and is named in no standing requirement,
  so exporting creates no spec conflict. Test it directly **and** keep one assertion through
  `detectScanners()` so the production call site is exercised.
- [ ] 1.6 New test file for the startup audit: a null-port row is reported; two rows sharing a
  port are reported with both `scanner_id`s; a stored `'1-10.0'` against a detected `'1-10'` is
  reported as a mismatch; a clean fixture reports no findings; a detection failure still reports
  null/duplicate findings and records the notation comparison as *not performed* rather than
  passing; a throwing audit does not propagate. Assert no `update`/`delete` call is ever made —
  read-only is the load-bearing property.
- [ ] 1.7 Run `npm run test:unit`; confirm each new test fails **on an assertion**, not on a
  missing import or a mock without the method. Record the count.
- [ ] 1.8 **Commit the failing tests alone.** The message SHALL list failing test names in three
  groups: (i) new, intended; (ii) pre-existing tests whose fixtures/titles this change
  deliberately rewrites — 1.4's two; (iii) anything else, **which must be empty**.

### Pre-existing tests: expected impact

Checked against source. `scanner-upsert.test.ts` has **25** tests across 4 describes
(`upsertScannerRow` from `:124`, then `:285`, `:357`, `:423`). None *fails* on the inversion —
`:141` and `:159` pass for the wrong reason (1.4). `scanner-handlers.test.ts`'s four
`detectScanners` tests never construct a device-number collision, so nothing breaks and nothing
currently covers `matchDetectedToDb` either. `register-handlers.test.ts` (71) mocks the handler
modules wholesale and is unaffected. **No Python test is affected** — this change touches no
Python.

## 2. Green phase

- [ ] 2.1 `scanner-upsert.ts` — invert `upsertScannerRow()` to port-primary with the fallback
  gated on the payload's port being unusable; add
  `orderBy: [{ enabled: 'desc' }, { updatedAt: 'desc' }]` to the port lookup; preserve a usable
  stored port (`payload.usb_port || existing.usb_port || null`) and coerce `''` to `null` on
  create. Keep the `enabled: true` re-detect re-enable behaviour and the disable-not-delete
  policy untouched. Update the now-false `// Prefer match on (usb_bus, usb_device)` comment at
  `:56` and the module doc-comment's matching description at `:17-19`.
- [ ] 2.2 `scanner-handlers.ts` — invert `matchDetectedToDb()` the same way; export it.
- [ ] 2.3 Implement the startup audit and call it from GraviScan's existing startup validation
  path. Read-only, non-blocking, own failures swallowed and logged. Emit one durable
  `scanLog()` line per finding class plus a clean-result line, with a stable, greppable prefix —
  and pin that prefix in a test, since the log is the only production signal this audit exists.
- [ ] 2.4 `npm run test:unit` fully green, including all 25 pre-existing `scanner-upsert` tests.
  Confirm 1.7's recorded count is now zero.
- [ ] 2.5 `npm run lint` and `npx tsc --noEmit` clean.
- [ ] 2.6 **Commit the implementation** separately from 1.8.

## 3. Documentation

- [ ] 3.1 Re-read `proposal.md` and `design.md` against the final diff; re-verify every line
  citation. Round 2 of review found citation drift in the sibling change's first draft, and
  `openspec validate --strict` checks delta structure, not whether prose matches code.
- [ ] 3.2 `npx openspec validate fix-graviscan-scanner-identity-precedence --strict` clean.
- [ ] 3.3 **Dry-run the archive path before opening the PR**, not after merge:
  `openspec validate --strict` does **not** cross-check a delta against the standing spec, and
  `specs-apply.js:333-335` throws at archive time on any scenario *name* present in the standing
  spec but absent from a MODIFIED block. This change is ADDED-only so it should be unaffected —
  confirm that rather than assume it.
- [ ] 3.4 Annotate #243 with `design.md` Decision 3's argument, so a later reader does not find
  a Tier-0-verified fix apparently reversed with no explanation. Comment on #167 and #203,
  correcting #203's false premise that port-primary matching already ships.
- [ ] 3.5 Write the operator note for the BREAKING change: what the audit reports, and what to
  do about each finding class.
- [ ] 3.6 File the `usb_port` unique-constraint issue (Decision 6) and the
  `graviscan:save-scanners-db` missing active-scan guard.

## 4. Hardware validation

- [ ] 4.1 On `pbiob-gh-04`: run the startup audit against the real row and confirm it reports
  clean. Pre-flighted read-only 2026-09-17 — one row, `usb_port: '1-8'`, byte-identical to live
  `buildUsbPort()` output, no duplicates, `display_name: null`. Re-confirm at execution time
  (device numbers move). Do **not** run `npm run dev` or `npm run build:python` — they uninstall
  `python-sane` (#361). Run `npm ci` first; leave `~/.bloom/.env` in place (#367).
- [ ] 4.2 Exercise the real write path: click Detect Scanners against the live scanner and
  confirm the existing row is **updated**, not duplicated — the one thing 25 mocked tests cannot
  establish, since a `findFirst` mock cannot show that real Prisma ordering and the real
  `where` clause agree. Capture the row before and after.
- [ ] 4.3 Synthesise the cases the rig cannot produce naturally, then restore: a second row
  sharing `usb_port: '1-8'` (audit must report it, and an upsert must pick the enabled/most
  recent); a row with `usb_port: ''` (audit must report it; an upsert must not leave it `''`).
  Record the exact DB path and commands, and restore the table afterwards.
- [ ] 4.4 **Verify the hub-attached, multi-level port case on the production rig**
  (`graviscan-ms-7c56`), read-only: `ls /sys/bus/usb/devices/` and byte-compare each stored
  `usb_port` against live `buildUsbPort()` output for a hub-attached V600. Only the single-level
  case (`1-8`) has been verified, and #243's notation hypothesis is unresolved precisely for
  multi-level paths. Also record `lsusb --version` per rig — older `usbutils` printed 0-based
  port numbers, which would make every stored path wrong by one per level. **Re-check for an
  active experiment first**; no destructive action is ever in scope on the production rig.
- [ ] 4.5 Record outcomes under the `hardware-validation-evidence` convention
  (passed/failed/blocked/not-executed per item, **naming the commit tested**) and write the
  account to the Obsidian vault at `C:\vaults\graviscan\`.

## 5. Pre-merge

- [ ] 5.1 `/pre-merge`.
- [ ] 5.2 Evidence gate: do not open the PR until 4.1-4.3 are recorded passed and 4.4 is
  recorded passed or blocked-with-cause.
- [ ] 5.3 Open the PR. Reference #167 and #203, note the #243 annotation, and mark it BREAKING
  with the operator note from 3.5.
- [ ] 5.4 Review cycling to convergence: `/copilot-review` + `/review-pr`, re-running against the
  updated diff after each round. **Every round after the first gives at least one lens the brief
  "did the previous round's fixes introduce defects of their own?"** with those fixes listed — on
  PR #365 three consecutive rounds found exactly that, and on this change's own round 2 that lens
  found that a round-1 fix had falsified the #243 non-regression argument while leaving the
  argument in place. Give one lens the brief to read the **native/C/packaging layer** any
  assumption rests on; round 1 of the sibling change missed a fatal `libusb-filter.c` assumption
  because all five lenses read only the diff's own languages.
- [ ] 5.5 Do not merge without explicit go-ahead from the user.
- [ ] 5.6 Only after this merges, proceed with `fix-graviscan-retry-stale-usb-address`, which
  depends on the port hygiene this change establishes.
