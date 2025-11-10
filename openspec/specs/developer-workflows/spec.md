# developer-workflows Specification

## Purpose

TBD - created by archiving change add-claude-commands. Update Purpose after archive.

## Requirements

### Requirement: Linting and Formatting Command

The system SHALL provide a `/lint` command that documents all linting and formatting workflows for TypeScript and Python code.

#### Scenario: Developer runs lint command for guidance

- **GIVEN** a developer wants to lint their code
- **WHEN** they invoke `/lint` command in Claude
- **THEN** the command SHALL display TypeScript linting commands (`npm run lint`, `npm run format`)
- **AND** SHALL display Python linting commands (`uv run black`, `uv run ruff`, `uv run mypy`)
- **AND** SHALL provide troubleshooting guidance for common issues

#### Scenario: Command references correct configuration files

- **GIVEN** the `/lint` command documentation
- **WHEN** a developer needs to understand linting configuration
- **THEN** the command SHALL reference `.eslintrc.json` for ESLint configuration
- **AND** SHALL reference `.prettierrc.json` for Prettier configuration
- **AND** SHALL reference `pyproject.toml` for Python linting configuration

### Requirement: Test Coverage Command

The system SHALL provide a `/coverage` command that documents test coverage workflows for TypeScript, Python, integration, and E2E tests.

#### Scenario: Developer checks TypeScript coverage

- **GIVEN** a developer wants to check TypeScript test coverage
- **WHEN** they invoke `/coverage` command
- **THEN** the command SHALL document `npm run test:unit:coverage` command
- **AND** SHALL specify 50% minimum coverage threshold for TypeScript
- **AND** SHALL explain how to view HTML coverage reports

#### Scenario: Developer checks Python coverage

- **GIVEN** a developer wants to check Python test coverage
- **WHEN** they invoke `/coverage` command
- **THEN** the command SHALL document `npm run test:python` command
- **AND** SHALL specify 80% minimum coverage threshold for Python
- **AND** SHALL explain how coverage is enforced in CI

### Requirement: PR Description Template Command

The system SHALL provide a `/pr-description` command that provides a standardized PR template with testing checklists.

#### Scenario: Developer creates PR with template

- **GIVEN** a developer is ready to create a PR
- **WHEN** they invoke `/pr-description` command
- **THEN** the command SHALL provide a markdown template with Summary, Changes, Testing sections
- **AND** SHALL include TypeScript unit test checklist
- **AND** SHALL include Python unit test checklist
- **AND** SHALL include integration test checklist (IPC, camera, DAQ, scanner)
- **AND** SHALL include E2E test checklist
- **AND** SHALL include Python build verification step
- **AND** SHALL include database migration checklist (if applicable)

#### Scenario: Template includes GitHub CLI commands

- **GIVEN** the `/pr-description` command output
- **WHEN** a developer wants to create a PR via CLI
- **THEN** the command SHALL document `gh pr create` command examples
- **AND** SHALL document `gh pr edit` command examples

### Requirement: Code Review Checklist Command

The system SHALL provide a `/review-pr` command that provides a comprehensive code review checklist covering Electron, Python, and hardware concerns.

#### Scenario: Reviewer uses checklist for code review

- **GIVEN** a reviewer is reviewing a PR
- **WHEN** they invoke `/review-pr` command
- **THEN** the command SHALL provide code quality checklist (naming, types, error handling)
- **AND** SHALL provide architecture checklist (IPC patterns, subprocess management)
- **AND** SHALL provide Electron-specific checklist (ASAR packaging, resource paths)
- **AND** SHALL provide Python bundling checklist (PyInstaller hidden imports, metadata)
- **AND** SHALL provide hardware integration checklist (mock hardware, error handling)
- **AND** SHALL provide database migration checklist (schema changes, backwards compatibility)
- **AND** SHALL provide cross-platform compatibility checklist
- **AND** SHALL provide security checklist (path sanitization, subprocess security)

### Requirement: Changelog Command

The system SHALL provide a `/changelog` command that documents version tracking and changelog format.

#### Scenario: Developer adds changelog entry

- **GIVEN** a developer has completed a feature
- **WHEN** they invoke `/changelog` command
- **THEN** the command SHALL document standard changelog format (Added, Changed, Fixed, etc.)
- **AND** SHALL provide examples of good changelog entries
- **AND** SHALL document tracking of dependency versions (Electron, Python, Node.js)
- **AND** SHALL document tracking of hardware SDK versions (Basler Pylon, NI-DAQmx)

### Requirement: Hardware Testing Command

The system SHALL provide a `/hardware-testing` command that documents mock vs. real hardware testing workflows.

#### Scenario: Developer runs camera integration test

- **GIVEN** a developer wants to test camera integration
- **WHEN** they invoke `/hardware-testing` command
- **THEN** the command SHALL document `npm run test:camera` for mock camera testing
- **AND** SHALL explain when to use mock hardware (CI) vs. real hardware (local)
- **AND** SHALL document camera setup verification steps
- **AND** SHALL provide troubleshooting for camera connection issues

#### Scenario: Developer runs DAQ integration test

- **GIVEN** a developer wants to test DAQ integration
- **WHEN** they invoke `/hardware-testing` command
- **THEN** the command SHALL document `npm run test:daq` for mock DAQ testing
- **AND** SHALL explain NI-DAQmx setup requirements
- **AND** SHALL provide troubleshooting for DAQ device detection

#### Scenario: Developer runs full scanner workflow test

- **GIVEN** a developer wants to test complete scanner workflow
- **WHEN** they invoke `/hardware-testing` command
- **THEN** the command SHALL document `npm run test:scanner` for full mock workflow
- **AND** SHALL document `npm run test:scanner-database` for database integration testing

### Requirement: Python Bundling Command

The system SHALL provide a `/python-bundling` command that documents PyInstaller workflows and troubleshooting.

#### Scenario: Developer builds Python executable

- **GIVEN** a developer needs to build Python executable
- **WHEN** they invoke `/python-bundling` command
- **THEN** the command SHALL document `npm run build:python` command
- **AND** SHALL explain PyInstaller bundling process (main.spec, hiddenimports, datas)

#### Scenario: Developer troubleshoots module not found error

- **GIVEN** PyInstaller build fails with "Module not found" error
- **WHEN** developer consults `/python-bundling` command
- **THEN** the command SHALL provide troubleshooting steps for missing hidden imports
- **AND** SHALL explain how to add hidden imports to `python/main.spec`
- **AND** SHALL explain how to add package metadata with `copy_metadata()`

#### Scenario: Developer adds new Python dependency

- **GIVEN** a developer adds a new Python package
- **WHEN** they invoke `/python-bundling` command
- **THEN** the command SHALL document updating `pyproject.toml`
- **AND** SHALL document updating `python/main.spec` if package requires hidden imports
- **AND** SHALL reference `python/PYINSTALLER.md` for detailed guidance

### Requirement: Database Migration Command

The system SHALL provide a `/database-migration` command that documents Prisma migration workflows.

#### Scenario: Developer creates new migration

- **GIVEN** a developer has modified Prisma schema
- **WHEN** they invoke `/database-migration` command
- **THEN** the command SHALL document `npm run prisma:migrate` command
- **AND** SHALL explain migration naming conventions
- **AND** SHALL document testing migration in dev database

#### Scenario: Developer generates Prisma client

- **GIVEN** Prisma schema has changed
- **WHEN** developer needs to regenerate client
- **THEN** the `/database-migration` command SHALL document `npm run prisma:generate` command

#### Scenario: Developer views database with Prisma Studio

- **GIVEN** a developer wants to inspect database contents
- **WHEN** they invoke `/database-migration` command
- **THEN** the command SHALL document `npm run prisma:studio` command for dev database
- **AND** SHALL document `npm run studio:production` command for production database

### Requirement: Integration Testing Command

The system SHALL provide an `/integration-testing` command that documents all integration test types and their purposes.

#### Scenario: Developer runs IPC integration test

- **GIVEN** a developer wants to test IPC communication
- **WHEN** they invoke `/integration-testing` command
- **THEN** the command SHALL document `npm run test:ipc` command
- **AND** SHALL explain what IPC test verifies (TypeScript ↔ Python subprocess communication)

#### Scenario: Developer runs all integration tests

- **GIVEN** a developer wants to run all integration tests
- **WHEN** they consult `/integration-testing` command
- **THEN** the command SHALL list all integration test commands:
  - `test:ipc` for IPC communication
  - `test:camera` for camera interface
  - `test:daq` for DAQ interface
  - `test:scanner` for scanner workflow
  - `test:scanner-database` for database persistence
  - `test:package` for packaged app verification

#### Scenario: Developer debugs failing integration test

- **GIVEN** an integration test is failing
- **WHEN** developer needs debugging guidance
- **THEN** the `/integration-testing` command SHALL document how to view Python subprocess logs
- **AND** SHALL document how to inspect IPC messages
- **AND** SHALL document how to inspect database state

### Requirement: Packaging Command

The system SHALL provide a `/packaging` command that documents Electron Forge packaging and distribution.

#### Scenario: Developer creates distributable package

- **GIVEN** a developer wants to create distributable
- **WHEN** they invoke `/packaging` command
- **THEN** the command SHALL document `npm run package` command
- **AND** SHALL provide packaging checklist (Python built, Prisma external to ASAR, migrations included)

#### Scenario: Developer creates platform-specific installer

- **GIVEN** a developer wants to create installer
- **WHEN** they invoke `/packaging` command
- **THEN** the command SHALL document `npm run make` command
- **AND** SHALL explain platform-specific packaging (macOS signing, Windows installer, Linux formats)

#### Scenario: Developer troubleshoots packaged app

- **GIVEN** packaged app fails to run
- **WHEN** developer consults `/packaging` command
- **THEN** the command SHALL provide troubleshooting for ASAR extraction issues
- **AND** SHALL provide troubleshooting for Python executable permissions
- **AND** SHALL provide troubleshooting for resource loading failures

### Requirement: E2E Testing Command

The system SHALL provide an `/e2e-testing` command that documents Playwright E2E testing workflows.

#### Scenario: Developer runs E2E tests

- **GIVEN** a developer wants to run E2E tests
- **WHEN** they invoke `/e2e-testing` command
- **THEN** the command SHALL document `npm run test:e2e` for standard execution
- **AND** SHALL document `npm run test:e2e:ui` for interactive mode
- **AND** SHALL document `npm run test:e2e:debug` for debug mode

#### Scenario: Developer writes new E2E test

- **GIVEN** a developer is writing new E2E test
- **WHEN** they consult `/e2e-testing` command
- **THEN** the command SHALL provide guidance on Electron-specific selectors
- **AND** SHALL explain database setup requirements
- **AND** SHALL explain hardware mock integration

#### Scenario: Developer debugs failing E2E test

- **GIVEN** an E2E test is failing
- **WHEN** developer needs debugging guidance
- **THEN** the `/e2e-testing` command SHALL document Playwright Inspector usage
- **AND** SHALL document how to view test artifacts (screenshots, traces)
- **AND** SHALL explain CI vs. local testing differences (headless vs. interactive)
