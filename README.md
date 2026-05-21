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
# Start development server
npm start

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
```

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
| `npm run test:dev:database`     | Test database initialization in dev mode          | Python built    |
| `npm run test:package:database` | Test database initialization in packaged app      | Package created |
| `npm run test:package`          | Verify Python bundled in packaged app             | Package created |
| `npm run package`               | Create distributable app bundle                   | Python built    |
| `npm run make`                  | Create platform-specific installers               | Python built    |
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

## Environment variables (GraviScan production rig)

The GraviScan production rig reads two optional environment variables
from `~/.bloom/.env` to control wedge-handling behavior. Both are
deployed per-rig, not committed to git, and default to safe values when
absent.

| Variable | Default | Behavior |
|---|---|---|
| `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL` | unset | When set, the main process POSTs a structured message to this Slack webhook URL whenever the V600 WedgeDetector fires (#236). Rate-limited to 1 message per (scanner, session) per minute. Absent or empty ⇒ Slack notifications disabled. **SECRET — never commit a real value.** |
| `LIBUSB_ENDPOINT_RECOVERY` | `true` | Controls the `libusb_clear_halt()`-on-bulk-IN-timeout wrapper in the LD_PRELOAD shim (#228). The shim defends against epkowa's stuck-endpoint bug on V600 scanners. Only case-insensitive `false` disables; any other value (or unset) leaves it on. |

### Deploying

On a fresh Linux rig, install the build-time prerequisites once:

```bash
sudo apt install build-essential libusb-1.0-0-dev pkg-config
```

`build-essential` provides `gcc` (required by `npm run build:native`);
`libusb-1.0-0-dev` provides the headers + `.pc` file used by
`pkg-config --cflags --libs libusb-1.0`. Without these, the
LD_PRELOAD shim build silently skips on non-Linux but fails loudly on
Linux with a missing-tool message.

Note: this PR does NOT add any database schema columns or migrations.
Existing rigs do NOT need to run `npx prisma migrate deploy`.
A one-time `npx prisma generate` after pulling is enough to update
the generated client to pick up the schema's new doc-comments.

On the rig, append the two env-var lines to `~/.bloom/.env`:

```bash
BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T.../B.../...
LIBUSB_ENDPOINT_RECOVERY=true
```

Restart `bloom-graviscan`. At startup the main process hydrates
`process.env` from this file and propagates the values to the scan
worker subprocesses (LD_PRELOAD chain) and the Slack notifier.

`.env.example` carries placeholder lines so developers see the
canonical name and default; copy to your local `.env` if you want to
exercise the features in development.

### Verification

After deploy, confirm the shim log line appears on stderr of a
scan_worker subprocess: `[libusb-filter] endpoint recovery: on`. If
this is missing, the shim didn't load (check `LD_PRELOAD` env var
and that `libusb-filter.so` exists at the expected path).

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
