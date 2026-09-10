## Why

Issue #279: PR #277's wedge auto-pause/retry feature is covered by 91 unit tests, but a real wedge scenario cannot be exercised via mock hardware or CI's E2E suite — CI's mock path has no fault-injection mechanism, so nothing in CI ever actually triggers a real `sane_start_invalid` wedge, a real physical power-cycle + retry, or real Slack+in-app-banner correlation. This is a data-loss-prevention safety feature and should be validated against real hardware before it is relied upon for an unattended multi-day production run.

Per this Tier 1 increment's ordering, this validation should happen only **after** `fix-graviscan-scan-write-atomicity` has landed — running it against unfixed code risks actually triggering that change's SIGKILL-corruption bug on a real plate during the validation run itself, and would validate a safety feature that isn't fully safe yet.

## What Changes

- Execute the full bench-test checklist from issue #279 against real hardware on `pbiob-gh-04` (the dev/test rig with a real Epson V600 attached) — `graviscan-ms-7c56` (the production rig) is never touched for this work.
- Record results as a comment on issue #279 and in the GraviScan rig-test vault (this project's established convention for empirical hardware findings), with enough detail per checklist item to reproduce.
- The one checklist item that explicitly calls for the **production** rig (a multi-hour continuous-interval session confirming no false-positive auto-pauses under normal operation) is deliberately **deferred out of this increment** to issue #364, a new Tier 2 pre-cutover gate on `graviscan-ms-7c56` — not silently substituted with a dev-rig run, and not silently dropped. The production-cutover roadmap doc's Tier 2 hard-block list has been updated to name #364 directly, so closing #279 does not by itself clear that gate.
- No application code changes in this change. It depends on `fix-graviscan-scan-write-atomicity` having merged first.

## Impact

- Affected specs: `hardware-validation-evidence` (new capability: recording of manual, human-executed hardware-validation evidence for safety-critical features before unattended production reliance — distinct from `hardware-testing-documentation`, which covers documentation-completeness for already-shipped features, not point-in-time test-run evidence)
- Affected code: none — this change is validation-only
- Affected docs: `docs/superpowers/plans/2026-09-02-graviscan-production-cutover-roadmap.md` (Tier 2 hard-block list now names #364 alongside #279/#226/#361)
- Depends on: `fix-graviscan-scan-write-atomicity` (must merge first)
- Closes #279's bench-test items; the production-rig multi-hour item is tracked as issue #364, a Tier 2 pre-cutover gate
