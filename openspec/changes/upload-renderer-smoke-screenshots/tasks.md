## 1. Verify ground truth

- [ ] 1.1 Identify the exact E2E job name(s) in `.github/workflows/pr-checks.yml` so the new upload step is added to the right job(s).

  ```bash
  grep -nE "^\s*(name|runs-on):" .github/workflows/pr-checks.yml | head -30
  grep -nE "test:e2e|playwright|xvfb" .github/workflows/pr-checks.yml
  ```

  Record the job name (likely `test-e2e` or `e2e`) and any matrix expansion. The upload step is added once per job.

- [ ] 1.2 Confirm `actions/upload-artifact@v4` is the current major version (avoid `@v3` deprecation).

  ```bash
  grep -rE "actions/upload-artifact" .github/workflows/ | head
  ```

  If the repo already uses a specific pinned version, match it for consistency.

- [ ] 1.3 Confirm the smoke spec writes to `tests/e2e/screenshots/` (sanity check — file structure may have changed).
  ```bash
  grep -nE "SCREENSHOTS_DIR|screenshots" tests/e2e/smoke-renderer.e2e.ts | head
  ```

## 2. Implementation

- [ ] 2.1 Add `actions/upload-artifact@v4` step to `.github/workflows/pr-checks.yml` after the E2E test step. The step MUST:
  - Have `if: always()` so it runs even if the spec fails
  - Set `name: renderer-screenshots-${{ matrix.os }}` (or the equivalent platform variable used by the existing matrix)
  - Set `path: tests/e2e/screenshots/*.png`
  - Set `if-no-files-found: warn` (so a missing screenshots dir produces a warning, not a CI failure)
  - Use the default retention (90 days) — do NOT override unless the workflow uses a different retention pattern elsewhere.

- [ ] 2.2 Update `tests/e2e/smoke-renderer.e2e.ts` header comment: append a paragraph stating "CI uploads `tests/e2e/screenshots/` as a `renderer-screenshots-<os>` artifact downloadable from the PR check page (per `Requirement: CI Integration for E2E Tests`). Reviewers can use that artifact instead of running the spec locally."

- [ ] 2.3 Update `.claude/skills/electron-playwright-workflow/SKILL.md` "Visual verification of renderer changes" section, "How to verify" subsection. Add a new step after the existing step 2 (`Run the smoke spec: npm run test:e2e:smoke`):

  > 2a. **Alternative for PR review**: download the `renderer-screenshots-<os>` artifact from the PR's CI check page. The artifact contains the same PNGs that `npm run test:e2e:smoke` produces locally. Use whichever is faster.

- [ ] 2.4 Update `.claude/commands/review-pr.md` Step 2.5 prerequisite. The bullet that currently reads "Each renderer-page change has its corresponding screenshot read via the Read tool" SHALL be augmented with: "Screenshots are available locally (after running `npm run test:e2e:smoke`) OR from the PR's CI artifact `renderer-screenshots-<os>`. Either path is acceptable; reviewers SHOULD prefer the CI artifact when CI has run, since it matches the code under review."

- [ ] 2.5 Update `.claude/commands/pre-merge.md` "Renderer screenshots captured + reviewed" checkbox. Add a parenthetical: "(local PNGs OR the CI `renderer-screenshots-<os>` artifact are both acceptable)".

- [ ] 2.6 Update `openspec/AGENTS.md` "Renderer-touching proposal rules" section, requirement 3 (visual-verification task). Add a sentence: "Screenshots are uploaded by CI as a `renderer-screenshots-<os>` artifact on each PR check run, so the visual-verification task may read them from the artifact instead of re-running the smoke spec locally."

- [ ] 2.7 Update `docs/E2E_TESTING.md` with a new top-level subsection "Renderer Smoke Spec" before the existing "Pitfalls" or final section. Content:
  - What it is: `tests/e2e/smoke-renderer.e2e.ts` captures full-page PNGs of every renderer route per scanner mode
  - When to use: any change touching `src/renderer/`
  - How to run locally: `npm run test:e2e:smoke` (requires `npm run start` in another terminal)
  - How to read in CI: download the `renderer-screenshots-<os>` artifact from the PR check page
  - Reference to the `electron-playwright-workflow` skill for the visual-review checklist

## 3. Verification

- [ ] 3.1 Validate the YAML edit is well-formed:

  ```bash
  npx -y js-yaml .github/workflows/pr-checks.yml > /dev/null && echo OK
  ```

  Expected: `OK`. If the workflow uses YAML features unsupported by `js-yaml` (rare), fall back to `python -c "import yaml; yaml.safe_load(open('.github/workflows/pr-checks.yml'))" && echo OK`.

- [ ] 3.2 Run the smoke spec locally to confirm screenshots still produce as before (no regression from header-comment edit):

  ```bash
  rm -f tests/e2e/screenshots/*.png
  npm run test:e2e:smoke
  ls tests/e2e/screenshots/*.png | wc -l
  ```

  Expected: `19` (matches what the smoke spec already produces — the header-comment edit doesn't affect runtime).

- [ ] 3.3 Run prettier on every modified doc:

  ```bash
  npx prettier --check tests/e2e/smoke-renderer.e2e.ts \
    .claude/skills/electron-playwright-workflow/SKILL.md \
    .claude/commands/review-pr.md \
    .claude/commands/pre-merge.md \
    openspec/AGENTS.md \
    docs/E2E_TESTING.md
  ```

  Fix anything flagged with `npx prettier --write`.

- [ ] 3.4 Validate this proposal:

  ```bash
  openspec validate upload-renderer-smoke-screenshots --strict
  ```

  Expected: `is valid`.

- [ ] 3.5 Validate that this proposal does not break the three other active proposals on the branch:

  ```bash
  for p in add-graviscan-renderer-pages fix-scanner-config-save-flow surface-disabled-scanners-on-detect; do
    openspec validate $p --strict
  done
  ```

  Expected: each `is valid`.

- [ ] 3.6 Commit incrementally — one commit per file group is fine, but the workflow YAML and the spec deltas SHOULD be separate commits so the YAML change can be cleanly reverted if CI flakes:

  ```
  ci: upload renderer smoke screenshots as PR artifacts
  docs: reference renderer-screenshots CI artifact across guardrail surfaces
  ```

- [ ] 3.7 Push and observe the next CI run:

  ```bash
  git push
  gh pr view 196 --json statusCheckRollup --jq '.statusCheckRollup[] | select(.name | test("(?i)e2e")) | {name, status, conclusion}'
  ```

  After CI completes (typically 5–10 min), confirm the artifact landed:

  ```bash
  gh run view --log <run-id> | grep -i "upload-artifact"
  gh run download <run-id> --pattern "renderer-screenshots-*"
  ls renderer-screenshots-*/
  ```

  Expected: at least one `renderer-screenshots-<os>` artifact exists, and it contains `*.png` files.

- [ ] 3.8 Read three PNGs from the downloaded CI artifact via the Read tool to confirm CI-uploaded artifacts are functionally equivalent to local runs (closes the loop on the spec's "functionally equivalent" claim).

## 4. Post-merge cleanup (after this proposal is archived)

- [ ] 4.1 Add the proposal to the cleanup checklist for OpenSpec archival once this PR merges (`openspec archive upload-renderer-smoke-screenshots`).
- [ ] 4.2 Verify that the README in `tests/e2e/` (if any) references the smoke spec and the artifact path. If no README exists, do NOT create one — `docs/E2E_TESTING.md` is the canonical doc.
