# Tasks: Add Claude Commands

## Phase 1: Core Development Commands

### Task 1: Create lint.md command

- [ ] Create `.claude/commands/lint.md`
- [ ] Document TypeScript linting commands (`npm run lint`, `npm run format`)
- [ ] Document Python linting commands (black, ruff, mypy via uv)
- [ ] Add "What to do after running" section
- [ ] Add troubleshooting for common lint/format issues
- [ ] Test all commands listed work correctly
- [ ] Cross-reference with `.prettierrc.json`, `.eslintrc.json`, `pyproject.toml`

**Validation:**

- Run `npm run lint` and verify output matches documentation
- Run `npm run format` and verify it formats files
- Run `uv run black --check python/` and verify Python formatting check
- Verify all file paths and command syntax are correct

### Task 2: Create coverage.md command

- [ ] Create `.claude/commands/coverage.md`
- [ ] Document TypeScript coverage (`npm run test:unit:coverage`)
- [ ] Document Python coverage (`npm run test:python`)
- [ ] Explain coverage goals (TypeScript 50%+, Python 80%+)
- [ ] Document integration test coverage expectations
- [ ] Add how to view coverage reports (HTML, terminal)
- [ ] Add troubleshooting for coverage failures

**Validation:**

- Run `npm run test:unit:coverage` and verify output matches documentation
- Run `npm run test:python` and verify coverage report generation
- Verify coverage thresholds documented match `vitest.config.ts` and `pyproject.toml`

### Task 3: Create pr-description.md command

- [ ] Create `.claude/commands/pr-description.md`
- [ ] Create PR description template with Summary, Changes, Testing sections
- [ ] Add TypeScript test checklist
- [ ] Add Python test checklist
- [ ] Add integration test checklist (IPC, camera, DAQ, scanner)
- [ ] Add E2E test checklist
- [ ] Add Python build verification step
- [ ] Add database migration checklist
- [ ] Add cross-platform compatibility notes
- [ ] Include GitHub CLI commands for creating/editing PRs

**Validation:**

- Use template to create a test PR and verify all sections make sense
- Verify all test commands referenced exist in package.json
- Test `gh pr create` command with template

### Task 4: Create review-pr.md command

- [ ] Create `.claude/commands/review-pr.md`
- [ ] Add code quality checklist (naming, types, error handling)
- [ ] Add architecture checklist (IPC patterns, subprocess management)
- [ ] Add Electron-specific checklist (ASAR, resource paths, main/renderer boundary)
- [ ] Add Python bundling checklist (hidden imports, metadata)
- [ ] Add hardware integration checklist (mock hardware, error handling)
- [ ] Add database migration checklist (schema changes, backwards compatibility)
- [ ] Add cross-platform compatibility checklist
- [ ] Add security checklist (path sanitization, subprocess security)
- [ ] Include GitHub CLI commands for reviewing PRs

**Validation:**

- Use checklist to review an existing merged PR
- Verify all items are clear and actionable
- Ensure items cover bloom-desktop-specific concerns

### Task 5: Create changelog.md command

- [ ] Create `.claude/commands/changelog.md`
- [ ] Document standard changelog format (Added, Changed, Fixed, etc.)
- [ ] Add section for tracking dependency versions (Electron, Python, Node)
- [ ] Add section for tracking hardware SDK versions (Pylon, NI-DAQmx)
- [ ] Document breaking changes format
- [ ] Add examples of good changelog entries
- [ ] Link to existing changelog file (if exists) or explain where to add entries

**Validation:**

- Verify format matches standard changelog conventions
- Check that all major dependencies are covered
- Test creating a sample changelog entry

## Phase 2: Specialized Commands

### Task 6: Create hardware-testing.md command

- [ ] Create `.claude/commands/hardware-testing.md`
- [ ] Document mock vs. real hardware testing
- [ ] List all hardware test commands (`test:camera`, `test:daq`, `test:scanner`, etc.)
- [ ] Explain when to use each test type
- [ ] Document CI behavior (uses mock hardware)
- [ ] Document local testing with real hardware
- [ ] Add hardware setup verification steps (SDK installation, device enumeration)
- [ ] Add troubleshooting section (camera not found, DAQ errors)
- [ ] Cross-reference with `docs/CAMERA_TESTING.md`, `docs/DAQ_TESTING.md`, `docs/SCANNER_TESTING.md`

**Validation:**

- Run `npm run test:camera` and verify mock camera test passes
- Run `npm run test:daq` and verify mock DAQ test passes
- Verify all commands listed exist in package.json
- Check cross-references to docs/ files are correct

### Task 7: Create python-bundling.md command

- [ ] Create `.claude/commands/python-bundling.md`
- [ ] Document `npm run build:python` command
- [ ] Explain PyInstaller bundling process (main.spec, hiddenimports, datas)
- [ ] Add troubleshooting for "Module not found" errors
- [ ] Add troubleshooting for missing hidden imports
- [ ] Add troubleshooting for DLL/dylib loading issues
- [ ] Document how to add new Python dependencies (pyproject.toml + main.spec)
- [ ] Add platform-specific sections (Windows DLL paths, macOS signing, Linux libs)
- [ ] Cross-reference with `python/PYINSTALLER.md`

**Validation:**

- Run `npm run build:python` and verify it builds successfully
- Verify troubleshooting steps match common issues from recent PRs
- Test that cross-reference to `python/PYINSTALLER.md` is correct

### Task 8: Create database-migration.md command

- [ ] Create `.claude/commands/database-migration.md`
- [ ] Document Prisma migration commands (`prisma:migrate`, `prisma:generate`, `prisma:studio`)
- [ ] Explain when to create migrations (schema changes)
- [ ] Document testing migrations in dev database
- [ ] Document testing migrations in packaged app
- [ ] Add rollback procedures
- [ ] Add data backup strategies
- [ ] Document production considerations (user data location, migration in packaged apps)
- [ ] Cross-reference with `docs/DATABASE.md`

**Validation:**

- Run `npm run prisma:studio` and verify it opens database browser
- Run `npm run prisma:generate` and verify Prisma client generation
- Verify all commands exist in package.json
- Check cross-reference to `docs/DATABASE.md` is correct

### Task 9: Create integration-testing.md command

- [ ] Create `.claude/commands/integration-testing.md`
- [ ] List all integration test types and their purposes
- [ ] Document IPC testing (`test:ipc`)
- [ ] Document camera testing (`test:camera`)
- [ ] Document DAQ testing (`test:daq`)
- [ ] Document scanner workflow testing (`test:scanner`)
- [ ] Document database integration testing (`test:scanner-database`)
- [ ] Document packaged app testing (`test:package`, `test:package:database`)
- [ ] Add debugging guidance (Python logs, IPC inspection, database state)
- [ ] Add CI vs. local testing notes

**Validation:**

- Run each integration test command and verify documentation matches behavior
- Verify all commands exist in package.json
- Test debugging steps work (can view Python logs, IPC messages)

### Task 10: Create packaging.md command

- [ ] Create `.claude/commands/packaging.md`
- [ ] Document packaging commands (`npm run package`, `npm run make`)
- [ ] Create packaging checklist (Python built, Prisma external to ASAR, migrations included)
- [ ] Document platform-specific packaging (macOS signing, Windows installer, Linux formats)
- [ ] Add troubleshooting section (ASAR extraction, Python permissions, resource loading)
- [ ] Document package testing commands
- [ ] Cross-reference with `docs/PACKAGING.md`

**Validation:**

- Run `npm run package` and verify it creates distributable
- Verify packaging checklist covers all critical items
- Check cross-reference to `docs/PACKAGING.md` is correct

### Task 11: Create e2e-testing.md command

- [ ] Create `.claude/commands/e2e-testing.md`
- [ ] Document E2E test commands (`test:e2e`, `test:e2e:ui`, `test:e2e:debug`)
- [ ] Explain Playwright setup for Electron
- [ ] Document writing E2E tests (selectors, assertions, database setup)
- [ ] Add debugging guidance (Playwright Inspector, artifacts, screenshots)
- [ ] Document CI vs. local testing (headless vs. interactive)
- [ ] Cross-reference with `docs/E2E_TESTING.md`

**Validation:**

- Run `npm run test:e2e` and verify E2E tests execute
- Run `npm run test:e2e:ui` and verify interactive mode works
- Verify all commands exist in package.json
- Check cross-reference to `docs/E2E_TESTING.md` is correct

## Phase 3: Documentation and Integration

### Task 12: Update README.md

- [ ] Add "Claude Commands" section to README.md
- [ ] List all available commands with brief descriptions
- [ ] Link to `.claude/commands/` directory
- [ ] Explain how to use commands (slash command in Claude)

**Validation:**

- Verify README.md section is clear and accurate
- Test that all command names listed match actual files

### Task 13: Create .claude/commands/README.md

- [ ] Create `.claude/commands/README.md`
- [ ] List all commands with descriptions
- [ ] Organize by category (Core, Specialized)
- [ ] Add usage instructions
- [ ] Add contribution guidelines for adding new commands

**Validation:**

- Verify all commands are listed
- Check that descriptions match individual command files

### Task 14: Validation and Testing

- [ ] Test all commands with real workflows
- [ ] Verify all npm scripts referenced exist
- [ ] Verify all file paths are correct
- [ ] Verify all cross-references to docs/ are valid
- [ ] Run a sample workflow using multiple commands (/lint → /coverage → /pr-description)
- [ ] Get feedback from team on command usefulness

**Validation:**

- Create test PR using commands and verify workflow works end-to-end
- Verify no broken links or incorrect paths
- Confirm commands save time vs. manual documentation searching

## Rollout Plan

### Week 1: Phase 1 (Core Commands)

- Days 1-2: Tasks 1-2 (lint, coverage)
- Days 3-4: Tasks 3-4 (pr-description, review-pr)
- Day 5: Task 5 (changelog)
- **Milestone:** Core development commands available

### Week 2: Phase 2 Part 1 (Hardware & Python)

- Days 1-2: Tasks 6-7 (hardware-testing, python-bundling)
- Days 3-4: Tasks 8-9 (database-migration, integration-testing)
- **Milestone:** Specialized bloom-desktop commands available

### Week 3: Phase 2 Part 2 (Packaging & E2E)

- Days 1-2: Tasks 10-11 (packaging, e2e-testing)
- Days 3-5: Tasks 12-14 (documentation, validation, testing)
- **Milestone:** All commands complete and validated

## Success Metrics

- [ ] All 11 commands created and functional
- [ ] All commands tested with real workflows
- [ ] README.md updated with command documentation
- [ ] At least 3 team members have tried commands and provided feedback
- [ ] Commands used in at least 2 PRs successfully
- [ ] Zero broken links or incorrect command syntax
