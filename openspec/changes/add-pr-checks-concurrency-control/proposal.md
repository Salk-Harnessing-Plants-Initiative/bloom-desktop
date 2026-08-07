## Why

`.github/workflows/pr-checks.yml` has no `concurrency` block. Every `pull_request` sync and every push to `main` triggers its own independent run of the full job matrix — including `test-integration`, `test-e2e-dev`, `test-make`, and `test-make-windows`, which run across Linux, macOS, and Windows. Nothing cancels a run that a newer commit has already superseded.

This was confirmed on 2026-08-06 in [issue #307](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/307): three separate pushes to `main` (`dad00f3`, `8c446ab`, `2a9c0e8`) landed within 47 minutes, each queuing its own copy of the macOS/Windows jobs simultaneously. The same problem hits PRs — every `synchronize` push during review re-triggers the full matrix on top of whatever is still running for the previous commit. macOS and Windows runners are the scarcest capacity in this workflow, so bursts of quick commits (common during active review or a string of small merges) needlessly multiply demand on exactly the runners least able to absorb it, delaying feedback for unrelated concurrent work.

## What Changes

- Add a single top-level `concurrency` block to `pr-checks.yml`, grouped by `${{ github.workflow }}-${{ github.ref }}` so unrelated branches/PRs never contend with each other, with `cancel-in-progress: ${{ github.event_name == 'pull_request' }}` — one expression, evaluated per run, not two separately-configured blocks:
  - On `pull_request` events this evaluates `true`: a new push to the same PR cancels the now-stale in-progress run for the previous commit, since only the latest commit's result matters before merge.
  - On `push`-to-`main` events this evaluates `false`: same-ref runs queue behind each other instead of running concurrently, which eliminates the runner pile-up. This is intended to also preserve a completed CI record for pushed commits where possible — see `design.md` for a known GitHub Actions limitation (queue depth of one pending run) where a burst of 3+ overlapping pushes can still silently evict a commit's run before it starts.
- Add `timeout-minutes` to the four jobs newly exposed to indefinite blocking by the queuing behavior above (`test-integration`, `test-e2e-dev`, `test-make`, `test-make-windows`) — without a `concurrency` block, a hung job only delayed its own push; with queuing, it could otherwise also block the _next_ queued `main` commit's CI from starting until GitHub's 6-hour default elapses. Values are set from actual observed job durations (see `design.md`), not guessed.
- Add a regression test (`tests/unit/pr-checks-workflow.test.ts`) that parses the workflow YAML and asserts the concurrency block's `group`/`cancel-in-progress` values and the four jobs' `timeout-minutes` values, so a future edit can't silently drop or weaken this behavior.
- Add `js-yaml` as an explicit `devDependency` (currently only present transitively via `@salk-hpi/bloom-fs`/`eslint`) since the new test imports it directly — this requires regenerating `package-lock.json`, not just editing `package.json`, so `npm ci` in every CI job keeps working.
- Post a comment on issue #307 once the implementing PR is open, summarizing the chosen design and its known queue-eviction limitation, since the issue itself currently has no record of this trade-off.

## Impact

- Affected specs: `developer-workflows` (new requirements: CI Concurrency Control, CI Job Timeout Bounds)
- Affected code: `.github/workflows/pr-checks.yml`, `tests/unit/pr-checks-workflow.test.ts` (new), `package.json`/`package-lock.json` (devDependency), `CHANGELOG.md`
- No application runtime behavior changes; this is CI-only.
