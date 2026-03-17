# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Workflow

### Ideas & Bugs → OpenSpec → Implementation

1. **Capture ideas and bugs** in `.claude/ideas/` and `.claude/bugs/`
   - Create a timestamped folder for each: `YYYY-MM-DD-short-name/`
   - Copy from `_TEMPLATE/` and customize
   - Add dated notes as you investigate

2. **When ready to implement**, create an OpenSpec proposal
   - Move from `.claude/` exploration to `openspec/changes/[change-id]/`
   - Follow the structured format: `proposal.md`, `tasks.md`, spec deltas

3. **Implement** following the OpenSpec tasks.md checklist

4. **Archive** completed changes to `openspec/changes/archive/`

### Folder Structure

```
.claude/
├── ideas/
│   ├── _TEMPLATE/              # Copy this for new ideas
│   │   └── README.md
│   ├── 2025-01-30-dark-mode/   # Example idea folder
│   │   └── README.md
│   └── 2025-02-01-export-csv/
│       └── README.md
└── bugs/
    ├── _TEMPLATE/              # Copy this for new bugs
    │   └── README.md
    ├── 2025-01-30-db-not-loading/
    │   └── README.md
    └── 2025-02-01-camera-timeout/
        └── README.md
```

### When to Use Each

| Situation | Location |
|-----------|----------|
| Brainstorming a feature | `.claude/ideas/YYYY-MM-DD-name/` |
| Investigating a bug | `.claude/bugs/YYYY-MM-DD-name/` |
| Ready to implement (new feature, breaking change, architecture) | `openspec/changes/` |
| Bug fix (restores intended behavior) | Direct fix, no proposal needed |
| Typo, formatting, config | Direct fix, no proposal needed |

## OpenSpec Instructions

Always open `openspec/AGENTS.md` when the request mentions planning, proposals, specs, breaking changes, or architecture shifts. Use it to learn how to create and apply change proposals.

## Project Overview

Bloom Desktop is an Electron-React application for cylinder scanning and upload. It coordinates Basler GigE cameras and NI-DAQ stepper motors for automated plant phenotyping.

## Architecture

**Multi-Process Design:**
- **Electron Main** (`src/main/`): App lifecycle, IPC routing, database access
- **React Renderer** (`src/renderer/`): UI with React Router, React Hook Form, Tailwind CSS
- **Python Backend** (`python/`): Hardware control via PyPylon (cameras) and NI-DAQmx (turntable)

**Process Communication:**
- Main ↔ Renderer: Electron IPC with context-isolated preload bridge
- Main ↔ Python: Stdio with line-delimited JSON (prefixed: `STATUS:`, `ERROR:`, `DATA:`, `FRAME:`)

**Key Files:**
- `src/main/main.ts`: Entry point, IPC handlers, Python subprocess management
- `src/main/preload.ts`: Context bridge exposing `window.electron.*` APIs
- `src/main/database.ts`: Prisma client initialization (handles dev vs packaged paths)
- `src/main/database-handlers.ts`: ~30 database IPC handlers
- `python/ipc_handler.py`: Main IPC router for hardware commands

**Subprocess Managers (extend base PythonProcess):**
- `python-process.ts`: Base subprocess manager
- `camera-process.ts`: Basler camera control
- `daq-process.ts`: NI-DAQ turntable rotation
- `scanner-process.ts`: Orchestrates camera + DAQ for synchronized scanning

## Common Commands

```bash
# Development
npm start                    # Start dev server (runs on port 9000)
npm run dev                  # Build Python + start dev server

# Testing
npm run test:unit            # Vitest unit tests
npm run test:python          # Python pytest (80%+ coverage required)
npm run test:ipc             # Python ↔ TypeScript IPC integration
npm run test:camera          # Camera integration (mock)
npm run test:daq             # DAQ integration (mock)
npm run test:scanner         # Scanner workflow (mock)
npm run test:scanner-database # Scanner-database persistence

# E2E Testing (requires dev server running first!)
npm run start                # Terminal 1: Start dev server
npm run test:e2e             # Terminal 2: Run Playwright tests
npm run test:e2e:ui          # Playwright UI mode for debugging

# Database
npm run prisma:generate      # Generate Prisma client after schema changes
npm run prisma:migrate       # Create and apply migrations
npm run prisma:studio        # Visual database browser

# Packaging
npm run build:python         # Build Python executable with PyInstaller
npm run package              # Create distributable app bundle
npm run make                 # Create platform installers
```

## Testing Notes

- E2E tests require the dev server running on port 9000 **before** running tests
- Python tests require `uv` installed for dependency management
- Integration tests auto-build Python if needed via `scripts/ensure-python-executable.sh`

## Database

Uses Prisma ORM with SQLite. Schema in `prisma/schema.prisma`.

**Models:** Scientist → Experiment ← Accessions, Phenotyper → Scan → Image

**Locations:**
- Dev: `./prisma/dev.db`
- Production: `~/.bloom/data/bloom.db`

**Packaging caveat:** Prisma binaries cannot be inside ASAR archive. They're copied to `Resources/` via `forge.config.ts` extraResource.

## Python Backend Protocol

Commands sent as JSON via stdin, responses prefixed:
- `STATUS:<message>` - Progress updates
- `ERROR:<message>` - Error messages
- `DATA:<json>` - JSON responses
- `FRAME:<base64_uri>` - Streaming camera frames

Mock hardware available for testing: `camera_mock.py`, `daq_mock.py`

## IPC Pattern

```
Renderer → preload (ipcRenderer.invoke) → main (ipcMain.handle) → Python subprocess
```

All renderer-to-main calls go through the context-isolated preload script. Database operations return `{ success: boolean, data?: T, error?: string }`.

## Build Configuration

- `forge.config.ts`: Electron Forge packaging, extraResources for Prisma and Python executable
- `webpack.main.config.ts`: Externals for Prisma (loaded from resources in production)
- `webpack.renderer.config.ts`: Tailwind CSS, PostCSS, TypeScript
- `pyproject.toml`: Python dependencies managed by `uv`
- `python/main.spec`: PyInstaller build configuration
