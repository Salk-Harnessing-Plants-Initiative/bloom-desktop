# Bloom Desktop - Project Structure

This document describes the organization of the Bloom Desktop codebase.

## Overview

```
bloom-desktop/
├── python/                      # Python backend (hardware control)
├── src/                         # TypeScript/Electron frontend
├── tests/                       # TypeScript tests
├── scripts/                     # Build and utility scripts
├── prisma/                      # Database schema (future use)
└── dist/                        # Build outputs
```

## Python Backend (`python/`)

Python backend for hardware control and IPC communication with Electron.

```
python/
├── __init__.py                  # Package version
├── main.py                      # Entry point (--ipc or interactive mode)
├── main.spec                    # PyInstaller configuration
├── ipc_handler.py               # IPC command routing
├── hardware/                    # Hardware interface modules
│   ├── __init__.py
│   ├── camera.py                # Basler camera (PyPylon)
│   ├── camera_mock.py           # Mock camera for testing
│   ├── daq.py                   # NI-DAQ rotation control
│   ├── daq_mock.py              # Mock DAQ for testing
│   └── README.md                # Hardware module documentation
└── tests/                       # Python unit tests
    ├── test_imports.py          # Dependency import tests
    ├── test_ipc_handler.py      # IPC protocol tests
    ├── test_main.py             # Main entry point tests
    ├── test_camera_commands.py  # Camera command handler tests
    └── hardware/                # Hardware module tests (future)
```

**Key Files:**

- `main.py` - Supports two modes: `--ipc` (for Electron) and interactive CLI
- `ipc_handler.py` - Routes commands from Electron to hardware modules
- `main.spec` - PyInstaller config, excludes tests from bundle

**Testing:**

```bash
npm run test:python              # Run Python unit tests
```

## TypeScript Frontend (`src/`)

Electron + React application for the UI and main process.

```
src/
├── main/                        # Electron main process
│   ├── main.ts                  # App entry point
│   ├── preload.ts               # Context bridge (exposes APIs to renderer)
│   ├── python-process.ts        # Base class for Python subprocesses
│   ├── python-paths.ts          # Python executable path resolution
│   ├── camera-process.ts        # Camera subprocess wrapper (Phase 3)
│   ├── daq-process.ts           # DAQ subprocess wrapper (Phase 3)
│   └── util.ts                  # Utility functions
├── renderer/                    # React renderer process
│   ├── index.tsx                # React entry point
│   ├── index.ejs                # HTML template
│   ├── App.tsx                  # Root component
│   ├── Home.tsx                 # Home page
│   ├── App.css                  # App styles
│   ├── index.css                # Global styles
│   └── components/              # React components (Phase 4+)
│       └── README.md            # Component guidelines
└── types/                       # TypeScript type definitions
    ├── electron.d.ts            # window.electron API types
    ├── camera.ts                # Camera interface types
    └── daq.ts                   # DAQ interface types
```

**Key Files:**

- `main/main.ts` - Electron app lifecycle, window management
- `main/preload.ts` - Exposes `window.electron` API to renderer
- `main/python-process.ts` - Manages Python subprocess, IPC protocol parsing
- `types/electron.d.ts` - TypeScript definitions for renderer API

## Tests (`tests/`)

TypeScript tests organized by type.

```
tests/
├── integration/                 # End-to-end integration tests
│   ├── test-ipc.ts              # Python ↔ TypeScript IPC test
│   ├── test-camera.ts           # Camera integration test
│   ├── test-package.ts          # Package verification test
│   └── test-capture.png         # Test image output
└── unit/                        # TypeScript unit tests (future)
    ├── README.md                # Testing guidelines
    └── setup.ts                 # Test setup
```

**Running Tests:**

```bash
npm run test:ipc                 # Python ↔ TypeScript IPC test
npm run test:camera              # Camera integration test
npm run test:package             # Package verification test
npm run test:unit                # Unit tests (future - Jest)
```

## Scripts (`scripts/`)

Build and utility scripts.

```
scripts/
└── build-python.js              # Builds Python executable with PyInstaller
```

**Usage:**

```bash
npm run build:python             # Build Python → dist/bloom-hardware
```

## Configuration Files

### Python Configuration

- `pyproject.toml` - Python dependencies, test config, linting (Black, Ruff, mypy)
- `uv.lock` - Locked Python dependencies (managed by uv)

### TypeScript/Node Configuration

- `package.json` - npm scripts, Node dependencies
- `package-lock.json` - Locked npm dependencies
- `tsconfig.json` - TypeScript compiler options
- `.eslintrc.json` - ESLint linting rules
- `.prettierrc.json` - Prettier formatting rules

### Electron Forge

- `forge.config.ts` - Electron Forge packaging configuration
- `webpack.main.config.ts` - Webpack config for main process
- `webpack.renderer.config.ts` - Webpack config for renderer process
- `webpack.rules.ts` - Webpack loaders
- `webpack.plugins.ts` - Webpack plugins

### Styling

- `tailwind.config.js` - Tailwind CSS configuration
- `postcss.config.js` - PostCSS configuration

## Build Outputs

```
dist/                            # Python executable (PyInstaller output)
├── bloom-hardware               # Bundled Python app (macOS/Linux)
└── bloom-hardware.exe           # Bundled Python app (Windows)

out/                             # Electron packaged app (electron-forge output)
├── bloom-desktop-darwin-*/      # macOS app bundle
├── bloom-desktop-win32-*/       # Windows app
└── bloom-desktop-linux-*/       # Linux app

build/                           # Intermediate build files (PyInstaller)
.webpack/                        # Webpack build output (Electron)
htmlcov/                         # Python test coverage report
```

## Development Workflow

### 1. Install Dependencies

```bash
# Node dependencies
npm install

# Python dependencies (uv automatically creates .venv)
npm run build:python
```

### 2. Development Mode

```bash
# Start Electron in dev mode
npm start

# In another terminal: rebuild Python if needed
npm run build:python
```

### 3. Run Tests

```bash
# Python tests
npm run test:python

# Integration tests
npm run test:ipc                 # IPC communication
npm run test:camera              # Camera functionality
npm run test:package             # Packaged app verification

# (Future) TypeScript unit tests
npm run test:unit
```

### 4. Build for Production

```bash
# Build Python executable
npm run build:python

# Package Electron app
npm run package

# Create installers
npm run make
```

## Phase Roadmap

### ✅ Phase 1: Foundation (Complete)

- Project structure
- Electron + React shell
- Python environment + PyInstaller

### ✅ Phase 2: IPC Foundation (Issue #12 Complete)

- Python IPC handler
- TypeScript PythonProcess manager
- Basic protocol (ping, get_version, check_hardware)

### ✅ Phase 3: Hardware Interfaces (Issues #14, #15 Complete)

- IPC handlers in main.ts + preload bridge
- Camera interface migration (PyPylon + Mock)
- Comprehensive testing (unit + integration)

### 🚧 Phase 3-4: Next Steps

- Issue #13: Bundle Python with Electron installers
- Issue #16: DAQ interface migration

### 📋 Phase 4+: UI & Features (Future)

- Camera control UI components
- DAQ control UI components
- Scanning workflow
- Data management
- Bloom upload integration

## File Naming Conventions

| Type                 | Convention     | Example                  |
| -------------------- | -------------- | ------------------------ |
| **Python**           | snake_case     | `camera_mock.py`         |
| **Python tests**     | `test_*.py`    | `test_camera.py`         |
| **TypeScript**       | kebab-case     | `camera-process.ts`      |
| **TypeScript tests** | `*.test.ts`    | `camera-process.test.ts` |
| **React components** | PascalCase.tsx | `CameraControl.tsx`      |
| **Type definitions** | kebab-case.ts  | `camera-types.ts`        |

## Contributing

See `README.md` for development setup and contribution guidelines.

## Documentation

- `README.md` - Project overview and setup
- `STRUCTURE.md` (this file) - Codebase organization
- `docs/CAMERA_TESTING.md` - Camera testing guide
- `tests/unit/README.md` - Testing guidelines

## Related Issues

- Issue #1 - EPIC: Migration plan
- Issue #12 - Python Process Manager & IPC Protocol ✅
- Issue #14 - IPC Handlers & Preload Bridge ✅
- Issue #15 - Camera Interface Migration ✅
- Issue #13 - Bundle Python with Electron (in progress)
- Issue #16 - DAQ Interface Migration (planned)
