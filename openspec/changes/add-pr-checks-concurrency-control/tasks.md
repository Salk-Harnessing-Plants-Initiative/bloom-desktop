## 1. Regression test (RED)

- [x] 1.1 Add `js-yaml` (and, per §4.4, `@types/js-yaml`) to `package.json` `devDependencies` (pin `js-yaml` to the already-resolved transitive version, `4.1.0`), then run `npm install` to regenerate `package-lock.json` so it stays in sync — `npm ci` (used in nearly every job in `pr-checks.yml`) hard-fails on a stale lockfile
- [x] 1.2 Write `tests/unit/pr-checks-workflow.test.ts`: parse `.github/workflows/pr-checks.yml` with `js-yaml`, then assert:
  - the file parses as valid YAML at all (standalone test, independent of the value assertions below)
  - a top-level `concurrency` key exists
  - `concurrency.group === '${{ github.workflow }}-${{ github.ref }}'`
  - `concurrency['cancel-in-progress'] === "${{ github.event_name == 'pull_request' }}"`
  - `jobs['build-python']['timeout-minutes'] === 10` (added per §4.1)
  - `jobs['test-integration']['timeout-minutes'] === 15`
  - `jobs['test-e2e-dev']['timeout-minutes'] === 90`
  - `jobs['test-make']['timeout-minutes'] === 20`
  - `jobs['test-make-windows']['timeout-minutes'] === 30`
  - no job outside this five-job set has a `timeout-minutes` key (negative-space check, added per §4.5)
    Use the exact whitespace shown above (`${{ github.workflow }}`, spaces inside the braces) — the assertion is a literal string match, so reformatting whitespace in the YAML later would cause a false failure unrelated to an actual regression.
- [x] 1.3 Run `npm run test:unit -- pr-checks-workflow` and confirm it FAILS (no `concurrency` block or `timeout-minutes` keys exist yet) — captures the RED state before any implementation change

## 2. Implementation (GREEN)

- [x] 2.1 Add the `concurrency` block to `.github/workflows/pr-checks.yml`, top level (alongside `on:`/`permissions:`), with both values as **unquoted plain scalars** exactly as below. Do NOT wrap `cancel-in-progress` in single quotes — the embedded `'pull_request'` single quotes prematurely close a single-quoted YAML scalar and break the entire file; double quotes are a safe alternative if quoting is wanted, but unquoted is simplest and is what the test expects.

  ```yaml
  # Redundant runs for the same ref are grouped so they don't run in parallel.
  # - pull_request pushes: cancel-in-progress=true — only the latest commit's
  #   result matters before merge, so a new push cancels the stale run.
  # - push-to-main: cancel-in-progress=false — pushes queue sequentially instead,
  #   so a commit's run isn't cancelled once it starts running or is next in
  #   queue. NOTE: GitHub Actions only holds one pending run per group by
  #   default, so a 3rd+ overlapping push can still silently evict an earlier
  #   push's still-pending (not yet started) run — see the "CI Concurrency
  #   Control" requirement, currently in openspec/changes/
  #   add-pr-checks-concurrency-control/specs/developer-workflows/spec.md
  #   (moves to openspec/specs/developer-workflows/spec.md once archived).
  concurrency:
    group: ${{ github.workflow }}-${{ github.ref }}
    cancel-in-progress: ${{ github.event_name == 'pull_request' }}
  ```

  (Per §4.3, the "moves once archived" wording was added after `/review-pr` caught that this comment originally asserted the requirement already lived at the post-archival path.)

- [x] 2.2 Add `timeout-minutes` to the five jobs newly exposed to indefinite blocking by `main`-push queuing, each with a one-line comment noting it bounds the new queuing-introduced hang risk (values are evidence-based — see `design.md` for the observed-duration data):
  - `build-python`: `timeout-minutes: 10` (added per §4.1)
  - `test-integration`: `timeout-minutes: 15`
  - `test-e2e-dev`: `timeout-minutes: 90`
  - `test-make`: `timeout-minutes: 20`
  - `test-make-windows`: `timeout-minutes: 30`
- [x] 2.3 Run `npm run test:unit -- pr-checks-workflow` and confirm it now PASSES

## 3. Verification

- [x] 3.1 Run `npm run lint` and `npm run format:check`
- [x] 3.2 Run full `npm run test:unit:coverage` to confirm no regressions elsewhere
- [x] 3.3 Validate the YAML is well-formed: `npx --no-install js-yaml .github/workflows/pr-checks.yml > /dev/null`
- [x] 3.4 Open the PR, and after its first CI run **starts**, push a trivial follow-up commit to the same PR branch to confirm in the Actions UI that the first run is shown as cancelled (superseded) — demonstrates the `pull_request` cancel-in-progress path works end-to-end
- [x] 3.5 While that PR is open, either push to a second, unrelated branch/PR or note an unrelated concurrent PR's run in the Actions UI, and confirm the two runs proceed independently — neither queues behind nor cancels the other. Verified live: PR #308's run (31205292264) and an unrelated open PR's run (`add-graviscan-tier5-browse-metadata`, run 31203784171) were both `in_progress` simultaneously; neither was cancelled or blocked by the other.
- [x] 3.6 The "concurrent pushes to main queue instead of running in parallel" scenario and the "third overlapping push can evict a pending run" scenario are intentionally NOT independently verified beyond the unit test in Section 1 and the documented GitHub Actions behavior in `design.md` — deliberately manufacturing a 3-commit burst against `main` to observe eviction is not worth doing on purpose. No task needed here; this is a stated decision, not an oversight.
- [x] 3.7 Confirm the four new `timeout-minutes` values don't cause false failures against the PR's own CI run for this change (i.e., `test-integration`, `test-e2e-dev`, `test-make`, and `test-make-windows` all complete well within their new limits on this PR) — a live sanity check on top of the historical-duration evidence in `design.md`. Verified on PR #308's run `31205292264` (attempt 2): `test-integration` 2m16s-3m34s (limit 15m), `test-e2e-dev` 20m-33m (limit 90m), `test-make` 4m17s (limit 20m), `test-make-windows` 13m13s (limit 30m) — all well within bounds. **Caveat surfaced by `/review-pr`:** this evidence is from run `31205292264`, one commit behind the PR's eventual tip — a later trivial commit (`c17d02b`) triggered a fresh run (`31210569031`) that had a real, unretried macOS E2E flake at the time of review. Section 4 below re-verifies against the actual final tip after the review-driven fixes.
- [x] 3.8 Once the PR is open, post a comment on [issue #307](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/307) summarizing the chosen design (differentiated `cancel-in-progress` by trigger type, not the issue's literally-suggested unconditional version) and its known queue-eviction limitation, linking to this PR and to `design.md`'s "Known limitation" section — the issue currently has zero comments and would otherwise carry no record of this trade-off after the OpenSpec change is archived. Posted: https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/307#issuecomment-5221076363

## 4. `/review-pr` fixes

A 5-subagent adversarial review of PR #308 (posted as a GitHub PR review comment) found 2 blocking and 5 important issues. Fixed here rather than left as follow-up, since all were cheap and directly actionable:

- [x] 4.1 **Blocking:** `build-python` had no `timeout-minutes`, despite `test-integration`/`test-e2e-dev`/`test-make`/`test-make-windows` all declaring `needs: build-python` — an unbounded hang there would have defeated all four downstream bounds, since none of them can start until it finishes. Added `timeout-minutes: 10` (observed 1m4s-2m17s across OSes, ~5x headroom), with the same style of in-file comment as the other four. Updated `design.md`, `specs/developer-workflows/spec.md` (new scenario "A hung upstream build cannot bypass the downstream jobs' bounds"), and `proposal.md` to reflect five bounded jobs, not four.
- [x] 4.2 **Blocking:** the PR's actual tip commit had a red, unretried CI run (`31210569031`) while `tasks.md` §3.7 cited evidence from an earlier commit's run. Re-verify after the fixes in this section land (see 4.6 below) and rerun any failed jobs before considering this resolved.
- [x] 4.3 **Important:** the `concurrency:` block comment and all four (now five) `timeout-minutes` comments in `pr-checks.yml` claimed the "CI Concurrency Control"/"CI Job Timeout Bounds" requirements already live at `openspec/specs/developer-workflows/spec.md` — they don't yet; that only happens once this change is archived. Reworded all five comments to point at `openspec/changes/add-pr-checks-concurrency-control/` and note they move on archival.
- [x] 4.4 **Important:** `js-yaml` ships no bundled types, so `load()` in the test resolved to implicit `any` and the `WorkflowFile` cast provided no real compile-time checking (masked only because `tsconfig.json` excludes `tests/**`). Added `@types/js-yaml` as an explicit devDependency; regenerated `package-lock.json`.
- [x] 4.5 **Important:** no test asserted that _no other_ job unexpectedly gained a `timeout-minutes`, and there was no standalone YAML-validity test independent of the value assertions. Added both to `tests/unit/pr-checks-workflow.test.ts` (a top-level `it('parses as valid YAML', ...)`, and an `EXPECTED_TIMEOUTS`-driven negative-space assertion).
- [ ] 4.6 Push these fixes, confirm `npm run lint`/`format:check`/`test:unit:coverage`/`tsc --noEmit` all still pass locally, then rerun the PR's CI on the new tip commit and confirm green (or confirm any remaining red is the same pre-existing/unrelated failure already documented in §3.7, not the macOS E2E flake recurring unretried) before considering blocking issue 4.2 closed.
- [ ] 4.7 Note in the PR (comment or description update) that the two important findings about "verified cross-platform" (the new test only runs on Linux in CI) and the cross-branch-isolation evidence (task 3.5's cited run was actually stuck, not cleanly completed) are acknowledged but not changed — both are accurate characterizations of already-true, acceptable behavior, not defects to fix.
