# bloom-desktop

Electron-react application for cylinder scanning and upload to bloom.

## Project Status

🚧 **In Active Migration** - This repository is being migrated from the [bloom-desktop-pilot](https://github.com/eberrigan/bloom-desktop-pilot/tree/benfica/add-testing) repository with comprehensive testing and FAIR principles.

See [Issue #1](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/1) for the full migration plan.

## Architecture

- **Frontend**: Electron + React + TypeScript
- **Backend**: Python (Basler Pylon cameras + NI-DAQ)
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
│   ├── main/             # Electron main process (future)
│   └── renderer/         # React renderer/UI (future)
├── prisma/               # Database schema & migrations (future)
├── python/               # Python hardware interfaces (future)
│   ├── pylon/           # Camera interface
│   └── daq/             # DAQ interface
├── tests/                # Test files (future)
├── scripts/              # Build scripts (future)
├── package.json          # Node.js dependencies
├── requirements.txt      # Python dependencies (temporary - will migrate to pyproject.toml)
├── tsconfig.json         # TypeScript configuration
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

```bash
# Lint TypeScript/JavaScript files
npm run lint

# Format code with Prettier
npm run format

# Check formatting without modifying
npm run format:check
```

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

Testing infrastructure will be added in Phase 1.2. Target coverage: 80%+

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
