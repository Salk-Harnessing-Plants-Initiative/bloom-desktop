# Tasks: Add Scanner Identity Service

## Implementation Checklist (TDD Approach)

### Phase 1: Write Unit Tests First (TDD)

- [x] 1.1 Create `tests/unit/scanner-identity.test.ts`
- [x] 1.2 Add test: Scanner identity initialized from config on startup
- [x] 1.3 Add test: `scanner:get-scanner-id` returns current identity
- [x] 1.4 Add test: Scanner identity updates when config saved successfully
- [x] 1.5 Add test: Scanner identity unchanged when config save fails
- [x] 1.6 Add test: Scanner identity defaults to empty string on first run
- [x] 1.7 Run tests: `npm run test:unit` - expect 5 failures ❌

### Phase 2: Implement Scanner Identity Service (TDD)

- [x] 2.1 Add `scannerIdentity` variable in src/main/main.ts (after line 83)
- [x] 2.2 Initialize `scannerIdentity` from config at app startup
- [x] 2.3 Add `scanner:get-scanner-id` IPC handler
- [x] 2.4 Update `config:set` handler to sync scannerIdentity on success
- [x] 2.5 Add code comments explaining scanner identity purpose
- [x] 2.6 Run tests: `npm run test:unit` - expect all scanner-identity tests to pass ✅

### Phase 3: Update Preload and Types (TDD)

- [x] 3.1 Add `getScannerId` function to scanner API in src/main/preload.ts
- [x] 3.2 Update `ScannerAPI` interface in src/types/scanner.ts (uses import in electron.d.ts)
- [x] 3.3 Add JSDoc comments to `getScannerId` method
- [x] 3.4 Run TypeScript compiler: `npx tsc --noEmit` - expect no errors ✅

### Phase 4: Write Layout Component Tests (TDD)

- [x] 4.1 Add test: Layout displays scanner name from scanner:get-scanner-id
- [x] 4.2 Add test: Layout shows "Not configured" when scanner name empty
- [x] 4.3 Add test: Layout updates display when scanner identity changes
- [x] 4.4 Run tests: `npm run test:unit` - expect 3 failures ❌

### Phase 5: Update Layout Component (TDD)

- [x] 5.1 Update Layout useEffect to call `window.electron.scanner.getScannerId()`
- [x] 5.2 Change from single load to periodic refresh (every 2 seconds)
- [x] 5.3 Update scanner name display logic ("Not configured" fallback)
- [x] 5.4 Add cleanup for interval on unmount
- [x] 5.5 Run tests: `npm run test:unit` - expect all Layout tests to pass ✅

### Phase 6: Integration Testing

- [x] 6.1 Manual test: Start app with existing config
- [x] 6.2 Manual test: Verify scanner name displays in Layout
- [x] 6.3 Manual test: Navigate to Machine Configuration
- [x] 6.4 Manual test: Change scanner name and save
- [x] 6.5 Manual test: Return to Layout - verify name updated (no restart)
- [x] 6.6 Manual test: Restart app - verify name persists
- [x] 6.7 Manual test: Delete ~/.bloom/ - verify "Not configured" shows

### Phase 7: Create Spec Delta

- [x] 7.1 Create `specs/scanner-api/spec.md` (already done ✅)
- [x] 7.2 Document all requirements and scenarios (already done ✅)
- [x] 7.3 Run validation: `npx openspec validate add-scanner-identity-service`
- [x] 7.4 Fix any validation errors

### Phase 8: Code Quality and Cleanup

- [x] 8.1 Run linter: `npm run lint` - fix any errors
- [x] 8.2 Run formatter: `npm run format`
- [x] 8.3 Run full test suite: `npm run test:unit` - expect all tests to pass ✅
- [x] 8.4 Review all code comments for clarity
- [x] 8.5 Verify no console.log statements left in code
- [x] 8.6 Check TypeScript types are complete

## Acceptance Criteria

### Functional Requirements

- ✓ Scanner name displays in Layout after saving config
- ✓ No app restart required to see updated name
- ✓ "Not configured" shown when scanner name empty
- ✓ Scanner name persists across app restarts
- ✓ Matches pilot's `scanner:get-scanner-id` API pattern

### Technical Requirements

- ✓ `scannerIdentity` variable holds runtime state
- ✓ `scanner:get-scanner-id` IPC handler returns identity
- ✓ `config:set` syncs `scannerIdentity` from saved config
- ✓ Layout uses `scanner:get-scanner-id` not `config:get`
- ✓ Initialization from `.env` at app startup
- ✓ All unit tests pass (5 scanner identity + 3 Layout tests)
- ✓ No breaking changes to existing APIs

### Code Quality Requirements

- ✓ Code comments explain scanner identity purpose
- ✓ Follows existing runtime state pattern (camera settings)
- ✓ TypeScript types for all new APIs
- ✓ Linter passes with no errors
- ✓ Formatter applied to all modified files

## Technical Implementation Notes

### Scanner Identity Variable

```typescript
// src/main/main.ts (after line 83, near currentCameraSettings)

/**
 * Scanner identity (runtime state)
 *
 * Holds the current scanner name, initialized from .env at startup
 * and synced when config is saved. Provides fast in-memory access
 * for UI components without file I/O.
 *
 * Pattern matches currentCameraSettings (ephemeral runtime state).
 * Pilot reference: bloom-desktop-pilot/app/src/main/main.ts:148
 */
let scannerIdentity: { name: string } = { name: '' };
```

### Initialization at Startup

```typescript
// src/main/main.ts (in app startup code, after loadEnvConfig)

// Initialize scanner identity from config
const config = loadEnvConfig(ENV_PATH);
scannerIdentity.name = config.scanner_name || '';
console.log(
  '[Scanner Identity] Initialized:',
  scannerIdentity.name || '(not configured)'
);
```

### IPC Handler

```typescript
// src/main/main.ts (with other scanner IPC handlers)

/**
 * Handle scanner:get-scanner-id - Get current scanner identity
 *
 * Returns the scanner's configured name from runtime state.
 * Matches pilot API: scanner.getScannerId()
 *
 * @returns {string} Scanner name or empty string if not configured
 */
ipcMain.handle('scanner:get-scanner-id', (): string => {
  return scannerIdentity.name;
});
```

### Sync on Config Save

```typescript
// src/main/main.ts (in config:set handler)

ipcMain.handle('config:set', async (_event, config: MachineConfig) => {
  try {
    const validation = validateConfig(config);
    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    saveEnvConfig(config, ENV_PATH);

    // Sync scanner identity from saved config
    scannerIdentity.name = config.scanner_name || '';
    console.log('[Scanner Identity] Updated:', scannerIdentity.name);

    return { success: true };
  } catch (error) {
    console.error('config:set error:', error);
    return {
      success: false,
      errors: {
        general:
          error instanceof Error ? error.message : 'Unknown error occurred',
      },
    };
  }
});
```

### Preload API

```typescript
// src/main/preload.ts (in scanner API)

const scannerAPI = {
  initialize: (settings: ScannerSettings) =>
    ipcRenderer.invoke('scanner:initialize', settings),
  scan: () => ipcRenderer.invoke('scanner:scan'),
  cleanup: () => ipcRenderer.invoke('scanner:cleanup'),
  getStatus: () => ipcRenderer.invoke('scanner:get-status'),
  onProgress: (callback: (progress: ScanProgress) => void) => {
    ipcRenderer.on('scanner:progress', (_event, progress) =>
      callback(progress)
    );
  },
  onComplete: (callback: (result: ScanResult) => void) => {
    ipcRenderer.on('scanner:complete', (_event, result) => callback(result));
  },
  onError: (callback: (error: string) => void) => {
    ipcRenderer.on('scanner:error', (_event, error) => callback(error));
  },
  /**
   * Get the current scanner identity (name).
   *
   * Returns the scanner's configured name from runtime state.
   * Returns empty string if scanner not configured.
   *
   * @returns {Promise<string>} Scanner name
   */
  getScannerId: (): Promise<string> =>
    ipcRenderer.invoke('scanner:get-scanner-id'),
};
```

### TypeScript Types

```typescript
// src/types/electron.d.ts (in ScannerAPI interface)

export interface ScannerAPI {
  initialize: (
    settings: ScannerSettings
  ) => Promise<{ success: boolean; initialized: boolean }>;
  scan: () => Promise<{ success: boolean }>;
  cleanup: () => Promise<{ success: boolean; initialized: boolean }>;
  getStatus: () => Promise<ScannerStatus>;
  onProgress: (callback: (progress: ScanProgress) => void) => void;
  onComplete: (callback: (result: ScanResult) => void) => void;
  onError: (callback: (error: string) => void) => void;

  /**
   * Get the current scanner identity (name).
   *
   * Returns the scanner's configured name from runtime state.
   * Returns empty string if scanner not configured.
   *
   * @returns {Promise<string>} Scanner name
   */
  getScannerId: () => Promise<string>;
}
```

### Layout Component Update

```typescript
// src/renderer/Layout.tsx

const [scannerName, setScannerName] = useState<string>('');

// Load scanner name from identity service
useEffect(() => {
  const loadScannerName = async () => {
    try {
      const name = await window.electron.scanner.getScannerId();
      setScannerName(name || '');
    } catch (error) {
      console.error('Failed to load scanner identity:', error);
    }
  };

  // Load on mount
  loadScannerName();

  // Refresh every 2 seconds to catch config updates
  const interval = setInterval(loadScannerName, 2000);

  return () => clearInterval(interval);
}, []);

// Display in footer
<div className="p-4 border-t border-gray-200">
  <p className="text-xs text-gray-500">
    Scanner: {scannerName || 'Not configured'}
  </p>
</div>
```

## Test Specifications

### Unit Tests: Scanner Identity

```typescript
// tests/unit/scanner-identity.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ipcMain } from 'electron';
import { loadEnvConfig, saveEnvConfig } from '../../src/main/config-store';

vi.mock('../../src/main/config-store');

describe('Scanner Identity Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize scanner identity from config on startup', () => {
    // Mock config load
    vi.mocked(loadEnvConfig).mockReturnValue({
      scanner_name: 'TestScanner',
      // ... other fields
    });

    // Simulate app startup
    // ... initialization code

    // Verify scannerIdentity set correctly
    // Call scanner:get-scanner-id and verify return value
  });

  it('should return scanner identity via scanner:get-scanner-id', async () => {
    // Set scannerIdentity to known value
    // Call IPC handler
    // Verify correct value returned
  });

  it('should update scanner identity when config saved successfully', async () => {
    // Mock successful save
    vi.mocked(saveEnvConfig).mockReturnValue(undefined);

    // Call config:set with new scanner_name
    // Verify scannerIdentity updated
    // Call scanner:get-scanner-id and verify new value
  });

  it('should not update scanner identity when config save fails', async () => {
    // Mock failed save
    vi.mocked(saveEnvConfig).mockImplementation(() => {
      throw new Error('Disk error');
    });

    // Set initial scannerIdentity
    // Call config:set with new scanner_name
    // Verify scannerIdentity unchanged
  });

  it('should default to empty string if not configured', () => {
    // Mock config with empty scanner_name
    vi.mocked(loadEnvConfig).mockReturnValue({
      scanner_name: '',
      // ... other fields
    });

    // Simulate app startup
    // Call scanner:get-scanner-id
    // Verify returns empty string
  });
});
```

### Component Tests: Layout

```typescript
// tests/unit/components/Layout.test.tsx

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Layout } from '../../../src/renderer/Layout';

describe('Layout scanner name display', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should display scanner name from scanner:get-scanner-id', async () => {
    // Mock getScannerId
    window.electron.scanner.getScannerId = vi.fn().mockResolvedValue('PBIOBScanner');

    render(<Layout />);

    await waitFor(() => {
      expect(screen.getByText(/Scanner: PBIOBScanner/)).toBeInTheDocument();
    });

    expect(window.electron.scanner.getScannerId).toHaveBeenCalled();
  });

  it('should show "Not configured" when scanner name empty', async () => {
    // Mock getScannerId returning empty string
    window.electron.scanner.getScannerId = vi.fn().mockResolvedValue('');

    render(<Layout />);

    await waitFor(() => {
      expect(screen.getByText(/Scanner: Not configured/)).toBeInTheDocument();
    });
  });

  it('should update display when scanner identity changes', async () => {
    // Mock getScannerId returning initial value
    const getScannerId = vi.fn()
      .mockResolvedValueOnce('OldScanner')
      .mockResolvedValueOnce('NewScanner');

    window.electron.scanner.getScannerId = getScannerId;

    render(<Layout />);

    // Verify initial display
    await waitFor(() => {
      expect(screen.getByText(/Scanner: OldScanner/)).toBeInTheDocument();
    });

    // Wait for interval refresh
    await waitFor(() => {
      expect(screen.getByText(/Scanner: NewScanner/)).toBeInTheDocument();
    }, { timeout: 3000 });

    expect(getScannerId).toHaveBeenCalledTimes(2);
  });
});
```

## Files Modified

### Main Process

- `src/main/main.ts` - Add scanner identity service
- `src/main/preload.ts` - Add getScannerId API
- `src/types/electron.d.ts` - Add type definitions

### Renderer

- `src/renderer/Layout.tsx` - Use scanner identity service

### Tests

- `tests/unit/scanner-identity.test.ts` - **NEW** (unit tests)
- `tests/unit/components/Layout.test.tsx` - Update (if exists) or create

### Spec

- `openspec/changes/add-scanner-identity-service/proposal.md` - ✓ Created
- `openspec/changes/add-scanner-identity-service/specs/scanner-api/spec.md` - ✓ Created
- `openspec/changes/add-scanner-identity-service/tasks.md` - ✓ This file

## Dependencies

- **Depends on**: `fix-credentials-and-remove-login` (completed - config:set handler exists)
- **Blocks**: None
- **Related**: Camera settings runtime state pattern (existing)

## Estimated Effort

- **Phase 1 (Tests)**: 15 minutes
- **Phase 2 (Service)**: 20 minutes
- **Phase 3 (Types)**: 10 minutes
- **Phase 4 (Component Tests)**: 10 minutes
- **Phase 5 (Layout)**: 15 minutes
- **Phase 6 (Integration)**: 10 minutes
- **Phase 7 (Spec)**: 5 minutes (already done)
- **Phase 8 (Cleanup)**: 10 minutes

**Total**: ~90 minutes
