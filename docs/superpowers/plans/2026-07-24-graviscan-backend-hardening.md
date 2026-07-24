# GraviScan Backend Hardening — Incremental Port Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the GraviScan production rig's hardware-validated backend work — currently stranded across three unmerged branches — into `main`, increment by increment, restoring the OpenSpec + TDD discipline the original merge already established for schema/types/handlers/coordinator.

**Architecture:** Almost none of this is new code. It already exists, tested, hardware-validated on the real production rig. The work is porting/adapting it into `main`'s current modular `src/main/graviscan/` structure (which didn't exist when these branches diverged) and closing real, verified gaps — not writing green-field features. Each increment: port, adapt to current structure, verify (tests + hardware where applicable), commit, PR, review, merge, archive the OpenSpec change.

**Tech Stack:** Electron + React + TypeScript + Prisma + Python (SANE) + native C (libusb shim) + Vitest + pytest + Playwright.

## Global Constraints

- TDD discipline: port code and its tests together; don't claim a port "done" without running its tests.
- Mocking philosophy (user-specified 2026-07-24): "necessary but sufficient" — mock only what genuinely requires hardware; exercise real code paths wherever possible to catch real bugs.
- Hardware-dependent verification (SANE/libusb/USB-specific behavior) MUST be checked for real against the physical rig at `pbiob-gh-04` (Tailscale IP `100.96.231.23`, SSH user `elizabeth`, key `~/.ssh/id_ed25519`, passwordless sudo), not assumed from mocks alone. A real Epson Perfection V600 (`04b8:013a`, GT-X820) is connected there.
- Each increment gets its own branch off `main`, its own PR, and goes through the same review process as recent PRs (#256, #257): implement → lint/test → commit → push → PR → adversarial review scaled to the change → fix findings → merge → clean up branch.
- OpenSpec: for increments with an existing stranded proposal, bring `openspec/changes/<id>/` over, adjust file references to match `main`'s current structure, implement against it, archive properly on merge (matching the 6 already-archived GraviScan changes: `2026-04-08-add-graviscan-schema` through `2026-04-16-refactor-extract-graviscan-wiring`). For orphan fixes with no proposal: skip the formal proposal only if it's a narrow bug-fix restoring already-intended behavior (per `openspec/AGENTS.md`); scaffold a lightweight proposal if it's a real behavior/capability change.
- Single-scan-mode compatibility: confirmed (2026-07-24 investigation) that everything in this plan applies equally whether the eventual GraviScan deployment uses continuous/timelapse mode or single-shot-only. `scanMode: 'single' | 'continuous'` is already the schema/renderer default with `'single'` as the base case; hardware-reliability work (wedge detection, libusb-filter, USB-hub detection) operates per-scan-event, not per-cycle, so none of it is continuous-mode-specific.

---

## Background: why this isn't a simple cherry-pick

Three facts, established through direct investigation (not assumption), that every increment below depends on:

1. **`main`'s backend was refactored after these branches diverged.** The original GraviScan integration (archived OpenSpec changes `2026-04-08` through `2026-04-16`) landed a monolithic `src/main/graviscan-handlers.ts` + `src/main/scan-coordinator.ts`, then `2026-04-16-refactor-extract-graviscan-wiring` split it into the modular `src/main/graviscan/{scan-coordinator,scanner-handlers,scanner-subprocess,register-handlers,wiring,session-handlers,image-handlers,scan-logger}.ts` package that exists on `main` today. The stranded branches (`feature/graviscan-prod`, `fix/v600-wedge-followups`, `fix/v600-wedge-followups-metadata_propogation_followup`) still use the old flat-file layout — none of them saw the refactor. Every TS-side port in this plan needs re-authoring into the current file layout, not a literal merge.

2. **OpenSpec proposals cover roughly 20% of the real commit volume.** The full lineage from `main` to `origin/fix/v600-wedge-followups-metadata_propogation_followup` is 135 commits. Only 6 have an OpenSpec change scaffolded (`add-v600-wedge-followups`, `add-wave-scoped-metadata-linking`, `add-reset-usb-button`, `add-ld-preload-to-subprocess`, `fix-scan-file-path-with-et-timestamp`, `remove-row-merge-scan`). A full commit-by-file audit (`git log main..origin/fix/v600-wedge-followups-metadata_propogation_followup --oneline -- python/ src/main/`) turned up substantial real, undocumented backend work — some of it critical (see #206 below). tasks.md checkbox counts on the 6 documented proposals were also frequently wrong (one showed `0/23` despite being ~75-80% actually implemented; another showed `0/12` despite being 100% done).

3. **Issue #206 is a live, currently-broken blocker on `main`.** `src/main/graviscan/scanner-subprocess.ts` on `main` already spawns `bloom-hardware --scan-worker --scanner-id ...` when packaged (lines ~97-99), but `python/main.py` on `main` has zero support for that flag — confirmed via direct `git show main:python/main.py | grep scan-worker` (no matches). This means **GraviScan cannot run scan workers in any packaged build on `main` today**, and per issue #206's own repro steps, it may also fail in `GRAVISCAN_MOCK=true npm run start` dev mode. The fix (commit `3f55b50` on the branch) already exists, is small, and is self-contained — hence Increment 1.

Full corrected branch lineage:

```
main
 └─ feature/graviscan-prod                                          (79 commits ahead of main at time of writing, 26 behind; hardware-validated on the real rig; old flat file structure)
     └─ fix/v600-wedge-followups                                    (PR #237, open, +49 commits; OpenSpec-scaffolded, Copilot-reviewed, has a Tier 1/2/3 rig-validation checklist)
         └─ fix/v600-wedge-followups-metadata_propogation_followup   (tip, +7 commits, no PR yet — treat as authoritative for "what's production-validated" per 2026-07-24 confirmation)
```

**Deferred, separate tracks (explicitly out of scope for this plan):**

- **QR verification subsystem** (`680a2d9`, `3c6a158`, `9984695`, `5f4de4a`, `3f90568`, `db6a10f`) — a full data-integrity feature (detects misplaced/duplicate plates via QR codes), not hardware "hardening." No proposal exists. Deserves its own dedicated review given its scientific-validity implications.
- **`add-wave-scoped-metadata-linking`** — ~75-80% done on the branch (schema, backend handlers, and most tests match the spec closely), but has real gaps: the UI silently swallows delete-blocked errors (`GraviMetadataList.tsx` catch block says `// Silently fail`), the migration lacks a data-backfill step, and the actual linking flow landed in `ExperimentForm.tsx` rather than the proposal's specified `GraviMetadataUpload.tsx`. This is an experiment/metadata feature, not scanner-hardware reliability — explicitly deferred per 2026-07-24 decision. Related upload-layer commits (`6aa678e`, `76b5b88`, `612b289`) travel with it when that track is picked up.

---

## Increment 1: Fix #206 — scan-worker mode for packaged builds

**Why first:** Confirmed currently broken on `main`. Everything else in this plan assumes GraviScan can actually run. Small, self-contained, already proven on the branch (source commit `3f55b50`).

**Files:**

- Modify: `python/graviscan/scan_worker.py` — extract `run_worker(scanner_id, device, mock)` from the existing `main()` CLI body
- Modify: `python/main.py` — add `scan_worker_mode()` + `--scan-worker`/`--scanner-id`/`--device`/`--mock` argparse flags, routing to `run_worker`

**Interfaces:**

- Produces: `run_worker(scanner_id: str, device: str, mock: bool = False) -> None` in `python/graviscan/scan_worker.py`, called by both `python -m graviscan.scan_worker` (dev) and `bloom-hardware --scan-worker` (packaged) — Increment 2 and later increments that touch `scan_worker.py`'s `main()` must preserve this entry point.

### Tasks

- [ ] **Step 1: Get the exact source diff for reference**

```bash
git show 3f55b50 -- python/graviscan/scan_worker.py python/main.py
```

- [ ] **Step 2: Branch off main**

```bash
git checkout main && git pull origin main
git checkout -b fix/scan-worker-mode-206
```

- [ ] **Step 3: Apply the `run_worker` extraction to `scan_worker.py`**

Add above `main()`:

```python
def run_worker(scanner_id: str, device: str, mock: bool = False) -> None:
    """Entry point for scan worker — used by both dev mode and production PyInstaller.

    Creates a ScanWorker, initializes SANE, and enters the command loop.
    Exits with code 1 if initialization fails, 0 on clean exit.
    """
    worker = ScanWorker(
        scanner_id=scanner_id,
        device_name=device,
        mock=mock,
    )

    if not worker.initialize():
        sys.exit(1)

    worker.run()
    sys.exit(0)
```

Replace the body of `main()` (after arg parsing) that constructs `ScanWorker` directly with:

```python
    run_worker(args.scanner_id, args.device or "mock-device", args.mock)
```

- [ ] **Step 4: Wire `--scan-worker` into `python/main.py`**

Add:

```python
def scan_worker_mode(scanner_id: str, device: str, mock: bool = False):
    """Run as a scan worker subprocess for a single scanner."""
    try:
        from python.graviscan.scan_worker import run_worker
    except ModuleNotFoundError:
        from graviscan.scan_worker import run_worker  # type: ignore[import-not-found]
    run_worker(scanner_id, device, mock)
```

In `main()`'s argparse setup, add:

```python
    parser.add_argument(
        "--scan-worker", action="store_true", help="Run as scan worker subprocess"
    )
    parser.add_argument("--scanner-id", type=str, help="Scanner UUID (scan-worker mode)")
    parser.add_argument("--device", type=str, help="SANE device name (scan-worker mode)")
    parser.add_argument("--mock", action="store_true", help="Use mock scanner (scan-worker mode)")
```

And in the routing logic:

```python
    if args.scan_worker:
        if not args.scanner_id or not args.device:
            parser.error("--scan-worker requires --scanner-id and --device")
        scan_worker_mode(args.scanner_id, args.device, args.mock)
        return
```

- [ ] **Step 5: Verify existing Python tests still pass**

```bash
uv run pytest python/tests/test_scan_worker.py -v
```

Expected: all PASS (this is a pure refactor — `main()`'s CLI behavior for the existing `-m graviscan.scan_worker` path must be unchanged).

- [ ] **Step 6: Add a test for the new entry point**

Create/extend `python/tests/test_scan_worker.py` (or a focused new test file) with a test that calls `python/main.py`'s argument parser with `--scan-worker --scanner-id X --device Y` and asserts it routes to `scan_worker_mode` (mock the actual `run_worker` call — this is testing CLI routing, not scanner behavior, so mocking here is the _sufficient_ half of "necessary but sufficient": no real hardware is involved in what's being tested).

- [ ] **Step 7: Reproduce the original bug, then confirm the fix, on the physical rig**

```bash
ssh -i ~/.ssh/id_ed25519 elizabeth@100.96.231.23
# clone/checkout this branch on the rig if not already present, then:
GRAVISCAN_MOCK=true npm run start
```

Confirm scan start no longer produces the `unrecognized arguments` error from issue #206's repro steps.

- [ ] **Step 8: Run full test suite + lint**

```bash
npm run test:python
npm run lint
npx tsc --noEmit
```

- [ ] **Step 9: Commit, push, open PR**

```bash
git add python/graviscan/scan_worker.py python/main.py python/tests/
git commit -m "fix: add --scan-worker mode to main.py for packaged builds (#206)"
git push -u origin fix/scan-worker-mode-206
```

Reference issue #206 in the PR body (`Fixes #206`). This is a narrow bug-fix restoring intended behavior — no OpenSpec proposal needed per `openspec/AGENTS.md`.

---

## Increment 2: `remove-row-merge-scan`

**Why second:** Zero design risk — hardware-validated on 2026-04-09 across all 5 scanners, fully implemented and tested on the branch already. Simplifies the worker before Increment 3 builds on top of it. Confirmed main still has the row-merge code path today (`git show main:python/graviscan/scan_worker.py | grep _scan_row` finds it).

**Files:**

- Modify: `python/graviscan/scan_worker.py` — remove `_scan_row`, `_sane_scan_row`, `_mock_scan_row`
- Modify: `python/graviscan/scan_regions.py` — remove `get_row_bounding_box`, `get_crop_box`, `GRID_4_ROW_GROUPS`/`get_row_groups`
- Modify: `python/tests/test_scan_worker.py` — remove/skip row-merge test coverage
- Modify: `python/tests/test_scan_regions.py` — remove `TestGetRowBoundingBox`/`TestGetCropBox`

**Interfaces:**

- Consumes: nothing from Increment 1 directly, but must land after it (same file, avoid conflicting simultaneous edits to `scan_worker.py`'s `main()` region — row-merge removal touches `_handle_scan`, not `main()`, so conflict risk is low but sequencing still matters for clean history).
- Produces: `scan_worker.py`'s `_handle_scan` with no row-merge branch — every plate scans individually at its exact grid ROI. Increment 3 depends on this (its "Why" explicitly states each plate scan is now independent).

### Tasks

- [ ] **Step 1: Get the exact source diff for reference**

```bash
git show e638aca -- python/graviscan/scan_regions.py python/graviscan/scan_worker.py python/tests/test_scan_regions.py python/tests/test_scan_worker.py
```

- [ ] **Step 2: Bring the OpenSpec proposal over**

```bash
git checkout main && git pull origin main
git checkout -b refactor/remove-row-merge-scan
git checkout origin/fix/v600-wedge-followups-metadata_propogation_followup -- openspec/changes/remove-row-merge-scan/
```

Review `openspec/changes/remove-row-merge-scan/tasks.md` — mark items done as you complete the equivalent step below rather than trusting the stranded copy's checkboxes (they were never updated, per the 2026-07-24 audit).

- [ ] **Step 3: Apply the diff to `main`'s current files**

The branch's `python/graviscan/scan_worker.py` and `scan_regions.py` have NOT been restructured on `main` (unlike the TS side) — this should apply close to as-is. Use the diff from Step 1 as the reference; apply manually via Edit since `main`'s file may have diverged slightly since Increment 1's changes (both touch `scan_worker.py`).

- [ ] **Step 4: Update tests to match**

Port the test changes from `git show e638aca -- python/tests/` — remove `TestGetRowBoundingBox`/`TestGetCropBox` from `test_scan_regions.py`, and either remove or `@pytest.mark.skip(reason="Row-merge scanning removed")` the row-merge test classes in `test_scan_worker.py` (the branch used skip-marking for `TestScanRowErrorAllPlates` — follow the same pattern rather than deleting outright, so the historical test intent stays discoverable).

- [ ] **Step 5: Run tests**

```bash
uv run pytest python/tests/test_scan_worker.py python/tests/test_scan_regions.py -v
```

Expected: PASS (with the row-merge tests skipped, not failing).

- [ ] **Step 6: Verify no other code references the removed functions**

```bash
grep -rn "get_row_bounding_box\|get_crop_box\|_scan_row\|_sane_scan_row\|_mock_scan_row" python/ src/
```

Expected: no matches outside the (now-skipped) test file.

- [ ] **Step 7: Run full test suite + lint**

```bash
npm run test:python
npm run lint
```

- [ ] **Step 8: Commit, push, open PR**

```bash
git add python/graviscan/ python/tests/ openspec/changes/remove-row-merge-scan/
git commit -m "refactor: remove row-merge scanning — all plates scan at exact grid ROI"
git push -u origin refactor/remove-row-merge-scan
```

- [ ] **Step 9: After merge, archive the OpenSpec change**

```bash
git checkout main && git pull origin main
npx openspec archive remove-row-merge-scan --yes
npx openspec validate --strict
git add openspec/
git commit -m "chore: archive remove-row-merge-scan"
git push
```

---

## Increment 3: Path composition + et-timestamp fix

**Why third:** Depends on Increment 2 (each plate scan must be independent for the worker to know its own `_et_` timestamp at save time). The OpenSpec proposal (`fix-scan-file-path-with-et-timestamp`) only names the smaller follow-up commit (`0b80c1e`) — the actual foundational work is `b430428` ("build scan file paths from components, compose at save time"), which the 2026-07-24 audit found was missing from the proposal's own file list. Port both together.

**Files:**

- Modify: `python/graviscan/scan_worker.py` — add `compose_output_path()`, call it from `_sane_scan`/`_mock_scan` before saving (no post-save rename)
- Modify: `python/graviscan/scan_regions.py` — path-component helpers if `compose_output_path` depends on them (check `b430428`'s exact diff)
- Modify: `python/main.py` — if `b430428` touches CLI args for path components (check diff)
- Create: `python/tests/test_scan_path_composition.py` (this file already exists on the branch — port it, don't write from scratch)
- Modify: `python/tests/test_scan_worker.py`, `python/tests/test_tiff_metadata.py`
- Modify (main-process side, needs re-authoring into current structure): `src/main/graviscan/scan-coordinator.ts` — remove any post-save rename logic (branch's flat `src/main/scan-coordinator.ts` had this removed already; confirm main's modular version doesn't still have it)

**Interfaces:**

- Consumes: `run_worker` unchanged (Increment 1); per-plate independent scanning (Increment 2).
- Produces: `scan-complete` events emitted with the final `_et_`-suffixed path already correct at emission time — no downstream consumer (main-process or renderer, when it's built in Phase 1b) should expect a rename step after `scan-complete`.

### Tasks

- [ ] **Step 1: Get both exact source diffs for reference**

```bash
git show b430428 > /tmp/path-composition.diff
git show 0b80c1e > /tmp/et-timestamp-fix.diff
```

- [ ] **Step 2: Bring the OpenSpec proposal over**

```bash
git checkout main && git pull origin main
git checkout -b fix/scan-file-path-et-timestamp
git checkout origin/fix/v600-wedge-followups-metadata_propogation_followup -- openspec/changes/fix-scan-file-path-with-et-timestamp/
```

Update the proposal's file list to include `b430428`'s changes — the stranded copy only documents `0b80c1e`.

- [ ] **Step 3: Apply `b430428`'s Python-side changes first**

Read `/tmp/path-composition.diff`'s Python hunks (`scan_regions.py`, `scan_worker.py`, `main.py`) and apply via Edit, adapting to whatever Increment 2 left in place.

- [ ] **Step 4: Apply `0b80c1e`'s Python-side changes on top**

Read `/tmp/et-timestamp-fix.diff`'s Python hunks and apply.

- [ ] **Step 5: Port the test files**

```bash
git show origin/fix/v600-wedge-followups-metadata_propogation_followup:python/tests/test_scan_path_composition.py
```

Save as `python/tests/test_scan_path_composition.py` on this branch, adjusting imports if `main`'s module layout differs.

- [ ] **Step 6: Run Python tests**

```bash
uv run pytest python/tests/test_scan_path_composition.py python/tests/test_scan_worker.py python/tests/test_tiff_metadata.py -v
```

- [ ] **Step 7: Check main's TS coordinator for now-obsolete rename logic**

```bash
grep -n "rename\|oldPath\|newPath" src/main/graviscan/scan-coordinator.ts
```

If found, remove it (per the branch's `scan-coordinator.ts` diff in `b430428`/`0b80c1e`, showing the rename loop deleted) — re-author into the modular file's actual structure rather than copy-pasting the flat-file version.

- [ ] **Step 8: Run full test suite + lint + typecheck**

```bash
npm run test:python
npm run test:unit
npx tsc --noEmit
npm run lint
```

- [ ] **Step 9: Verify on the physical rig with a real scan**

```bash
ssh -i ~/.ssh/id_ed25519 elizabeth@100.96.231.23
# on the branch checkout there, run a real scan and confirm the saved
# file path matches the scan-complete event's emitted path exactly —
# no rename window.
```

- [ ] **Step 10: Commit, push, open PR, and after merge archive**

```bash
git add python/ src/main/graviscan/ openspec/changes/fix-scan-file-path-with-et-timestamp/
git commit -m "fix: compose scan file paths with _et_ timestamp at save time (#154)"
git push -u origin fix/scan-file-path-et-timestamp
```

After merge: `npx openspec archive fix-scan-file-path-with-et-timestamp --yes`, validate, commit, push (same pattern as Increment 2 Step 9).

---

## Increment 4: Small reliability-fix bundle

**Why fourth and grouped:** Five independent, small, low-risk fixes with no proposal — bundling them avoids five near-trivial PRs while keeping the diff reviewable. None touch the same files as each other's core logic (verify at Step 1), so grouping is low-risk. Each is a narrow bug-fix restoring intended behavior — no OpenSpec proposal needed.

**Files:**

- Modify: `src/main/graviscan/scan-coordinator.ts` (continuous-folder-per-cycle bug, `73f0fad`; filename-rewrite scoping, `f94cfb6`)
- Modify: `src/main/lsusb-detection.ts` (USB-hub detection, `dfafcc2`)
- Modify: `src/main/graviscan/scanner-handlers.ts` or equivalent (stale-scanner-record cleanup, `8b8f5f3`/`a660cb5`) — check `scanner-upsert.ts` too, since later increments touch it
- Modify: wherever preview image decoding lives (sequential sharp decode queueing, `f875f73`)
- Modify: `src/main/graviscan/` config/output-dir handling (`SCANS_DIR` env fix, `f80a32c`) — branch introduced `src/main/graviscan-output-dir.ts`; check if `main` has an equivalent or needs this new file

### Tasks

- [ ] **Step 1: Get all five exact source diffs and confirm no file-level conflicts between them**

```bash
git show dfafcc2 > /tmp/usb-hub-detection.diff
git show 8b8f5f3 > /tmp/stale-scanner-cleanup-1.diff
git show a660cb5 > /tmp/stale-scanner-cleanup-2.diff
git show 73f0fad > /tmp/continuous-folder-bug.diff
git show f94cfb6 > /tmp/filename-rewrite-scope.diff
git show f875f73 > /tmp/sequential-image-decode.diff
git show f80a32c > /tmp/scans-dir-env-fix.diff
```

Read each; note that `73f0fad` and `f94cfb6` both touch `scan-coordinator.ts` — apply them in commit order (`73f0fad` before `f94cfb6`) to match how they were authored.

- [ ] **Step 2: Branch off main**

```bash
git checkout main && git pull origin main
git checkout -b fix/graviscan-reliability-bundle
```

- [ ] **Step 3: Apply USB-hub detection fix**

Re-author `dfafcc2`'s `lsusb-detection.ts` changes — this file exists on `main` at the same path (not restructured), so the diff should apply close to as-is via Edit.

- [ ] **Step 4: Apply stale-scanner-record cleanup**

Re-author `8b8f5f3` + `a660cb5` into `main`'s current `src/main/graviscan/scanner-handlers.ts` (the branch's monolithic `graviscan-handlers.ts` equivalent). Check for overlap with `scanner-upsert.ts` first — Increment 8 (`add-reset-usb-button`) and Increment 9 (`add-v600-wedge-followups`, Tasks 2/3) both touch stale-row handling too; if this fix is fully superseded by either of those, skip it here and note that in the PR description rather than doing redundant work.

- [ ] **Step 5: Apply continuous-folder-per-cycle bug fix, then the filename-rewrite scoping fix**

Re-author `73f0fad` then `f94cfb6` into `src/main/graviscan/scan-coordinator.ts`, in that order.

- [ ] **Step 6: Apply sequential image-decode queueing fix**

Locate where `main` currently does preview image decoding (search `grep -rn "sharp(" src/main/`) and re-author `f875f73`'s sequential-queueing logic there.

- [ ] **Step 7: Apply SCANS_DIR env fix**

Check whether `main` already has `src/main/graviscan-output-dir.ts` or equivalent:

```bash
git show main:src/main/graviscan-output-dir.ts 2>&1 | head -5
```

If missing, port the file from the branch and wire it in per `f80a32c`'s diff. If `main`'s config-store/output-dir logic already reads `SCANS_DIR` correctly, this step may be a no-op — verify rather than assume.

- [ ] **Step 8: Write/port tests for each fix**

Each source commit above should have an accompanying test on the branch (check `git show <sha> --stat` for test file changes) — port those alongside the source change, don't skip them.

- [ ] **Step 9: Run full test suite + lint + typecheck**

```bash
npm run test:unit
npx tsc --noEmit
npm run lint
```

- [ ] **Step 10: Verify USB-hub detection and continuous-folder behavior on the physical rig**

```bash
ssh -i ~/.ssh/id_ed25519 elizabeth@100.96.231.23
# run a real continuous-mode scan (2+ cycles) and confirm files land in
# one folder per session, not a new folder every cycle
```

- [ ] **Step 11: Commit, push, open PR**

Reference each source issue if one exists (check for #158, and search for issues matching the other four fixes before writing the PR body — don't assume none exist without checking).

---

## Increment 5: `add-ld-preload-to-subprocess`

**Why fifth:** Fully implemented and well-tested on the branch already (confirmed via 2026-07-24 audit: `buildSubprocessEnv()` is more robust than the proposal's own spec, real tests exist covering Linux/mock/macOS/Windows branches). Self-contained — no dependency on Increments 1-4 beyond landing after them for clean history.

**Files:**

- Modify: `src/main/graviscan/scanner-subprocess.ts` — port `buildSubprocessEnv()` (sets `LD_PRELOAD`/`SANE_USB_FILTER`/`LIBUSB_ENDPOINT_RECOVERY` only on `platform === 'linux' && !mock`)
- Create: `src/main/native/libusb-filter.c`
- Modify: `forge.config.ts` — add `./src/main/native/libusb-filter.so` to `extraResource`, Linux-only
- Create: `tests/unit/scanner-subprocess-env.test.ts` (port from branch)

**Interfaces:**

- Consumes: `ScannerSubprocess` class structure already on `main` (Increment 1's changes don't touch this file).
- Produces: `buildSubprocessEnv(platform, mock, saneName, libusbEndpointRecovery)` — a pure function, unit-testable without spawning anything. Increment 9 (`add-v600-wedge-followups`) references `LIBUSB_ENDPOINT_RECOVERY` — confirm its expectations match this increment's implementation before starting Increment 9.

### Tasks

- [ ] **Step 1: Get the exact source diff and files for reference**

```bash
git show origin/fix/v600-wedge-followups-metadata_propogation_followup:src/main/scanner-subprocess.ts > /tmp/scanner-subprocess-target.ts
git show origin/fix/v600-wedge-followups-metadata_propogation_followup:src/main/native/libusb-filter.c > /tmp/libusb-filter.c
git show origin/fix/v600-wedge-followups-metadata_propogation_followup:tests/unit/scanner-subprocess-env.test.ts > /tmp/scanner-subprocess-env.test.ts
git show origin/fix/v600-wedge-followups-metadata_propogation_followup:forge.config.ts > /tmp/forge.config-target.ts
```

- [ ] **Step 2: Bring the OpenSpec proposal over**

```bash
git checkout main && git pull origin main
git checkout -b feat/libusb-preload-subprocess
git checkout origin/fix/v600-wedge-followups-metadata_propogation_followup -- openspec/changes/add-ld-preload-to-subprocess/
```

Update the proposal's spec to document the `LIBUSB_ENDPOINT_RECOVERY` addition (not in the original spec — added later per issue #228, this is spec drift that should be reconciled, not silently ignored).

- [ ] **Step 3: Port `libusb-filter.c` as a new file**

```bash
mkdir -p src/main/native
cp /tmp/libusb-filter.c src/main/native/libusb-filter.c
```

- [ ] **Step 4: Re-author `buildSubprocessEnv()` into `main`'s `scanner-subprocess.ts`**

Compare `/tmp/scanner-subprocess-target.ts` against `main`'s current `src/main/graviscan/scanner-subprocess.ts` and add the function, adapting to whatever structure Increments 1-4 left in place. Preserve the `.so` path resolution logic (`app.isPackaged` → `process.resourcesPath` vs `src/main/native/`).

- [ ] **Step 5: Wire `forge.config.ts`**

Add the `extraResource` entry from `/tmp/forge.config-target.ts`, Linux-only, without disturbing existing entries for other platforms/modes.

- [ ] **Step 6: Port the test file**

```bash
cp /tmp/scanner-subprocess-env.test.ts tests/unit/scanner-subprocess-env.test.ts
```

Adjust import paths to match `main`'s `src/main/graviscan/` location.

- [ ] **Step 7: Run tests**

```bash
npm run test:unit -- scanner-subprocess-env
```

Expected: PASS across all branches (Linux+real, mock, macOS/Windows, `LIBUSB_ENDPOINT_RECOVERY` true/false/case-insensitive/invalid).

- [ ] **Step 8: Build the native shim and verify it links correctly on the rig**

```bash
ssh -i ~/.ssh/id_ed25519 elizabeth@100.96.231.23
# on the branch checkout there:
gcc -shared -fPIC -o src/main/native/libusb-filter.so src/main/native/libusb-filter.c -ldl -lusb-1.0
```

- [ ] **Step 9: Run a real parallel-scan test against multiple scanners on the rig**

Confirm `LD_PRELOAD`/`SANE_USB_FILTER` actually prevent cross-scanner USB interface contention — this is exactly the kind of hardware-specific behavior that must be verified for real, not mocked (per the user's stated mocking philosophy).

- [ ] **Step 10: Run full test suite + lint + typecheck**

```bash
npm run test:unit
npx tsc --noEmit
npm run lint
```

- [ ] **Step 11: Commit, push, open PR, and after merge archive**

```bash
git add src/main/native/ src/main/graviscan/scanner-subprocess.ts forge.config.ts tests/unit/scanner-subprocess-env.test.ts openspec/changes/add-ld-preload-to-subprocess/
git commit -m "feat: wire libusb-filter LD_PRELOAD shim into scanner subprocess spawn"
git push -u origin feat/libusb-preload-subprocess
```

After merge: `npx openspec archive add-ld-preload-to-subprocess --yes`, validate, commit, push.

---

## Increment 6: Bloom (Supabase) upload re-enable

**Why sixth:** No proposal exists — needs its own investigation before porting, not a blind port. Source commit `84b54e6` ("re-enable Bloom upload, parallel per-image + alongside Box").

**Files:**

- Modify: `src/main/graviscan-upload.ts` (branch path) → `main`'s equivalent (confirm exact path — check if `main` has this file at all first)

### Tasks

- [ ] **Step 1: Determine main's current Bloom-upload state before assuming anything**

```bash
git show main:src/main/graviscan/graviscan-upload.ts 2>&1 | head -5
# or wherever it actually lives on main - locate it first:
find_result=$(git ls-tree -r main --name-only | grep -i "graviscan-upload")
echo "$find_result"
```

If it doesn't exist on `main` at all, this increment is a full port, not a "re-enable." If it exists but Bloom upload is disabled/commented out, this is a smaller, more surgical fix. Do not proceed to Step 2 until this is actually confirmed.

- [ ] **Step 2: Get the exact source diff**

```bash
git show 84b54e6 -- src/main/graviscan-upload.ts src/main/graviscan-handlers.ts
```

- [ ] **Step 3: Branch off main**

```bash
git checkout main && git pull origin main
git checkout -b feat/bloom-upload-parallel
```

- [ ] **Step 4: Scaffold a lightweight OpenSpec proposal**

This is a real behavior change (upload pipeline), not a narrow bug fix — per the global constraints, it needs a proposal even though none exists upstream. Use `openspec/AGENTS.md`'s scaffold process; keep it small (this is a re-enable + parallelization, not a new capability).

- [ ] **Step 5: Port the upload-parallelization logic**

Apply per Step 2's diff, adapting to `main`'s actual current file (per Step 1's finding).

- [ ] **Step 6: Write/port tests**

Check `git show 84b54e6 --stat` for accompanying test changes; port them. If none exist on the branch, write unit tests covering: parallel per-image upload ordering, Box-and-Bloom-alongside behavior, and error handling when one upload target fails but the other should still proceed.

- [ ] **Step 7: Run full test suite + lint + typecheck**

```bash
npm run test:unit
npx tsc --noEmit
npm run lint
```

- [ ] **Step 8: Verify against a real (or realistic mock) Supabase + Box target**

Given this touches external service calls, confirm with the user what credentials/environment are available for a real verification pass before merging — do not assume production credentials are safe to exercise from this branch without checking.

- [ ] **Step 9: Commit, push, open PR, and after merge archive the scaffolded proposal**

---

## Increment 7: TIFF metadata embedding

**Why seventh:** Real scientific-traceability feature (embeds `exp_name`, `wave_number`, `start_timestamp`, `phenotyper_name` directly into TIFF `ImageDescription`) with zero proposal. Source commit `7c67fa4`.

**Files:**

- Modify: `python/graviscan/scan_worker.py` — embed metadata at save time
- Modify: `python/tests/test_scan_worker.py`, `python/tests/test_tiff_metadata.py`
- Modify (main-process side): `src/main/graviscan/scanner-subprocess.ts`, `scan-coordinator.ts` — pass the metadata fields down to the worker

**Interfaces:**

- Consumes: `compose_output_path()` from Increment 3 (metadata embedding happens alongside path composition, at save time).
- Produces: every saved TIFF's `ImageDescription` tag contains the 4 fields above — any downstream consumer (upload pipeline, Increment 6; future renderer, Phase 1b) can rely on this for provenance display without re-deriving it from the filename.

### Tasks

- [ ] **Step 1: Get the exact source diff**

```bash
git show 7c67fa4 > /tmp/tiff-metadata-embedding.diff
```

- [ ] **Step 2: Scaffold a lightweight OpenSpec proposal**

Real capability addition (metadata provenance in image files) — needs a proposal per global constraints. Reference the scientific-rigor rationale explicitly: "every parameter that affects a scan output must appear alongside the images" (matches this project's stated metadata-preservation value).

- [ ] **Step 3: Branch off main**

```bash
git checkout main && git pull origin main
git checkout -b feat/embed-tiff-metadata
```

- [ ] **Step 4: Port the Python-side embedding logic**

Apply per Step 1's diff to `python/graviscan/scan_worker.py`, adapting to whatever Increments 2-3 left in place (this commit lands after both on the branch, so expect compatible structure).

- [ ] **Step 5: Port the TS-side metadata plumbing**

Re-author into `main`'s modular `scanner-subprocess.ts`/`scan-coordinator.ts` — the branch's diff touches the flat-file equivalents; adapt paths through the current call chain (`GraviScan.tsx` → IPC → `scan-coordinator.ts` → `scanner-subprocess.ts` → Python worker, though the renderer half doesn't exist on `main` yet — for now, verify the metadata fields are at least plumbed as far as the coordinator/subprocess layer accepts them, ready for Phase 1b's renderer to supply real values).

- [ ] **Step 6: Port tests**

```bash
git show 7c67fa4 -- python/tests/test_scan_worker.py python/tests/test_tiff_metadata.py
```

Port the test changes; verify they check the actual `ImageDescription` tag content (round-trip: write a TIFF, read it back, assert the 4 fields are present and correct), not just that the function runs without error.

- [ ] **Step 7: Run tests**

```bash
uv run pytest python/tests/test_scan_worker.py python/tests/test_tiff_metadata.py -v
```

- [ ] **Step 8: Verify on the physical rig with a real scan**

```bash
ssh -i ~/.ssh/id_ed25519 elizabeth@100.96.231.23
# run a real scan, then inspect the saved TIFF's metadata directly:
python3 -c "from PIL import Image; img = Image.open('path/to/scan.tiff'); print(img.tag_v2[270])"
```

Confirm the 4 fields appear correctly in a real, hardware-produced file — not just a mock-mode output.

- [ ] **Step 9: Run full test suite + lint + typecheck**

- [ ] **Step 10: Commit, push, open PR, and after merge archive the scaffolded proposal**

---

## Increment 8: `add-reset-usb-button`

**Why eighth:** Handler logic is real and correct (confirmed 2026-07-24 audit), but needs re-authoring into `main`'s modular `scanner-handlers.ts`/`register-handlers.ts` (neither has any reset-related handler today). The audit also found the branch's own tests mirror the handler logic rather than testing the real exported handler — fix that while re-authoring rather than porting the same gap forward.

**Files:**

- Modify: `src/main/graviscan/scanner-handlers.ts` — add `graviscan:reset-usb` handler
- Modify: `src/main/graviscan/register-handlers.ts` — register the new IPC channel
- Modify: `src/types/graviscan.ts` — add `ResetUsbResult` interface
- Modify: `src/main/preload.ts`, `src/types/electron.d.ts` — expose `resetUsb`
- Create: `tests/unit/graviscan/reset-usb-handler.test.ts` (real handler-level test, not a logic-mirror — see Step 5)

**Interfaces:**

- Consumes: `getCoordinator()` accessor pattern already used by other handlers in `scanner-handlers.ts`; `detectEpsonScanners()` from `lsusb-detection.ts` (touched in Increment 4, Step 3 — confirm signature hasn't changed).
- Produces: `resetUsb(): Promise<ResetUsbResult>` where `ResetUsbResult = { success: boolean; scanners?: Array<{id: string; status: 'ready' | 'disconnected'}>; error?: string }` — this is the renderer-facing contract Phase 1b's `ConfigureScanner.tsx` equivalent will call.

### Tasks

- [ ] **Step 1: Get the exact source diff for reference**

```bash
git show origin/fix/v600-wedge-followups-metadata_propogation_followup:src/main/graviscan-handlers.ts | sed -n '600,790p'
```

(The handler is at lines 648-783 per the 2026-07-24 audit; adjust line numbers if the branch has moved since.)

- [ ] **Step 2: Bring the OpenSpec proposal over**

```bash
git checkout main && git pull origin main
git checkout -b feat/reset-usb-button
git checkout origin/fix/v600-wedge-followups-metadata_propogation_followup -- openspec/changes/add-reset-usb-button/
```

- [ ] **Step 3: Check for overlap with Increment 4's stale-scanner cleanup**

If Increment 4 already handled stale-row cleanup fully, this handler's `usb_bus`/`usb_device` clearing logic may partially overlap — read both before writing new code, don't duplicate.

- [ ] **Step 4: Re-author the `graviscan:reset-usb` handler into `scanner-handlers.ts`**

Port the logic: `coordinator.shutdown()` → clear `usb_bus`/`usb_device` (preserve `usb_port`) via `db.graviScanner.updateMany(...)` → wait `USB_RELEASE_WAIT_MS = 5000` → `detectEpsonScanners()` → match by `usb_port` → `coordinator.initialize(scannerConfigs)` if any matched → return `{success, scanners}`. Register the handler in `register-handlers.ts` following that file's existing pattern for other handlers.

- [ ] **Step 5: Write a real handler-level test, not a logic-mirror**

The branch's `tests/unit/reset-usb.test.ts` reimplements the handler logic with injected mocks rather than importing and testing the real exported handler. Write `tests/unit/graviscan/reset-usb-handler.test.ts` following the conventions in `tests/unit/graviscan/scanner-handlers.test.ts` (import and invoke the real registered handler, mock only the coordinator/DB/lsusb-detection dependencies it calls). Cover the same 4 cases as the branch's tests: full success, unplugged scanner → `disconnected` status, coordinator is null, lsusb returns 0 scanners.

- [ ] **Step 6: Wire the UI-facing plumbing**

Add `ResetUsbResult` to `src/types/graviscan.ts`, expose `resetUsb` in `preload.ts` and `electron.d.ts`. (The actual button UI doesn't exist on `main` yet — Phase 1b's renderer work will consume this; for now this increment stops at the IPC-exposed contract.)

- [ ] **Step 7: Run tests**

```bash
npm run test:unit -- reset-usb
```

- [ ] **Step 8: Verify on the physical rig**

Simulate a scanner disconnect/reconnect (physically unplug/replug the V600 mid-session) and confirm the reset flow recovers it — this is exactly the scenario issue #182 describes.

- [ ] **Step 9: Run full test suite + lint + typecheck**

- [ ] **Step 10: Commit, push, open PR, and after merge archive**

Reference issues #182, #161, #230, #203 in the PR body.

---

## Increment 9: `add-v600-wedge-followups`

**Why last:** Biggest of the 9 — real rebase pass required (branch uses flat `graviscan-handlers.ts`/`scan-coordinator.ts`; `main` has the modular package), plus one real code smell to fix (`initialize()` has a duplicate, un-refactored code path — task 7.3 on the branch), plus rig-only manual validation (Task 12) that can't be automated and should happen last, once everything below it has already landed and been verified.

**Files:**

- Create: `src/main/wedge-detector.ts`, `src/main/slack-notifier.ts`
- Modify: `src/main/graviscan/scan-coordinator.ts` — wire `WedgeDetector`/`SlackNotifier` into the event flow; refactor `initialize()` to use `addScanner()` internally (closing task 7.3's gap)
- Modify: `src/main/config-store.ts` — persist `slack_webhook_url`, `libusb_endpoint_recovery`
- Modify: `src/main/graviscan/scanner-handlers.ts`, `scanner-upsert.ts` — stale-row disable, per-row remove UI's IPC handler, grid_mode persistence fix
- Create: `tests/unit/wedge-detector.test.ts`, `tests/unit/slack-notifier.test.ts`, `tests/unit/wedge-pipeline-integration.test.ts` (port from branch — all three are substantive, not placeholders, per the 2026-07-24 audit)

**Interfaces:**

- Consumes: `LIBUSB_ENDPOINT_RECOVERY` env var contract from Increment 5 — confirm `buildSubprocessEnv()`'s exact behavior matches what `WedgeDetector`/`config-store.ts` expect before starting.
- Produces: `WedgeDetector.processScanError(input: ScanErrorInput): WedgeDetectedEvent | null` and `SlackNotifier.notify(event: WedgeDetectedEvent): Promise<void>` — pure/deterministic detector, no I/O; notifier does the actual network call. Nothing later in this plan depends on these interfaces, but Phase 1b's renderer will (in-UI wedge banner, per issue #240, itself deferred).

### Tasks

- [ ] **Step 1: Confirm Increment 5's `LIBUSB_ENDPOINT_RECOVERY` contract matches this increment's expectations**

```bash
git show origin/fix/v600-wedge-followups-metadata_propogation_followup:src/main/config-store.ts | grep -n "libusb_endpoint_recovery" -A 5
```

Compare against what Increment 5 actually implemented on `main`. Reconcile any mismatch before proceeding — don't silently diverge.

- [ ] **Step 2: Bring the OpenSpec proposal over**

```bash
git checkout main && git pull origin main
git checkout -b feat/wedge-detector-slack-notifier
git checkout origin/fix/v600-wedge-followups-metadata_propogation_followup -- openspec/changes/add-v600-wedge-followups/
```

- [ ] **Step 3: Port `WedgeDetector` and its tests as standalone files first**

`wedge-detector.ts` is pure logic (no I/O, no DB, no network per its own doc comment) — port it and `tests/unit/wedge-detector.test.ts` verbatim; this file doesn't need re-authoring for the modular structure since it's new, not a modification of something that moved.

```bash
git show origin/fix/v600-wedge-followups-metadata_propogation_followup:src/main/wedge-detector.ts > src/main/wedge-detector.ts
git show origin/fix/v600-wedge-followups-metadata_propogation_followup:tests/unit/wedge-detector.test.ts > tests/unit/wedge-detector.test.ts
npm run test:unit -- wedge-detector
```

- [ ] **Step 4: Port `SlackNotifier` and its tests the same way**

```bash
git show origin/fix/v600-wedge-followups-metadata_propogation_followup:src/main/slack-notifier.ts > src/main/slack-notifier.ts
git show origin/fix/v600-wedge-followups-metadata_propogation_followup:tests/unit/slack-notifier.test.ts > tests/unit/slack-notifier.test.ts
npm run test:unit -- slack-notifier
```

- [ ] **Step 5: Re-author the coordinator wiring into `main`'s modular `scan-coordinator.ts`**

This is the real rebase work — the branch wires `WedgeDetector`/`SlackNotifier` into a flat `scan-coordinator.ts`; `main`'s version is already split into a package. Read `main`'s current `src/main/graviscan/scan-coordinator.ts` fully first, then adapt the branch's event-wiring diff (`2edf981`) to fit the current module boundaries rather than copying the flat-file version's structure.

- [ ] **Step 6: Refactor `initialize()` to use `addScanner()` internally (closes task 7.3)**

The branch itself never finished this — `initialize()` and `addScanner()` remain two separate code paths that should share logic. Since this plan is already re-authoring the coordinator wiring in Step 5, do this refactor now rather than porting the duplication forward.

- [ ] **Step 7: Port `config-store.ts` persistence changes**

```bash
git show ede7344 -- src/main/config-store.ts
```

Apply `slack_webhook_url`/`libusb_endpoint_recovery` persistence via `saveEnvConfig`, reconciled with Increment 5 per Step 1.

- [ ] **Step 8: Port remaining scanner-handlers/scanner-upsert changes**

Cover: grid_mode persistence fix (task 2), stale-row disable (task 3), per-row Remove scanner UI's IPC handler + spawn-on-discovery wiring (tasks 7/9), orphan-worker cleanup (Copilot #20). Check each against Increment 4 and Increment 8 for overlap first — do not duplicate stale-row logic across three increments.

- [ ] **Step 9: Port the integration test**

```bash
git show origin/fix/v600-wedge-followups-metadata_propogation_followup:tests/unit/wedge-pipeline-integration.test.ts > tests/unit/wedge-pipeline-integration.test.ts
```

- [ ] **Step 10: Run full test suite + lint + typecheck**

```bash
npm run test:unit
npx tsc --noEmit
npm run lint
```

- [ ] **Step 11: Rig-only manual validation (Task 12 from the original proposal — cannot be automated)**

On `pbiob-gh-04` (or, if the user wants this validated against the real production rig `graviscan-ms-7c56` before deploying there, coordinate that separately — this plan's SSH access is to the test box only):

- Confirm `[libusb-filter] endpoint recovery: on` appears in scan-worker stderr during a real scan
- Run a real continuous-session scan (multiple cycles) and confirm no false wedge alerts
- Toggle `LIBUSB_ENDPOINT_RECOVERY=false` and confirm the wrapper actually disables
- If a real wedge occurs during validation, capture the evidence (Slack message, logs) per the original Tier 2 checklist pattern in `docs/RIG_VALIDATION_PR237.md` (stranded on the branch, not yet on `main` — consider porting that doc too, or writing a `main`-appropriate equivalent, as part of this step)

- [ ] **Step 12: Commit, push, open PR, and after merge archive**

Reference issues #228, #236, #230, #234 (addressed) — note #240, #238, #239 remain deliberately deferred future work, not gaps in this increment.

---

## Cross-cutting: rig access reference

For any future session continuing this plan:

- Test rig: `pbiob-gh-04`, Tailscale IP `100.96.231.23`, SSH: `ssh -i ~/.ssh/id_ed25519 elizabeth@100.96.231.23` (or `elizabeth@pbiob-gh-04` via MagicDNS). Passwordless key auth + passwordless sudo.
- Physical scanner connected there: Epson Perfection V600 Photo (GT-X820), USB ID `04b8:013a`.
- SANE/iscan driver setup on that box: see `docs/GRAVISCAN_SCANNER_DRIVER_SETUP.md` (already merged to `main` as of 2026-07-24) if the driver ever needs reinstalling.
- Real production rig `graviscan-ms-7c56` (`graviscan@graviscan-ms-7c56.tail461d0e.ts.net`) is a **separate machine**, not accessible in this plan's context — it currently has `iscan` installed via the old `--ignore-depends` workaround (issue #226) and should not be assumed reachable or in a known-good state without separately confirming.
