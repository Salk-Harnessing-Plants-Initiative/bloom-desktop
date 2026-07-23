# Fix Formatting

Automatically reformat code to match the project's style config (Prettier for TS/JS, black for Python). This mutates files in place; run `/lint` separately for logic-level errors.

## Commands

```bash
# TypeScript/JavaScript — Prettier
npm run format

# Python — black
uv run black python/
```

## What Gets Fixed

- Line length (wrapping or collapsing)
- Quote style, semicolons, trailing commas
- Indentation and bracket/brace spacing
- End-of-line characters

Covers `.ts`, `.tsx`, `.js`, `.jsx`, `.json`, `.css`, `.md` (Prettier — see `.prettierignore` for exclusions) and `python/**/*.py` (black).

## What Is NOT Auto-Fixed

- Lint/logic errors — use `/lint` (`npm run lint`, `uv run ruff check python/`)
- Type errors — use `npx tsc --noEmit` or `uv run mypy python/`
- Code structure or correctness

## After Running

### Review the diff

```bash
git diff
```

Confirm the changes are formatting-only. If something unexpected changed, check for a pre-existing syntax error in the file — formatters rarely corrupt valid code.

### Verify tests still pass

```bash
npm run test:unit
npm run test:python
```

### Commit formatting separately

```bash
git add -u
git commit -m "style: apply formatter"
```

## Common Scenarios

### CI reports a formatting failure

```bash
# Fix locally
npm run format
uv run black python/

# Verify the check now passes
npm run format:check
uv run black --check python/

# Commit and push
git add -u
git commit -m "style: apply formatter"
git push
```

### After resolving a merge conflict

```bash
npm run format
uv run black python/
git diff        # review
git add -u
git commit
```

## Comparison with /lint

| Command | Purpose | Modifies files? |
|---|---|---|
| `/fix-formatting` | Auto-fix style | Yes |
| `/lint` | Check code quality + types | No |
| `npm run format:check` / `uv run black --check python/` | Verify formatting without fixing | No |

**Recommended order:** `/fix-formatting` → `/lint` → commit.

## IDE Integration

- VS Code / Cursor: `"editor.formatOnSave": true` with the Prettier and Python (black) extensions
- Configure black as the Python formatter provider so on-save formatting matches CI

## Related Commands

- `/lint` — Check for code quality and type issues
- `npm run format:check` / `uv run black --check python/` — Verify formatting without fixing (what CI runs)
- `/pre-merge` — Full gate including format check
- `/ci-debug` — Debug a CI formatting failure
