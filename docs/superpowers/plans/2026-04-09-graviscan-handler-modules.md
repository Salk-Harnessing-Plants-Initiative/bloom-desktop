# GraviScan Handler Modules (Increment 3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the monolithic `graviscan-handlers.ts` (1,338 lines) from PR #138 into 3 focused, testable service modules with comprehensive unit tests.

**Architecture:** Extract 15 IPC handlers from `origin/graviscan/4-main-process:src/main/graviscan-handlers.ts` into `src/main/graviscan/scanner-handlers.ts`, `session-handlers.ts`, and `image-handlers.ts`. Each module exports async functions testable via direct import — no `ipcMain` dependency. Key deps (Prisma, coordinator, session fns) injected as parameters; external deps (`detectEpsonScanners`, `sharp`, `fs`) module-mocked in tests.

**Tech Stack:** TypeScript, Vitest, Prisma (mocked), sharp (mocked), Electron `app` API (mocked)

**Source branch:** `origin/graviscan/4-main-process` (PR #138, Ben's branch)

**Reference:** `openspec/changes/add-graviscan-handler-modules/` (proposal, design, tasks, spec)

---

## File Structure

```
src/main/graviscan/
├── scanner-handlers.ts     # ~500 LOC — scanner detection, config, validation, platform
├── session-handlers.ts     # ~400 LOC — scan lifecycle: start, status, cancel
├── image-handlers.ts       # ~400 LOC — image read, export, upload
└── index.ts                # barrel export + IPC channel mapping JSDoc

tests/unit/graviscan/
├── scanner-handlers.test.ts
├── session-handlers.test.ts
└── image-handlers.test.ts
```

Cherry-picked dependencies (already exist in Ben's branch, need to land on our branch):

- `src/main/lsusb-detection.ts`
- `src/main/graviscan-path-utils.ts`
- `src/main/box-backup.ts`

---

### Task 0: Cherry-Pick Dependencies

**Files:**

- Create: `src/main/lsusb-detection.ts` (from Ben's branch)
- Create: `src/main/graviscan-path-utils.ts` (from Ben's branch)
- Create: `src/main/box-backup.ts` (from Ben's branch)

- [ ] **Step 1: Extract lsusb-detection.ts from Ben's branch**

```bash
git show origin/graviscan/4-main-process:src/main/lsusb-detection.ts > src/main/lsusb-detection.ts
```

- [ ] **Step 2: Extract graviscan-path-utils.ts from Ben's branch**

```bash
git show origin/graviscan/4-main-process:src/main/graviscan-path-utils.ts > src/main/graviscan-path-utils.ts
```

- [ ] **Step 3: Extract box-backup.ts from Ben's branch**

```bash
git show origin/graviscan/4-main-process:src/main/box-backup.ts > src/main/box-backup.ts
```

- [ ] **Step 4: Create the graviscan module directory**

```bash
mkdir -p src/main/graviscan tests/unit/graviscan
```

- [ ] **Step 5: Verify all three files compile**

Run: `npx prisma generate && npx tsc --noEmit`
Expected: No errors. Cherry-picked files depend on Prisma models (GraviScan, GraviImage, GraviScanner) that exist in the schema. `prisma generate` ensures the client types are up to date.

- [ ] **Step 6: Commit**

```bash
git add src/main/lsusb-detection.ts src/main/graviscan-path-utils.ts src/main/box-backup.ts
git commit -m "chore: cherry-pick graviscan utility files from PR #138

Extract lsusb-detection, graviscan-path-utils, and box-backup from
origin/graviscan/4-main-process. Required as imports for handler modules."
```

---

### Task 1: Scanner Handlers — Tests

**Files:**

- Create: `tests/unit/graviscan/scanner-handlers.test.ts`

- [ ] **Step 1: Write scanner-handlers test file with mocks and detectScanners tests**

```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Module-mock detectEpsonScanners before importing the module under test
vi.mock('../../../src/main/lsusb-detection', () => ({
  detectEpsonScanners: vi.fn(),
}));

import { detectEpsonScanners } from '../../../src/main/lsusb-detection';
import {
  detectScanners,
  saveScannersToDB,
  getConfig,
  saveConfig,
  getPlatformInfo,
  validateConfig,
  runStartupScannerValidation,
  getSessionValidationState,
  resetSessionValidation,
} from '../../../src/main/graviscan/scanner-handlers';
import type { DetectedScanner } from '../../../src/types/graviscan';

const mockDetect = vi.mocked(detectEpsonScanners);

// Helper: create a mock PrismaClient
function createMockDb() {
  return {
    graviScanner: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
    },
    graviConfig: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
    },
  } as any;
}

const MOCK_SCANNER: DetectedScanner = {
  name: 'Perfection V600 Photo',
  scanner_id: 'scanner-1',
  usb_bus: 1,
  usb_device: 2,
  usb_port: '1-2',
  is_available: true,
  vendor_id: '04b8',
  product_id: '013a',
  sane_name: 'epkowa:interpreter:001:002',
};

describe('scanner-handlers', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    vi.stubEnv('GRAVISCAN_MOCK', '');
    mockDetect.mockReset();
  });

  describe('detectScanners', () => {
    it('should return detected scanners from lsusb', async () => {
      mockDetect.mockReturnValue({
        success: true,
        scanners: [MOCK_SCANNER],
        count: 1,
      });

      const result = await detectScanners(db);

      expect(result.success).toBe(true);
      expect(result.scanners).toHaveLength(1);
      expect(result.scanners[0].vendor_id).toBe('04b8');
    });

    it('should return mock scanners when GRAVISCAN_MOCK is true', async () => {
      vi.stubEnv('GRAVISCAN_MOCK', 'true');
      db.graviScanner.findMany.mockResolvedValue([
        {
          id: 'db-1',
          name: 'Scanner 1',
          vendor_id: '04b8',
          product_id: '013a',
          usb_bus: 1,
          usb_device: 1,
          usb_port: '1-1',
          enabled: true,
        },
      ]);

      const result = await detectScanners(db);

      expect(result.success).toBe(true);
      expect(result.mock).toBe(true);
      expect(mockDetect).not.toHaveBeenCalled();
    });

    it('should propagate detection failure', async () => {
      mockDetect.mockReturnValue({
        success: false,
        error: 'lsusb not found',
        scanners: [],
        count: 0,
      });

      const result = await detectScanners(db);

      expect(result.success).toBe(false);
      expect(result.error).toBe('lsusb not found');
    });
  });

  describe('saveScannersToDB', () => {
    it('should create new scanner records', async () => {
      db.graviScanner.findFirst.mockResolvedValue(null);
      db.graviScanner.create.mockResolvedValue({
        id: 'new-1',
        name: 'Scanner 1',
        vendor_id: '04b8',
        product_id: '013a',
        usb_bus: 1,
        usb_device: 2,
        usb_port: '1-2',
        enabled: true,
      });

      const result = await saveScannersToDB(db, [
        {
          name: 'Scanner 1',
          vendor_id: '04b8',
          product_id: '013a',
          usb_bus: 1,
          usb_device: 2,
          usb_port: '1-2',
        },
      ]);

      expect(result.success).toBe(true);
      expect(result.scanners).toHaveLength(1);
      expect(db.graviScanner.create).toHaveBeenCalled();
    });

    it('should update existing scanner matched by USB port', async () => {
      // findFirst returns null for bus+device, then returns existing for port match
      db.graviScanner.findFirst.mockImplementation(async ({ where }: any) => {
        if (where?.usb_port === '1-2') {
          return {
            id: 'existing-1',
            name: 'Old Name',
            usb_port: '1-2',
            display_name: null,
          };
        }
        return null;
      });
      db.graviScanner.update.mockResolvedValue({
        id: 'existing-1',
        name: 'Scanner 1',
        vendor_id: '04b8',
        product_id: '013a',
        usb_bus: 1,
        usb_device: 2,
        usb_port: '1-2',
        enabled: true,
      });

      const result = await saveScannersToDB(db, [
        {
          name: 'Scanner 1',
          vendor_id: '04b8',
          product_id: '013a',
          usb_bus: 1,
          usb_device: 2,
          usb_port: '1-2',
        },
      ]);

      expect(result.success).toBe(true);
      expect(result.scanners[0].id).toBe('existing-1');
      expect(result.scanners[0].name).toBe('Scanner 1');
    });
  });

  describe('getConfig', () => {
    it('should return config from database', async () => {
      db.graviConfig.findFirst.mockResolvedValue({
        id: '1',
        grid_mode: '2grid',
        resolution: 600,
        format: 'tiff',
      });

      const result = await getConfig(db);

      expect(result.success).toBe(true);
      expect(result.config?.grid_mode).toBe('2grid');
    });

    it('should return null when no config exists', async () => {
      db.graviConfig.findFirst.mockResolvedValue(null);

      const result = await getConfig(db);

      expect(result.success).toBe(true);
      expect(result.config).toBeNull();
    });
  });

  describe('saveConfig', () => {
    it('should create config when none exists', async () => {
      db.graviConfig.findFirst.mockResolvedValue(null);
      db.graviConfig.create.mockResolvedValue({
        id: '1',
        grid_mode: '4grid',
        resolution: 1200,
        format: 'tiff',
      });

      const result = await saveConfig(db, {
        grid_mode: '4grid',
        resolution: 1200,
      });

      expect(result.success).toBe(true);
      expect(db.graviConfig.create).toHaveBeenCalled();
    });

    it('should update existing config', async () => {
      db.graviConfig.findFirst.mockResolvedValue({ id: '1' });
      db.graviConfig.update.mockResolvedValue({
        id: '1',
        grid_mode: '2grid',
        resolution: 600,
        format: 'tiff',
      });

      const result = await saveConfig(db, {
        grid_mode: '2grid',
        resolution: 600,
      });

      expect(result.success).toBe(true);
      expect(db.graviConfig.update).toHaveBeenCalled();
    });
  });

  describe('getPlatformInfo', () => {
    const originalPlatform = process.platform;

    afterEach(() => {
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    });

    it('should return sane backend on linux', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });
      const result = await getPlatformInfo();

      expect(result.success).toBe(true);
      expect(result.backend).toBe('sane');
    });

    it('should return unsupported on darwin', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true,
      });
      const result = await getPlatformInfo();

      expect(result.supported).toBe(false);
      expect(result.backend).toBe('unsupported');
    });

    it('should return mock platform info when GRAVISCAN_MOCK is true', async () => {
      vi.stubEnv('GRAVISCAN_MOCK', 'true');
      const result = await getPlatformInfo();

      expect(result.success).toBe(true);
      expect(result.supported).toBe(true);
      expect(result.mock_enabled).toBe(true);
    });
  });

  describe('validateConfig', () => {
    it('should return no-config when no saved scanners', async () => {
      db.graviScanner.findMany.mockResolvedValue([]);

      const result = await validateConfig(db);

      expect(result.success).toBe(true);
      expect(result.status).toBe('no-config');
    });

    it('should match saved scanners by USB port', async () => {
      db.graviScanner.findMany.mockResolvedValue([
        {
          id: 's1',
          name: 'Scanner 1',
          usb_port: '1-2',
          vendor_id: '04b8',
          product_id: '013a',
          enabled: true,
        },
      ]);
      mockDetect.mockReturnValue({
        success: true,
        scanners: [{ ...MOCK_SCANNER, usb_port: '1-2' }],
        count: 1,
      });

      const result = await validateConfig(db);

      expect(result.success).toBe(true);
      expect(result.status).toBe('valid');
      expect(result.matched).toHaveLength(1);
      expect(result.missing).toHaveLength(0);
    });

    it('should report missing scanners', async () => {
      db.graviScanner.findMany.mockResolvedValue([
        {
          id: 's1',
          name: 'Scanner 1',
          usb_port: '1-2',
          vendor_id: '04b8',
          product_id: '013a',
          enabled: true,
        },
      ]);
      mockDetect.mockReturnValue({ success: true, scanners: [], count: 0 });

      const result = await validateConfig(db);

      expect(result.status).toBe('mismatch');
      expect(result.missing).toHaveLength(1);
    });
  });

  describe('runStartupScannerValidation', () => {
    it('should skip validation when no cached scanners', async () => {
      resetSessionValidation();
      const result = await runStartupScannerValidation(db, []);

      expect(result.isValidated).toBe(false);
      expect(result.isValidating).toBe(false);
    });

    it('should validate cached scanners against detected hardware', async () => {
      db.graviScanner.findMany.mockResolvedValue([
        {
          id: 's1',
          name: 'Scanner 1',
          vendor_id: '04b8',
          product_id: '013a',
          enabled: true,
        },
      ]);
      mockDetect.mockReturnValue({
        success: true,
        scanners: [{ ...MOCK_SCANNER, scanner_id: 's1' }],
        count: 1,
      });

      resetSessionValidation();
      const result = await runStartupScannerValidation(db, ['s1']);

      expect(result.isValidated).toBe(true);
      expect(result.allScannersAvailable).toBe(true);
    });
  });

  describe('getSessionValidationState / resetSessionValidation', () => {
    it('should return current state and reset', () => {
      resetSessionValidation();
      const state = getSessionValidationState();
      expect(state.isValidating).toBe(false);
      expect(state.isValidated).toBe(false);
      expect(state.detectedScanners).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/graviscan/scanner-handlers.test.ts --reporter=verbose`
Expected: FAIL — `Cannot find module '../../../src/main/graviscan/scanner-handlers'`

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/unit/graviscan/scanner-handlers.test.ts
git commit -m "test: add scanner-handlers unit tests (red)

Tests for detectScanners, saveScannersToDB, getConfig, saveConfig,
getPlatformInfo, validateConfig, runStartupScannerValidation, and
validation state accessors. All tests fail — implementation next."
```

---

### Task 2: Scanner Handlers — Implementation

**Files:**

- Create: `src/main/graviscan/scanner-handlers.ts`

- [ ] **Step 1: Implement scanner-handlers.ts**

Extract and adapt the following handlers from `origin/graviscan/4-main-process:src/main/graviscan-handlers.ts`:

- `graviscan:detect-scanners` (lines 236-352)
- `graviscan:get-config` (lines 362-380)
- `graviscan:save-config` (lines 383-424)
- `graviscan:save-scanners-db` (lines 434-557)
- `graviscan:platform-info` (lines 568-613)
- `graviscan:validate-scanners` (lines 621-636) — delegates to `runStartupScannerValidation`
- `graviscan:validate-config` (lines 638-772)
- Plus: `runStartupScannerValidation` (lines 56-190), `getSessionValidationState` (lines 191-196), `resetSessionValidation` (lines 198-206)

Key adaptations from Ben's code:

- Remove `ipcMain.handle()` wrappers — export naked async functions
- Replace module-level `db` with `db: PrismaClient` parameter on every function
- Keep module-level `sessionValidation` state + exported `resetSessionValidation()`
- Scanner model: Epson Perfection V600 (USB `04b8:013a`)

```bash
git show origin/graviscan/4-main-process:src/main/graviscan-handlers.ts > /tmp/graviscan-handlers-full.ts
```

Then create `src/main/graviscan/scanner-handlers.ts` by extracting and refactoring the relevant sections. The file should:

1. Import `PrismaClient`, `detectEpsonScanners`, and types from `../types/graviscan`
2. Define and export `SessionValidationState` interface
3. Keep module-level `sessionValidation` const + `resetSessionValidation()` + `getSessionValidationState()`
4. Export `runStartupScannerValidation(db, cachedScannerIds)` — adapted from lines 56-190, with `db` as first param
5. Export `detectScanners(db)` — adapted from lines 236-352
6. Export `getConfig(db)` — adapted from lines 362-380
7. Export `saveConfig(db, configInput)` — adapted from lines 383-424
8. Export `saveScannersToDB(db, scanners)` — adapted from lines 434-557
9. Export `getPlatformInfo()` — adapted from lines 568-613 (no `db` needed)
10. Export `validateConfig(db)` — adapted from lines 638-772

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/unit/graviscan/scanner-handlers.test.ts --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 3: Run TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/main/graviscan/scanner-handlers.ts
git commit -m "feat: add scanner-handlers module (green)

Extracts 7 handlers + 3 validation state functions from Ben's
graviscan-handlers.ts. Pure exports with db injection, no ipcMain."
```

---

### Task 3: Session Handlers — Tests

**Files:**

- Create: `tests/unit/graviscan/session-handlers.test.ts`

- [ ] **Step 1: Write session-handlers test file**

```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Types matching Ben's ScanCoordinator + PlateConfig
interface ScanCoordinatorLike {
  readonly isScanning: boolean;
  initialize(scanners: any[]): Promise<void>;
  scanOnce(platesPerScanner: Map<string, any[]>): Promise<void>;
  scanInterval(
    platesPerScanner: Map<string, any[]>,
    intervalMs: number,
    durationMs: number
  ): Promise<void>;
  cancelAll(): void;
  shutdown(): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): this;
}

function createMockCoordinator(
  overrides: Partial<ScanCoordinatorLike> = {}
): ScanCoordinatorLike {
  return {
    isScanning: false,
    initialize: vi.fn().mockResolvedValue(undefined),
    scanOnce: vi.fn().mockResolvedValue(undefined),
    scanInterval: vi.fn().mockResolvedValue(undefined),
    cancelAll: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnThis(),
    ...overrides,
  };
}

function createMockSessionFns() {
  return {
    getScanSession: vi.fn().mockReturnValue(null),
    setScanSession: vi.fn(),
    markScanJobRecorded: vi.fn(),
  };
}

// Static imports — added after implementation exists
import {
  startScan,
  getScanStatus,
  markJobRecorded,
  cancelScan,
} from '../../../src/main/graviscan/session-handlers';

describe('session-handlers', () => {
  let coordinator: ReturnType<typeof createMockCoordinator>;
  let sessionFns: ReturnType<typeof createMockSessionFns>;
  let onError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    coordinator = createMockCoordinator();
    sessionFns = createMockSessionFns();
    onError = vi.fn();
  });

  describe('startScan', () => {
    const baseParams = {
      scanners: [
        {
          scannerId: 's1',
          saneName: 'epkowa:interpreter:001:002',
          plates: [
            {
              plate_index: '00',
              grid_mode: '2grid',
              resolution: 600,
              output_path: '/tmp/scan',
            },
          ],
        },
      ],
      metadata: {
        experimentId: 'exp-1',
        phenotyperId: 'pheno-1',
        resolution: 600,
      },
    };

    it('should reject when coordinator is null', async () => {
      const result = await startScan(
        null as any,
        baseParams,
        sessionFns,
        onError
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not initialized');
    });

    it('should reject when scan already in progress', async () => {
      coordinator = createMockCoordinator({ isScanning: true } as any);

      const result = await startScan(
        coordinator,
        baseParams,
        sessionFns,
        onError
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('already in progress');
    });

    it('should initialize coordinator and call scanOnce for one-shot', async () => {
      const result = await startScan(
        coordinator,
        baseParams,
        sessionFns,
        onError
      );

      expect(result.success).toBe(true);
      expect(coordinator.initialize).toHaveBeenCalled();
      expect(coordinator.scanOnce).toHaveBeenCalled();
      expect(sessionFns.setScanSession).toHaveBeenCalled();
    });

    it('should call scanInterval for continuous mode', async () => {
      const continuousParams = {
        ...baseParams,
        interval: { intervalSeconds: 300, durationSeconds: 3600 },
      };

      const result = await startScan(
        coordinator,
        continuousParams,
        sessionFns,
        onError
      );

      expect(result.success).toBe(true);
      expect(coordinator.scanInterval).toHaveBeenCalledWith(
        expect.any(Map),
        300000,
        3600000
      );
    });

    it('should build correct session state with jobs map', async () => {
      await startScan(coordinator, baseParams, sessionFns, onError);

      const sessionArg = sessionFns.setScanSession.mock.calls[0][0];
      expect(sessionArg.isActive).toBe(true);
      expect(sessionArg.experimentId).toBe('exp-1');
      expect(sessionArg.jobs['s1:00']).toBeDefined();
      expect(sessionArg.jobs['s1:00'].status).toBe('pending');
    });

    it('should calculate totalCycles for continuous mode', async () => {
      const continuousParams = {
        ...baseParams,
        interval: { intervalSeconds: 60, durationSeconds: 300 },
      };

      await startScan(coordinator, continuousParams, sessionFns, onError);

      const sessionArg = sessionFns.setScanSession.mock.calls[0][0];
      expect(sessionArg.totalCycles).toBe(5); // 300 / 60
    });

    it('should call onError and clear session when fire-and-forget rejects', async () => {
      const deferred = { reject: (_e: Error) => {} };
      const scanPromise = new Promise<void>((_resolve, reject) => {
        deferred.reject = reject;
      });
      coordinator = createMockCoordinator({
        scanOnce: vi.fn().mockReturnValue(scanPromise),
      } as any);

      const result = await startScan(
        coordinator,
        baseParams,
        sessionFns,
        onError
      );
      expect(result.success).toBe(true);

      // Now reject the detached promise
      deferred.reject(new Error('Subprocess crashed'));
      // Wait for the .catch() handler to execute
      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalled();
      });
      expect(sessionFns.setScanSession).toHaveBeenCalledWith(null);
    });
  });

  describe('getScanStatus', () => {
    it('should return isActive false when no session', () => {
      const result = getScanStatus(sessionFns);

      expect(result.isActive).toBe(false);
    });

    it('should return full session state when active', async () => {
      sessionFns.getScanSession.mockReturnValue({
        isActive: true,
        experimentId: 'exp-1',
        phenotyperId: 'pheno-1',
        resolution: 600,
        sessionId: null,
        jobs: { 's1:00': { status: 'pending' } },
        isContinuous: false,
        currentCycle: 0,
        totalCycles: 1,
        intervalMs: 0,
        scanStartedAt: Date.now(),
        scanDurationMs: 0,
        coordinatorState: 'scanning',
        nextScanAt: null,
        waveNumber: 0,
      });

      const result = getScanStatus(sessionFns);

      expect(result.isActive).toBe(true);
      expect(result.experimentId).toBe('exp-1');
      expect(result.jobs).toBeDefined();
    });
  });

  describe('markJobRecorded', () => {
    it('should delegate to injected markScanJobRecorded', () => {
      markJobRecorded(sessionFns, 's1:00');

      expect(sessionFns.markScanJobRecorded).toHaveBeenCalledWith('s1:00');
    });
  });

  describe('cancelScan', () => {
    it('should call cancelAll and shutdown then clear session', async () => {
      const result = await cancelScan(coordinator, sessionFns);

      expect(result.success).toBe(true);
      expect(coordinator.cancelAll).toHaveBeenCalled();
      expect(coordinator.shutdown).toHaveBeenCalled();
      expect(sessionFns.setScanSession).toHaveBeenCalledWith(null);
    });

    it('should return error when coordinator is null', async () => {
      const result = await cancelScan(null as any, sessionFns);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not initialized');
    });

    it('should return success when no scan session is active', async () => {
      // Coordinator exists but no scan in progress
      coordinator = createMockCoordinator({ isScanning: false } as any);
      const result = await cancelScan(coordinator, sessionFns);

      expect(result.success).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/graviscan/session-handlers.test.ts --reporter=verbose`
Expected: FAIL — `Cannot find module '../../../src/main/graviscan/session-handlers'`

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/unit/graviscan/session-handlers.test.ts
git commit -m "test: add session-handlers unit tests (red)

Tests for startScan (one-shot, continuous, rejection, fire-and-forget
error), getScanStatus, markJobRecorded, cancelScan. All fail."
```

---

### Task 4: Session Handlers — Implementation

**Files:**

- Create: `src/main/graviscan/session-handlers.ts`

- [ ] **Step 1: Implement session-handlers.ts**

Extract and adapt from Ben's `graviscan-handlers.ts`:

- `graviscan:start-scan` (lines 784-938)
- `graviscan:get-scan-status` (lines 940-968)
- `graviscan:mark-job-recorded` (lines 968-978)
- `graviscan:cancel-scan` (lines 979-1010)

Key adaptations:

- Define locally: `ScanCoordinatorLike` interface (`cancelAll()` not `cancelScan()`), `ScannerConfig`, `PlateConfig` (with `resolution: number`)
- Remove `ipcMain.handle()` wrappers
- Replace `getCoordinator?.()` with injected `coordinator` parameter
- Replace `getScanSession`/`setScanSession`/`markScanJobRecorded` imports from `./main` with injected `sessionFns` parameter
- Replace `getMainWindow?.()?.webContents.send('graviscan:scan-error', ...)` with injected `onError` callback
- Fire-and-forget `.catch()` calls `onError` and `sessionFns.setScanSession(null)`

The module exports:

- `startScan(coordinator, params, sessionFns, onError)`
- `getScanStatus(sessionFns)`
- `markJobRecorded(sessionFns, jobKey)`
- `cancelScan(coordinator, sessionFns)`

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/unit/graviscan/session-handlers.test.ts --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 3: Run TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/main/graviscan/session-handlers.ts
git commit -m "feat: add session-handlers module (green)

Extracts 4 scan lifecycle handlers from Ben's graviscan-handlers.ts.
Coordinator and session fns injected as parameters. Local
ScanCoordinatorLike interface based on Ben's ScanCoordinator."
```

---

### Task 5: Image Handlers — Tests

**Files:**

- Create: `tests/unit/graviscan/image-handlers.test.ts`

- [ ] **Step 1: Write image-handlers test file**

```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Module mocks — must be before imports
vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn().mockReturnValue('/mock/app'),
    getPath: vi.fn().mockReturnValue('/mock/home'),
  },
}));

vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnValue({
      toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-jpeg-data')),
    }),
  })),
}));

vi.mock('../../../src/main/graviscan-path-utils', () => ({
  resolveGraviScanPath: vi.fn(),
}));

vi.mock('../../../src/main/box-backup', () => ({
  runBoxBackup: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    promises: {
      copyFile: vi.fn().mockResolvedValue(undefined),
    },
  };
});

import { app } from 'electron';
import { resolveGraviScanPath } from '../../../src/main/graviscan-path-utils';
import { runBoxBackup } from '../../../src/main/box-backup';
import * as fs from 'fs';

const mockResolvePath = vi.mocked(resolveGraviScanPath);
const mockRunBoxBackup = vi.mocked(runBoxBackup);

function createMockDb() {
  return {
    graviScan: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  } as any;
}

import {
  getOutputDir,
  readScanImage,
  uploadAllScans,
  downloadImages,
  resetUploadState,
} from '../../../src/main/graviscan/image-handlers';

describe('image-handlers', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    mockResolvePath.mockReset();
    mockRunBoxBackup.mockReset();
    resetUploadState();
  });

  describe('getOutputDir', () => {
    it('should return dev path when NODE_ENV is development', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.mocked(app.getAppPath).mockReturnValue('/project/root');

      const result = getOutputDir();

      expect(result.success).toBe(true);
      expect(result.path).toContain('.graviscan');
    });

    it('should return production path when NODE_ENV is production', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.mocked(app.getPath).mockReturnValue('/home/user');

      const result = getOutputDir();

      expect(result.success).toBe(true);
      expect(result.path).toContain('.bloom');
    });

    it('should create directory if missing', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      getOutputDir();

      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), {
        recursive: true,
      });
    });

    it('should return error when mkdirSync fails', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockImplementation(() => {
        throw new Error('EACCES');
      });

      const result = getOutputDir();

      expect(result.success).toBe(false);
      expect(result.error).toContain('EACCES');
    });
  });

  describe('readScanImage', () => {
    it('should return base64 data URI for thumbnail', async () => {
      mockResolvePath.mockReturnValue('/scan/image.tiff');

      const result = await readScanImage('/scan/image.tiff');

      expect(result.success).toBe(true);
      expect(result.dataUri).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('should return full-resolution data URI when full option is true', async () => {
      mockResolvePath.mockReturnValue('/scan/image.tiff');
      const result = await readScanImage('/scan/image.tiff', { full: true });

      expect(result.success).toBe(true);
      expect(result.dataUri).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('should return error when file not found', async () => {
      mockResolvePath.mockReturnValue(null);

      const result = await readScanImage('/missing/image.tiff');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('uploadAllScans', () => {
    it('should trigger box backup and report results', async () => {
      mockRunBoxBackup.mockResolvedValue({
        success: true,
        experiments: 1,
        filesCopied: 5,
        errors: [],
      } as any);

      const onProgress = vi.fn();
      const result = await uploadAllScans(db, onProgress);

      expect(result.success).toBe(true);
      expect(result.uploaded).toBe(5);
      expect(mockRunBoxBackup).toHaveBeenCalled();
    });

    it('should reject concurrent uploads', async () => {
      // Make first upload hang
      mockRunBoxBackup.mockReturnValue(new Promise(() => {}));

      // Start first upload (will hang)
      const first = uploadAllScans(db);
      // Try second immediately
      const second = await uploadAllScans(db);

      expect(second.success).toBe(false);
      expect(second.errors).toContain('Upload already in progress');
    });
  });

  describe('downloadImages', () => {
    it('should return zero counts when no images found', async () => {
      db.graviScan.findMany.mockResolvedValue([]);

      const result = await downloadImages(db, {
        experimentId: 'exp-1',
        experimentName: 'Test Exp',
        targetDir: '/tmp/download',
      });

      expect(result.success).toBe(true);
      expect(result.total).toBe(0);
      expect(result.copied).toBe(0);
    });

    it('should copy images and write metadata CSV', async () => {
      db.graviScan.findMany.mockResolvedValue([
        {
          wave_number: 0,
          plate_barcode: 'PLATE-001',
          plate_index: '00',
          grid_mode: '2grid',
          capture_date: new Date('2026-04-01'),
          experiment: { accession: { graviPlateAccessions: [] } },
          images: [{ path: '/scan/image.tiff' }],
        },
      ]);
      mockResolvePath.mockReturnValue('/scan/image.tiff');

      const onProgress = vi.fn();
      const result = await downloadImages(
        db,
        {
          experimentId: 'exp-1',
          experimentName: 'Test Exp',
          targetDir: '/tmp/download',
        },
        onProgress
      );

      expect(result.total).toBe(1);
      expect(result.copied).toBe(1);
      expect(fs.writeFileSync).toHaveBeenCalled(); // metadata CSV
      expect(fs.promises.copyFile).toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/graviscan/image-handlers.test.ts --reporter=verbose`
Expected: FAIL — `Cannot find module '../../../src/main/graviscan/image-handlers'`

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/unit/graviscan/image-handlers.test.ts
git commit -m "test: add image-handlers unit tests (red)

Tests for getOutputDir, readScanImage, uploadAllScans (incl concurrent
upload guard), downloadImages (incl metadata CSV). All fail."
```

---

### Task 6: Image Handlers — Implementation

**Files:**

- Create: `src/main/graviscan/image-handlers.ts`

- [ ] **Step 1: Implement image-handlers.ts**

Extract and adapt from Ben's `graviscan-handlers.ts`:

- `graviscan:get-output-dir` (lines 1014-1050)
- `graviscan:read-scan-image` (lines 1055-1093)
- `graviscan:upload-all-scans` (lines 1095-1155)
- `graviscan:download-images` (lines 1159-1338)

Key adaptations:

- Remove `ipcMain.handle()` wrappers
- `getOutputDir()` — keep Electron `app` import (module-mocked in tests)
- `readScanImage(filePath, options?)` — same as Ben's but no `_event` param
- `uploadAllScans(db, onProgress?)` — replace `getMainWindow?.()?.webContents.send('graviscan:box-backup-progress', progress)` with `onProgress?.(progress)`. Module-level `uploadInProgress` guard + exported `resetUploadState()`
- `downloadImages(db, params, onProgress?)` — accept `targetDir: string` in params (no `dialog.showOpenDialog`). Replace `mainWindow.webContents.send('graviscan:download-progress', ...)` with `onProgress?.(...)`. Remove `mainWindow` null check (no longer relevant).

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/unit/graviscan/image-handlers.test.ts --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 3: Run TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/main/graviscan/image-handlers.ts
git commit -m "feat: add image-handlers module (green)

Extracts 4 image operation handlers from Ben's graviscan-handlers.ts.
Progress events via callback injection. Upload guard with
resetUploadState() for testing. Dialog handling deferred to 3c."
```

---

### Task 7: Barrel Export + Full Verification

**Files:**

- Create: `src/main/graviscan/index.ts`

- [ ] **Step 1: Create index.ts barrel export**

```typescript
/**
 * GraviScan Handler Modules
 *
 * Extracted from PR #138 (origin/graviscan/4-main-process) graviscan-handlers.ts.
 * Each module exports testable functions — no ipcMain dependency.
 * IPC wiring happens in Increment 3c (register-handlers.ts).
 *
 * IPC channel → function mapping (for 3c reference):
 *
 *   graviscan:detect-scanners    → scannerHandlers.detectScanners(db)
 *   graviscan:get-config         → scannerHandlers.getConfig(db)
 *   graviscan:save-config        → scannerHandlers.saveConfig(db, config)
 *   graviscan:save-scanners-db   → scannerHandlers.saveScannersToDB(db, scanners)
 *   graviscan:platform-info      → scannerHandlers.getPlatformInfo()
 *   graviscan:validate-scanners  → scannerHandlers.runStartupScannerValidation(db, ids)
 *   graviscan:validate-config    → scannerHandlers.validateConfig(db)
 *   graviscan:start-scan         → sessionHandlers.startScan(coordinator, params, fns, onError)
 *   graviscan:get-scan-status    → sessionHandlers.getScanStatus(fns)
 *   graviscan:mark-job-recorded  → sessionHandlers.markJobRecorded(fns, key)
 *   graviscan:cancel-scan        → sessionHandlers.cancelScan(coordinator, fns)
 *   graviscan:get-output-dir     → imageHandlers.getOutputDir()
 *   graviscan:read-scan-image    → imageHandlers.readScanImage(path, opts)
 *   graviscan:upload-all-scans   → imageHandlers.uploadAllScans(db, onProgress)
 *   graviscan:download-images    → imageHandlers.downloadImages(db, params, onProgress)
 *
 * webContents.send channels replaced by callbacks:
 *   graviscan:scan-error          → onError callback in startScan
 *   graviscan:box-backup-progress → onProgress callback in uploadAllScans
 *   graviscan:download-progress   → onProgress callback in downloadImages
 */

export * from './scanner-handlers';
export * from './session-handlers';
export * from './image-handlers';
```

- [ ] **Step 2: Run ALL tests**

Run: `npx vitest run tests/unit/graviscan/ --reporter=verbose`
Expected: All tests PASS across all 3 test files

- [ ] **Step 3: Run TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run lint**

Run: `npx eslint src/main/graviscan/`
Expected: No errors (fix any that appear)

- [ ] **Step 5: Commit**

```bash
git add src/main/graviscan/index.ts
git commit -m "feat: add barrel export with IPC channel mapping JSDoc

Re-exports all public functions from scanner-handlers, session-handlers,
and image-handlers. JSDoc documents IPC channel → function mapping and
webContents.send → callback replacements for Increment 3c."
```

- [ ] **Step 6: Final verification — run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All existing tests still pass + new graviscan tests pass

---

## Summary

| Task | Module           | What                                                | Commit message prefix |
| ---- | ---------------- | --------------------------------------------------- | --------------------- |
| 0    | deps             | Cherry-pick lsusb-detection, path-utils, box-backup | `chore:`              |
| 1    | scanner-handlers | Tests (red)                                         | `test:`               |
| 2    | scanner-handlers | Implementation (green)                              | `feat:`               |
| 3    | session-handlers | Tests (red)                                         | `test:`               |
| 4    | session-handlers | Implementation (green)                              | `feat:`               |
| 5    | image-handlers   | Tests (red)                                         | `test:`               |
| 6    | image-handlers   | Implementation (green)                              | `feat:`               |
| 7    | index.ts         | Barrel export + full verification                   | `feat:`               |
