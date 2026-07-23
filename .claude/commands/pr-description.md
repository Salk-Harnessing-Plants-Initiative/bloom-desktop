# PR Description Template

Use this template when creating pull requests to ensure comprehensive documentation and testing verification.

## Quick Commands

```bash
# View current PR
gh pr view

# View PR diff
gh pr diff

# List changed files
gh pr diff --name-only

# Check CI status
gh pr checks
```

## Checkbox Convention (READ FIRST)

Use a three-state convention for verification checkboxes — don't tick `[x]` out of habit:

- `[x]` — Verified green. You ran the command and it passed.
- `[!]` — Pre-existing failure on `main`. This PR introduces no new failures. Link the issue tracking the baseline bug.
- `[ ]` — Not yet verified, or doesn't apply.

The `[!]` state exists because docs/config/refactor PRs often inherit lint/typecheck/build failures that already exist on `main`. Ticking `[x]` on those would be a false claim.

Example:
```
- [x] Unit tests pass — 47 passing
- [!] `npm run format:check` fails on pre-existing issue (#12), not introduced here
- [ ] Coverage check (not run — no new code added)
```

## PR Description Template

```markdown
## Summary

[Brief 1-2 sentence description of what this PR does]

## Changes

- [Bullet point list of specific changes]
- [Group related changes together]
- [Use present tense: "Add X", "Fix Y", "Update Z"]

## OpenSpec Change

- Change ID: `<change-id>`
- Affected capabilities: `<capability-1>`, `<capability-2>`
- Delta types: ADDED / MODIFIED / REMOVED
- All `tasks.md` items complete: yes/no

(If this PR is too small for an OpenSpec proposal — typo, dep bump, test-only — say "No OpenSpec change: <reason>".)

## Testing

### TypeScript Tests

- [ ] Unit tests pass (`npm run test:unit`)
- [ ] Unit tests added for new functionality
- [ ] Coverage meets 50% threshold (`npm run test:unit:coverage`)

### Python Tests

- [ ] Unit tests pass (`npm run test:python`)
- [ ] Unit tests added for new functionality
- [ ] Coverage meets 80% threshold (enforced by CI)

### Integration Tests

- [ ] IPC tests pass (`npm run test:ipc`)
- [ ] Camera tests pass (`npm run test:camera`) - if camera changes
- [ ] DAQ tests pass (`npm run test:daq`) - if DAQ changes
- [ ] Scanner tests pass (`npm run test:scanner`) - if scanner changes
- [ ] Database integration tests pass (`npm run test:scanner-database`) - if database changes

### E2E Tests

- [ ] E2E tests pass (`npm run test:e2e`)
- [ ] Added E2E tests for new user workflows (if applicable)

### Hardware Integration

- [ ] Mock hardware tests pass (used in CI)
- [ ] Real hardware tested locally (if hardware changes)
- [ ] Hardware documentation updated (`docs/CAMERA_TESTING.md`, `docs/DAQ_TESTING.md`, etc.)

## Build & Packaging

- [ ] TypeScript compiles without errors (`npx prisma generate && npx tsc --noEmit`)
- [ ] Python executable builds successfully (`npm run build:python`)
- [ ] Packaged app tested (`npm run package` and manual verification) - if packaging changes

## Linting & Formatting

- [ ] ESLint passes (`npm run lint`)
- [ ] Prettier formatting applied (`npm run format`)
- [ ] Python formatting applied (`uv run black python/`)
- [ ] Python linting passes (`uv run ruff check python/`)
- [ ] Python type checking passes (`uv run mypy python/`)

## Database Changes

- [ ] No database changes
- [ ] Database migration created and tested (`npm run prisma:migrate`)
- [ ] Schema changes maintain pilot compatibility (see `docs/PILOT_COMPATIBILITY.md`)
- [ ] Migration tested in packaged app

## Cross-Platform Compatibility

- [ ] CI tests pass on Linux, macOS, and Windows
- [ ] File paths use `path.join()` (Node.js) or `Path()` (Python)
- [ ] No platform-specific assumptions (case-sensitive paths, line endings, etc.)

## Breaking Changes

- [ ] No breaking changes
- [ ] Breaking changes documented below with migration path

[If breaking changes, describe what breaks and how to migrate]

## Related Issues

Closes #[issue number]
Related to #[issue number]

## Screenshots/Examples

[If UI changes, include screenshots]
[If IPC changes, include example command/response]
[If hardware changes, include example output]

## Reviewer Notes

[Specific areas you want reviewers to focus on]
[Any concerns or questions you have]
[Special testing instructions]
```

## GitHub CLI Tips

```bash
# Create PR with title
gh pr create --title "feat: add camera exposure control"

# Create PR with body from file
gh pr create --title "feat: ..." --body-file pr-description.md

# Edit PR description
gh pr edit --body "Updated description"

# Add labels
gh pr edit --add-label "area:hardware" --add-label "type:feature"

# Request review
gh pr edit --add-reviewer @username

# Add to project
gh pr edit --add-project "Bloom Desktop"

# Check CI status
gh pr checks

# View specific job logs
gh run view --log-failed
```

## Example PRs

### Feature PR Example

```markdown
## Summary

Add camera brightness control to camera settings with live preview updates.

## Changes

- Add brightness slider to CameraSettingsForm component
- Add brightness parameter to CameraSettings IPC type
- Implement brightness control in Python camera interface
- Add brightness field to camera settings database schema
- Update camera mock to simulate brightness changes

## Testing

### TypeScript Tests

- [x] Unit tests pass
- [x] Added tests for brightness slider component
- [x] Coverage: 52% (up from 50%)

### Python Tests

- [x] Unit tests pass
- [x] Added tests for brightness control in camera interface
- [x] Coverage: 85%

### Integration Tests

- [x] IPC tests pass
- [x] Camera tests pass (mock camera with brightness control)
- [x] Real Basler camera tested locally with brightness range 0.0-1.0

## Database Changes

- [x] Migration created (`20250107_add_camera_brightness`)
- [x] Schema maintains pilot compatibility
- [x] Migration tested in dev and packaged app

## Related Issues

Closes #51 (per-experiment camera settings)

## Screenshots

[Screenshot of brightness slider in camera settings UI]

## Reviewer Notes

Please verify the brightness range (0.0-1.0) makes sense for the UI. The Basler SDK uses this range internally.
```

### Bug Fix PR Example

```markdown
## Summary

Fix race condition in Python subprocess startup causing intermittent IPC test failures on Windows.

## Changes

- Add ready signal from Python process to indicate IPC handler initialization
- Wait for ready signal in TypeScript before sending first IPC command
- Add 5-second timeout for ready signal to prevent hanging

## Testing

### Integration Tests

- [x] IPC tests pass consistently on Windows (previously failed ~30% of the time)
- [x] Tests pass on Linux and macOS (no regression)

## Related Issues

Closes #47 (IPC race condition on Windows)
```

## Related Commands

- `/lint` - Run linting before creating PR
- `/coverage` - Check coverage before creating PR
- `/pre-merge` - Full pre-merge gate before opening this PR
- `/review-pr` - Use this checklist when reviewing PRs
- `/copilot-review` - Fetch and triage GitHub Copilot inline comments
- `/cleanup-merged` - Post-merge cleanup workflow
