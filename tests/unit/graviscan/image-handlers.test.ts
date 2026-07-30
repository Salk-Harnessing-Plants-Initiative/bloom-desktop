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

const sharpMockInstance = {
  resize: vi.fn().mockReturnThis(),
  jpeg: vi.fn().mockReturnValue({
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-jpeg-data')),
  }),
};

vi.mock('sharp', () => ({
  default: vi.fn(() => sharpMockInstance),
}));

vi.mock('../../../src/main/graviscan-path-utils', () => ({
  resolveGraviScanPath: vi.fn(),
}));

vi.mock('../../../src/main/box-backup', () => ({
  runBoxBackup: vi.fn(),
}));

vi.mock('../../../src/main/graviscan-upload', () => ({
  uploadAllPendingScans: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    promises: {
      copyFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
    },
  };
});

import * as path from 'path';
import { app } from 'electron';
import { resolveGraviScanPath } from '../../../src/main/graviscan-path-utils';
import { runBoxBackup } from '../../../src/main/box-backup';
import { uploadAllPendingScans } from '../../../src/main/graviscan-upload';
import * as fs from 'fs';

const mockResolvePath = vi.mocked(resolveGraviScanPath);
const mockRunBoxBackup = vi.mocked(runBoxBackup);
const mockUploadAllPendingScans = vi.mocked(uploadAllPendingScans);

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
  ensureDir,
  listScanFiles,
} from '../../../src/main/graviscan/image-handlers';

describe('image-handlers', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    // Default: no GRAVISCAN_OUTPUT_DIR override — falls back to hardcoded path.
    vi.mocked(fs.readFileSync).mockReturnValue('');
    vi.mocked(fs.promises.mkdir).mockReset().mockResolvedValue(undefined);
    vi.mocked(fs.readdirSync).mockReset();
    vi.mocked(fs.statSync).mockReset();
    mockResolvePath.mockReset();
    mockRunBoxBackup.mockReset();
    mockUploadAllPendingScans.mockReset();
    resetUploadState();
    sharpMockInstance.resize.mockClear();
    sharpMockInstance.jpeg.mockClear();
    sharpMockInstance.jpeg.mockReturnValue({
      toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-jpeg-data')),
    });
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

    it('should use GRAVISCAN_OUTPUT_DIR from ~/.bloom/.env when set in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.mocked(app.getPath).mockReturnValue('/home/user');
      vi.mocked(fs.readFileSync).mockReturnValue(
        'GRAVISCAN_OUTPUT_DIR=/data/bloom/graviscan\n'
      );

      const result = getOutputDir();

      expect(result.success).toBe(true);
      expect(result.path).toBe('/data/bloom/graviscan');
    });
  });

  describe('readScanImage', () => {
    it('should return base64 data URI for thumbnail', async () => {
      mockResolvePath.mockReturnValue('/scan/image.tiff');
      const result = await readScanImage('/scan/image.tiff');

      expect(result.success).toBe(true);
      expect(result.dataUri).toMatch(/^data:image\/jpeg;base64,/);
      expect(sharpMockInstance.resize).toHaveBeenCalledWith(400, null, {
        withoutEnlargement: true,
      });
      expect(sharpMockInstance.jpeg).toHaveBeenCalledWith({ quality: 85 });
    });

    it('should return full-resolution data URI when full option is true', async () => {
      mockResolvePath.mockReturnValue('/scan/image.tiff');
      const result = await readScanImage('/scan/image.tiff', { full: true });

      expect(result.success).toBe(true);
      expect(result.dataUri).toMatch(/^data:image\/jpeg;base64,/);
      expect(sharpMockInstance.resize).not.toHaveBeenCalled();
      expect(sharpMockInstance.jpeg).toHaveBeenCalledWith({ quality: 95 });
    });

    it('should return error when file not found', async () => {
      mockResolvePath.mockReturnValue(null);

      const result = await readScanImage('/missing/image.tiff');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error when sharp processing fails', async () => {
      mockResolvePath.mockReturnValue('/scan/corrupt.tiff');
      sharpMockInstance.jpeg.mockReturnValueOnce({
        toBuffer: vi.fn().mockRejectedValue(new Error('Invalid TIFF')),
      });

      const result = await readScanImage('/scan/corrupt.tiff');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid TIFF');
    });

    it('should serialize concurrent calls through the decode queue (no overlapping decodes)', async () => {
      // Concurrent sharp/libvips decodes crash with GLib threading errors on
      // Linux — readScanImage() queues decodes onto a module-level chain so
      // they run strictly one at a time. Prove that here: fire two calls
      // without awaiting the first, and assert the underlying sharp calls
      // happen one-at-a-time in issue order, with both promises still
      // resolving correctly with their own result.
      mockResolvePath.mockImplementation((p: string) => p);

      const callOrder: string[] = [];
      let resolveFirst: (() => void) | undefined;
      let callIndex = 0;

      // Override jpeg() to hand back a distinct, independently-controllable
      // toBuffer() promise per call, tracked via start/end markers.
      sharpMockInstance.jpeg.mockImplementation(() => {
        const idx = ++callIndex;
        callOrder.push(`start:${idx}`);
        return {
          toBuffer: vi.fn().mockImplementation(() => {
            if (idx === 1) {
              return new Promise<Buffer>((resolve) => {
                resolveFirst = () => {
                  callOrder.push('end:1');
                  resolve(Buffer.from('first-data'));
                };
              });
            }
            callOrder.push(`end:${idx}`);
            return Promise.resolve(Buffer.from(`data-${idx}`));
          }),
        };
      });

      // Fire both calls without awaiting the first.
      const firstPromise = readScanImage('/scan/first.tiff');
      const secondPromise = readScanImage('/scan/second.tiff');

      // Flush pending microtasks/macrotasks. Only the first decode should
      // have started — the second is queued behind it.
      await new Promise((r) => setTimeout(r, 0));
      expect(callOrder).toEqual(['start:1']);

      // Let the first decode finish; only then should the second start.
      resolveFirst?.();
      const [firstResult, secondResult] = await Promise.all([
        firstPromise,
        secondPromise,
      ]);

      expect(callOrder).toEqual(['start:1', 'end:1', 'start:2', 'end:2']);
      expect(firstResult.success).toBe(true);
      expect(firstResult.dataUri).toBe(
        `data:image/jpeg;base64,${Buffer.from('first-data').toString('base64')}`
      );
      expect(secondResult.success).toBe(true);
      expect(secondResult.dataUri).toBe(
        `data:image/jpeg;base64,${Buffer.from('data-2').toString('base64')}`
      );
    });
  });

  describe('uploadAllScans', () => {
    beforeEach(() => {
      // Default: Bloom upload has nothing to do — most tests below only
      // care about Box behavior unless they override this.
      mockUploadAllPendingScans.mockResolvedValue({
        success: true,
        uploaded: 0,
        skipped: 0,
        failed: 0,
        errors: [],
        metadataLinkingAvailable: false,
      });
    });

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

    it('should run Bloom and Box uploads in parallel', async () => {
      mockUploadAllPendingScans.mockResolvedValue({
        success: true,
        uploaded: 3,
        skipped: 0,
        failed: 0,
        errors: [],
        metadataLinkingAvailable: false,
      });
      mockRunBoxBackup.mockResolvedValue({
        success: true,
        experiments: 1,
        filesCopied: 3,
        errors: [],
      } as any);

      const result = await uploadAllScans(db);

      expect(mockUploadAllPendingScans).toHaveBeenCalled();
      expect(mockRunBoxBackup).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.uploaded).toBe(6); // 3 Bloom + 3 Box
    });

    it('should surface metadataLinkingAvailable from the Bloom result on the merged return value', async () => {
      mockUploadAllPendingScans.mockResolvedValue({
        success: true,
        uploaded: 1,
        skipped: 0,
        failed: 0,
        errors: [],
        metadataLinkingAvailable: true,
      });
      mockRunBoxBackup.mockResolvedValue({
        success: true,
        experiments: 1,
        filesCopied: 1,
        errors: [],
      } as any);

      const result = await uploadAllScans(db);

      expect(result.metadataLinkingAvailable).toBe(true);
    });

    it('should report metadataLinkingAvailable=false when Bloom upload throws', async () => {
      mockUploadAllPendingScans.mockRejectedValue(new Error('Bloom crash'));
      mockRunBoxBackup.mockResolvedValue({
        success: true,
        experiments: 1,
        filesCopied: 1,
        errors: [],
      } as any);

      const result = await uploadAllScans(db);

      expect(result.metadataLinkingAvailable).toBe(false);
    });

    it('should let Box complete successfully when Bloom upload fails', async () => {
      mockUploadAllPendingScans.mockResolvedValue({
        success: false,
        uploaded: 0,
        skipped: 0,
        failed: 2,
        errors: ['Bloom: authentication failed'],
        metadataLinkingAvailable: false,
      });
      mockRunBoxBackup.mockResolvedValue({
        success: true,
        experiments: 1,
        filesCopied: 4,
        errors: [],
      } as any);

      const result = await uploadAllScans(db);

      // Box's success is not masked by Bloom's failure.
      expect(mockRunBoxBackup).toHaveBeenCalled();
      expect(result.success).toBe(false); // overall still false (Bloom failed)
      expect(result.uploaded).toBe(4); // Box's files still counted
      expect(result.failed).toBe(2);
      expect(result.errors).toContain('Bloom: authentication failed');
    });

    it('should let Bloom complete successfully when Box backup fails', async () => {
      mockUploadAllPendingScans.mockResolvedValue({
        success: true,
        uploaded: 5,
        skipped: 0,
        failed: 0,
        errors: [],
        metadataLinkingAvailable: false,
      });
      mockRunBoxBackup.mockResolvedValue({
        success: false,
        experiments: 0,
        filesCopied: 0,
        errors: ['rclone not installed'],
      } as any);

      const result = await uploadAllScans(db);

      // Bloom's success is not masked by Box's failure.
      expect(mockUploadAllPendingScans).toHaveBeenCalled();
      expect(result.success).toBe(false); // overall still false (Box failed)
      expect(result.uploaded).toBe(5); // Bloom's uploads still counted
      expect(result.errors).toContain('rclone not installed');
    });

    it('should isolate a thrown Bloom upload from a successful Box backup', async () => {
      mockUploadAllPendingScans.mockRejectedValue(
        new Error('Unexpected Bloom crash')
      );
      mockRunBoxBackup.mockResolvedValue({
        success: true,
        experiments: 1,
        filesCopied: 2,
        errors: [],
      } as any);

      const result = await uploadAllScans(db);

      expect(result.success).toBe(false);
      expect(result.uploaded).toBe(2); // Box still completed and is counted
      expect(
        result.errors.some((e) => e.includes('Unexpected Bloom crash'))
      ).toBe(true);
    });

    it('should isolate a thrown Box backup from a successful Bloom upload', async () => {
      mockUploadAllPendingScans.mockResolvedValue({
        success: true,
        uploaded: 3,
        skipped: 0,
        failed: 0,
        errors: [],
        metadataLinkingAvailable: false,
      });
      mockRunBoxBackup.mockRejectedValue(new Error('Unexpected Box crash'));

      const result = await uploadAllScans(db);

      expect(result.success).toBe(false);
      expect(result.uploaded).toBe(3); // Bloom still completed and is counted
      expect(
        result.errors.some((e) => e.includes('Unexpected Box crash'))
      ).toBe(true);
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

    it('should continue copying remaining files when one fails', async () => {
      db.graviScan.findMany.mockResolvedValue([
        {
          wave_number: 0,
          plate_barcode: 'PLATE-001',
          plate_index: '00',
          grid_mode: '2grid',
          capture_date: new Date('2026-04-01'),
          experiment: { accession: { graviPlateAccessions: [] } },
          images: [
            { path: '/scan/good.tiff' },
            { path: '/scan/bad.tiff' },
            { path: '/scan/also-good.tiff' },
          ],
        },
      ]);
      mockResolvePath.mockImplementation((p: string) => p);
      vi.mocked(fs.promises.copyFile).mockImplementation(async (src: any) => {
        if (String(src).includes('bad')) throw new Error('Disk full');
      });

      const result = await downloadImages(db, {
        experimentId: 'exp-1',
        experimentName: 'Test Exp',
        targetDir: '/tmp/download',
      });

      expect(result.total).toBe(3);
      expect(result.copied).toBe(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Disk full');
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

  describe('ensureDir', () => {
    it('creates the directory recursively and returns the path', async () => {
      const result = await ensureDir('/scans/session-1');

      expect(fs.promises.mkdir).toHaveBeenCalledWith('/scans/session-1', {
        recursive: true,
      });
      expect(result).toEqual({ success: true, path: '/scans/session-1' });
    });

    it('is idempotent — succeeds even when mkdir resolves for an already-existing dir', async () => {
      vi.mocked(fs.promises.mkdir).mockResolvedValueOnce(undefined);

      const result = await ensureDir('/scans/existing');

      expect(result.success).toBe(true);
    });

    it('returns an error when dirPath is missing', async () => {
      const result = await ensureDir(undefined as unknown as string);

      expect(result).toEqual({
        success: false,
        error: 'dirPath is required',
      });
      expect(fs.promises.mkdir).not.toHaveBeenCalled();
    });

    it('returns an error when dirPath is not a string', async () => {
      const result = await ensureDir(123 as unknown as string);

      expect(result.success).toBe(false);
      expect(result.error).toBe('dirPath is required');
    });

    it('returns an error when mkdir rejects', async () => {
      vi.mocked(fs.promises.mkdir).mockRejectedValueOnce(
        new Error('EACCES: permission denied')
      );

      const result = await ensureDir('/no-permission');

      expect(result.success).toBe(false);
      expect(result.error).toContain('EACCES');
    });
  });

  describe('listScanFiles', () => {
    it('returns an empty file list when the directory does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = listScanFiles('/scans/does-not-exist');

      expect(result).toEqual({ success: true, files: [] });
    });

    it('lists direct image files in a given session directory (flat mode)', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'scan_00.tif', isDirectory: () => false },
        { name: 'scan_01.png', isDirectory: () => false },
        { name: 'notes.txt', isDirectory: () => false },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any);
      vi.mocked(fs.statSync).mockReturnValue({
        size: 1024,
        mtime: new Date('2026-07-01T00:00:00.000Z'),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const result = listScanFiles('/scans/session-1');

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(2); // notes.txt filtered out
      expect(result.files.map((f) => f.name).sort()).toEqual([
        'scan_00.tif',
        'scan_01.png',
      ]);
      expect(result.files[0].folder).toBe('session-1');
      expect(result.files[0].size).toBe(1024);
    });

    it('recurses into subfolders when no dirPath is given (base-dir mode)', () => {
      vi.mocked(app.getAppPath).mockReturnValue('/project/root');
      vi.mocked(app.getPath).mockReturnValue('/home/user');
      vi.stubEnv('NODE_ENV', 'production');
      vi.mocked(fs.existsSync).mockReturnValue(true);

      vi.mocked(fs.readdirSync).mockImplementation(((dir: string) => {
        if (path.basename(dir) === 'graviscan') {
          return [{ name: 'exp1', isDirectory: () => true }] as unknown[];
        }
        // subfolder listing (no withFileTypes) — plain string names
        return ['plate_00.tif', 'ignore.csv'] as unknown[];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any);
      vi.mocked(fs.statSync).mockReturnValue({
        size: 2048,
        mtime: new Date('2026-07-02T00:00:00.000Z'),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const result = listScanFiles();

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(1);
      expect(result.files[0].name).toBe('plate_00.tif');
      expect(result.files[0].folder).toBe('exp1');
    });

    it('sorts files newest-first by modification time', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'older.tif', isDirectory: () => false },
        { name: 'newer.tif', isDirectory: () => false },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any);
      vi.mocked(fs.statSync).mockImplementation(((filePath: string) => {
        const isNewer = filePath.includes('newer');
        return {
          size: 100,
          mtime: new Date(
            isNewer ? '2026-07-10T00:00:00.000Z' : '2026-07-01T00:00:00.000Z'
          ),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any);

      const result = listScanFiles('/scans/session-1');

      expect(result.files.map((f) => f.name)).toEqual([
        'newer.tif',
        'older.tif',
      ]);
    });

    it('returns a failure result when readdirSync throws', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      const result = listScanFiles('/scans/session-1');

      expect(result.success).toBe(false);
      expect(result.files).toEqual([]);
      expect(result.error).toContain('EACCES');
    });
  });
});
