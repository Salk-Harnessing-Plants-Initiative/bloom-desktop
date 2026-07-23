# Validate Development Environment

Check that the dev environment is correctly set up. Run after cloning, after dependency changes, when imports or tests fail unexpectedly, or after switching machines.

## Checks

```bash
# 1. Runtime versions match the project's requirements
node --version    # expect >=20.0.0 (package.json "engines")
npm --version     # expect >=8.0.0  (package.json "engines")
uv --version
python3 --version # expect >=3.11 (pyproject.toml "requires-python")

# 2. Install / sync dependencies from the lockfiles
npm ci
uv sync --extra dev --frozen

# 3. Dependency tree resolves cleanly
npm ls
uv tree

# 4. Prisma client generated (required before most TS commands work)
npx prisma generate

# 5. Import / module smoke test
node -e "require('.')" 2>&1 | head -5
uv run python -c "import numpy, pypylon, nidaqmx, PIL; print('OK')"

# 6. Tests run
npm run test:unit -- --run
uv run pytest python/tests -q
```

## Common fixes

| Symptom                                                           | Fix                                                                                                                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm`/`node` not found or wrong version                           | Use nvm/fnm to switch to Node >=20                                                                                                                                                   |
| `uv` not found                                                    | Install via the [uv installer script](https://docs.astral.sh/uv/getting-started/installation/)                                                                                       |
| Deps not synced / import errors                                   | `npm ci` (delete `node_modules` first if stale); `uv sync --extra dev --frozen`                                                                                                      |
| Prisma client out of date ("cannot find module '.prisma/client'") | `npx prisma generate`                                                                                                                                                                |
| pypylon / nidaqmx import errors                                   | These are hardware SDK bindings — mock hardware paths don't need the real SDK installed, but the Python package itself must still `pip`-install cleanly; see `python/PYINSTALLER.md` |
| `GRAVISCAN_MOCK` / hardware mock env vars missing                 | Check `.env.example` for the flags this repo uses to run without real hardware attached                                                                                              |
| Missing system dependency (Linux, pypylon)                        | `apt-get install` steps documented in `.github/workflows/pr-checks.yml` under "Install system dependencies for pypylon"                                                              |

## Notes

- **Environment variables:** copy `.env.example` to `.env` and set required values — never commit `.env`. E2E tests use a separate `.env.e2e`.
- **Database:** `~/.bloom/dev.db` is created automatically in dev mode; do not hand-create it.
- **Hardware:** tests and dev mode default to mock camera/DAQ/scanner implementations — no physical hardware is required to validate the environment.
- **Native build step:** `npm run build:python` bundles the Python executable; it runs automatically as part of `npm run dev`.

## Related commands

- `/run-ci-locally` — run the full CI gate after the environment is confirmed healthy
- `/test` — run the test suite
- `/dev` — start the dev server
