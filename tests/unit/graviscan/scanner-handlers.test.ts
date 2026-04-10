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
