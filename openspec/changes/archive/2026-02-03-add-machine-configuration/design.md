## Context

The pilot application (`bloom-desktop-pilot`) uses a YAML configuration file that admins must manually edit. This approach is error-prone and not user-friendly. bloom-desktop needs a GUI-based configuration system that:

1. Separates sensitive credentials from general settings
2. Restricts access to authorized administrators
3. Provides immediate feedback for validation errors
4. Integrates with existing IPC patterns

**Stakeholders**: Lab managers (configure stations), phenotypers (use configured stations), developers (test with mock settings)

## Goals / Non-Goals

**Goals:**

- Provide GUI for all machine-level settings
- Protect configuration with credential-based access
- Display scanner identity in sidebar
- Store credentials securely in environment file
- Support first-run setup flow

**Non-Goals:**

- Per-experiment camera settings (separate issue #51)
- Cloud sync of configuration (each station is independent)
- Multi-user authentication (single admin per station)
- Session metadata persistence (separate issue #83)

## Decisions

### Decision 1: Hybrid Storage (config.json + .env)

**What**: Non-sensitive settings in `~/.bloom/config.json`, sensitive credentials in `~/.bloom/.env`

**Why**:

- Security best practice separates secrets from config
- `.env` files are standard for credentials
- JSON is easy to read/write programmatically
- Consistent with existing `BLOOM_DATABASE_URL` pattern

**Alternatives considered**:

- Single YAML file (pilot approach) - mixes secrets with config, harder to parse
- electron-store - adds dependency, less control over file location
- All in .env - harder to structure complex config

### Decision 2: Bloom Credentials as Admin Access

**What**: Require Bloom scanner credentials to access configuration page

**Why**:

- No separate admin password to manage
- Credentials serve dual purpose (auth + API)
- Each scanner has unique credentials

**Alternatives considered**:

- Separate admin PIN - adds another credential to manage
- No protection - too easy to accidentally change settings
- Lock checkbox (pilot approach) - can be bypassed by editing file

### Decision 3: Hidden Page with Keyboard Shortcut

**What**: No sidebar link, access via `Ctrl+Shift+,`

**Why**:

- Phenotypers don't need to see this option
- Consistent with "admin-only" pattern
- Discoverable by those who need it

**Alternatives considered**:

- Always visible link - confusing for phenotypers
- Menu item only - less discoverable
- Command-line flag only - not user-friendly

### Decision 4: Separation from Camera Settings Page

**What**: Machine Configuration handles machine-level defaults; Camera Settings handles per-session image parameters

**Why**:

- **Machine Configuration** (`/machine-config`): Admin-only, rarely changed, stores defaults
  - Scanner name, default camera IP, scans directory, API credentials
  - No live preview (use Camera Settings for that)

- **Camera Settings** (`/camera-settings`): User-facing, changed frequently, session-only
  - Exposure, gain, gamma, brightness, contrast
  - Live preview for tuning
  - Temporary camera selection for testing (not persisted)

**Interaction**:

- Camera Settings loads default camera IP from Machine Configuration on mount
- Temporary camera changes in Camera Settings are session-only
- CaptureScan always uses the Machine Configuration camera IP

**Alternatives considered**:

- Merge into one page - too complex, mixes admin and user workflows
- Have Camera Settings persist camera IP - creates confusion about source of truth

## Risks / Trade-offs

| Risk                            | Mitigation                                              |
| ------------------------------- | ------------------------------------------------------- |
| User forgets keyboard shortcut  | First-run auto-redirect; document in README             |
| Credentials stored in plaintext | .env file has restricted permissions; standard practice |
| Config file corruption          | Validate on load; keep backup; provide reset option     |
| Camera IP changes               | "Test Connection" verifies before save                  |

## Migration Plan

1. **Phase 1**: Ship config infrastructure (no UI changes visible)
2. **Phase 2**: Add Machine Configuration page (existing behavior unchanged)
3. **Phase 3**: Update CaptureScan to use config (fallback to defaults)
4. **Phase 4**: Add first-run detection

**Rollback**: All config values have sensible defaults; app works without config file.

## Open Questions

None - all design questions resolved during planning.
