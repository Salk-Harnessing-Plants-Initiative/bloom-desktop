## 1. Regression test (RED)

- [x] 1.1 Add `js-yaml` to `package.json` `devDependencies` (pin to the already-resolved transitive version, `4.1.0`), then run `npm install` to regenerate `package-lock.json` so it stays in sync — `npm ci` (used in nearly every job in `pr-checks.yml`) hard-fails on a stale lockfile
- [x] 1.2 Write `tests/unit/pr-checks-workflow.test.ts`: parse `.github/workflows/pr-checks.yml` with `js-yaml`, then assert:
  - a top-level `concurrency` key exists
  - `concurrency.group === '${{ github.workflow }}-${{ github.ref }}'`
  - `concurrency['cancel-in-progress'] === "${{ github.event_name == 'pull_request' }}"`
  - `jobs['test-integration']['timeout-minutes'] === 15`
  - `jobs['test-e2e-dev']['timeout-minutes'] === 90`
  - `jobs['test-make']['timeout-minutes'] === 20`
  - `jobs['test-make-windows']['timeout-minutes'] === 30`
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
  #   Control" requirement in openspec/specs/developer-workflows/spec.md for
  #   this known limitation (persists after this proposal is archived).
  concurrency:
    group: ${{ github.workflow }}-${{ github.ref }}
    cancel-in-progress: ${{ github.event_name == 'pull_request' }}
  ```

- [x] 2.2 Add `timeout-minutes` to the four jobs newly exposed to indefinite blocking by `main`-push queuing, each with a one-line comment noting it bounds the new queuing-introduced hang risk (values are evidence-based — see `design.md` for the observed-duration data):
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
- [x] 3.7 Confirm the four new `timeout-minutes` values don't cause false failures against the PR's own CI run for this change (i.e., `test-integration`, `test-e2e-dev`, `test-make`, and `test-make-windows` all complete well within their new limits on this PR) — a live sanity check on top of the historical-duration evidence in `design.md`. Verified on PR #308's run: `test-integration` 2m16s-3m34s (limit 15m), `test-e2e-dev` 20m-33m (limit 90m), `test-make` 4m17s (limit 20m), `test-make-windows` 13m13s (limit 30m) — all well within bounds. (The macOS `test-e2e-dev` job initially failed on 9 flaky Electron-launch tests unrelated to this change; a re-run of failed jobs passed cleanly, confirming transient CI flakiness rather than a regression or a timeout false-trigger.)
- [x] 3.8 Once the PR is open, post a comment on [issue #307](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/307) summarizing the chosen design (differentiated `cancel-in-progress` by trigger type, not the issue's literally-suggested unconditional version) and its known queue-eviction limitation, linking to this PR and to `design.md`'s "Known limitation" section — the issue currently has zero comments and would otherwise carry no record of this trade-off after the OpenSpec change is archived. Posted: https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/307#issuecomment-5221076363
