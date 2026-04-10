// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
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
      void uploadAllScans(db);
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
