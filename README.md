# bloom-desktop

Electron-react application for cylinder scanning and upload to bloom.

## Project Status

🚧 **In Active Migration** - This repository is being migrated from the [bloom-desktop-pilot](https://github.com/eberrigan/bloom-desktop-pilot/tree/benfica/add-testing) repository with comprehensive testing and FAIR principles.

See [Issue #1](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/1) for the full migration plan.

## Architecture

- **Frontend**: Electron + React + TypeScript
- **Backend**: Python (Basler Pylon cameras + NI-DAQ)
- **Database**: Prisma ORM + SQLite
- **Python Management**: uv + pyproject.toml
- **Distribution**: PyInstaller bundled with Electron
- **Build System**: Electron Forge + Webpack

## Prerequisites

- **Node.js**: >=18.0.0
- **npm**: >=8.0.0
- **Python**: >=3.11 (managed via uv)
- **uv**: Python package manager ([installation instructions](https://docs.astral.sh/uv/getting-started/installation/))

### Hardware Dependencies (for production use)

- **Basler Pylon SDK**: Required for camera interface
- **NI-DAQmx Runtime**: Required for data acquisition
- **SANE**: Required for GraviScan flatbed scanners (Linux)

## Project Structure

```
bloom-desktop/
├── src/
│   ├── main/             # Electron main process
│   │   ├── python-process.ts   # Python subprocess manager
│   │   ├── python-paths.ts     # Path resolution for Python executable
│   │   ├── database.ts         # Prisma database initialization
│   │   ├── database-handlers.ts # Database IPC handlers
│   │   └── preload.ts          # Preload script
│   ├── renderer/         # React renderer/UI
│   └── types/            # TypeScript type definitions
│       └── database.ts   # Database type definitions
├── python/               # Python hardware backend
│   ├── main.py          # Entry point (--ipc or interactive mode)
│   ├── ipc_handler.py   # IPC command routing
│   ├── hardware/        # Hardware interfaces (camera, DAQ)
│   ├── tests/           # Python unit tests (pytest)
│   ├── main.spec        # PyInstaller build configuration
│   └── PYINSTALLER.md   # PyInstaller troubleshooting guide
├── prisma/              # Database schema and migrations
│   ├── schema.prisma    # Prisma schema (pilot-compatible)
│   ├── migrations/      # Database migrations
│   └── seed.ts          # Seed script for test data
├── tests/
│   ├── integration/     # Integration tests
│   │   ├── test-ipc.ts        # Python ↔ TypeScript IPC test
│   │   └── test-package.ts    # Packaged app verification
│   └── unit/            # TypeScript unit tests
│       ├── path-sanitizer.test.ts # Path sanitization tests
│       └── database.test.ts       # Database operation tests
├── scripts/
│   └── build-python.js  # Python executable build script
├── out/                 # Packaged applications (generated)
├── dist/                # Python executable (generated)
├── package.json         # Node.js dependencies
├── pyproject.toml       # Python dependencies (uv)
├── forge.config.ts      # Electron Forge configuration
├── tsconfig.json        # TypeScript configuration
└── README.md
```

## Development Setup

### 1. Install Dependencies

```bash
# Install Node.js dependencies
npm install

# Install Python dependencies (once uv setup is complete)
# uv sync
```

### 2. Available Scripts

#### Development

```bash
# Start development server (full app)
npm start

# Start GraviScan mode
npm run start:app:graviscan

# Start GraviScan with mock hardware (no scanner required)
npm run start:app:graviscan:mock

# Start CylinderScan mode
npm run start:app:cylinderscan

# Lint TypeScript/JavaScript files
npm run lint

# Format code with Prettier
npm run format

# Check formatting without modifying
npm run format:check
```

#### Python Backend

```bash
# Build Python executable (PyInstaller)
npm run build:python

# Run Python unit tests
npm run test:python
```

**PyInstaller Documentation**: See [python/PYINSTALLER.md](python/PYINSTALLER.md) for:

- How the Python build process works
- Troubleshooting bundling issues
- Adding new Python dependencies
- Understanding module import paths

#### Database

```bash
# Generate Prisma Client (run after schema changes)
npm run prisma:generate

# Create and apply database migrations
npm run prisma:migrate

# Seed database with test data
npm run prisma:seed

# Open Prisma Studio (visual database browser)
npm run prisma:studio
```

For complete database documentation, see [docs/DATABASE.md](docs/DATABASE.md).

#### Testing

```bash
# Test Python IPC communication (builds Python if needed)
npm run test:ipc

# Test camera integration with mock camera
npm run test:camera

# Test DAQ integration with mock DAQ
npm run test:daq

# Test scanner integration with mock hardware
npm run test:scanner

# Test scanner-database integration
npm run test:scanner-database

# Test GraviScan IPC communication (mock)
npm run test:graviscan-ipc

# Test GraviScan interactive scanning
npm run test:graviscan-interactive

# GraviScan metadata validation (included in test:unit)
npx vitest run tests/unit/graviMetadataValidation.test.ts

# GraviScan TIFF metadata (included in test:python)
uv run pytest python/tests/test_tiff_metadata.py -v

# Test database initialization in dev mode
npm run test:dev:database

# Test database initialization in packaged app (run after npm run package)
npm run test:package:database

# Test packaged app (run after npm run package)
npm run test:package

# E2E tests (requires dev server running)
# Terminal 1: npm run start
# Terminal 2: npm run test:e2e
npm run test:e2e
```

**Testing Documentation**:

- **E2E**: See [docs/E2E_TESTING.md](docs/E2E_TESTING.md) for end-to-end testing instructions ⚠️ **Requires dev server**
- **Camera**: See [docs/CAMERA_TESTING.md](docs/CAMERA_TESTING.md) for camera testing instructions
- **DAQ**: See [docs/DAQ_TESTING.md](docs/DAQ_TESTING.md) for DAQ turntable testing instructions
- **Database**: See [docs/DATABASE.md](docs/DATABASE.md) for database testing instructions

#### Packaging & Distribution

```bash
# Package app for distribution (includes Python executable)
npm run package

# Create installers (includes Python executable)
npm run make

# GraviScan Linux packaging
npm run package:graviscan:linux

# GraviScan Linux installer
npm run make:graviscan:linux
```

#### App Mode Packaging

The `APP_MODE` environment variable controls how the app is packaged (configured in `forge.config.ts`):

| Mode | App Name | Product Name |
|------|----------|--------------|
| `full` (default) | bloom-desktop | Bloom Desktop |
| `graviscan` | bloom-graviscan | Bloom GraviScan |
| `cylinderscan` | bloom-cylinderscan | Bloom CylinderScan |

Each mode uses a different app name, product name, and icon. The codebase is shared across all modes.

**Important**: Bloom Desktop uses Prisma ORM, which requires special packaging configuration for Electron. Prisma's binary query engines cannot be bundled inside the ASAR archive and are copied to the `Resources/` directory using dynamic module loading. See [docs/PACKAGING.md](docs/PACKAGING.md) for detailed information on:

- How Prisma packaging works
- Troubleshooting packaged apps
- Platform-specific considerations

### 3. Script Details

| Script                          | Description                                       | Prerequisites   |
| ------------------------------- | ------------------------------------------------- | --------------- |
| `npm start`                     | Launch Electron app in development mode           | None            |
| `npm run build:python`          | Build Python executable with PyInstaller          | uv installed    |
| `npm run test:python`           | Run Python unit tests with pytest (80%+ coverage) | uv installed    |
| `npm run test:ipc`              | Integration test for Python ↔ TypeScript IPC     | Python built    |
| `npm run test:camera`           | Integration test for camera interface (mock)      | Python built    |
| `npm run test:daq`              | Integration test for DAQ interface (mock)         | Python built    |
| `npm run test:scanner`          | Integration test for scanner workflow (mock)      | Python built    |
| `npm run test:scanner-database` | Integration test for scanner-database persistence | Python built    |
| `npm run test:graviscan-ipc`    | GraviScan IPC integration test (mock)             | Python built    |
| `npm run test:graviscan-interactive` | GraviScan interactive scan test              | Python built    |
| `npm run test:dev:database`     | Test database initialization in dev mode          | Python built    |
| `npm run test:package:database` | Test database initialization in packaged app      | Package created |
| `npm run test:package`          | Verify Python bundled in packaged app             | Package created |
| `npm run package`               | Create distributable app bundle                   | Python built    |
| `npm run make`                  | Create platform-specific installers               | Python built    |
| `npm run package:graviscan:linux` | Package GraviScan for Linux x64                 | Python built    |
| `npm run make:graviscan:linux`  | Create GraviScan Linux installer                  | Python built    |
| `npm run start:app:graviscan`   | Launch GraviScan mode in dev                      | None            |
| `npm run start:app:graviscan:mock` | Launch GraviScan with mock hardware            | None            |
| `npm run start:app:cylinderscan` | Launch CylinderScan mode in dev                  | None            |
| `npm run lint`                  | Check TypeScript/JavaScript code style            | None            |
| `npm run format`                | Auto-format code with Prettier                    | None            |
| `npm run format:check`          | Check code formatting                             | None            |

## Migration from Pilot

This project is migrating code from the pilot repository in phases:

**Pilot structure → New structure:**

```
Pilot:                          New:
├── app/                     → ├── src/
│   ├── src/                →   ├── main/ (Electron main process)
│   ├── prisma/             →   └── renderer/ (React UI)
│   └── package.json        → ├── prisma/
├── pylon/                  → ├── python/pylon/
├── daq/                    → ├── python/daq/
└── test/                   → ├── tests/
                              └── package.json (root)
```

## Testing

### Test Coverage

- **TypeScript Unit Tests**: 48 tests (28 path sanitizer + 20 database)
- **Python Unit Tests**: 84.5% coverage (78 tests)
- **Integration Tests**: Python ↔ TypeScript IPC, camera, DAQ, packaged app verification
- **Target**: 80%+ coverage for all code

### Running Tests

```bash
# TypeScript unit tests (Vitest)
npm run test:unit

# Python unit tests (pytest)
npm run test:python

# Integration: Test IPC communication
npm run test:ipc

# Integration: Test camera interface
npm run test:camera

# Integration: Test DAQ interface
npm run test:daq

# Integration: Verify packaged app
npm run package
npm run test:package
```

### Test Output Examples

**Python Tests:**

```
============================= 78 passed, 6 warnings in 6.25s ========================
Coverage HTML written to dir htmlcov
Required test coverage of 80% reached. Total coverage: 84.50%
```

**IPC Test:**

```
[PASS] Python process started successfully
[PASS] Ping test passed
[PASS] Version test passed
[PASS] Hardware check test passed
```

**Package Test:**

```
[PASS] Package found
[PASS] Python executable found
[PASS] Python executable has correct permissions
[PASS] IPC commands functional: 3/3 tested
```

## Contributing

Please see migration issues in the [Issues](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues) tab. All PRs should:

- Include tests with 80%+ coverage
- Pass linting and formatting checks
- Reference the related issue number
- Follow the migration plan in Issue #1

## License

BSD-2-Clause - See [LICENSE](LICENSE) file for details.

## Links

- [Pilot Repository](https://github.com/eberrigan/bloom-desktop-pilot/tree/benfica/add-testing)
- [Migration Plan (Issue #1)](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/1)
- [Current Phase (Issue #2)](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/2)
