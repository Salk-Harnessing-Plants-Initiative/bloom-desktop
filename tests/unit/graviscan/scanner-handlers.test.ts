// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
    resetSessionValidation();
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

    // ─── Bug fix: mock buildMockScanners no longer pads with placeholders ───

    it('mock mode with N enabled DB rows returns exactly N scanners (no placeholder padding)', async () => {
      vi.stubEnv('GRAVISCAN_MOCK', 'true');
      db.graviScanner.findMany.mockResolvedValue([
        {
          id: 'db-1',
          name: 'Real Scanner',
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
      expect(result.scanners).toHaveLength(1);
      expect(result.scanners[0].scanner_id).toBe('db-1');
      // Critically, NO placeholder `mock-scanner-N` id leaks through
      expect(
        result.scanners.some((s) => s.scanner_id.startsWith('mock-'))
      ).toBe(false);
    });

    it('mock mode with empty DB returns 2 placeholder scanners with empty scanner_id', async () => {
      vi.stubEnv('GRAVISCAN_MOCK', 'true');
      db.graviScanner.findMany.mockResolvedValue([]);

      const result = await detectScanners(db);

      expect(result.success).toBe(true);
      expect(result.scanners).toHaveLength(2);
      // Empty string is the sentinel for "not yet in DB"
      for (const s of result.scanners) {
        expect(s.scanner_id).toBe('');
      }
    });

    it('mock mode does NOT generate fake mock-scanner-N ids when partial DB state exists', async () => {
      // Reproduces the smoke-test bug: 1 enabled scanner in DB
      // (the other was disabled by disableMissingScanners). buildMockScanners
      // used to pad up to MOCK_SCANNER_COUNT=2 with a placeholder
      // `mock-scanner-2` id, which then leaked to FK consumers.
      vi.stubEnv('GRAVISCAN_MOCK', 'true');
      db.graviScanner.findMany.mockResolvedValue([
        {
          id: 'real-uuid',
          name: 'Mock Scanner 1',
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
      expect(result.scanners).toHaveLength(1); // not 2
      expect(result.scanners[0].scanner_id).toBe('real-uuid');
    });

    it('should return error when database throws', async () => {
      db.graviScanner.findMany.mockRejectedValue(
        new Error('DB connection lost')
      );

      const result = await detectScanners(db);

      expect(result.success).toBe(false);
      expect(result.error).toContain('DB connection lost');
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

    it('should update existing scanner matched by USB bus+device', async () => {
      db.graviScanner.findFirst.mockImplementation(async ({ where }: any) => {
        if (where?.usb_bus === 1 && where?.usb_device === 2) {
          return {
            id: 'existing-1',
            name: 'Old Name',
            usb_bus: 1,
            usb_device: 2,
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
    });

    it('should update existing scanner matched by USB port', async () => {
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

    // ─── Section 1.3: fix-scanner-config-save-flow tests ───

    it('(p) rejects empty array without touching DB', async () => {
      const result = await saveScannersToDB(db, []);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no scanners to save/i);
      expect(db.graviScanner.findFirst).not.toHaveBeenCalled();
      expect(db.graviScanner.update).not.toHaveBeenCalled();
      expect(db.graviScanner.create).not.toHaveBeenCalled();
    });

    it('(p2) matches existing row by usb_port FIRST (even when bus+device differ)', async () => {
      db.graviScanner.findFirst.mockImplementation(({ where }: any) => {
        if (where?.usb_port === '1-2') {
          return Promise.resolve({
            id: 'existing-1',
            name: 'Old Name',
            display_name: null,
            vendor_id: '04b8',
            product_id: '013a',
            usb_port: '1-2',
            usb_bus: 999, // old bus
            usb_device: 999, // old device
            enabled: true,
          });
        }
        return Promise.resolve(null);
      });
      db.graviScanner.update.mockResolvedValue({
        id: 'existing-1',
        name: 'Scanner New',
        display_name: null,
        vendor_id: '04b8',
        product_id: '013a',
        usb_port: '1-2',
        usb_bus: 1,
        usb_device: 5,
        enabled: true,
      });

      const result = await saveScannersToDB(db, [
        {
          name: 'Scanner New',
          vendor_id: '04b8',
          product_id: '013a',
          usb_bus: 1,
          usb_device: 5, // different from existing (999)
          usb_port: '1-2', // same usb_port
        },
      ]);

      expect(result.success).toBe(true);
      expect(db.graviScanner.update).toHaveBeenCalled();
      expect(db.graviScanner.create).not.toHaveBeenCalled();
      // Verify the first findFirst call was keyed on usb_port
      const firstCallArg = db.graviScanner.findFirst.mock.calls[0][0];
      expect(firstCallArg).toEqual(
        expect.objectContaining({ where: { usb_port: '1-2' } })
      );
    });

    it('(p3) fallback match by composite (vendor_id, product_id, name, usb_bus, usb_device) when usb_port empty', async () => {
      db.graviScanner.findFirst.mockImplementation(({ where }: any) => {
        if (
          where?.vendor_id === '04b8' &&
          where?.product_id === '013a' &&
          where?.name === 'Epson V850' &&
          where?.usb_bus === 1 &&
          where?.usb_device === 3
        ) {
          return Promise.resolve({
            id: 'existing-composite',
            name: 'Epson V850',
            display_name: null,
            vendor_id: '04b8',
            product_id: '013a',
            usb_port: null,
            usb_bus: 1,
            usb_device: 3,
            enabled: true,
          });
        }
        return Promise.resolve(null);
      });
      db.graviScanner.update.mockResolvedValue({
        id: 'existing-composite',
        name: 'Epson V850',
      });

      const result = await saveScannersToDB(db, [
        {
          name: 'Epson V850',
          vendor_id: '04b8',
          product_id: '013a',
          usb_bus: 1,
          usb_device: 3,
          usb_port: '', // empty — should trigger composite fallback
        },
      ]);

      expect(result.success).toBe(true);
      expect(db.graviScanner.update).toHaveBeenCalled();
      expect(db.graviScanner.create).not.toHaveBeenCalled();
    });

    it('(p4) does NOT match by (usb_bus, usb_device) alone when usb_port differs', async () => {
      // Stale row with bus/device that coincidentally matches but has different port
      db.graviScanner.findFirst.mockImplementation(({ where }: any) => {
        if (where?.usb_port === '1-2') {
          return Promise.resolve(null); // not found by new port
        }
        // This match by composite should NOT be triggered because we pass non-empty usb_port
        if (where?.vendor_id) {
          return Promise.resolve(null);
        }
        return Promise.resolve(null);
      });
      db.graviScanner.create.mockResolvedValue({
        id: 'new-row',
        name: 'Scanner',
      });

      await saveScannersToDB(db, [
        {
          name: 'Scanner',
          vendor_id: '04b8',
          product_id: '013a',
          usb_bus: 1,
          usb_device: 2,
          usb_port: '1-2',
        },
      ]);

      // With bus/device matching discarded, it should create a new row
      expect(db.graviScanner.create).toHaveBeenCalled();
      // Verify NO findFirst call used bus+device as sole `where` keys
      for (const call of db.graviScanner.findFirst.mock.calls) {
        const where = call[0]?.where;
        if (where && 'usb_bus' in where && 'usb_device' in where) {
          // If bus/device were in `where`, they must be accompanied by other keys (composite)
          expect(Object.keys(where).length).toBeGreaterThan(2);
        }
      }
    });
  });

  // ─── Section 1.3: disableMissingScanners tests ───
  describe('disableMissingScanners', () => {
    it('(q) sets enabled=false on rows not in the identity list', async () => {
      const { disableMissingScanners } = await import(
        '../../../src/main/graviscan/scanner-handlers'
      );

      db.graviScanner.findMany = vi.fn().mockResolvedValue([
        {
          id: 'row-a',
          name: 'A',
          usb_port: '1-1',
          usb_bus: 1,
          usb_device: 1,
          vendor_id: '04b8',
          product_id: '013a',
          enabled: true,
        },
        {
          id: 'row-b',
          name: 'B',
          usb_port: '1-2',
          usb_bus: 1,
          usb_device: 2,
          vendor_id: '04b8',
          product_id: '013a',
          enabled: true,
        },
      ]);
      db.graviScanner.update.mockResolvedValue({});

      // Only 'A' is in the enabled list; 'B' should be disabled
      const result = await disableMissingScanners(db, [
        {
          usb_port: '1-1',
          vendor_id: '04b8',
          product_id: '013a',
          name: 'A',
          usb_bus: 1,
          usb_device: 1,
        },
      ]);

      expect(result.success).toBe(true);
      expect(result.disabled).toBe(1);
      expect(db.graviScanner.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'row-b' },
          data: { enabled: false },
        })
      );
      // A should NOT have been updated to disabled
      const updateCalls = db.graviScanner.update.mock.calls.map(
        (c: any) => c[0]
      );
      const aUpdate = updateCalls.find((u: any) => u.where.id === 'row-a');
      expect(aUpdate).toBeUndefined();
    });

    it('(q2) does NOT touch rows matching the identity list', async () => {
      const { disableMissingScanners } = await import(
        '../../../src/main/graviscan/scanner-handlers'
      );

      db.graviScanner.findMany = vi.fn().mockResolvedValue([
        {
          id: 'row-a',
          name: 'A',
          usb_port: '1-1',
          usb_bus: 1,
          usb_device: 1,
          vendor_id: '04b8',
          product_id: '013a',
          enabled: true,
        },
      ]);
      db.graviScanner.update.mockResolvedValue({});

      const result = await disableMissingScanners(db, [
        {
          usb_port: '1-1',
          vendor_id: '04b8',
          product_id: '013a',
          name: 'A',
          usb_bus: 1,
          usb_device: 1,
        },
      ]);

      expect(result.success).toBe(true);
      expect(result.disabled).toBe(0);
      expect(db.graviScanner.update).not.toHaveBeenCalled();
    });

    it('(q3) never deletes rows — only flips enabled', async () => {
      const { disableMissingScanners } = await import(
        '../../../src/main/graviscan/scanner-handlers'
      );

      db.graviScanner.findMany = vi.fn().mockResolvedValue([
        {
          id: 'row-b',
          name: 'B',
          usb_port: '1-2',
          usb_bus: 1,
          usb_device: 2,
          vendor_id: '04b8',
          product_id: '013a',
          enabled: true,
        },
      ]);
      db.graviScanner.update.mockResolvedValue({});
      db.graviScanner.delete = vi.fn();
      db.graviScanner.deleteMany = vi.fn();

      await disableMissingScanners(db, []);

      expect(db.graviScanner.delete).not.toHaveBeenCalled();
      expect(db.graviScanner.deleteMany).not.toHaveBeenCalled();
      expect(db.graviScanner.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { enabled: false },
        })
      );
    });

    it('(q4) matches by usb_port primary with composite fallback', async () => {
      const { disableMissingScanners } = await import(
        '../../../src/main/graviscan/scanner-handlers'
      );

      db.graviScanner.findMany = vi.fn().mockResolvedValue([
        {
          id: 'row-port',
          name: 'X',
          usb_port: '1-5',
          usb_bus: 99,
          usb_device: 99,
          vendor_id: '04b8',
          product_id: '013a',
          enabled: true,
        },
        {
          id: 'row-composite',
          name: 'Y',
          usb_port: null,
          usb_bus: 2,
          usb_device: 3,
          vendor_id: '04b8',
          product_id: '013a',
          enabled: true,
        },
      ]);
      db.graviScanner.update.mockResolvedValue({});

      // Match row-port by usb_port primary AND row-composite by composite fallback.
      // Both should remain enabled (not appear in disabled list).
      const result = await disableMissingScanners(db, [
        {
          usb_port: '1-5',
          vendor_id: '04b8',
          product_id: '013a',
          name: 'X',
          usb_bus: 1, // bus differs — usb_port primary match wins
          usb_device: 10,
        },
        {
          usb_port: '', // empty — composite fallback kicks in
          vendor_id: '04b8',
          product_id: '013a',
          name: 'Y',
          usb_bus: 2,
          usb_device: 3,
        },
      ]);

      expect(result.success).toBe(true);
      expect(result.disabled).toBe(0);
      expect(db.graviScanner.update).not.toHaveBeenCalled();
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

    it('should return a copy that does not affect internal state', async () => {
      // Run validation to populate state
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
      await runStartupScannerValidation(db, ['s1']);

      const state = getSessionValidationState();
      // Mutate the returned copy
      state.detectedScanners.push({ ...MOCK_SCANNER, scanner_id: 'injected' });
      state.cachedScannerIds.push('injected-id');

      // Internal state should be unaffected
      const freshState = getSessionValidationState();
      expect(freshState.detectedScanners).toHaveLength(1);
      expect(freshState.cachedScannerIds).toHaveLength(1);
    });
  });
});
