## Why

The renderer-visual-verification guardrails landed in PR #196 mandate that any change touching `src/renderer/` must capture and review screenshots via `npm run test:e2e:smoke`. The smoke spec already runs in CI as part of `test:e2e` (Playwright auto-discovers it). However, the captured PNGs are written to `tests/e2e/screenshots/` on the CI runner and discarded when the job ends — there is **no way for a human reviewer to look at the screenshots from the PR's GitHub UI without rerunning the spec locally**.

That's a procedural gap. The guardrail in `pre-merge.md` says "read each affected screenshot via the Read tool" but the only way to get those PNGs onto a reviewer's machine today is to: clone the branch, install deps, start the dev server, run the spec, eyeball the output. That friction means most reviewers won't bother — and if they don't, the visual-review guardrail is a paper rule.

CI already uploads Playwright failure artifacts (traces, videos) per the existing `Scenario: CI job uploads failure artifacts`. We need the equivalent for the smoke spec's success-path PNGs: **always upload `tests/e2e/screenshots/` as a CI artifact so reviewers can download them from the PR check page.**

## What Changes

### CI workflow

- Add an `actions/upload-artifact@v4` step to the E2E job in `.github/workflows/pr-checks.yml`:
  - Path: `tests/e2e/screenshots/*.png`
  - Name: `renderer-screenshots-<os>` (so multi-platform CI matrix doesn't conflict)
  - Run condition: `if: always()` — upload even when E2E fails, so reviewers see what was captured before the failure
  - Retention: 90 days (GitHub default; aligns with PR review windows)

### Spec deltas (`e2e-testing` capability)

- **MODIFIED** `Requirement: CI Integration for E2E Tests` — add a new scenario `CI job uploads renderer smoke screenshots` and update the existing `CI job uploads failure artifacts` retention from "7-day" to align with the actual workflow
- **ADDED** `Requirement: Renderer Smoke Spec` — formalizes that `tests/e2e/smoke-renderer.e2e.ts` exists, captures every renderer route per scanner mode, and produces screenshots reviewable both locally and as CI artifacts
- **MODIFIED** `Requirement: npm Scripts for E2E Testing` — add a scenario for `npm run test:e2e:smoke`

### Documentation updates (so reviewers know the artifact exists)

- `openspec/AGENTS.md` "Renderer-touching proposal rules" section: note that screenshots are uploaded by CI to PR check artifacts, alongside the local `tests/e2e/screenshots/` path
- `.claude/skills/electron-playwright-workflow/SKILL.md` "Visual verification of renderer changes" section: add CI artifact path as an alternative to local capture
- `.claude/commands/review-pr.md` Step 2.5 prerequisite: reviewers can fetch screenshots from CI artifacts instead of running the smoke spec locally
- `.claude/commands/pre-merge.md` checkbox: same — CI artifact is an acceptable evidence path
- `tests/e2e/smoke-renderer.e2e.ts` header comment: note the CI artifact upload
- `docs/E2E_TESTING.md`: new "Renderer smoke spec + CI artifacts" subsection

## Impact

- Affected specs: `e2e-testing` (1 MODIFIED + 1 ADDED + 1 MODIFIED requirement)
- Affected code:
  - MODIFIED: `.github/workflows/pr-checks.yml` (add `actions/upload-artifact@v4` step)
  - MODIFIED: `openspec/AGENTS.md` (renderer-touching rules — CI artifact reference)
  - MODIFIED: `.claude/skills/electron-playwright-workflow/SKILL.md` (visual-verification — CI artifact path)
  - MODIFIED: `.claude/commands/review-pr.md` (Step 2.5 — CI artifact alternative)
  - MODIFIED: `.claude/commands/pre-merge.md` (checkbox — CI artifact alternative)
  - MODIFIED: `tests/e2e/smoke-renderer.e2e.ts` (header comment)
  - MODIFIED: `docs/E2E_TESTING.md` (new subsection)
- No code in `src/` is touched. No new dependencies. No npm script changes.

## Non-Goals

- **Pixel-diff regression suite.** The artifact is for human eyeball review only. Adding `toHaveScreenshot()` baseline assertions and managing baselines across platforms is a separate proposal.
- **Pre-push git hook.** Local enforcement of "you must run the smoke spec before push" was considered and rejected — CI is the gate; local is convenience.
- **Slack/email notification when screenshots change.** Out of scope; reviewers pull artifacts manually from the PR check page.
- **Retention longer than GitHub's 90-day default.** PRs that take >90 days to review have bigger problems than missing screenshots.
- **Updating CI to also run on `push` to non-PR branches.** Smoke spec only runs on PR via the existing `test:e2e` job; that's sufficient.
