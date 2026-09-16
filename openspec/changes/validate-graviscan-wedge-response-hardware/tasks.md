> **Status: executed 2026-09-15/16 on `pbiob-gh-04` against PR #365's branch at `daa1cba`.**
> Four items pass, one fails with a confirmed defect, one is blocked on scanner
> count, one was not reached, and the Slack half of 2.2 was descoped. #279 stays
> **open**. An earlier revision of this file recorded most items as "NOT
> EXECUTABLE"; adversarial review showed that was wrong (see §2.0) and it has
> been corrected.

## 1. Pre-flight

- [x] 1.1 PR #365 confirmed open at `daa1cba`, 22/22 CI green, containing the atomic-write fix. Merge to `main` not required — the PR branch was checked out on the rig per design.md's "Depend on the fix's code being present" decision. `origin/main` was still `028435c` with the branch 0 commits behind, so the validated tree is exactly what will land.
- [x] 1.2 SSH to `pbiob-gh-04` confirmed (`ssh elizabeth@100.96.231.23`, passwordless). The task's note that this credential was "not yet confirmed in project memory" was **stale** — it was already documented. Rig confirmed idle; branch checked out; tree clean.
- [x] 1.3 Disk 1.8T free; real V600 detected. Baseline real scan verified before any destructive step: 18s, 3.7MB TIFF at the correct `_et_`-stamped path.

### 1.x Pre-flight blockers (each cost real time; all now tracked)

- [x] 1.4 **`npm run build:python` silently ships a scanner-incapable binary.** `scripts/build-python.js:28` runs `uv sync --extra dev`; `uv sync` treats an omitted extra as _remove it_, so it **uninstalls** `python-sane`. `python/main.spec:57` then marks the missing `sane` hidden import as "does not fail build", so the build succeeds and every real scan fails with `Failed to initialize: No module named 'sane'`. `scanner-subprocess.ts:208` spawns that bundle _regardless of `isPackaged`_, so `npm run dev` hits it too. Corrections posted to **#361**. Working sequence: `uv sync --extra graviscan-linux --extra dev`, then `uv run pyinstaller python/main.spec --clean --noconfirm`, then `npm start` (never `npm run dev`).
- [x] 1.5 **A stale `dist/bloom-hardware` (Aug 31) would have invalidated the whole run** by testing the pre-PR worker. Caught before executing anything; rebuilt and verified the bundle performs the atomic write before trusting it.
- [x] 1.6 **Machine Configuration could not be saved at all.** `scanner_name` is required unconditionally but only settable from a Bloom-API dropdown that renders `disabled` without credentials, so `scanner_mode` could never leave `''` and `App.tsx:50-59` kept the app locked on the config screen. Filed as **#367**, cross-referenced on #347. Worked around by hand-writing `~/.bloom/.env`.
- [x] 1.7 **The rig's Electron GPU process crash-loops** (NVIDIA RTX A5000 + proprietary driver + Wayland; kernel shows Electron segfaulting in `libc.so.6`). Froze the UI three times. Confirmed **not** an app defect: the same commit runs cleanly on Windows, and the production rig is AMD/`amdgpu` with 0 Electron segfaults in its kernel log. Resolved by running under **Xvfb** — the project's own CI recipe — which also enables in-process Playwright screenshots that don't depend on the broken compositor.
- [x] 1.8 **Two app instances compete for one USB scanner.** Once a scanner is registered in the DB, the Forge-launched instance spawns a worker for it at startup and holds the device, so a second (Playwright) instance fails `startScan` with "No scanners came online". Fix: run Forge with `GRAVISCAN_MOCK=true` (it only needs to serve the renderer) and let the Playwright instance own the real device.

## 2. Bench tests (pbiob-gh-04 only — never graviscan-ms-7c56)

### 2.0 Correction: the first recorded conclusion was wrong

An earlier revision recorded 6 of 8 items as "NOT EXECUTABLE", reasoning that #228 makes the wedge a parallel multi-scanner contention failure that one V600 cannot reproduce. Three independent reviewers rejected this, correctly:

- PR #365's own comment records that a SIGKILL mid-USB-capture **wedged this same single V600** on 2026-09-10, recoverable only by physical power-cycle. The claim of impossibility was contradicted by this project's own record.
- #228 establishes contention as one _way to produce_ a bulk-IN error; the wedge _mechanism_ is epkowa failing to call `libusb_clear_halt()`. Contention is not required.
- #279 item 2.6 is explicitly a one-scanner scenario ("2 events across 1 scanner").
- Both failed induction attempts ran with `LIBUSB_ENDPOINT_RECOVERY=true` — i.e. with **#228's own anti-wedge shim enabled**, which `libusb-filter.c` documents as clearing exactly the stall being induced. The attempts were confounded by configuration.

The real blocker was the induction _vector_: SIGKILLing the worker is structurally incapable of exercising the wedge path, because `scan-coordinator.ts`'s `exit` handler deletes the scanner from `this.subprocesses` before any `scan-error` can be raised. Switching to a **physical power cut** produced a wedge immediately.

### Results

- [x] 2.1 **PASS.** Cutting scanner power mid-session produced `[WedgeDetector] wedge-detected signature=consecutive_failures cycle=1` followed by `auto-paused`, and the banner appeared: _"… wedged (signature: consecutive_failures) — this scanner has been automatically paused. / Scan failed after 5 attempts: Failed to reopen device after 3 attempts: Access to resource has been denied"_. Screenshot captured. Note the signature is `consecutive_failures`, not `sane_start_invalid` — a documented signature, but a different one from the item's wording.
- [x] 2.2 **PARTIAL — banner half PASS, Slack half NOT EXECUTED.** The banner fired from the wedge event (2.1). The Slack path was deliberately not configured: the rig has no webhook and firing deliberate-failure alerts into the lab's real channel was declined. The app states this at startup: `[GraviScan] BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL not set — Slack notifications disabled`. The item's actual assertion — _no divergence between the two notification paths_ — is therefore **unverified**, and cannot be verified on a rig with no webhook at all.
- [ ] 2.3 **BLOCKED — requires ≥2 scanners.** The only item genuinely blocked by scanner count. One V600 is available and no more can be obtained. Unblocks with a second scanner; nothing else. **Split out of #279 into its own issue #369 (2026-09-16)** so #279 can close on its remaining items rather than being held open indefinitely by hardware availability; #369 carries the induction recipe and the substantive risk (a paused scanner's plates holding each row open to the 90s timeout and dragging healthy scanners' cadence).
- [ ] 2.4 **FAIL — confirmed defect.** `retryScanner()` (`session-handlers.ts:376`) rebuilds the SANE name via `buildSaneName(row.usb_bus, row.usb_device)` from the DB row. Those columns are refreshed only by `resetUsb()` and `saveScannersToDB()` — neither is on the retry path (`WedgeBanner.tsx:37` calls `retryScanner` directly). Every physical power-cycle re-enumerates the device at a new number, so retry always builds a stale name. **Reproduced:** DB synced to `usb_device: 7` before the power-cycle; device returned at `008`; a session started successfully using the live name `epkowa:interpreter:001:008`; `retryScanner` then failed on that same healthy device with `Failed to initialize: Failed to open device after 3 attempts`, and `getScannerStatus` reported `status: "error"`. Logged as `[WedgeResponse] retry failed`. **This is existing issue #182**, open since 2026-05-06 with the identical mechanism; today's run converts it from suspicion to reproduced defect. Scope caveat: proven via the IPC path, not by clicking the button — but the button calls exactly this path. **The documented operator recovery path for a Tier 2-gating safety feature does not work.**
- [x] 2.5 **PASS.** With power still off, the spec clicked "Power-Cycled & Retry" → "Confirm Retry". The retry was genuinely attempted (`[WedgeResponse] retry failed scanner=… error=…` at 17:16:20) and did not recover the scanner; the banner persisted. The confirmation gate behaved as intended, including its warning copy: _"Only click Confirm Retry after you have physically power-cycled this scanner. Retrying before the power-cycle is done will very likely wedge again immediately."_
- [x] 2.6 **PASS.** UI rendered _"1 auto-pause event across 1 scanner this session"_ — event count and distinct-scanner count correctly kept separate, which is the confusion the item guards against. Caveat: with a single event the plural formatting ("2 events across 1 scanner") was not exercised.
- [ ] 2.7 **NOT EXECUTED.** The run terminated at 2.4 before reaching session-cancel, due to a spec-side selector bug (after 2.5 the banner sits in its _confirming_ state, which renders "Cancel"/"Confirm Retry" rather than "Power-Cycled & Retry"). Requires one more wedge to execute; deliberately skipped as low-information relative to another power-cycle.
- [x] 2.8 **PASS.** `~/.bloom/logs/graviscan-2026-09-16.log` was reviewed after a real wedge and a real retry — the precondition the item actually asks for. The lines are genuinely sufficient to reconstruct the incident: retry backoff progression, `wedge-detected` with signature and cycle, `auto-paused` with session and cycle, per-plate verification-skipped diagnostics, and `[WedgeResponse] retry failed` with the error. One gap: `session=null` appears in the `[WedgeResponse]` lines.

### 2.9 Real-hardware observations of PR #365 (side outcome, recorded on the PR itself)

Observed while inducing the wedge. Recorded here only as a pointer — the durable record is a comment on PR #365 and §11 of `fix-graviscan-scan-write-atomicity/tasks.md`, since that is where someone asking "was #365 validated on hardware?" will look.

- [x] 2.9a The `stopped` outcome added in review round 2 fired on a real wedge auto-pause: `Cycle N: row verification skipped for plate 00 (wave 1): no completion signal received (scanner stopped mid-row)`. Round 1 found this path structurally unreachable; round 2 fixed it; real hardware confirms the fix. Without it those plates would have produced nothing for 90s.
- [x] 2.9b The atomic-write path ran on real hardware, producing a correctly-named `.tmp-` file and no truncated file at any final `_et_` path. Honest limit: it was not established that a kill landed _inside_ `image.save()`, and no post-kill temp residue was recorded, so this is _consistent with_ #281 item 1's guarantee rather than a demonstration of it.
- [x] 2.9c The round-2 honest denominator did real work: with the scanner absent from the coordinator's map, 15 consecutive cycles logged `grid 00 complete — 0/1 files verified — 1 MISSING`. The round-1 results-derived denominator would have printed `0/0 files verified` with no MISSING marker. Precise framing: the regression was caught in **review round 2**, before this run; hardware exercised the fix rather than catching the bug.
- [x] 2.9d #363's renderer-invisibility argument is field-confirmed — the tally is log-only and no UI signal appeared. But #363's stronger claim that a paused scanner produces _"no log line at all"_ is **refuted**: the shortfall line fired every cycle, because `expectedByGrid` derives from `platesPerScanner` (`scan-coordinator.ts:919-936`), not the live subprocess map. #363 and the roadmap were both corrected on that half on 2026-09-16; the elevation still stands on the renderer half, and #363 remains a Tier 2 hard-block.
- [x] 2.9e **New gap found:** an unexpected worker death is recorded with `console.log`, not `scanLog()` (`scan-coordinator.ts` `exit` handler), so it never reaches `~/.bloom/logs/graviscan-*.log`, and there is no error event and no respawn. A worker that dies mid-session is strictly _less_ observable than one that fails to start (`reclaimUnresponsive()` does `scanLog` + `initErrors.set` + `scanner-init-status`). Distinct from #363/#281/#358/#327.

## 3. Record results

- [x] 3.1 Per-item results posted on #279, naming the commit tested (`daa1cba`) and stating that the run was against PR #365's branch, not merged `main`.
- [x] 3.2 Findings recorded in the GraviScan rig-test vault as `C:\vaults\graviscan\2026-09-16-issue-279-wedge-response-bench-validation-findings.md`, following the vault's existing note convention (YAML frontmatter, TL;DR, setup table, per-item results, relative links to sibling notes). It carries the full methodology the GitHub comments summarize: the five pre-flight blockers, the misleading instruments, the corrected wrong conclusion, and what would close each outstanding #279 item.
- [ ] 3.3 **#279 stays OPEN.** 2.3 is blocked on scanner count, 2.4 fails, 2.7 was not reached, and 2.2's correlation assertion is unverified. This supersedes the original instruction to close it. #279 remains a Tier 2 hard-block.
- [x] 3.4 #364's body corrected — it claimed every other #279 item had been validated on `pbiob-gh-04`, which was written predictively and is false.
- [x] 3.5 2.9e filed as its own issue, cross-referencing #363.
- [x] 3.6 2.4's reproduction commented onto **#182**, and #182 promoted into the cutover roadmap's Tier 1 list and Tier 2 hard-block list — it breaks the only documented recovery path for a feature that already gates cutover, and it appeared in neither list.

## 4. Validation

- [x] 4.1 `openspec validate validate-graviscan-wedge-response-hardware --strict` passes.
