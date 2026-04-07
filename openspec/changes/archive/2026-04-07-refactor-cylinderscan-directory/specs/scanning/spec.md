## ADDED Requirements

### Requirement: Mode-Specific Directory Boundaries

CylinderScan-specific main process modules SHALL reside in `src/main/cylinderscan/`. Shared infrastructure code in `src/main/` SHALL NOT import from `src/main/cylinderscan/` or `src/main/graviscan/` (when it exists). This one-way dependency rule is enforced by an ESLint `no-restricted-imports` rule.

#### Scenario: CylinderScan process files are in the cylinderscan directory

- **GIVEN** the project source code
- **WHEN** a developer looks for CylinderScan-specific main process modules
- **THEN** `camera-process.ts`, `daq-process.ts`, `scanner-process.ts`, and `scan-metadata-json.ts` SHALL be located in `src/main/cylinderscan/`
- **AND** they SHALL NOT be in `src/main/` root

#### Scenario: Shared code cannot import from mode-specific directories

- **GIVEN** a TypeScript file in `src/main/` (not inside `cylinderscan/` or `graviscan/`)
- **WHEN** the file attempts to import from `**/cylinderscan/**` or `**/graviscan/**`
- **THEN** ESLint SHALL report an error with the message "Shared code must not import from cylinderscan/" or "Shared code must not import from graviscan/"

#### Scenario: Mode-specific code can import from shared code

- **GIVEN** a TypeScript file inside `src/main/cylinderscan/`
- **WHEN** the file imports from `src/main/python-process.ts` or other shared modules
- **THEN** the import SHALL be allowed (no ESLint error)

#### Scenario: All existing tests pass after directory restructure

- **GIVEN** the 4 CylinderScan files have been moved to `src/main/cylinderscan/`
- **AND** all import statements across the impacted files have been updated (including dynamic `import()` calls)
- **WHEN** the full test suite runs (`npx vitest run` and `uv run pytest`)
- **THEN** all tests SHALL pass with zero failures
- **AND** `npx tsc --noEmit` SHALL report zero type errors

#### Scenario: main.ts imports CylinderScan modules from new paths

- **GIVEN** `src/main/main.ts` registers CylinderScan IPC handlers
- **WHEN** it imports `CameraProcess`, `DAQProcess`, `ScannerProcess`
- **THEN** the imports SHALL use paths relative to `./cylinderscan/` (e.g., `'./cylinderscan/camera-process'`)
- **AND** the `no-restricted-imports` rule SHALL NOT flag these imports (main.ts is the orchestrator, not shared library code — see ESLint override)
