# Project Context

## Purpose

Bloom Desktop is an Electron-based desktop application for **cylinder scanning and upload to Bloom** - a plant phenotyping system developed by the Salk Harnessing Plants Initiative. The application:

- Controls Basler Pylon cameras for capturing plant images
- Interfaces with NI-DAQ hardware for turntable rotation control
- Manages experimental metadata and scan records via SQLite database
- Provides a React-based UI for scientists and phenotypers
- Packages Python hardware drivers with an Electron desktop app

**Current Status**: Active migration from [bloom-desktop-pilot](https://github.com/eberrigan/bloom-desktop-pilot) with emphasis on comprehensive testing, FAIR principles, and maintainability.

## Tech Stack

### Frontend

- **Electron** 28.2.2 - Desktop application framework
- **React** 18.3.1 - UI library with React Router for navigation
- **TypeScript** 5.4.0 - Type-safe JavaScript
- **Tailwind CSS** 3.4.1 - Utility-first CSS framework
- **Webpack** - Module bundler (via Electron Forge)

### Backend & Hardware

- **Python** >=3.11 - Hardware control layer
- **PyInstaller** - Python executable bundling
- **uv** - Fast Python package manager
- **Basler Pylon SDK** - Camera interface (pypylon)
- **NI-DAQmx** - Data acquisition for turntable control

### Database

- **Prisma** 6.18.0 - ORM with type-safe query builder
- **SQLite** - Embedded database
- **Schema**: 100% compatible with bloom-desktop-pilot for data migration

### Testing

- **Vitest** - TypeScript unit tests (target: 50%+ coverage)
- **pytest** - Python unit tests (enforced: 80%+ coverage)
- **Playwright** - End-to-end testing
- **@testing-library/react** - React component testing
- **Integration tests** - IPC, camera, DAQ, scanner, packaged app verification

### Development Tools

- **ESLint** - TypeScript/JavaScript linting
- **Prettier** - Code formatting (enforced via pre-commit)
- **black** - Python code formatting
- **ruff** - Python linting
- **mypy** - Python type checking
- **Electron Forge** - Build, package, and distribution

### CI/CD

- **GitHub Actions** - PR checks across Linux, macOS, Windows
- **Multi-platform testing** - Integration and E2E tests on all platforms
- **Automated checks** - Linting, formatting, compilation, unit tests, integration tests

## Project Conventions

### Code Style

**TypeScript/JavaScript**:

- **Prettier** configuration (`.prettierrc.json`):
  - Semicolons: required
  - Single quotes: preferred
  - Trailing commas: ES5
  - Print width: 80 characters
  - Tab width: 2 spaces (spaces, not tabs)
- **ESLint** extends:
  - `eslint:recommended`
  - `@typescript-eslint/recommended`
  - `plugin:import/recommended`
  - `prettier` (ensures no conflicts)
- **TypeScript compiler** (`tsconfig.json`):
  - Target: ES2021
  - Module: CommonJS
  - Strict: `noImplicitAny: true`
  - JSX: `react-jsx`

**Python**:

- **black** - Automatic formatting (enforced in CI)
- **ruff** - Fast linting
- **mypy** - Type checking with type hints
- Coverage target: 80%+ (enforced in `pyproject.toml`)

**Naming Conventions**:

- Files: kebab-case (e.g., `python-process.ts`, `database-handlers.ts`)
- React components: PascalCase (e.g., `App.tsx`)
- Functions/variables: camelCase
- Constants: UPPER_SNAKE_CASE
- Database tables: PascalCase (Prisma models)
- IPC channels: Use descriptive names (e.g., `database:createScan`)

### Architecture Patterns

**Electron Architecture**:

```
┌─────────────────────────────────────────┐
│          Renderer Process               │
│  (React UI - src/renderer/)             │
└──────────────┬──────────────────────────┘
               │ IPC (contextBridge)
               ▼
┌─────────────────────────────────────────┐
│          Main Process                   │
│  (Node.js - src/main/)                  │
│  ├─ Python subprocess manager           │
│  ├─ Database handlers (Prisma)          │
│  └─ IPC handlers                        │
└──────────────┬──────────────────────────┘
               │ stdio/IPC
               ▼
┌─────────────────────────────────────────┐
│       Python Process                    │
│  (Hardware control - python/)           │
│  ├─ Basler Pylon camera driver          │
│  ├─ NI-DAQ turntable control            │
│  └─ IPC command routing                 │
└─────────────────────────────────────────┘
```

**Key Design Decisions**:

1. **Python as subprocess**: Hardware drivers run in separate Python process, managed by TypeScript
2. **Prisma outside ASAR**: Binary query engines extracted to `Resources/` directory (see `docs/PACKAGING.md`)
3. **Mock hardware for CI**: All integration tests use mock hardware for cross-platform CI
4. **Database in main process**: Prisma Client runs in main process, IPC handlers expose to renderer
5. **Path sanitization**: All file paths validated and sanitized before use
6. **Environment-based database paths**:
   - Development: `~/.bloom/dev.db` (outside project for persistence across branches)
   - Production: `~/.bloom/data/bloom.db`
   - E2E tests: `tests/e2e/test.db`

**Module Organization**:

- `src/main/` - Electron main process (Node.js)
- `src/renderer/` - React UI
- `src/types/` - Shared TypeScript type definitions
- `python/` - Python hardware backend
- `python/hardware/` - Camera and DAQ interfaces
- `prisma/` - Database schema and migrations
- `tests/` - All test files (unit, integration, E2E)

### Testing Strategy

**Test Pyramid**:

1. **Unit Tests** (foundation):
   - **TypeScript**: Vitest with happy-dom (50%+ coverage target)
   - **Python**: pytest with mock hardware (80%+ coverage enforced)
   - Run on every PR in CI (Linux only for speed)

2. **Integration Tests** (middle):
   - IPC communication between TypeScript ↔ Python
   - Camera interface with mock camera
   - DAQ interface with mock DAQ
   - Scanner workflow end-to-end
   - Scanner-database persistence
   - Run on Linux, macOS, Windows in CI

3. **E2E Tests** (top):
   - Playwright tests with real Electron app
   - Tests both webpack dev build and packaged app
   - Run on Linux, macOS, Windows in CI
   - Database initialization and basic workflows

**Mock Hardware**:

- All CI tests use mock hardware (no real cameras/DAQ)
- Real hardware tests documented in `docs/` (manual execution)
- Mock camera: Generates test images
- Mock DAQ: Simulates turntable control

**Coverage Requirements**:

- Python: 80%+ (enforced by pytest-cov in CI, will fail if below)
- TypeScript: 50%+ (enforced by Vitest in CI)
- Integration: All critical paths tested (IPC, hardware, database)

**Test Execution**:

```bash
# Unit tests (fast)
npm run test:unit         # TypeScript (Vitest)
npm run test:python       # Python (pytest with coverage)

# Integration tests (requires Python build)
npm run test:ipc          # IPC communication
npm run test:camera       # Camera interface
npm run test:daq          # DAQ interface
npm run test:scanner      # Scanner workflow
npm run test:scanner-database  # Database persistence

# E2E tests
npm run test:e2e          # Playwright E2E
npm run test:e2e:ui       # Playwright UI mode
npm run test:e2e:debug    # Playwright debug mode

# Package tests (requires packaging)
npm run package
npm run test:package:database
```

**CI Workflow** (`.github/workflows/pr-checks.yml`):

- **Linting**: ESLint, Prettier (TypeScript), black, ruff, mypy (Python)
- **Compilation**: TypeScript type checking
- **Unit tests**: Vitest + pytest with coverage
- **Integration tests**: Cross-platform (Linux, macOS, Windows)
- **E2E tests**: Playwright on all platforms
- **Package tests**: Database initialization (macOS only)
- **Summary job**: All checks must pass to merge

### Git Workflow

**Branching Strategy**:

- **Main branch**: `main` (protected, requires PR)
- **Feature branches**: `<username>/<feature-name>` (e.g., `elizabeth/playwright-e2e-testing`)
- **No direct commits** to main

**PR Requirements**:

- All CI checks must pass (linting, tests, coverage)
- Code must be formatted (Prettier/black)
- Tests required for new features (80%+ Python, 50%+ TypeScript)
- Reference related issue number
- Follow migration plan from [Issue #1](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/1)

**Commit Conventions**:

- Use descriptive commit messages
- Reference issue numbers when applicable
- Group related changes in single commits

**Migration Context**:

- Currently migrating from [bloom-desktop-pilot](https://github.com/eberrigan/bloom-desktop-pilot/tree/benfica/add-testing)
- Maintaining 100% database schema compatibility
- Phased migration approach in 6 phases (see [Issue #1](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/1))
- **Current Phase**: Phase 1 foundation work mostly complete, Phase 2-3 hardware integration in progress

**Active Development Areas** (check [GitHub Issues](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues) for latest):

- Database testing improvements (#55, #56, #57, #58)
- Machine configuration UI (#49)
- Per-experiment camera settings (#51)
- IPC race condition fixes (#47)
- Scan preview page (#46)

## Domain Context

**Plant Phenotyping**:

- **Phenotyping**: Measuring observable characteristics of plants (growth, morphology, color, etc.)
- **Cylinder scanning**: Rotating plants on turntable while capturing images from fixed camera
- **Turntable control**: NI-DAQ hardware controls stepper motor for precise rotation
- **Frame capture**: Basler Pylon cameras capture high-resolution images at specific angles

**Domain Entities**:

- **Scientist**: Researchers who design experiments
- **Phenotyper**: Operators who perform scans
- **Experiment**: Collection of scans for specific research question
- **Accession**: Plant genetic line/variety
- **Scan**: Single plant imaging session with metadata
- **Image**: Individual frame from a scan

**Workflow**:

1. Scientist creates experiment with metadata
2. Phenotyper selects experiment and enters plant barcode
3. System configures camera (exposure, gain, brightness, etc.)
4. Turntable rotates plant while camera captures frames
5. Scan metadata and images saved to database
6. Data uploaded to Bloom server for analysis

**Hardware Context**:

- **Basler Pylon cameras**: Industrial cameras for high-quality imaging
- **NI-DAQ**: National Instruments data acquisition for turntable control
- **Stepper motor**: Precise rotation control (seconds per rotation, wave number)
- **Scanner stations**: Multiple independent scanning setups

## Important Constraints

**Technical Constraints**:

- **Prisma packaging**: Binary query engines cannot run from ASAR archive - must be extracted to `Resources/` (see `docs/PACKAGING.md`)
- **Python bundling**: PyInstaller creates single executable, bundled as Electron extra resource
- **Platform compatibility**: Must support Linux, macOS, Windows
- **Node.js**: >=18.0.0 required
- **Python**: >=3.11 required (managed via uv)
- **Database compatibility**: Schema must remain 100% compatible with bloom-desktop-pilot for data migration

**Hardware Constraints**:

- **Basler Pylon SDK**: Required for production use (not in CI)
- **NI-DAQmx Runtime**: Required for production use (not in CI)
- **Mock hardware**: CI tests use mocks (no real hardware access)

**Testing Constraints**:

- **Coverage minimums**: Python 80%+, TypeScript 50%+
- **CI platforms**: Tests must pass on Linux, macOS, Windows
- **No hardware in CI**: All integration tests use mock hardware

**Migration Constraints**:

- **Pilot compatibility**: Database schema must match pilot for migration
- **Phased approach**: Features migrated incrementally (see Issue #1)
- **No breaking changes**: Must maintain compatibility during migration

**Business Constraints**:

- **FAIR principles**: Findable, Accessible, Interoperable, Reusable data
- **Research reproducibility**: Comprehensive metadata capture
- **License**: BSD-2-Clause (open source)

## External Dependencies

**Hardware SDKs**:

- **Basler Pylon SDK**: Camera interface (production only)
  - Python wrapper: `pypylon`
  - Documentation: [Basler Pylon](https://www.baslerweb.com/en/products/software/basler-pylon-camera-software-suite/)
- **NI-DAQmx Runtime**: Data acquisition (production only)
  - Python wrapper: `nidaqmx`
  - Documentation: [NI-DAQmx](https://www.ni.com/en-us/support/downloads/drivers/download.ni-daqmx.html)

**Python Package Management**:

- **uv**: Fast Python package manager
  - Installation: [uv docs](https://docs.astral.sh/uv/getting-started/installation/)
  - Configuration: `pyproject.toml`

**Related Systems**:

- **bloom-desktop-pilot**: Original prototype repository
  - URL: https://github.com/eberrigan/bloom-desktop-pilot
  - Relationship: Source of migration code and schema
- **Bloom server**: Backend system for data upload (not yet integrated)

**Development Services**:

- **GitHub Actions**: CI/CD platform
- **npm registry**: Node.js package distribution
- **PyPI**: Python package distribution (via uv)

**Key External APIs**:

- **Electron APIs**: Main/renderer IPC, native dialogs, file system
- **Node.js APIs**: Child processes (Python subprocess management), file system
- **Prisma Client**: Database queries (auto-generated from schema)

**Documentation References**:

- Database: `docs/DATABASE.md`
- Packaging: `docs/PACKAGING.md`
- Camera testing: `docs/CAMERA_TESTING.md`
- DAQ testing: `docs/DAQ_TESTING.md`
- Scanner testing: `docs/SCANNER_TESTING.md`
- Configuration: `docs/CONFIGURATION.md`
- Pilot compatibility: `docs/PILOT_COMPATIBILITY.md`
