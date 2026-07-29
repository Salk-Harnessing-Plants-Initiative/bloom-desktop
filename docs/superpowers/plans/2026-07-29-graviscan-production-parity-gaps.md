# GraviScan Backend: Production Parity Gaps

## Background

The plan at `docs/superpowers/plans/2026-07-24-graviscan-backend-hardening.md` ported 9
increments of hardware-validated GraviScan work from three stranded/unmerged branches
into `main`, executed via `superpowers:subagent-driven-development` across a full
session (2026-07-26 through 2026-07-29). All 9 increments are merged
(PRs #258, #259, #260, #261, #262, #263, #264, #265, #266) and their OpenSpec changes
archived. `main` is currently at `ea6fb6a`.

After that plan completed, the user asked whether `main` now includes everything on
`fix/v600-wedge-followups-metadata_propogation_followup` — the branch confirmed
running on the production rig `graviscan-ms-7c56` (at `18657bc` as of 2026-07-29).
**It does not.** That branch is 301 files and +31k/-27k lines different from `main`
overall, but most of that is out of scope here: an entire separate scanner modality
(`cylinderscan`/camera/DAQ, Basler/NI-DAQmx — a different hardware path entirely) and
a full GraviScan renderer that doesn't exist on `main` at all (Phase 1b, tracked
separately). **This plan is scoped narrowly to the GraviScan backend** (Python
`scan_worker.py` + `src/main/graviscan/` package + the handful of related root-level
files: `config-store.ts`, `graviscan-upload.ts`, `graviscan-output-dir.ts`,
`wedge-detector.ts`, `slack-notifier.ts`) — explicitly excluding cylinderscan/camera/DAQ
and renderer-only concerns, per the user's direction.

A three-way parallel investigation (via the `Agent` tool, `general-purpose` subagent,
each independently reading full file contents from both branches via `git show` — not
relying on `git diff`, since the two branches use different file layouts and diff
often fails to detect renames) produced the findings below. **Every finding was
independently confirmed by direct code reading before being written down here** —
follow the same standard: read the actual current code on `main` and the actual code
on the production branch yourself before treating any of this as still-accurate,
since `main` may have moved since 2026-07-29.

Key branch/commit references:
- `main` (this plan's starting point): `ea6fb6a`
- Production (`origin/fix/v600-wedge-followups-metadata_propogation_followup`): `18657bc`
- Original 9-increment plan (for cross-reference / established conventions):
  `docs/superpowers/plans/2026-07-24-graviscan-backend-hardening.md`

## Global Constraints

(Same conventions established and proven across the prior 9-increment plan — follow
them exactly.)

- **Confirm via direct investigation, not assumption.** Every finding below came from
  reading actual code on both branches. Before writing a fix, re-read the current
  state of both sides yourself — `main` may have changed since this doc was written,
  and some findings may already be stale.
- One branch/PR/OpenSpec-change/review cycle per increment below. Each increment gets
  its own git worktree (`superpowers:using-git-worktrees`), branch, PR, CI run, and
  (where a formal proposal is warranted — non-trivial new behavior, not a narrow bug
  fix) an OpenSpec change scaffolded fresh and archived after merge.
- **Use this repo's own OpenSpec slash commands, not ad-hoc file creation**, for every
  stage of a change's lifecycle:
  - `/openspec:proposal` to scaffold a new change (`proposal.md`, `tasks.md`,
    `design.md` if warranted, and spec deltas under `changes/<id>/specs/<capability>/`)
    — this is "the new-feature command." Run it, don't hand-write these files from
    scratch, so the proposal follows this repo's exact conventions (verb-led
    change-id, `#### Scenario:` blocks, `openspec validate <id> --strict` at the end).
  - `/openspec:apply` when implementing a change whose proposal already exists and is
    approved — reads `proposal.md`/`design.md`/`tasks.md`, works through tasks in
    order, and keeps the checklist honest (only check off what's actually done).
  - `/openspec:archive` after merge — moves `changes/<id>/` to
    `changes/archive/YYYY-MM-DD-<id>/` and applies the spec deltas to the live
    `openspec/specs/<capability>/spec.md`. Never hand-edit the archive move; let the
    command (and `openspec archive <id> --yes` under the hood) do it, then run
    `openspec validate --all --strict` and `npm run format:check` before committing,
    per the established pattern from every increment of the prior plan.
  - **`openspec/specs/` is "current truth — what IS built"; `openspec/changes/archive/`
    is a historical record of completed proposals, never edited retroactively**
    (confirmed directly from `openspec/AGENTS.md`'s own Directory Structure section).
    If a past change's archived record turns out to have been wrong (see Increment 1
    below), the fix is a brand-new change proposal with a `MODIFIED` delta against the
    live spec — not an edit to the old archived folder.
- Use `superpowers:subagent-driven-development` for execution: fresh implementer
  subagent per task, task-level review (spec + quality), fix loop (max 5 rounds), and
  a final whole-branch review on the most capable available model before merging —
  this is exactly the process that caught 2 Critical + 7 Important cross-stage bugs in
  the prior plan's Increment 9 that no single-stage review saw. Don't skip the final
  review here either, especially for Increment 1 (Critical severity).
- **Ledger discipline**: run this skill's `scripts/sdd-workspace` from the **main
  checkout**, not from inside a worktree — worktrees get their own separate,
  git-ignored `.superpowers/sdd/` directory that is destroyed when the worktree is
  removed post-merge. This cost an entire ledger (Increment 1 of the prior plan) last
  time. All briefs/reports/ledger entries must live at
  `C:/repos/bloom-desktop/.superpowers/sdd/2026-07-29-graviscan-production-parity-gaps/`,
  even though implementer/reviewer subagents do their actual git work inside their
  assigned worktree.
- Squash-merge convention: `gh pr merge <N> --squash --delete-branch=false`, then
  manually delete local branch (`git branch -D`), remote branch
  (`git push origin --delete`), and the worktree (`ExitWorktree action:"remove"
  discard_changes:true` if using the native tool, or `git worktree remove` +
  `git worktree prune` as fallback).
- Auto-merge policy: the user previously approved auto-merging each clean increment
  without pausing for confirmation, reserving pauses for load-bearing ambiguity or
  anything only the user can decide. Confirm this still holds for this new plan/session
  before relying on it — don't assume it silently carries over.
- Rig verification: `pbiob-gh-04` (dev rig) and `graviscan-ms-7c56` (production rig)
  were both offline for the entirety of the prior plan's execution. If still offline,
  continue the established workaround: hardware-dependent verification becomes an
  automated `@pytest.mark.hardware`-marked test (registered in `pyproject.toml`,
  excluded from default runs via `addopts -m "not hardware"`), documented as a manual
  checklist in the PR body, non-blocking for merge. Check rig status
  (`tailscale status`) before assuming this workaround is still needed.
- **Known pre-existing, non-blocking noise** (don't waste a fix-round rediscovering
  these — verify via `git stash` A/B on the exact commit before ever dismissing
  something as "pre-existing", but expect to find these specific ones):
  - Windows path-separator (`\` vs `/`) assertion failures in
    `tests/unit/graviscan/scan-coordinator.test.ts`,
    `tests/unit/graviscan/register-handlers.test.ts`, `schema-detection.test.ts`,
    `config-store.test.ts`, `image-uploader.test.ts`.
  - `fcntl`-module-missing failure on Windows in
    `test_scan_worker.py::TestUSBResetPathConstruction::test_path_from_device_name`.
  - Windows-only `PermissionError` on tempfile cleanup in `test_tiff_metadata.py`
    and `test_camera_streaming.py` (Pillow keeps a file handle open; Windows disallows
    delete-while-open, POSIX doesn't) — local-Windows-only, CI's Linux job is clean.
  - A flaky macOS E2E job (`Test - E2E Dev Build (macos-latest)`) that fails different,
    unrelated `renderer-database-ipc.e2e.ts`/`plant-barcode-validation.e2e.ts` tests
    each run — confirmed flaky via re-run, not a real regression, every time it's come
    up so far.
  - A pre-existing, unrelated TypeScript error at `graviscan-upload.ts:278` (missing
    `plate_barcode` on `GraviImageMetadata`) that shows up in every `tsc --noEmit` run
    on this codebase — not introduced by any of this work.
  - Prettier has a markdown non-idempotence bug on list items with long inline code
    spans near the wrap boundary (continuation-line indent flips between successive
    `--write` passes). If `npm run format:check` won't go clean on an OpenSpec doc, this
    is likely why — restructure the offending prose to avoid the ambiguous wrap point,
    then verify stability by running `prettier --write` twice in a row and diffing.

## Increment 1 — Fix the USBDEVFS_RESET regression (Critical, do first)

**This is the most important item in this entire plan.** `python/graviscan/scan_worker.py`
on `main` still has `_reopen_device()` calling `self._reset_usb_device()` (line ~573
as of `ea6fb6a`) on every device-reopen during error recovery. Production explicitly
**removed** this call on 2026-05-21 (issue #228) because kernel-level USBDEVFS_RESET
makes V600 wedges *worse* — it can trigger a controller FLR (function-level reset) that
fully detaches the scanner, requiring a physical AC power-cycle to recover. This is
exactly the failure mode the entire `add-v600-wedge-followups` initiative exists to
prevent.

Confirm directly before starting:
```bash
git show main:python/graviscan/scan_worker.py | grep -n "_reset_usb_device\|_reopen_device"
git show origin/fix/v600-wedge-followups-metadata_propogation_followup:python/graviscan/scan_worker.py | sed -n '/def _reopen_device/,/def /p'
```

**Why this slipped through**: `main`'s own archived OpenSpec change
(`openspec/changes/archive/2026-07-29-add-v600-wedge-followups/tasks.md`, task 3.5.2)
is checked `[x]` claiming this removal was done, with a test asserting `_reopen_device()`
does not call `_reset_usb_device`. Neither is true on the live code — confirmed by
grepping `python/tests/test_scan_worker.py` directly, no such assertion exists. This
task was never actually part of any of the 9 increments' dispatched scope (Stage 9a's
brief only covered `bytes_received`/`wall_seconds` event fields, WedgeDetector,
SlackNotifier, and config persistence) — the checkbox was inherited pre-checked from
whatever originally staged the `add-v600-wedge-followups` proposal document, most
likely reflecting work that existed only on a stranded branch and was never actually
ported.

**Task**:
1. Remove the `self._reset_usb_device()` call from `_reopen_device()`, matching
   production's fix exactly (delete the call, keep `_reset_usb_device()` itself
   defined and retained — production's own comment says it's "retained for
   testability"; don't delete the method).
2. Port production's explanatory comment (or write an equivalent one) so a future
   reader understands why the call is absent, not just that it's absent.
3. Add the missing regression test: `_reopen_device()` does NOT call
   `_reset_usb_device`. Use a mock/spy on `_reset_usb_device` and assert zero calls
   during a full `_reopen_device()` run.
4. **No new OpenSpec proposal is needed for this one — verified directly.** The live
   spec is already correct: `openspec/specs/scanning/spec.md` has a
   `### Requirement: USBDEVFS_RESET Removed from Recovery Path` (search for
   `USBDEVFS_RESET Removed from Recovery Path`) whose scenario already states, in
   full, exactly the correct behavior — `_reopen_device()` SHALL NOT invoke
   `_reset_usb_device()`, the method SHALL be preserved for testability, the 3-second
   bus-settle sleep SHALL be preserved, etc. The spec was never wrong; only the code
   and the archived `tasks.md` checkbox are. This is the same "narrow bug fix
   restoring already-documented intended behavior" pattern as Increment 1 of the
   prior plan (`docs/superpowers/plans/2026-07-24-graviscan-backend-hardening.md`),
   which also needed no OpenSpec change per this repo's Global Constraints. Just fix
   the code, add the test the spec's own scenario already describes
   (`#### Scenario: Recovery path does not call USBDEVFS_RESET`), and say plainly in
   the PR description that the implementation was out of compliance with an
   already-correct, already-archived spec requirement — no spec edit required.
   `openspec/changes/archive/2026-07-29-add-v600-wedge-followups/` itself must not be
   edited regardless (it's a historical record of what was proposed and when, per
   `openspec/AGENTS.md`'s Directory Structure section) — the PR description is where
   this discrepancy gets recorded, not the archive.
5. Check whether the same "checked but not actually implemented" pattern applies to
   any *other* checkbox in that same archived tasks.md — task 3.5 has sibling items
   (3.5.1, 3.5.3, 3.5.4 per the file's numbering) worth a quick audit while you're in
   there, since if one was falsely checked, siblings might be too.

Rig-only manual validation (document as checklist, don't skip, can't be automated):
confirm real recovery behavior on a real wedge event once `pbiob-gh-04` or
`graviscan-ms-7c56` is back online — specifically that recovery no longer triggers a
controller FLR/detachment requiring physical power-cycle.

## Increment 2 — Missing `graviscan:verify-plates` IPC handler (Critical)

Production's `src/main/graviscan-handlers.ts` (around line 1084-1488) has a complete
QR-code plate-position verification and swap-auto-correction pipeline with real DB
side effects — not a UI-only feature:

```bash
git show origin/fix/v600-wedge-followups-metadata_propogation_followup:src/main/graviscan-handlers.ts | sed -n '1084,1488p'
```

It detects when two plates' QR codes were swapped during loading (`detectedPlateId`/
`assignedPlateId` cross-match) and corrects `db.graviScanPlateAssignment.updateMany`
and `db.graviScan.update` directly, writing `verification_status`. Nothing on `main`
does this at all — confirmed via full read of all 5 of `main`'s modular
`src/main/graviscan/*.ts` handler files.

**Task**: Port this to `main`'s modular layout — likely a new
`src/main/graviscan/verify-plates.ts` or added to `scanner-handlers.ts`/a new file,
your call based on `main`'s existing file-organization conventions (one exported
function per logical concern, thin IPC registration in `register-handlers.ts`). Wrap
each DB write in its own try/catch (per-record, not batch) matching production's
defensive pattern — confirmed production does this so one bad record doesn't abort the
whole batch. Write real tests (this repo's established convention throughout the
prior plan: handler-level tests against the real exported function, never a
logic-mirror reimplementation).

Note: this handler emits `getMainWindow?.()?.webContents.send(...)` progress events
(`verify-started`, `verify-result`, `verify-complete`) that are no-ops without a
renderer — that's fine, port them anyway (harmless, and a future renderer will need
them); just don't treat the absence of a listener as a reason to skip porting the
underlying logic.

## Increment 3 — Missing `get-scanner-status` + `list-scan-files` + `ensure-dir` handlers (Important)

Three handlers present on production, absent on `main`, bundled here since they're
each small and independent of each other:

- **`graviscan:get-scanner-status`** (production `graviscan-handlers.ts:1033-1070`):
  merges live `coordinator.getScannerStatuses()` subprocess state with DB rows to
  report `disconnected` for saved-but-not-running scanners. **This handler depends on
  `getScannerStatuses()` existing on the coordinator, which also doesn't exist on
  `main` yet** — see Increment 6 below, which must land first or be folded into this
  increment (your call on ordering; they're tightly coupled, consider doing them
  together as one increment if that's cleaner than a hard sequencing dependency).
- **`graviscan:list-scan-files`** (production `graviscan-handlers.ts:1790-1875`): lists
  image files, recursive when no `dirPath` given, flat when a session dir is given,
  sorted newest-first, filtered by extension.
- **`graviscan:ensure-dir`** (production `graviscan-handlers.ts:1770-1784`): trivial
  idempotent `fs.promises.mkdir(dirPath, {recursive:true})`.

Confirm via:
```bash
git show origin/fix/v600-wedge-followups-metadata_propogation_followup:src/main/graviscan-handlers.ts | sed -n '1033,1070p;1770,1875p'
```

Port to `main`'s `image-handlers.ts` (file-listing/mkdir concerns fit there
alongside `getOutputDir`/`readScanImage`) and wherever `getScannerStatuses()` lands
(coordinator-facing, so likely `register-handlers.ts` or `scanner-handlers.ts`,
matching how `resetUsb`/`validateConfig` are wired today).

## Increment 4 — Coordinator correctness: `getScannerStatuses()`, `initErrors` clearing, `addScanner` race guard (Important)

Three related fixes to `src/main/graviscan/scan-coordinator.ts`:

1. **Port `getScannerStatuses()`** from production (`scan-coordinator.ts:84-111` on
   that branch) — merges live subprocess state with the `initErrors` map that `main`
   already has (ported in the prior plan, currently unconsumed). This unblocks
   Increment 3's `get-scanner-status` handler.
2. **Clear `initErrors` at the top of `initialize()`.** Production does
   `this.initErrors.clear()` before repopulating (`scan-coordinator.ts:136-137` on
   that branch); `main`'s `initialize()` has no equivalent, so a scanner that failed
   once and later succeeds keeps a stale error entry forever, which would feed wrong
   data into `getScannerStatuses()` once that's wired up per item 1.
3. **Restore the double-queued `addScanner()` race guard.** Production re-enters
   `addScanner()` (not `spawnSingleScanner()` directly) from the queued
   `cycle-complete` handler, specifically so the `hasWorker()` idempotency check
   re-runs before actually spawning — this was a real fix for a real bug (Copilot PR
   #237: double-clicking "Detect" mid-scan could spawn duplicate subprocesses for the
   same scanner). `main`'s current code
   (`scan-coordinator.ts` `addScanner()`, the `cycle-complete` handler around line
   171-177) calls `spawnSingleScanner()` directly, skipping that re-check. Confirm the
   exact current line numbers and restore the re-entrant call, matching production's
   structure:
   ```bash
   git show origin/fix/v600-wedge-followups-metadata_propogation_followup:src/main/scan-coordinator.ts | sed -n '290,310p'
   ```

## Increment 5 — `usb_bus`/`usb_device`/`usb_port` `||` vs `??` bug (Important, small)

`src/main/graviscan/scanner-upsert.ts`'s `upsertScannerRow()` uses `||` instead of
`??` for these three fields in both the UPDATE and CREATE blocks:

```ts
usb_port: payload.usb_port || null,
usb_bus: payload.usb_bus || null,
usb_device: payload.usb_device || null,
```

Production uses `??`. If `usb_bus`/`usb_device` is legitimately `0` (a valid USB bus/
device number), `||` silently coerces it to `null`, breaking the hardware-identity
match key used by `detectScanners`/`resetUsb`/auto-init. Small, mechanical, one-line-
per-field fix plus a regression test asserting a `usb_device: 0` payload round-trips
correctly (not coerced to null).

## Increment 6 — `graviscan_system_name` / `GRAVISCAN_SYSTEM_NAME` missing entirely (Important)

Production has a `graviscan_system_name` field fully wired: `getDefaultConfig()`,
`loadEnvConfig()`, `saveEnvConfig()` in `config-store.ts`; hydrated into
`process.env.GRAVISCAN_SYSTEM_NAME` at startup in `main.ts`; operator-editable in the
(not-yet-ported) renderer's `MachineConfiguration.tsx`. `main`'s `config-store.ts` has
no such field — yet `main`'s own `graviscan-upload.ts` (x2 call sites) and
`box-backup.ts` already read `process.env.GRAVISCAN_SYSTEM_NAME`, which is therefore
always `undefined`. Every uploaded session/image and Box-backup path silently loses
system-name attribution on `main` — a real problem for multi-rig fleets.

**Task**: port the field through `config-store.ts` (matching the pattern already
established for `slack_webhook_url`/`libusb_endpoint_recovery` in the prior plan —
read-merge-write via `saveEnvConfig()`, not overwrite) and the `main.ts` startup
hydration. Renderer wiring (`MachineConfiguration.tsx`) is out of scope until the
renderer itself exists — document that as a follow-up note, don't invent a fake
renderer component to satisfy this.

## Increment 7 — `download-images` gaps (Important, larger)

Three distinct gaps in `src/main/graviscan/image-handlers.ts`'s `downloadImages()`
vs. production's equivalent in `graviscan-handlers.ts` (~line 2047-2247):

1. **Wave-aware accession lookup** — production falls back to
   `db.graviExperimentWaveMetadata.findMany(...)` keyed by `(experiment_id,
   wave_number)` when `experiment.accession_id` is null; `main` always uses the single
   legacy accession for every wave. **This is the same, already-known,
   already-deferred gap flagged during Increment 6 of the prior plan** — `main`'s
   Prisma schema has no `GraviExperimentWaveMetadata` model at all, and `main`'s
   `ExperimentForm.tsx` requires `accession_id` at creation time so the null-accession
   case can't currently occur via `main`'s UI. **Do not port this in isolation** — it's
   explicitly tied to a separate, not-yet-started "add-wave-scoped-metadata-linking"
   initiative that would need the schema migration first. Confirm this is still true
   before deciding, then either explicitly defer (again) with a note, or escalate to
   the user if you think it's now in scope.
2. **Missing `plates.csv`/`sections.csv` output** — production writes 3 CSVs per wave
   subfolder (metadata/plates/sections); `main` writes only `metadata.csv`. This part
   is NOT tied to the wave-metadata schema gap — port it independently.
3. **Different target-directory contract** — production auto-resolves
   `app.getPath('downloads')` and only needs `{experimentId, experimentName,
   waveNumber?}`; `main`'s signature requires an explicit `targetDir: string` with no
   default. Since `main` has no renderer yet to supply a directory picker, decide
   whether to add the Downloads-folder default now (so a future renderer can omit
   `targetDir` entirely, matching production's simpler contract) or leave it explicit.
   Your call — flag your reasoning in the PR.

## Increment 8 — Smaller/optional items (Minor)

Bundle if worth doing at all, otherwise explicitly defer each with a one-line reason
in this plan's ledger:

- `graviscan:cancel-scan` — production clears the session *before* awaiting
  `coordinator.shutdown()`; `main` clears it *after*. A caller polling
  `graviscan:get-scan-status` during that window sees different `isActive` values.
  Decide which ordering is actually correct (main's own comment on a different
  function suggests deferring session-clear until work is truly done is the
  deliberate pattern elsewhere in this codebase — likely main's is fine, but confirm,
  don't assume).
- DPI runtime-validation safety net (`V600_VALIDATED_DPI`, `_validate_dpi()`,
  `dpi-warning` event) in `scan_worker.py` — self-flagged as incomplete in `main`'s own
  archived tasks.md (task 8.6), not a silent regression. Low urgency since it fails
  safe (missing warning ≠ actual wedge), but real telemetry value for the wedge-
  detection story this whole effort is about.
- `graviscan:reset-scanners` handler — likely dead on production too (no renderer
  call site found during investigation, superseded by the more complete `reset-usb`
  flow). Probably not worth porting; confirm no other caller exists before skipping.
- `SCANS_DIR` → `GRAVISCAN_OUTPUT_DIR` env var rename (already done correctly in the
  prior plan, necessary since `main`'s `config-store.ts` already uses `SCANS_DIR` for
  an unrelated setting) — needs a one-time operator migration step on the rig's
  `~/.bloom/.env` during any eventual cutover, since a legacy `SCANS_DIR=` value set
  specifically to redirect GraviScan output on production will silently stop being
  honored on a `main`-based build. Not a code fix — a deployment note. Make sure
  whoever eventually deploys `main`-based builds to `graviscan-ms-7c56` knows this.

## What NOT to do

- Do not touch anything in `src/main/cylinderscan/` (or wherever camera/DAQ code
  lives), `python/hardware/camera*.py`, `python/hardware/daq*.py`, or any Basler/
  NI-DAQmx-related file. That's a separate hardware modality and explicitly out of
  scope per the user's direction.
- Do not port any renderer-only code (`src/renderer/**`, `.tsx` files) — no GraviScan
  renderer exists on `main`, and building one is out of scope for this plan.
- Do not treat `main`'s pre-existing improvements over production as gaps to "fix
  back" — `main` is already ahead of production on: the `'process-error'` vs `'error'`
  event-name fix (production has a live crash risk main already avoided), the
  `cancelAll()`/`sleepResolve` hang fix, `readline` handle cleanup in
  `scanner-subprocess.ts`, path-traversal hardening in `read-scan-image`, the
  `scan_regions.py` bed-geometry clamp, and the empty-payload stale-disable guard in
  `save-scanners-db`. Leave these alone; they are not in this plan's scope to change.

## Which increments need `/openspec:proposal`

Per Global Constraints ("formal proposal warranted = non-trivial new behavior, not a
narrow bug fix" — the same test the prior plan applied throughout):

| Increment | OpenSpec proposal? | Why |
|---|---|---|
| 1 — USBDEVFS_RESET | **No** | Live spec already correct; pure bug fix bringing code into compliance (verified directly, see Increment 1's own notes). |
| 2 — verify-plates | **Yes** | New capability with no main counterpart at all — real new behavior. |
| 3 — get-scanner-status / list-scan-files / ensure-dir | **Yes** | New IPC surface, new behavior. |
| 4 — coordinator correctness | **Likely no**, but check `getScannerStatuses()` specifically — if bundled into Increment 3's proposal (per the suggested merge), it inherits that one; the `initErrors`-clear and `addScanner` race-guard fixes are narrow bug fixes on their own. |
| 5 — `\|\|` vs `??` | **No** | One-line correctness fix, no behavior change from what was ever intended. |
| 6 — `graviscan_system_name` | **Yes** | New config field, new persisted behavior — same shape as the prior plan's `slack_webhook_url`/`libusb_endpoint_recovery` work, which did get a proposal (folded into `add-v600-wedge-followups`). |
| 7 — download-images gaps | **Yes**, for the `plates.csv`/`sections.csv` + target-dir-contract parts (new/changed behavior). The wave-metadata part is explicitly deferred, not implemented — no proposal needed for something not being done. |
| 8 — minor items | **No**, or fold into whichever of 6/7's proposal is doing the adjacent work if actually implemented rather than deferred. |

Don't treat this table as gospel over your own judgment once you're actually looking
at the code — it's a starting point, re-derive if something doesn't fit once you're in
the work, same as every judgment call throughout the prior plan.

## Suggested execution order

Increment 1 (Critical, safety) → Increment 2 (Critical, data-correctness feature) →
Increments 3+4 together (tightly coupled coordinator/handler work) → Increment 5
(quick correctness fix) → Increment 6 → Increment 7 → Increment 8 (optional, lowest
priority, do last or skip with notes).
