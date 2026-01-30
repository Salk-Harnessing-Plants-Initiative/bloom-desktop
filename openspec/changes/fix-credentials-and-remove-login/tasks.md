# Tasks: Fix Credential Flow and Consolidate to Single .env File

## Implementation Checklist (TDD Approach)

### Phase 0: Consolidate Configuration Storage (NEW)
- [ ] 0.1 Add test: `loadEnvConfig()` reads all fields from .env
- [ ] 0.2 Add test: `saveEnvConfig()` writes all fields to .env
- [ ] 0.3 Add test: Migration merges config.json + .env → .env
- [ ] 0.4 Add test: Migration deletes config.json after merge
- [ ] 0.5 Update `MachineConfig` interface to include credential fields
- [ ] 0.6 Remove `MachineCredentials` interface
- [ ] 0.7 Implement `loadEnvConfig()` in config-store.ts
- [ ] 0.8 Implement `saveEnvConfig()` in config-store.ts
- [ ] 0.9 Implement migration logic in `loadEnvConfig()`
- [ ] 0.10 Remove `loadConfig()`, `saveConfig()`, `loadCredentials()`, `saveCredentials()`
- [ ] 0.11 Remove `CONFIG_PATH` constant
- [ ] 0.12 Update all imports/references to use unified functions
- [ ] 0.13 Run config-store tests - expect all to pass

### Phase 1: Write Tests First (TDD)
- [ ] 1.1 Add IPC test: `config:fetch-scanners` accepts apiUrl parameter
- [ ] 1.2 Add IPC test: `config:fetch-scanners` accepts credentials parameter
- [ ] 1.3 Add IPC test: Handler uses provided credentials, not file
- [ ] 1.4 Add IPC test: Success with valid credentials
- [ ] 1.5 Add IPC test: Failure with invalid credentials
- [ ] 1.6 Remove IPC tests for `config:validate-credentials`
- [ ] 1.7 Update IPC tests for unified config load/save
- [ ] 1.8 Run IPC tests - expect failures (not implemented yet)

### Phase 2: Fix IPC Handler (TDD)
- [ ] 2.1 Update `config:fetch-scanners` handler in src/main/main.ts
- [ ] 2.2 Update handler signature to accept `apiUrl` and `credentials`
- [ ] 2.3 Remove `loadCredentials()` call from handler (use unified config)
- [ ] 2.4 Pass credentials to `fetchScannersFromBloom()`
- [ ] 2.5 Update `config:load` handler to use `loadEnvConfig()`
- [ ] 2.6 Update `config:save` handler to use `saveEnvConfig()`
- [ ] 2.7 Update src/main/preload.ts `fetchScanners` to accept parameters
- [ ] 2.8 Update src/types/electron.d.ts type signatures
- [ ] 2.9 Run IPC tests - expect all to pass

### Phase 3: Update Renderer for Unified Config (TDD)
- [ ] 3.1 Add component test: Component uses single unified config state
- [ ] 3.2 Add component test: fetchScanners called with credentials from config
- [ ] 3.3 Add component test: Save writes all fields to unified config
- [ ] 3.4 Run component tests - expect failures
- [ ] 3.5 Merge `config` and `credentials` state into single `config` state
- [ ] 3.6 Update all form fields to read from unified `config` state
- [ ] 3.7 Update `fetchScanners()` to pass credentials from `config`
- [ ] 3.8 Update `handleSave()` to save unified config
- [ ] 3.9 Update `loadConfiguration` to load unified config
- [ ] 3.10 Run component tests - expect all to pass

### Phase 4: Remove Login Screen Tests (TDD)
- [ ] 4.1 Remove test: "should display login screen when credentials exist"
- [ ] 4.2 Remove test: "should validate credentials on login"
- [ ] 4.3 Remove test: "should show error on invalid login"
- [ ] 4.4 Remove test: "should transition to config form after login"
- [ ] 4.5 Add test: "should not render login screen"
- [ ] 4.6 Add test: "should load config form directly when credentials exist"
- [ ] 4.7 Run tests - expect failures (login screen still exists)

### Phase 5: Remove Login Screen Implementation
- [ ] 5.1 Remove `FormState` type value `'login'` from types
- [ ] 5.2 Update `formState` type to `'loading' | 'config'`
- [ ] 5.3 Remove state: `loginUsername`
- [ ] 5.4 Remove state: `loginPassword`
- [ ] 5.5 Remove state: `loginError`
- [ ] 5.6 Remove function: `handleLogin`
- [ ] 5.7 Remove JSX: login form render block
- [ ] 5.8 Update `loadConfiguration` useEffect logic
- [ ] 5.9 Remove `hasCredentials` check and `setFormState('login')`
- [ ] 5.10 Always set `setFormState('config')` after loading
- [ ] 5.11 Run tests - expect all to pass (24/24 after removals)

### Phase 6: Update E2E Tests
- [ ] 6.1 Update test: "should not require credentials to access config form"
- [ ] 6.2 Add test: "should fetch scanners with form credentials on first run"
- [ ] 6.3 Update test: "should populate scanner dropdown after successful fetch"
- [ ] 6.4 Remove login-related E2E tests if any
- [ ] 6.5 Run E2E tests - verify they pass (requires dev server running)

### Phase 7: Manual Testing
- [ ] 7.1 Test: Delete ~/.bloom/ and start app
- [ ] 7.2 Test: Verify config form shown immediately (no login)
- [ ] 7.3 Test: Enter ALL config fields (scanner name, camera IP, scans dir, API URL, credentials)
- [ ] 7.4 Test: Click "Fetch Scanners" before saving
- [ ] 7.5 Test: Verify scanner list populates
- [ ] 7.6 Test: Click "Save Configuration"
- [ ] 7.7 Test: Verify only .env file created (NO config.json)
- [ ] 7.8 Test: Check .env contains all fields (scanner name, camera IP, etc.)
- [ ] 7.9 Test: Restart app
- [ ] 7.10 Test: Verify form pre-filled with ALL values, no login screen
- [ ] 7.11 Test: Modify credentials in form (don't save)
- [ ] 7.12 Test: Click "Fetch Scanners" with modified credentials
- [ ] 7.13 Test: Verify uses NEW credentials from form

### Phase 7b: Migration Testing
- [ ] 7b.1 Test: Create old-style config.json + .env files manually
- [ ] 7b.2 Test: Start app
- [ ] 7b.3 Test: Verify form loads with values from BOTH files
- [ ] 7b.4 Test: Verify config.json deleted after load
- [ ] 7b.5 Test: Verify .env now contains ALL fields
- [ ] 7b.6 Test: Restart app again
- [ ] 7b.7 Test: Verify loads correctly from .env only

### Phase 8: Cleanup & Documentation
- [ ] 8.1 Remove `config:validate-credentials` IPC handler from src/main/main.ts
- [ ] 8.2 Remove `validateCredentials` from src/main/preload.ts
- [ ] 8.3 Remove `validateCredentials` from src/types/electron.d.ts
- [ ] 8.4 Add code comments explaining credential purpose
- [ ] 8.5 Update any affected documentation
- [ ] 8.6 Run full test suite: `npm run test:unit`
- [ ] 8.7 Run linter: `npm run lint`
- [ ] 8.8 Format code: `npm run format`

## Acceptance Criteria

### Functional Requirements
- ✓ No login screen shown on app start (first run or returning user)
- ✓ Configuration form loads immediately
- ✓ Form pre-filled with ALL saved values (scanner name, camera IP, credentials, etc.)
- ✓ "Fetch Scanners" button works on first run (no saved .env)
- ✓ "Fetch Scanners" button uses form credentials, not file
- ✓ ALL configuration saved to single .env file (no config.json)
- ✓ Automatic migration from legacy config.json to .env
- ✓ Matches pilot implementation pattern (single file, no login screen)

### Technical Requirements
- ✓ Single `loadEnvConfig()` function replaces dual load functions
- ✓ Single `saveEnvConfig()` function replaces dual save functions
- ✓ `MachineConfig` interface includes all fields (config + credentials)
- ✓ Removed: `MachineCredentials` interface (merged into MachineConfig)
- ✓ Removed: `config.json` file and CONFIG_PATH constant
- ✓ Removed: Login screen UI
- ✓ Removed: `handleLogin` function
- ✓ Removed: Login state variables
- ✓ Removed: `config:validate-credentials` IPC handler
- ✓ Removed: `validateCredentials` API
- ✓ IPC handler `config:fetch-scanners` accepts parameters
- ✓ Renderer uses unified config state (no separate credentials state)
- ✓ Migration logic automatically merges legacy files

### Testing Requirements
- ✓ All unit tests pass (24+ tests expected after removals)
- ✓ All E2E tests pass (7 tests in machine-config-fetch-scanners.e2e.ts)
- ✓ Manual testing checklist completed
- ✓ No regression in existing features

## Technical Notes

### IPC Handler Change

**Before**:
```typescript
ipcMain.handle('config:fetch-scanners', async () => {
  const config = loadConfig(CONFIG_PATH);
  const credentials = loadCredentials(ENV_PATH); // ❌ Loads from file
  return await fetchScannersFromBloom(config.bloom_api_url, credentials);
});
```

**After**:
```typescript
ipcMain.handle('config:fetch-scanners', async (
  _event,
  apiUrl: string,
  credentials: MachineCredentials
) => {
  // ✅ Uses provided credentials from form
  return await fetchScannersFromBloom(apiUrl, credentials);
});
```

### Renderer Change

**Before**:
```typescript
const fetchScanners = async () => {
  const result = await window.electron.config.fetchScanners(); // ❌ No params
  // ...
};
```

**After**:
```typescript
const fetchScanners = async () => {
  // ✅ Pass form state as parameters
  const result = await window.electron.config.fetchScanners(
    config.bloom_api_url,
    credentials
  );
  // ...
};
```

### FormState Simplification

**Before**:
```typescript
type FormState = 'loading' | 'login' | 'config';
const [formState, setFormState] = useState<FormState>('loading');

// Load logic
if (configData.hasCredentials) {
  setFormState('login'); // ❌ Show login screen
} else {
  setFormState('config');
}
```

**After**:
```typescript
type FormState = 'loading' | 'config';
const [formState, setFormState] = useState<FormState>('loading');

// Load logic - always go to config
setFormState('config'); // ✅ Direct to config form
```

### Configuration Consolidation

**Before** (dual storage):
```typescript
// config-store.ts
const CONFIG_PATH = path.join(homedir, '.bloom', 'config.json');
const ENV_PATH = path.join(homedir, '.bloom', '.env');

interface MachineConfig {
  scanner_name: string;
  camera_ip_address: string;
  scans_dir: string;
  bloom_api_url: string;
}

interface MachineCredentials {
  bloom_scanner_username: string;
  bloom_scanner_password: string;
  bloom_anon_key: string;
}

loadConfig(CONFIG_PATH);      // Reads config.json
loadCredentials(ENV_PATH);    // Reads .env
```

**After** (unified .env):
```typescript
// config-store.ts
const ENV_PATH = path.join(homedir, '.bloom', '.env');

interface MachineConfig {
  scanner_name: string;
  camera_ip_address: string;
  scans_dir: string;
  bloom_api_url: string;
  bloom_scanner_username: string;  // ✅ Merged
  bloom_scanner_password: string;  // ✅ Merged
  bloom_anon_key: string;          // ✅ Merged
}

loadEnvConfig(ENV_PATH);  // ✅ Reads everything from .env
```

**`.env` file format**:
```env
SCANNER_NAME=PBIOBScanner
CAMERA_IP_ADDRESS=10.0.0.50
SCANS_DIR=/Users/scanner/.bloom/scans
BLOOM_API_URL=https://api.bloom.salk.edu/proxy
BLOOM_SCANNER_USERNAME=pbiob_scanner@salk.edu
BLOOM_SCANNER_PASSWORD=scanner_password_123
BLOOM_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Files Modified

**Main Process**:
- `src/main/config-store.ts` - **MAJOR REFACTOR**: Consolidate to single .env
- `src/main/main.ts` - Update IPC handlers for unified config
- `src/main/preload.ts` - Update API signatures

**Renderer**:
- `src/renderer/MachineConfiguration.tsx` - Merge state, remove login UI

**Types**:
- `src/types/electron.d.ts` - Update interfaces and API signatures

**Tests**:
- `tests/unit/config-ipc.test.ts` - Add parameterized handler tests
- `tests/unit/pages/MachineConfiguration.test.tsx` - Remove login tests
- `tests/e2e/machine-config-fetch-scanners.e2e.ts` - Update for new flow

## Dependencies

- **Depends on**: `add-fetch-scanners-button` (completed)
- **Blocks**: Future Bloom upload implementation
- **Related**: Pilot implementation pattern

## Rollback Plan

If issues discovered:
1. Revert single commit containing all changes
2. Login screen restored
3. Fetch button fix can be cherry-picked separately
4. No data loss (`.env` files unaffected)

## Questions Resolved

1. **Q**: Should we keep credential persistence?
   **A**: YES - required for future Bloom API uploads

2. **Q**: Did pilot have a login screen?
   **A**: NO - pilot loads config directly from YAML

3. **Q**: What are credentials for?
   **A**: Supabase authentication for Bloom API access

4. **Q**: Are scanners separate user accounts?
   **A**: NO - they're service accounts for scanner machines

5. **Q**: Should we use OS keychain?
   **A**: DEFERRED - .env acceptable for MVP, can enhance later
