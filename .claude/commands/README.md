# Claude Commands for Bloom Desktop

Collection of slash commands that provide quick-reference workflows for common development tasks.

## Usage

Commands are invoked in Claude using the slash syntax:

```
/lint
/coverage
/pr-description
```

Commands provide guidance on:

- Running specific commands
- Understanding output
- Troubleshooting common issues
- Related workflows

## Available Commands

### Core Development Commands

Use these commands daily for standard development workflows.

#### `/dev` - Dev Server & Verification

Start the Electron dev server and verify changes by exercising the running app (Playwright MCP or `npm run test:e2e`).

#### `/lint` - Linting and Type Checking

Check-only code quality and type safety checks for TypeScript and Python.

- TypeScript: ESLint, `tsc --noEmit`
- Python: ruff, mypy
- Formatting is check-only here — use `/fix-formatting` to auto-fix

#### `/fix-formatting` - Auto-Fix Formatting

Reformat code in place with Prettier (TS/JS) and black (Python).

#### `/test` - Run Unit Tests

Run the fast TypeScript (Vitest) and Python (pytest) unit suites, with watch-mode guidance.

#### `/tdd` - Test-Driven Development

Structured red-green-refactor workflow with bloom-specific patterns (mock hardware, IPC contracts, metadata fixtures).

#### `/coverage` - Test Coverage

Check test coverage across all test types.

- TypeScript unit tests (50% minimum)
- Python unit tests (80% minimum enforced)
- Integration test expectations
- E2E test coverage
- How to view coverage reports
- CI enforcement details

#### `/validate-env` - Validate Development Environment

Verify Node/npm/uv/Python versions, dependency sync, Prisma client generation, and import smoke tests after cloning or switching machines.

#### `/run-ci-locally` - Reproduce CI Locally

Mirrors all 12 jobs in `.github/workflows/pr-checks.yml` (lint, typecheck, unit tests, Python build, integration, E2E, packaged-app database) with local repro commands for each.

#### `/pr-description` - PR Template

Standardized PR description template with the three-state (`[x]`/`[!]`/`[ ]`) verification convention and comprehensive testing checklists.

- Summary, changes, and OpenSpec change-id sections
- TypeScript, Python, integration, E2E test checklists
- Hardware testing verification
- Build and packaging checks
- Database migration checklist
- GitHub CLI commands for PR management

#### `/review-pr` - Adversarial Multi-Lens PR Review

Launches 5 specialized subagents (code quality/architecture, testing/TDD, scientific rigor/metadata/UX, security/cross-platform, behavioral correctness) to critically review a PR and post a verdict to GitHub.

#### `/copilot-review` - GitHub Copilot Comment Triage

Fetch, categorize (high/medium/low priority), and offer to address GitHub Copilot's inline PR review comments.

#### `/pre-merge` - Full Pre-Merge Gate

Comprehensive pre-merge verification: format, lint, typecheck, test, build, docs, OpenSpec status, PR creation/update, CI monitoring, Copilot + human review triage, and changelog.

#### `/update-changelog` - Version Tracking

Document changes for releases using standard changelog format.

- Standard changelog categories (Added, Changed, Fixed, etc.)
- Semantic versioning guidance
- Dependency version tracking
- Breaking change documentation
- Git workflow integration

#### `/cleanup-merged` - Post-Merge Cleanup

Clean up a feature branch after its PR merges (with a `state == MERGED` gate before any deletion) and archive completed OpenSpec proposals via the CLI.

#### `/new-feature` - New Feature Workflow

End-to-end workflow for scoping, proposing (OpenSpec), reviewing (`openspec-review` skill), and implementing (TDD) a new feature.

#### `/ci-debug` - CI Debugging

Diagnose and fix a failing GitHub Actions run — job-by-job breakdown of all CI jobs, common failure patterns, log download, and re-run commands.

#### `/docs-review` - Documentation Review

Systematic review of bloom-desktop's documentation (README, docs/, OpenSpec, Python docs) for accuracy, completeness, and consistency.

### Specialized Commands

Use these commands for specific workflows (hardware, Python, database, packaging, testing).

#### `/hardware-testing` - Hardware Integration Testing

Guide for testing with mock and real hardware (camera, DAQ, scanner).

- Mock hardware testing commands (CI-safe)
- Real hardware testing prerequisites and setup
- Camera testing (Basler Pylon SDK)
- DAQ testing (NI-DAQmx)
- Full scanner workflow testing
- Troubleshooting camera and DAQ issues
- Mock hardware implementation details

#### `/python-bundling` - PyInstaller Troubleshooting

Build Python executables and troubleshoot PyInstaller issues.

- Building Python executable (`npm run build:python`)
- PyInstaller configuration (`python/main.spec`)
- Adding new Python dependencies
- Troubleshooting "Module not found" errors
- Troubleshooting missing package metadata
- DLL/dylib loading issues (Windows/macOS)
- Platform-specific packaging concerns
- Verification checklist

#### `/database-migration` - Prisma Migrations

Create and manage database migrations with Prisma.

- Creating migrations (`npm run prisma:migrate`)
- Generating Prisma Client
- Viewing database with Prisma Studio
- Migration workflow (modify schema → create → test)
- Database locations (dev, production, E2E)
- Migration best practices
- Rollback procedures
- Common issues and solutions

#### `/integration-testing` - Integration Test Guide

Run and understand integration tests for IPC, hardware, and database.

- IPC communication tests
- Camera integration tests (mock camera)
- DAQ integration tests (mock DAQ)
- Scanner workflow tests
- Database integration tests
- Packaged app tests
- Debugging integration tests
- CI behavior and mock hardware

#### `/packaging` - Electron Packaging

Create distributable packages and installers with Electron Forge.

- Creating packages (`npm run package`)
- Creating installers (`npm run make`)
- Packaging checklist
- Platform-specific packaging (macOS, Windows, Linux)
- Code signing and notarization (macOS)
- ASAR configuration (Prisma unpacking)
- Common packaging issues
- Distribution and release workflow

#### `/e2e-testing` - Playwright E2E Testing

Run and write end-to-end tests with Playwright.

- Running E2E tests (`npm run test:e2e`, `test:e2e:ui`, `test:e2e:debug`)
- Writing E2E tests (template and best practices)
- Electron-specific selectors (data-testid)
- Database setup for E2E tests
- Debugging with Playwright Inspector
- CI/CD integration (xvfb on Linux)
- Common issues (timeouts, multiple windows)

### OpenSpec Commands

Generated by `npx openspec init --tools claude`; source of truth is the OpenSpec CLI, not this repo.

- `/openspec:proposal` - scaffold a new change proposal
- `/openspec:apply` - implement an approved proposal
- `/openspec:archive` - archive a completed change (also wrapped by `/cleanup-merged`)

Note: proposal review is handled by the **`openspec-review` skill** (`.claude/skills/openspec-review/`, invoked via the Skill tool, not a slash command) — a 5-lens adversarial review team covering spec quality, code/architecture feasibility, GitHub issue alignment, TDD strategy, and scientific rigor.

## Command Cross-Reference

Commands often reference each other for related workflows:

- `/dev` → `/test` (verify code correctness before browsing the app)
- `/fix-formatting` → `/lint` (auto-fix style, then check quality/types)
- `/lint` → `/coverage` (run linting before checking coverage)
- `/test` → `/tdd` (structured red-green-refactor when adding tests)
- `/coverage` → `/pr-description` (verify coverage before creating PR)
- `/run-ci-locally` → `/pre-merge` (wrapped by the full pre-merge gate)
- `/validate-env` → `/run-ci-locally` (confirm environment before running the CI gate)
- `/pr-description` → `/review-pr` (PR template and review checklist)
- `/pre-merge` → `/copilot-review`, `/review-pr`, `/ci-debug`, `/update-changelog` (chained phases)
- `/new-feature` → `openspec-review` skill → `/tdd` → `/pre-merge` → `/cleanup-merged` (full feature lifecycle)
- `/hardware-testing` → `/integration-testing` (hardware tests are integration tests)
- `/python-bundling` → `/hardware-testing` (Python build required for hardware tests)
- `/python-bundling` → `/packaging` (Python executable bundled in Electron package)
- `/database-migration` → `/packaging` (migrations run in packaged apps)
- `/integration-testing` → `/e2e-testing` (progression from integration to E2E)

## Related Documentation

Commands link to detailed documentation in the repository:

- **docs/**: Comprehensive guides for camera, DAQ, scanner, database, packaging, E2E testing
- **python/PYINSTALLER.md**: Detailed PyInstaller guide
- **openspec/**: OpenSpec proposals and specifications
- **README.md**: Project overview and getting started

## Contributing New Commands

When adding new commands:

1. **Create command file**: `.claude/commands/command-name.md`
2. **Follow format**:
   - Brief description (1-2 sentences)
   - Commands section with code blocks
   - "What to do after running" section
   - Common issues section (if applicable)
   - Related commands section
3. **Update this README**: Add to appropriate category above
4. **Test command**: Verify all commands and paths are correct
5. **Add to OpenSpec**: Update proposal if part of planned work

## Command Format

Each command follows this structure:

````markdown
# Command Name

[1-2 sentence description]

## Commands

```bash
# Command examples
npm run command
```
````

## What to do after running

1. [Next steps]
2. [Common actions]

## Troubleshooting (optional)

[Common issues and solutions]

## Related Commands

- /related-command - Description

```

## Getting Help

- **Command-specific help**: Run the command (e.g., `/lint`)
- **General help**: See repository documentation in `docs/`
- **Issues**: Report at https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues
```
