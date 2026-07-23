# Lint & Format Code

Run linting and formatting checks across TypeScript and Python code to ensure code quality and consistent style. This command is **check-only**; to auto-fix formatting, use `/fix-formatting`.

## Commands

### TypeScript/JavaScript

```bash
# Run ESLint
npm run lint

# Check formatting without making changes
npm run format:check
```

### Python

```bash
# Check Python formatting (CI mode) — does not modify files
uv run black --check python/

# Lint Python code with ruff
uv run ruff check python/

# Type check Python code with mypy
uv run mypy python/
```

### Database

```bash
# Format Prisma schema
npx prisma format

# Validate Prisma schema
npx prisma validate
```

## What to do after running

### TypeScript/JavaScript

1. **If `format:check` fails** - Run `/fix-formatting` to auto-fix, then re-run `/lint`
2. **Fix ESLint errors** - Address any linting errors reported by ESLint

### Python

1. **If `black --check` fails** - Run `/fix-formatting` to auto-fix, then re-run `/lint`
2. **Fix ruff warnings** - Address linting warnings reported by ruff
3. **Fix mypy type errors** - Add type hints or fix type inconsistencies
4. **Test after changes** - Run `npm run test:python` to ensure tests still pass

## Common Issues

### Prettier conflicts with ESLint

- This shouldn't happen - our ESLint config extends `prettier` to disable conflicting rules
- If it does happen, check that `.eslintrc.json` includes `"prettier"` in the `extends` array

### black reformats code unexpectedly

- black is opinionated and automatic - its formatting is non-negotiable
- If you need to preserve formatting in a specific area, use `# fmt: off` and `# fmt: on` comments
- Example:
  ```python
  # fmt: off
  matrix = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
  ]
  # fmt: on
  ```

### mypy type errors in hardware modules

- Hardware SDK packages (pypylon, nidaqmx) may not have type stubs
- Use `# type: ignore` comments for unavoidable type issues with external packages
- Example: `from pypylon import pylon  # type: ignore`

## CI Enforcement

All linting and formatting checks run in CI (`.github/workflows/pr-checks.yml`):

- **Lint - Node.js** job: Runs `npm run lint` and `npm run format:check`
- **Lint - Python** job: Runs `black --check`, `ruff check`, and `mypy`
- PRs cannot merge unless all checks pass

## Configuration Files

- **TypeScript/JavaScript**:
  - `.eslintrc.json` - ESLint configuration
  - `.prettierrc.json` - Prettier configuration
  - `.prettierignore` - Files to exclude from Prettier
- **Python**:
  - `pyproject.toml` - black, ruff, and mypy configuration (under `[tool.black]`, `[tool.ruff]`, `[tool.mypy]`)

## Related Commands

- `/fix-formatting` - Auto-fix style issues (this command only checks)
- `/coverage` - Check test coverage after fixing code
- `/pr-description` - Create PR with linting verification checklist
- `/pre-merge` - Full gate: format-check + lint + typecheck + test + build
