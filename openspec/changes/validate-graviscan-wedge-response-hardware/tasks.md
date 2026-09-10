## 1. Pre-flight

- [ ] 1.1 Confirm PR #365 (`fix-graviscan-scan-write-atomicity`) is open and contains the atomic-write fix — merge to `main` is NOT required to proceed (see design.md's "Depend on the fix's code being present on `pbiob-gh-04`" decision); the PR branch checked out on the rig is sufficient.
- [ ] 1.2 SSH to `pbiob-gh-04` (`ssh elizabeth@100.96.231.23` per this Tier 1 increment's handoff notes — this credential is not yet confirmed in project memory, unlike `graviscan-ms-7c56`'s; verify it works before relying on it, and record it in memory once confirmed). Fetch and check out PR #365's branch (`eberrigan/fix-graviscan-scan-write-atomicity`) rather than `main`, confirm the rig is idle (re-verify — it's a shared dev machine, do not assume prior idle status still holds).
- [ ] 1.3 Confirm disk space and that the real V600 is attached and detected.

## 2. Bench tests (on pbiob-gh-04 only — never graviscan-ms-7c56)

- [ ] 2.1 Deliberately induce a `sane_start_invalid` wedge (per #228's known root-cause conditions) during an active interval session — confirm the scanner stops within a few seconds and the banner appears.
- [ ] 2.2 Confirm the Slack alert and the in-app banner both fire from the same wedge event (no divergence).
- [ ] 2.3 Confirm other scanners in the same session keep running unaffected.
- [ ] 2.4 Dismiss the banner, physically power-cycle the wedged scanner, click "Power-Cycled & Retry" — confirm it rejoins the next cycle and resumes producing images.
- [ ] 2.5 Click "Power-Cycled & Retry" WITHOUT power-cycling first — confirm it re-wedges promptly (confirmation-gate working as intended).
- [ ] 2.6 Trigger two wedges on the same scanner across a session — confirm the counter shows event count and distinct-scanner count correctly (e.g. "2 events across 1 scanner", not "2 scanners").
- [ ] 2.7 Let a session complete/cancel while a wedge banner is showing — confirm the banner and counter clear.
- [ ] 2.8 Review the resulting `~/.bloom/logs/graviscan-*.log` after a session with a wedge+retry — confirm the log lines are actually useful for reconstructing what happened. If a checklist item fails, record it as a failure with details rather than treating it as blocking task 3.3 — this requirement covers evidence recording, not a specific outcome (see spec delta).

## 3. Record results

- [ ] 3.1 Post pass/fail results per checklist item (2.1-2.8), with enough detail to reproduce, as a comment on #279 — note explicitly that this validation ran against PR #365's branch (name the commit SHA tested), not yet-merged `main`.
- [ ] 3.2 Record the same empirical findings in the GraviScan rig-test vault (`C:\vaults\graviscan\`).
- [ ] 3.3 Close #279 once validation passes AND PR #365 has merged (if PR #365 changes materially after this validation runs, re-verify the changed behavior before closing rather than assuming the earlier run still applies). The closing comment must explicitly note: (a) the production-rig multi-hour item was split out and is tracked separately as issue #364 (already filed, not a new task here), and (b) closing #279 does NOT by itself clear the Tier 2 cutover gate — #364 remains open and hard-blocking.
- [ ] 3.4 Cross-reference #364 back: add a comment on #364 linking to the closed #279 and this change, so anyone landing on #364 directly has the full context without needing to trace back through #279 first.

## 4. Validation

- [ ] 4.1 Run `openspec validate validate-graviscan-wedge-response-hardware --strict` and resolve any issues.
