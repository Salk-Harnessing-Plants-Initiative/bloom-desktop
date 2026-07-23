# Run CI Locally

Reproduce the CI gate locally before pushing. This mirrors the jobs in `.github/workflows/pr-checks.yml` — **all 12 jobs are hard-blocking (no `continue-on-error`)**; a failure in any one blocks merge via the `All Checks Passed` summary job.

## What CI actually runs

| #   | Job                          | Platform(s)                    | Local repro                                                                                                                                                                               |
| --- | ---------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Lint - Node.js               | Linux                          | `npm run lint && npm run format:check`                                                                                                                                                    |
| 2   | Lint - Python                | Linux                          | `uv run black --check python/ && uv run ruff check python/ && uv run mypy python/`                                                                                                        |
| 3   | Test - Database Migrations   | Linux                          | `./scripts/verify-migrations.sh && npm run test:db-upgrade`                                                                                                                               |
| 4   | Compile - TypeScript         | Linux                          | `BLOOM_DATABASE_URL='file:./dev.db' npx prisma generate && npx tsc --noEmit`                                                                                                              |
| 5   | Test - TypeScript Unit       | Linux                          | `BLOOM_DATABASE_URL='file:./dev.db' npx prisma generate && BLOOM_DATABASE_URL='file:./dev.db' npx prisma migrate deploy && BLOOM_DATABASE_URL='file:./dev.db' npm run test:unit:coverage` |
| 6   | Test - Python                | Linux                          | `npm run test:python`                                                                                                                                                                     |
| 7   | Test - E2E IPC Coverage      | Linux                          | `npm run test:e2e:coverage`                                                                                                                                                               |
| 8   | Build - Python Executable    | Linux/macOS/Windows            | `npm run build:python`                                                                                                                                                                    |
| 9   | Test - Integration           | Linux/macOS/Windows (needs #8) | `npm run test:ipc && npm run test:camera && npm run test:daq && npm run test:scanner`                                                                                                     |
| 10  | Test - Dev Mode Database     | Linux (needs #8)               | `npx prisma generate && npm run test:dev:database`                                                                                                                                        |
| 11  | Test - E2E Dev Build         | Linux/macOS/Windows (needs #8) | `npm run test:e2e` (dev server must be running)                                                                                                                                           |
| 12  | Test - Packaged App Database | macOS (needs #8)               | `npm run test:package:database`                                                                                                                                                           |

Jobs 9, 10, 11, 12 depend on job 8's build artifact (`build-python`); reproduce job 8 first if testing those locally.

## Standard local sweep (fast subset — jobs 1-6)

Run these in order, stopping on the first failure. Jobs 4 and 5 set `BLOOM_DATABASE_URL: 'file:./dev.db'` in CI — the commands below scope it inline (`VAR=value cmd`) rather than `export`ing it, so it doesn't leak into your shell. Per `.env.example`, do not add `BLOOM_DATABASE_URL` to your `.env` file or export it persistently — a stale exported value silently changes which database Prisma targets in later, unrelated commands.

```bash
# 1. Format check
npm run format:check
uv run black --check python/

# 2. Lint
npm run lint
uv run ruff check python/
uv run mypy python/

# 3. Type check (CI sets BLOOM_DATABASE_URL for Prisma steps — match it, don't reuse a stale export)
BLOOM_DATABASE_URL='file:./dev.db' npx prisma generate
npx tsc --noEmit

# 4. Tests
BLOOM_DATABASE_URL='file:./dev.db' npm run test:unit
npm run test:python

# 5. Build (Python executable)
npm run build:python
```

### Annotated run (recommended output format)

```
[1/5] Format check...     PASSED
[2/5] Lint...             PASSED
[3/5] Type check...       PASSED
[4/5] Tests...            PASSED
[5/5] Build...            PASSED

FAST SWEEP PASSED — jobs 1-6 reproduced
```

On failure:

```
[2/5] Lint...
  <error output>
FAILED

Fix: run /fix-formatting for format failures, or /lint for lint details.
```

## Quick fixes

| Step         | Fix                                                                        |
| ------------ | -------------------------------------------------------------------------- |
| Format check | Run `/fix-formatting`                                                      |
| Lint         | Run `/lint` locally, fix errors                                            |
| Type check   | Fix type errors reported by `npx tsc --noEmit` / `uv run mypy python/`     |
| Tests        | Read test output and fix; use `/tdd` for a structured fix loop             |
| Build        | Run `npm run build:python` locally; check `scripts/build-python.js` output |

## Dependencies and environment

```bash
npm ci
uv sync --extra dev --frozen
```

If steps fail with "module not found" or import errors, re-run the above.

## Platform matrix (jobs 8, 9, 11, 12)

Jobs 8, 9, 11 run on Linux + macOS + Windows; job 12 is macOS-only. Reproducing the fast sweep (jobs 1-6) locally only covers your current platform — cross-platform pitfalls to watch for:

- Path separators — use `path.join()` (Node) / `Path()` (Python), never string concatenation
- File-system case sensitivity — Linux is case-sensitive; macOS/Windows are not
- Xvfb — Linux CI runs E2E under a virtual display; a headless Linux dev box needs the same

## When to use

- Before every `git push`
- Before creating a PR
- After significant changes
- Whenever you want confidence the PR will pass CI

## Related commands

- `/lint` — lint + type check only
- `/coverage` — tests with coverage detail
- `/integration-testing` — job 9 in detail (mock hardware)
- `/e2e-testing` — jobs 11/12 in detail
- `/pre-merge` — full pre-merge gate (wraps this command)
- `/tdd` — structured red-green-refactor loop for fixing test failures
- `/ci-debug` — diagnose a CI run that already failed on GitHub

## OpenSpec check

If the repo uses OpenSpec, validate active changes before pushing:

```bash
npx openspec validate --all --strict
```

A validation failure here means CI would also fail if it validates OpenSpec state.
