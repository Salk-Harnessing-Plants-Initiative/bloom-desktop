# Proposal: Add Claude Commands for Developer Workflows

## Problem Statement

Bloom-desktop developers currently lack standardized slash commands for common development workflows. This leads to:

1. **Inconsistent development practices** - No standard way to run linting, check coverage, or create PRs
2. **Onboarding friction** - New developers must discover commands and workflows independently
3. **Quality variance** - Without standardized PR templates and review checklists, quality varies across contributions
4. **Dual-stack complexity** - TypeScript + Python stack requires coordinating multiple toolchains (npm, uv, pytest, vitest)
5. **Hardware testing gaps** - No documented workflow for mock vs. real hardware testing
6. **Missing specialized guidance** - No quick reference for Python bundling (PyInstaller), database migrations (Prisma), or Electron packaging

## Proposed Solution

Create 11 Claude slash commands in `.claude/commands/` that provide quick-reference workflows for common tasks:

### Core Development Commands (5 commands)

**1. /lint - Linting and Formatting**

- Runs ESLint, Prettier (TypeScript)
- Runs black, ruff, mypy (Python)
- Shows how to fix common issues
- Links to configuration files

**2. /coverage - Test Coverage**

- Runs Vitest coverage (TypeScript, 50% minimum)
- Runs pytest coverage (Python, 80% minimum)
- Explains coverage goals for different test types
- Shows how to generate and view coverage reports

**3. /pr-description - PR Template**

- Standardized PR description format
- Checklist for TypeScript tests, Python tests, integration tests, E2E tests
- Hardware testing verification (mock camera, mock DAQ)
- Python build verification (`npm run build:python`)
- Database migration checklist (if applicable)
- Cross-platform compatibility notes

**4. /review-pr - Code Review Checklist**

- Code quality checks (naming, types, error handling)
- Architecture checks (IPC patterns, subprocess management)
- Electron-specific concerns (ASAR packaging, resource paths)
- Python bundling concerns (PyInstaller hidden imports, metadata)
- Hardware integration checks (mock hardware available, error handling)
- Database migration review (Prisma schema changes)
- Cross-platform compatibility (Windows, macOS, Linux)
- Security considerations (path sanitization, subprocess security)

**5. /changelog - Version Tracking**

- Standard changelog format (Added, Changed, Fixed, etc.)
- Tracks major dependency versions (Electron, Python, Node.js)
- Tracks hardware SDK versions (Basler Pylon, NI-DAQmx)
- Documents breaking changes and migration paths

### Specialized Commands (6 new commands)

**6. /hardware-testing - Hardware Integration Testing**

- **What it does:** Explains when to use mock vs. real hardware, how to run camera/DAQ/scanner tests
- **Commands:** `npm run test:camera`, `npm run test:daq`, `npm run test:scanner`
- **Mock hardware:** How CI uses mock camera/DAQ for testing without physical devices
- **Real hardware:** How to test with actual Basler cameras and NI-DAQ devices
- **Troubleshooting:** Camera enumeration, DAQ device detection, SDK installation verification

**7. /python-bundling - PyInstaller Troubleshooting**

- **What it does:** Guides through Python executable building and common PyInstaller issues
- **Commands:** `npm run build:python`, how to test bundled executable
- **Troubleshooting:** "Module not found" errors, missing hidden imports, DLL/dylib loading issues
- **Adding dependencies:** How to update pyproject.toml and main.spec when adding Python packages
- **Platform-specific issues:** Windows DLL paths, macOS code signing, Linux shared libraries

**8. /database-migration - Prisma Migration Workflows**

- **What it does:** Guides through creating and testing Prisma database migrations
- **Commands:** `npm run prisma:migrate`, `npm run prisma:generate`, `npm run prisma:studio`
- **Testing migrations:** Dev database, packaged app database, data migration scripts
- **Rollback procedures:** How to revert migrations, backup strategies
- **Production considerations:** User data location (`~/.bloom/data/`), migration in packaged apps

**9. /integration-testing - Integration Test Guide**

- **What it does:** Explains the different integration test types and when to use each
- **Test types:**
  - IPC communication (TypeScript ↔ Python subprocess)
  - Camera integration (with mock camera)
  - DAQ integration (with mock DAQ)
  - Scanner workflow (full mock workflow)
  - Database persistence (scanner-database integration)
  - Packaged app verification
- **Commands:** `npm run test:ipc`, `npm run test:camera`, `npm run test:daq`, etc.
- **Debugging:** Python subprocess logs, IPC message inspection, database state inspection

**10. /packaging - Electron Packaging and Distribution**

- **What it does:** Guides through creating distributable packages and installers
- **Commands:** `npm run package`, `npm run make`, `npm run test:package`
- **Packaging checklist:** Python executable built, Prisma binaries external to ASAR, database migrations included
- **Platform-specific:** macOS code signing/notarization, Windows Squirrel installer, Linux AppImage/deb/rpm
- **Troubleshooting:** ASAR extraction issues, Python executable permissions, resource loading

**11. /e2e-testing - Playwright E2E Testing**

- **What it does:** Guides through running and writing Playwright E2E tests
- **Commands:** `npm run test:e2e`, `npm run test:e2e:ui`, `npm run test:e2e:debug`
- **Writing tests:** Electron-specific selectors, hardware mock integration, database state setup
- **CI vs. local:** Headless mode (CI), interactive mode (local), screenshot testing
- **Debugging:** Playwright Inspector, test artifacts, screenshots on failure

## Benefits

1. **Faster onboarding** - New developers can run `/lint` or `/hardware-testing` to discover workflows instantly
2. **Consistent quality** - `/pr-description` ensures all PRs include necessary testing and verification steps
3. **Reduced debugging time** - `/python-bundling` provides step-by-step PyInstaller troubleshooting
4. **Better code reviews** - `/review-pr` checklist ensures reviewers check Electron, Python, and hardware concerns
5. **Improved testing** - `/integration-testing` and `/e2e-testing` clarify when and how to run different test suites
6. **Smoother releases** - `/packaging` documents Electron Forge workflows and platform-specific issues

## Implementation Approach

### Phase 1: Core Commands (Week 1)

Priority: High - Daily use commands

- `lint.md` - Used multiple times per day
- `coverage.md` - Used before every PR
- `pr-description.md` - Used for every PR
- `review-pr.md` - Used for every code review
- `changelog.md` - Used for releases and documentation

### Phase 2: Specialized Commands (Week 2-3)

Priority: Medium-High - Used for specific workflows

- `hardware-testing.md` - Used when working on camera/DAQ integration
- `python-bundling.md` - Used when PyInstaller issues occur or dependencies change
- `database-migration.md` - Used when schema changes needed
- `integration-testing.md` - Used when debugging test failures
- `packaging.md` - Used before releases or when testing packaged app
- `e2e-testing.md` - Used when writing or debugging E2E tests

### Validation Strategy

Each command will be:

1. Tested with real workflows (run all commands, verify outputs match documentation)
2. Reviewed for accuracy (command syntax, file paths, npm script names)
3. Validated against CI pipeline (`.github/workflows/pr-checks.yml`)
4. Cross-referenced with existing docs (`docs/`, `python/PYINSTALLER.md`, `README.md`)

## Command Format

Each command file will follow this structure:

````markdown
# [Command Name]

[1-2 sentence description of what this command helps with]

## Commands

```bash
# Specific commands to run
npm run <command>
```
````

## What to do after running

1. [Step-by-step guidance]
2. [Common next actions]

## Troubleshooting (if applicable)

[Common issues and solutions]

## Related Commands

- /[related-command] - [when to use it]

```

## Risks and Mitigations

**Risk 1: Commands become stale as project evolves**
- **Mitigation:** Commands reference package.json scripts (single source of truth)
- **Mitigation:** Add "Last updated" dates and version information
- **Mitigation:** Link to authoritative sources (pyproject.toml, CI workflows)

**Risk 2: Overwhelming number of commands**
- **Mitigation:** Organize by frequency of use (core commands vs. specialized)
- **Mitigation:** Cross-reference related commands
- **Mitigation:** `/help` lists all commands with brief descriptions

**Risk 3: Duplicating existing documentation**
- **Mitigation:** Commands provide quick reference, link to detailed docs for deep dives
- **Mitigation:** Focus on "how to" workflows, not architectural explanations

**Risk 4: Command maintenance burden**
- **Mitigation:** Commands are short (50-200 lines each)
- **Mitigation:** Most commands just document existing npm scripts
- **Mitigation:** Validation can be automated (test command syntax)

## Success Criteria

1. ✅ **Discoverable:** All commands listed and described in Claude's command palette
2. ✅ **Accurate:** All command syntax works as documented, all npm scripts exist
3. ✅ **Useful:** Developers use commands instead of searching docs/code for common tasks
4. ✅ **Quality improvement:** PRs using `/pr-description` template have complete testing checklists
5. ✅ **Faster onboarding:** New developers can run linting/testing without asking team members

## Alternatives Considered

### Alternative 1: Just improve README.md
**Pros:** Single location for all documentation
**Cons:**
- README becomes overwhelming with all workflow details
- Not task-oriented (hard to find "how do I run linting?")
- Not integrated into Claude workflow

### Alternative 2: Keep all docs in docs/ directory
**Pros:** Documentation accessible without Claude
**Cons:**
- Less discoverable (requires knowing which doc file to read)
- Not command-oriented (docs explain concepts, not quick workflows)
- Separate from development workflow

### Alternative 3: Only create specialized commands (skip basic lint/test/PR commands)
**Pros:** Less work, focus on unique bloom-desktop needs
**Cons:**
- Misses opportunity for standardized basic workflows
- Developers still discover linting/testing/PR process independently
- Inconsistent quality across contributions

**Decision:** Proceed with full 11-command implementation for comprehensive workflow coverage.

## Open Questions

1. **Should we include Windows-specific troubleshooting in each command?**
   - Recommendation: Yes for commands where Windows differs (python-bundling, packaging)
   - Rationale: Windows CI tests are critical, developers need Windows-specific guidance

2. **How detailed should command output examples be?**
   - Recommendation: Include both success and common error examples
   - Focus on: pytest coverage failures, PyInstaller import errors, Playwright timeouts

3. **Should commands include troubleshooting sections?**
   - Recommendation: Yes for complex workflows (python-bundling, packaging, e2e-testing)
   - Rationale: These workflows have frequent issues that need quick resolution

4. **Do we need a /setup command for initial environment setup?**
   - Recommendation: Out of scope for this proposal
   - Rationale: README.md already covers setup; can be added later if needed

## Related Work

- **openspec/AGENTS.md** - Existing OpenSpec workflow commands (proposal, apply, archive)
- **docs/** directory - Detailed documentation that commands will reference
- **python/PYINSTALLER.md** - PyInstaller guide that python-bundling command will reference
- **.github/workflows/pr-checks.yml** - CI pipeline that commands will align with
- **package.json** - npm scripts that commands will document
- **pyproject.toml** - Python configuration that commands will reference

## Next Steps

1. ✅ Create `openspec/changes/add-claude-commands/proposal.md` (this document)
2. Create `openspec/changes/add-claude-commands/tasks.md` with implementation checklist
3. Validate proposal structure
4. Get approval from team
5. Implement Phase 1 (core commands)
6. Implement Phase 2 (specialized commands)
7. Test all commands with real workflows
8. Update README.md to mention Claude commands
```
