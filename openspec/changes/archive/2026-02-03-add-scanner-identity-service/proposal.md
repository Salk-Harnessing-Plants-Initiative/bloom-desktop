# Change Proposal: Add Scanner Identity Service

## Problem Statement

The scanner name configured in Machine Configuration is not displayed in the Layout sidebar after saving. This occurs because Layout loads the scanner name once on mount and never refreshes, even after configuration changes are saved.

**Current Behavior**:

1. User saves scanner name in Machine Configuration → saved to `~/.bloom/.env` ✅
2. Layout displays "Not configured" in bottom left → never updates ❌
3. App restart required to see updated scanner name → poor UX ❌

**Root Cause**: Layout directly queries config storage (`config:get`) on mount only, conflating **persistent storage** with **runtime state**.

## Context: Pilot Implementation Pattern

The pilot implementation separates these concerns using a scanner service pattern:

### Evidence from `bloom-desktop-pilot`

**Pilot Architecture** (`bloom-desktop-pilot/app/src/main/main.ts`):

```typescript
// Line 88: Config loaded at startup (persistence layer)
const config = yaml.load(fs.readFileSync(config_yaml, 'utf8'));

// Line 148: Scanner service created with config (runtime state)
const scanner = createScanner(config);

// Line 149: IPC handler exposes scanner identity (runtime API)
ipcMain.handle('scanner:get-scanner-id', scanner.getScannerId);
```

**Scanner Service** (`bloom-desktop-pilot/app/src/main/scanner.ts`):

```typescript
class Scanner {
  private scanner_name: string;

  constructor(config) {
    this.scanner_name = config.scanner_name; // Initialize from config
  }

  getScannerId = () => {
    return this.scanner_name; // Runtime state accessor
  };
}
```

**Key Architectural Pattern**:

- **Config file** (`.env`) = Persistence layer (read at startup, written on save)
- **Scanner service** = Runtime state (holds current scanner identity)
- **UI components** = Query scanner service via IPC, not config directly

This separates "what's on disk" from "what's currently active," allowing runtime updates without filesystem I/O.

## Proposed Solution

Implement a lightweight scanner identity service following the pilot pattern, aligned with our existing runtime state management for camera settings.

### Current Runtime State Pattern (Already in Place)

We already use this pattern for camera settings:

**From `src/main/main.ts` line 83**:

```typescript
// Camera settings: in-memory, ephemeral (lost on restart)
let currentCameraSettings: CameraSettings | null = null;

// Updated when camera configured
ipcMain.handle('camera:configure', async (_event, settings) => {
  if (success) {
    currentCameraSettings = { ...currentCameraSettings, ...settings };
  }
});

// Queried by UI
ipcMain.handle('camera:get-settings', async () => {
  return currentCameraSettings;
});
```

**Proposed: Scanner Identity (Same Pattern)**:

```typescript
// Scanner identity: in-memory, synced from config
let scannerIdentity: { name: string } = { name: '' };

// Initialize on app startup
const config = loadEnvConfig(ENV_PATH);
scannerIdentity.name = config.scanner_name;

// IPC handler (matches pilot's scanner:get-scanner-id)
ipcMain.handle('scanner:get-scanner-id', () => {
  return scannerIdentity.name;
});

// Update when config saved
ipcMain.handle('config:set', async (_event, config: MachineConfig) => {
  const result = await saveEnvConfig(config, ENV_PATH);
  if (result.success) {
    scannerIdentity.name = config.scanner_name; // Sync runtime state
  }
  return result;
});
```

### Why This Approach?

1. **Matches pilot pattern**: Uses scanner service with `scanner:get-scanner-id` API
2. **Consistent with our codebase**: Same pattern as `currentCameraSettings`
3. **Minimal scope**: Only scanner identity (name), not full scanner service
4. **No persistence overhead**: In-memory state, synced from config
5. **Immediate updates**: Layout can query `scanner:get-scanner-id` anytime
6. **Separation of concerns**:
   - `.env` file = Persistence (what's saved)
   - `scannerIdentity` = Runtime state (what's active)
   - IPC handlers = APIs for UI to query both

### Comparison with Other Runtime State

| State                | Storage                                      | Lifecycle            | Access Pattern                   |
| -------------------- | -------------------------------------------- | -------------------- | -------------------------------- |
| Camera settings      | In-memory (`currentCameraSettings`)          | Lost on restart      | `camera:get-settings` IPC        |
| Scanner metadata     | In-memory (`ScannerProcess.currentSettings`) | Lost on restart      | Per-scan initialization          |
| **Scanner identity** | **In-memory (`scannerIdentity`)**            | **Synced from .env** | **`scanner:get-scanner-id` IPC** |
| Machine config       | Persistent (`.env` file)                     | Survives restart     | `config:get` IPC                 |

Scanner identity follows the same pattern but syncs with persistent config.

## Scope

### Files to Modify

1. **src/main/main.ts** (scanner identity service):
   - Add `scannerIdentity` variable after line 83 (near `currentCameraSettings`)
   - Initialize from config at app startup
   - Add `scanner:get-scanner-id` IPC handler
   - Update `config:set` handler to sync scanner identity
   - Add comment explaining scanner identity purpose

2. **src/main/preload.ts** (IPC API):
   - Add `getScannerId` to scanner API namespace
   - Export type-safe wrapper for `scanner:get-scanner-id`

3. **src/types/electron.d.ts** (TypeScript types):
   - Add `getScannerId` to `ScannerAPI` interface
   - Document return type and purpose

4. **src/renderer/Layout.tsx** (UI consumer):
   - Change from `config:get` to `scanner:get-scanner-id`
   - Add effect to poll scanner ID periodically (simple refresh)
   - Remove dependency on config persistence

### Files to Create

5. **tests/unit/scanner-identity.test.ts** (TDD):
   - Test: Scanner identity initialized from config on startup
   - Test: `scanner:get-scanner-id` returns current identity
   - Test: Scanner identity updates when config saved
   - Test: Scanner identity defaults to empty string if not configured

6. **openspec/changes/add-scanner-identity-service/specs/scanner-api/spec.md**:
   - Spec delta for Scanner API
   - Requirements for scanner identity service
   - Scenarios for initialization and updates

### Files NOT Modified

- `src/main/scanner-process.ts` - Separate concern (scan execution)
- `src/main/camera-process.ts` - Separate concern (camera operations)
- Any renderer components except Layout

## Benefits

1. **Fixes immediate bug**: Scanner name displays correctly after save
2. **Matches pilot architecture**: Uses `scanner:get-scanner-id` pattern
3. **Consistent with codebase**: Same pattern as camera settings
4. **No restart required**: Runtime state updates immediately
5. **Separation of concerns**: Config storage ≠ runtime identity
6. **Minimal scope**: Only scanner identity, not full service
7. **Future-proof**: Foundation for scanner service expansion
8. **Zero breaking changes**: Additive only (new IPC handler)

## Impact Analysis

### Non-Breaking Changes

- ✅ **Adds**: `scanner:get-scanner-id` IPC handler (new API)
- ✅ **Adds**: `scannerIdentity` runtime state variable
- ✅ **Adds**: Sync logic in `config:set` handler
- ✅ **Changes**: Layout component implementation (queries different API)
- ✅ **Keeps**: All existing config APIs (`config:get`, `config:set`)
- ✅ **Keeps**: All existing persistence logic (`.env` file)

### No Breaking Changes

This is a purely additive change:

- New IPC handler added
- No existing APIs modified or removed
- No interface changes to existing code
- Layout implementation detail only

## Testing Strategy (TDD)

### Phase 1: Write Tests First

**Unit Tests** (`tests/unit/scanner-identity.test.ts`):

```typescript
describe('Scanner Identity Service', () => {
  it('should initialize scanner identity from config on startup', () => {
    // Test that scannerIdentity loads from .env
  });

  it('should return scanner identity via scanner:get-scanner-id', async () => {
    // Test IPC handler returns correct value
  });

  it('should update scanner identity when config saved', async () => {
    // Test that config:set syncs scannerIdentity
  });

  it('should default to empty string if not configured', () => {
    // Test first-run behavior
  });

  it('should handle config save failure gracefully', async () => {
    // Test scannerIdentity unchanged on save failure
  });
});
```

**Component Tests** (`tests/unit/components/Layout.test.tsx`):

```typescript
describe('Layout scanner name display', () => {
  it('should display scanner name from scanner:get-scanner-id', async () => {
    // Test Layout queries scanner service
  });

  it('should show "Not configured" when scanner name empty', async () => {
    // Test fallback text
  });

  it('should update display when scanner identity changes', async () => {
    // Test reactive updates
  });
});
```

### Phase 2: Implement to Pass Tests

1. Add scanner identity variable and initialization
2. Implement `scanner:get-scanner-id` handler
3. Update `config:set` to sync identity
4. Update Layout to use new API
5. Run tests - expect all to pass

### Phase 3: Integration Testing

**Manual Test Flow**:

1. Start app with existing config → verify scanner name displays
2. Navigate to Machine Configuration
3. Change scanner name → save
4. Return to Layout → verify name updated (no restart)
5. Restart app → verify name persists

### Phase 4: E2E Testing

Not required for this change (no user-facing flow changes).

## Implementation Plan (TDD)

### Phase 1: Write Tests (15 min)

- [ ] Create `tests/unit/scanner-identity.test.ts`
- [ ] Write 5 unit tests (see Testing Strategy above)
- [ ] Run tests - expect failures ❌

### Phase 2: Implement Scanner Identity Service (20 min)

- [ ] Add `scannerIdentity` variable in main.ts
- [ ] Initialize from config at app startup
- [ ] Add `scanner:get-scanner-id` IPC handler
- [ ] Update `config:set` to sync identity
- [ ] Add code comments
- [ ] Run tests - expect all to pass ✅

### Phase 3: Update Preload & Types (10 min)

- [ ] Add `getScannerId` to preload.ts
- [ ] Add type definitions to electron.d.ts
- [ ] Run TypeScript compiler - expect no errors ✅

### Phase 4: Update Layout Component (15 min)

- [ ] Write Layout component tests
- [ ] Update Layout to use `scanner:get-scanner-id`
- [ ] Add periodic refresh (useEffect polling)
- [ ] Run component tests - expect all to pass ✅

### Phase 5: Create Spec Delta (10 min)

- [ ] Write spec delta in `specs/scanner-api/spec.md`
- [ ] Document requirements and scenarios
- [ ] Run `npx openspec validate add-scanner-identity-service`

### Phase 6: Manual Testing (10 min)

- [ ] Test full flow (see Integration Testing above)
- [ ] Verify scanner name updates without restart
- [ ] Test first-run behavior (no config)
- [ ] Test app restart (persistence)

### Phase 7: Code Review & Cleanup (10 min)

- [ ] Run linter: `npm run lint`
- [ ] Run formatter: `npm run format`
- [ ] Run full test suite: `npm run test:unit`
- [ ] Review code comments and documentation

**Total Estimated Time**: 90 minutes

## Dependencies

- **Depends on**: `fix-credentials-and-remove-login` (completed)
- **Blocks**: None
- **Related**: Camera settings runtime state pattern

## Rollback Plan

If issues discovered:

1. Remove `scanner:get-scanner-id` IPC handler
2. Revert Layout to use `config:get` (old behavior)
3. Remove `scannerIdentity` variable
4. No data loss (`.env` file unchanged)
5. Single commit rollback

## Questions Resolved

1. **Q**: Should we create a full Scanner service like pilot?
   **A**: No - minimal identity service only (this change). Can expand later.

2. **Q**: Should scanner identity persist separately?
   **A**: No - synced from `.env` file (single source of truth).

3. **Q**: How to notify Layout of changes?
   **A**: Layout polls `scanner:get-scanner-id` periodically (simple, works).

4. **Q**: What about other scanner state (metadata, settings)?
   **A**: Out of scope - those are per-scan, ephemeral (ScannerProcess).

5. **Q**: Why not use events/observers?
   **A**: Polling is simpler, matches camera settings pattern, sufficient for MVP.

## Acceptance Criteria

### Functional Requirements

- ✅ Scanner name displays in Layout after saving config
- ✅ No app restart required to see updated name
- ✅ "Not configured" shown when scanner name empty
- ✅ Scanner name persists across app restarts (via .env)
- ✅ Matches pilot's `scanner:get-scanner-id` API pattern

### Technical Requirements

- ✅ `scannerIdentity` variable holds runtime state
- ✅ `scanner:get-scanner-id` IPC handler returns identity
- ✅ `config:set` syncs `scannerIdentity` from config
- ✅ Layout uses `scanner:get-scanner-id` not `config:get`
- ✅ Initialization from `.env` at app startup
- ✅ All unit tests pass (5 scanner identity tests)
- ✅ All component tests pass (3 Layout tests)
- ✅ No breaking changes to existing APIs

### Code Quality Requirements

- ✅ Code comments explain scanner identity purpose
- ✅ Follows existing runtime state pattern (camera settings)
- ✅ TypeScript types for all new APIs
- ✅ Linter passes with no errors
- ✅ Formatter applied to all modified files
