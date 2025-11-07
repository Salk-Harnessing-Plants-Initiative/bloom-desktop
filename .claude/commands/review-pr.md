# Code Review Checklist

Comprehensive checklist for reviewing pull requests in bloom-desktop, covering code quality, architecture, Electron/Python concerns, and hardware integration.

## Quick Commands

```bash
# View PR
gh pr view [pr-number]

# Checkout PR locally
gh pr checkout [pr-number]

# View PR diff
gh pr diff [pr-number]

# View CI status
gh pr checks [pr-number]

# Add review comment
gh pr review [pr-number] --comment -b "Review comment"

# Approve PR
gh pr review [pr-number] --approve

# Request changes
gh pr review [pr-number] --request-changes -b "Reason for requesting changes"
```

## Review Checklist

### 1. Code Quality

#### Naming and Clarity

- [ ] Variable and function names are descriptive and follow conventions (camelCase for TS/JS, snake_case for Python)
- [ ] File names follow kebab-case convention (e.g., `camera-process.ts`, `camera_mock.py`)
- [ ] No magic numbers or strings (use named constants)
- [ ] Complex logic has explanatory comments

#### Type Safety

- [ ] TypeScript: No `any` types (use `unknown` or proper types)
- [ ] TypeScript: Interfaces defined for IPC payloads and responses
- [ ] Python: Type hints provided for function signatures
- [ ] Python: mypy passes without errors

#### Error Handling

- [ ] Errors are caught and handled appropriately (not silently swallowed)
- [ ] User-facing errors have clear messages
- [ ] Python subprocess errors are logged and surfaced to TypeScript
- [ ] IPC errors include descriptive messages and error codes

#### Testing

- [ ] Unit tests added for new functionality
- [ ] Tests are focused and test one thing at a time
- [ ] Mock objects used appropriately (hardware, external services)
- [ ] Edge cases and error paths are tested
- [ ] Coverage meets thresholds (TypeScript 50%+, Python 80%+)

### 2. Architecture

#### IPC Communication

- [ ] IPC commands follow JSON-lines protocol (one JSON per line)
- [ ] IPC handlers properly typed in `src/types/` directory
- [ ] Commands use descriptive names (e.g., `start_stream`, not `cmd1`)
- [ ] Responses include `success` boolean and appropriate payload
- [ ] Errors are handled on both TypeScript and Python sides

#### Subprocess Management

- [ ] Python subprocess lifecycle managed correctly (start, restart on crash, cleanup)
- [ ] Subprocess stdout/stderr piped and logged
- [ ] Ready signals used to prevent race conditions
- [ ] Timeouts implemented for subprocess operations

#### Module Organization

- [ ] TypeScript code in appropriate directory (`src/main/`, `src/renderer/`, `src/types/`)
- [ ] Python code in `python/` or `python/hardware/`
- [ ] Tests in `tests/` matching source structure
- [ ] No circular dependencies

### 3. Electron & Python Integration

#### ASAR Packaging

- [ ] No code reads files directly from `app.asar` (will fail in production)
- [ ] Prisma binaries extracted to `Resources/` directory (not in ASAR)
- [ ] Python executable packaged as extra resource
- [ ] Resource paths use proper helpers (`python-paths.ts`)

#### Resource Paths

- [ ] File paths use `path.join()` (TypeScript) or `Path()` (Python)
- [ ] Paths work in both development and production
- [ ] Database path respects environment variables (`BLOOM_DATABASE_URL`)
- [ ] User data directory uses OS-appropriate location (`~/.bloom/data/`)

#### Process Boundaries

- [ ] Main process handles IPC and database operations
- [ ] Renderer process uses context bridge (no direct Node.js access)
- [ ] Python process handles hardware control only
- [ ] No mixing of concerns across process boundaries

### 4. Python Bundling (PyInstaller)

#### Hidden Imports

- [ ] New Python packages added to `hiddenimports` in `python/main.spec` if needed
- [ ] Package metadata included with `copy_metadata()` if package uses `importlib.metadata`
- [ ] DLL/dylib dependencies documented if platform-specific

#### Build Verification

- [ ] Python executable builds successfully (`npm run build:python`)
- [ ] Bundled executable tested manually (`echo '{"command":"check_hardware"}' | ./dist/bloom-hardware --ipc`)
- [ ] Integration tests pass with bundled executable

#### PyInstaller Configuration

- [ ] `python/main.spec` updated if new dependencies added
- [ ] `pathex` includes both `.` and `./python` for dual import paths
- [ ] Build cache cleaned if spec file changed (`scripts/build-python.js` handles this)

### 5. Hardware Integration

#### Mock Hardware

- [ ] Mock camera (`camera_mock.py`) available for testing
- [ ] Mock DAQ (`daq_mock.py`) available for testing
- [ ] CI tests use mock hardware (no real devices required)
- [ ] Mock behavior realistic enough for integration tests

#### Real Hardware

- [ ] Changes tested with real hardware if hardware interfaces modified
- [ ] Hardware connection errors handled gracefully (device not found, permission denied)
- [ ] Hardware disconnection during operation handled (don't crash app)
- [ ] Hardware initialization logged with clear status messages

#### Hardware Documentation

- [ ] Hardware setup instructions updated if needed (`docs/CAMERA_TESTING.md`, `docs/DAQ_TESTING.md`)
- [ ] New hardware requirements documented (SDK versions, drivers)

### 6. Database (Prisma)

#### Schema Changes

- [ ] Migration created (`npm run prisma:migrate`)
- [ ] Migration tested in dev and packaged app environments
- [ ] Schema maintains compatibility with bloom-desktop-pilot (see `docs/PILOT_COMPATIBILITY.md`)
- [ ] No breaking changes to existing tables/columns without migration path

#### Queries

- [ ] Prisma Client used for all database access (no raw SQL unless necessary)
- [ ] Queries are efficient (use `include` wisely, avoid N+1 queries)
- [ ] Transactions used for multi-step operations
- [ ] Database errors handled and surfaced to user

#### Data Validation

- [ ] Input sanitized before database operations
- [ ] File paths validated (use `path-sanitizer.ts`)
- [ ] Foreign key relationships respected
- [ ] Data types match schema (dates, numbers, strings)

### 7. Cross-Platform Compatibility

#### File Paths

- [ ] No hardcoded paths (use `path.join()`, `Path()`, or environment variables)
- [ ] No assumptions about path separators (`\` vs `/`)
- [ ] No case-sensitive path assumptions (Windows is case-insensitive)

#### Platform-Specific Code

- [ ] Platform checks use `process.platform` (TypeScript) or `sys.platform` (Python)
- [ ] Platform-specific code clearly documented
- [ ] Alternatives provided for unsupported platforms or graceful degradation

#### CI Testing

- [ ] PR tested on Linux, macOS, and Windows in CI
- [ ] Platform-specific failures investigated and fixed
- [ ] No platform-specific test skips without good reason

### 8. Security

#### Path Sanitization

- [ ] User-provided file paths sanitized with `path-sanitizer.ts`
- [ ] No path traversal vulnerabilities (`../../../etc/passwd`)
- [ ] File operations validate permissions

#### Subprocess Security

- [ ] Python subprocess arguments validated (no command injection)
- [ ] Subprocess runs with appropriate permissions (not elevated)
- [ ] Subprocess stdin/stdout handled securely

#### Data Security

- [ ] No secrets in code (API keys, passwords)
- [ ] User data stored in appropriate location (`~/.bloom/data/`)
- [ ] Database file permissions appropriate (user-readable only)

## After Review

### Approved

```bash
gh pr review [pr-number] --approve -b "LGTM! Great work on [specific aspect]"
```

### Request Changes

```bash
gh pr review [pr-number] --request-changes -b "Changes requested:
- [Specific issue 1]
- [Specific issue 2]"
```

### Add Comment (No Approval)

```bash
gh pr review [pr-number] --comment -b "Looks good overall, but please check [specific aspect]"
```

## Related Commands

- `/pr-description` - Template that PR authors should follow
- `/lint` - Linting checks that should pass before review
- `/coverage` - Coverage expectations for new code