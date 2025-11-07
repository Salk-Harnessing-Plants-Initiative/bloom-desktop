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

#### `/lint` - Linting and Formatting

Run linting and formatting checks for TypeScript and Python code.

- TypeScript: ESLint, Prettier
- Python: black, ruff, mypy
- Database: Prisma format and validate
- Configuration file references
- Troubleshooting common lint issues

#### `/coverage` - Test Coverage

Check test coverage across all test types.

- TypeScript unit tests (50% minimum)
- Python unit tests (80% minimum enforced)
- Integration test expectations
- E2E test coverage
- How to view coverage reports
- CI enforcement details

#### `/pr-description` - PR Template

Standardized PR description template with comprehensive testing checklists.

- Summary and changes format
- TypeScript, Python, integration, E2E test checklists
- Hardware testing verification
- Build and packaging checks
- Database migration checklist
- GitHub CLI commands for PR management

#### `/review-pr` - Code Review Checklist

Comprehensive code review checklist for reviewers.

- Code quality checks (naming, types, error handling)
- Architecture checks (IPC, subprocess management)
- Electron-specific concerns (ASAR, resource paths)
- Python bundling checks (PyInstaller, hidden imports)
- Hardware integration checks
- Database migration review
- Cross-platform compatibility
- Security considerations

#### `/changelog` - Version Tracking

Document changes for releases using standard changelog format.

- Standard changelog categories (Added, Changed, Fixed, etc.)
- Semantic versioning guidance
- Dependency version tracking
- Breaking change documentation
- Git workflow integration

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

## Command Cross-Reference

Commands often reference each other for related workflows:

- `/lint` → `/coverage` (run linting before checking coverage)
- `/coverage` → `/pr-description` (verify coverage before creating PR)
- `/pr-description` → `/review-pr` (PR template and review checklist)
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

```markdown
# Command Name

[1-2 sentence description]

## Commands

```bash
# Command examples
npm run command
```

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