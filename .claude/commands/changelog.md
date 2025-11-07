# Changelog Management

Document changes to the project in a structured changelog format for releases and version tracking.

## Changelog Format

Follow [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format with these categories:

- **Added** - New features
- **Changed** - Changes to existing functionality
- **Deprecated** - Soon-to-be removed features
- **Removed** - Removed features
- **Fixed** - Bug fixes
- **Security** - Security vulnerability fixes

## Example Changelog Entry

```markdown
## [0.2.0] - 2025-01-15

### Added

- Camera brightness control in settings UI (#51)
- Per-experiment camera configuration support
- Database migration for camera settings storage
- Real-time brightness preview in camera stream

### Changed

- Updated camera settings form with brightness slider (0.0-1.0 range)
- Refactored camera IPC handlers to support additional parameters

### Fixed

- IPC race condition on Windows causing test failures (#47)
- Python subprocess ready signal timeout handling

### Dependencies

- Electron 28.2.2
- Python 3.12
- Node.js 20.x
- Basler Pylon SDK 7.4.0
- NI-DAQmx 23.8

## [0.1.0] - 2024-12-01

### Added

- Initial Electron application structure
- Python hardware control subprocess
- Basler camera integration with mock camera for testing
- NI-DAQ turntable control with mock DAQ
- Prisma database with SQLite
- React UI with Tailwind CSS
- E2E testing framework with Playwright
- Integration tests for IPC, camera, DAQ, scanner

### Testing

- TypeScript unit tests: Vitest (50% coverage)
- Python unit tests: pytest (80%+ coverage enforced)
- Integration tests: All critical paths covered
- E2E tests: App launch, database init, basic workflows
- Cross-platform CI: Linux, macOS, Windows
```

## Version Numbering

Follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (1.0.0 → 2.0.0): Breaking changes
- **MINOR** (0.1.0 → 0.2.0): New features, backward-compatible
- **PATCH** (0.1.0 → 0.1.1): Bug fixes, backward-compatible

### Examples

- Adding camera brightness control: **MINOR** (new feature)
- Fixing IPC race condition: **PATCH** (bug fix)
- Changing database schema incompatibly: **MAJOR** (breaking change)

## Dependency Version Tracking

Track major versions of key dependencies in each release:

### Core Framework

- **Electron**: Desktop application framework (currently 28.2.2)
- **Node.js**: Runtime version (currently 20.x required)
- **Python**: Hardware control backend (currently 3.12+)

### Hardware SDKs

- **Basler Pylon SDK**: Camera driver (required for production, not CI)
- **NI-DAQmx Runtime**: DAQ driver (required for production, not CI)

### Python Packages

- **pypylon**: Basler camera Python interface
- **nidaqmx**: NI-DAQ Python interface
- **Pillow**: Image processing
- **numpy**: Numerical operations

### Node.js Packages

- **React**: UI framework (currently 18.3.1)
- **Prisma**: Database ORM (currently 6.18.0)
- **Playwright**: E2E testing (currently 1.44.0)

## Breaking Changes

When introducing breaking changes, document:

1. **What breaks**: Specific functionality that changes
2. **Why**: Reason for the breaking change
3. **Migration path**: How users/developers can adapt

### Example

```markdown
## [2.0.0] - 2025-03-01

### Changed (BREAKING)

- **Database schema**: Renamed `camera_config` table to `camera_settings`
  - **Why**: Improve naming consistency across application
  - **Migration**: Automatic migration included (`20250301_rename_camera_config`)
  - **Action required**: Backup database before upgrading, run migrations
  - **Rollback**: Revert to v1.x if migration fails

- **IPC protocol**: Changed camera command format from `start_camera` to `start_stream`
  - **Why**: Support multiple stream types (camera, scanner, preview)
  - **Migration**: Update any external tools that send IPC commands
  - **Backward compatibility**: Old commands supported until v3.0.0 (deprecated)
```

## Changelog Location

- **CHANGELOG.md**: Root of repository
- **Keep it updated**: Add entries before each release
- **Update with PRs**: Consider adding changelog entries in PRs (optional)

## Changelog Best Practices

### Good Changelog Entries

✅ **Specific and actionable**

```markdown
### Added

- Camera brightness control with 0.0-1.0 range slider (#51)
- Database migration `20250115_add_brightness` for camera settings
```

✅ **Groups related changes**

```markdown
### Changed

- Refactored IPC handlers for camera, DAQ, and scanner
  - Improved error handling with descriptive messages
  - Added ready signals to prevent race conditions
  - Unified response format across all handlers
```

### Bad Changelog Entries

❌ **Too vague**

```markdown
### Changed

- Updated code
- Fixed bugs
```

❌ **Implementation details** (save for commit messages)

```markdown
### Changed

- Refactored camera.py to use class-based architecture with private methods
- Changed variable name from `cam` to `camera_instance`
```

## Git Workflow with Changelog

### Option 1: Update changelog in release PR

1. Create feature branches and PRs as normal
2. Before release, create "Prepare v0.2.0" PR
3. Update CHANGELOG.md with all changes since last release
4. Merge release PR
5. Tag release: `git tag v0.2.0 && git push --tags`

### Option 2: Update changelog in each PR (optional)

1. Add changelog entry in each PR under "Unreleased" section
2. Before release, change "Unreleased" to version number and date
3. Tag release

## Generating Changelog from Git History

Use git log to find changes since last release:

```bash
# List commits since last tag
git log v0.1.0..HEAD --oneline

# List PRs merged since last tag
gh pr list --state merged --base main --json number,title,mergedAt | \
  jq -r '.[] | "- \(.title) (#\(.number))"'
```

## Related Commands

- `/pr-description` - PR template includes "Related Issues" section
- Use issue/PR numbers in changelog entries for traceability