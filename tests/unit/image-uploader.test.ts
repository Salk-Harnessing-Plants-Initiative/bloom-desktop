/**
 * Unit tests for image-uploader module
 *
 * TDD: These tests are written first before implementation (RED phase).
 * The tests define the expected behavior of the image upload service.
 *
 * Related: openspec/changes/add-browse-scans (Phase 5)
 * Related: openspec/changes/fix-upload-database-registration
 */

import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import type { ImageStatus } from '../../src/types/database';

// Types for testing
interface MockImage {
  id: string;
  scan_id: string;
  frame_number: number;
  path: string;
  status: ImageStatus;
}

interface MockExperiment {
  id: string;
  name: string;
  species: string;
  scientist?: {
    name: string;
    email: string;
  };
}

interface MockPhenotyper {
  id: string;
  name: string;
  email: string;
}

interface MockScan {
  id: string;
  plant_id: string;
  accession_name?: string;
  wave_number?: number;
  plant_age_days?: number;
  capture_date?: Date;
  scanner_name?: string;
  num_frames?: number;
  exposure_time?: number;
  gain?: number;
  brightness?: number;
  contrast?: number;
  gamma?: number;
  seconds_per_rot?: number;
  deleted?: boolean;
  images: MockImage[];
  experiment?: MockExperiment;
  phenotyper?: MockPhenotyper;
}

// Mock modules before importing
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

vi.mock('@salk-hpi/bloom-js', () => ({
  SupabaseUploader: vi.fn(),
  SupabaseStore: vi.fn(),
}));

vi.mock('@salk-hpi/bloom-fs', () => ({
  uploadImages: vi.fn(),
  concurrentMap: vi.fn(),
}));

// Mock config-store
vi.mock('../../src/main/config-store', () => ({
  loadEnvConfig: vi.fn(),
  getScansDir: vi.fn(),
}));

// Import after mocking
import { createClient } from '@supabase/supabase-js';
import { SupabaseUploader, SupabaseStore } from '@salk-hpi/bloom-js';
import { uploadImages, concurrentMap } from '@salk-hpi/bloom-fs';
import { loadEnvConfig, getScansDir } from '../../src/main/config-store';

// Import the module under test (will fail until implemented)
import {
  ImageUploader,
  UploadProgressCallback,
} from '../../src/main/image-uploader';

describe('image-uploader (add-browse-scans Phase 5)', () => {
  // Mock instances
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockSupabaseClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockUploader: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockStore: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockPrismaClient: any;

  // Test data
  const mockCredentials = {
    scanner_name: 'TestScanner',
    camera_ip_address: 'mock',
    scans_dir: '/test/scans',
    bloom_api_url: 'https://api.bloom.salk.edu/proxy',
    bloom_scanner_username: 'scanner@salk.edu',
    bloom_scanner_password: 'password123',
    bloom_anon_key: 'test-anon-key',
  };

  const mockExperiment: MockExperiment = {
    id: 'exp-1',
    name: 'Test Experiment',
    species: 'arabidopsis',
    scientist: {
      name: 'Dr. Test Scientist',
      email: 'scientist@salk.edu',
    },
  };

  const mockPhenotyper: MockPhenotyper = {
    id: 'phen-1',
    name: 'Test Phenotyper',
    email: 'phenotyper@salk.edu',
  };

  const mockScan: MockScan = {
    id: 'scan-123',
    plant_id: 'PLANT-001',
    accession_name: 'ACC-001',
    wave_number: 1,
    plant_age_days: 14,
    capture_date: new Date('2024-01-15T10:30:00Z'),
    scanner_name: 'TestScanner',
    num_frames: 3,
    exposure_time: 100,
    gain: 1.0,
    brightness: 50,
    contrast: 50,
    gamma: 1.0,
    seconds_per_rot: 60,
    experiment: mockExperiment,
    phenotyper: mockPhenotyper,
    images: [
      {
        id: 'img-1',
        scan_id: 'scan-123',
        frame_number: 1,
        path: '2024-01-15/PLANT-001/scan-uuid/001.png',
        status: 'pending',
      },
      {
        id: 'img-2',
        scan_id: 'scan-123',
        frame_number: 2,
        path: '2024-01-15/PLANT-001/scan-uuid/002.png',
        status: 'pending',
      },
      {
        id: 'img-3',
        scan_id: 'scan-123',
        frame_number: 3,
        path: '2024-01-15/PLANT-001/scan-uuid/003.png',
        status: 'pending',
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock Supabase client with auth
    mockSupabaseClient = {
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          data: {
            session: { access_token: 'mock-token' },
            user: { id: 'user-123' },
          },
          error: null,
        }),
      },
      // Default: verification always finds the object present, so
      // existing tests (not concerned with verification) still see
      // images marked 'uploaded'. Tests exercising verification itself
      // override these per-test.
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { object_path: 'cyl-images/found.png' },
              error: null,
            }),
          }),
        }),
      }),
      storage: {
        from: vi.fn().mockReturnValue({
          list: vi.fn().mockResolvedValue({
            data: [{ name: 'found.png' }],
            error: null,
          }),
        }),
      },
    };
    (createClient as Mock).mockReturnValue(mockSupabaseClient);

    // Setup mock SupabaseUploader
    mockUploader = {
      uploadImage: vi.fn().mockResolvedValue({ error: null }),
    };
    (SupabaseUploader as unknown as Mock).mockImplementation(
      () => mockUploader
    );

    // Setup mock SupabaseStore
    mockStore = {
      insertImageMetadata: vi.fn().mockResolvedValue({ id: 1 }),
    };
    (SupabaseStore as unknown as Mock).mockImplementation(() => mockStore);

    // Setup mock uploadImages from bloom-fs that simulates calling callbacks
    (uploadImages as Mock).mockImplementation(
      async (
        _paths: string[],
        metadata: unknown[],
        _uploader: unknown,
        _store: unknown,
        opts?: {
          before?: (index: number) => void;
          result?: (
            index: number,
            m: unknown,
            created: number | null,
            error: unknown
          ) => void;
        }
      ) => {
        // Simulate uploading each image
        for (let i = 0; i < metadata.length; i++) {
          opts?.before?.(i);
          // Simulate successful upload - created ID is i+1
          await opts?.result?.(i, metadata[i], i + 1, null);
        }
      }
    );

    // Setup mock config
    (loadEnvConfig as Mock).mockReturnValue(mockCredentials);
    (getScansDir as Mock).mockReturnValue(mockCredentials.scans_dir);

    // Default concurrentMap: functionally equivalent to bloom-fs's real
    // implementation (runs asyncFunc for every item, bounded concurrency
    // doesn't matter for correctness in these tests). Tests that need to
    // assert the real nWorkers bound do so via toHaveBeenCalledWith.
    (concurrentMap as Mock).mockImplementation(
      async (
        array: unknown[],
        _nWorkers: number,
        asyncFunc: (item: unknown, index: number) => Promise<unknown>
      ) => {
        const results = [];
        for (let i = 0; i < array.length; i++) {
          results.push(await asyncFunc(array[i], i));
        }
        return results;
      }
    );

    // Setup mock Prisma client
    mockPrismaClient = {
      image: {
        update: vi.fn().mockResolvedValue({}),
      },
      scan: {
        findUnique: vi.fn().mockResolvedValue(mockScan),
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ImageUploader class', () => {
    describe('constructor and authentication', () => {
      it('should load credentials from config-store', async () => {
        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();

        expect(loadEnvConfig).toHaveBeenCalled();
      });

      it('should create Supabase client with correct credentials', async () => {
        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();

        expect(createClient).toHaveBeenCalledWith(
          mockCredentials.bloom_api_url,
          mockCredentials.bloom_anon_key
        );
      });

      it('should authenticate with Supabase using email/password', async () => {
        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();

        expect(mockSupabaseClient.auth.signInWithPassword).toHaveBeenCalledWith(
          {
            email: mockCredentials.bloom_scanner_username,
            password: mockCredentials.bloom_scanner_password,
          }
        );
      });

      it('should throw error on authentication failure', async () => {
        mockSupabaseClient.auth.signInWithPassword.mockResolvedValue({
          data: { session: null, user: null },
          error: { message: 'Invalid credentials' },
        });

        const uploader = new ImageUploader(mockPrismaClient);

        await expect(uploader.authenticate()).rejects.toThrow(
          'Authentication failed: Invalid credentials'
        );
      });

      it('should throw error when credentials are missing', async () => {
        (loadEnvConfig as Mock).mockReturnValue({
          ...mockCredentials,
          bloom_scanner_username: '',
          bloom_scanner_password: '',
        });

        const uploader = new ImageUploader(mockPrismaClient);

        await expect(uploader.authenticate()).rejects.toThrow(
          'Missing Bloom credentials'
        );
      });
    });

    describe('uploadScan', () => {
      it('should update Image.status to "uploading" before upload', async () => {
        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123');

        // Verify each image was marked as "uploading"
        for (const image of mockScan.images) {
          expect(mockPrismaClient.image.update).toHaveBeenCalledWith({
            where: { id: image.id },
            data: { status: 'uploading' },
          });
        }
      });

      it('should call bloom-fs uploadImages with absolute image paths (scansDir prepended)', async () => {
        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123');

        // Verify uploadImages was called once with absolute paths
        // Image.path stores relative paths; uploader prepends scansDir
        expect(uploadImages).toHaveBeenCalledTimes(1);
        const callArgs = (uploadImages as Mock).mock.calls[0];
        const imagePaths = callArgs[0] as string[];
        expect(imagePaths).toHaveLength(3);
        // scansDir from mockCredentials is '/test/scans'
        expect(imagePaths[0]).toContain('/test/scans');
        expect(imagePaths[0]).toContain(
          '2024-01-15/PLANT-001/scan-uuid/001.png'
        );
        expect(imagePaths[1]).toContain(
          '2024-01-15/PLANT-001/scan-uuid/002.png'
        );
        expect(imagePaths[2]).toContain(
          '2024-01-15/PLANT-001/scan-uuid/003.png'
        );
      });

      it('should update Image.status to "uploaded" after successful upload', async () => {
        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123');

        // Verify each image was marked as "uploaded"
        for (const image of mockScan.images) {
          expect(mockPrismaClient.image.update).toHaveBeenCalledWith({
            where: { id: image.id },
            data: { status: 'uploaded' },
          });
        }
      });

      it('should update Image.status to "failed" on upload failure', async () => {
        // Make second image upload fail via uploadImages mock
        (uploadImages as Mock).mockImplementation(
          async (
            _paths: string[],
            metadata: unknown[],
            _uploader: unknown,
            _store: unknown,
            opts?: {
              before?: (index: number) => void;
              result?: (
                index: number,
                m: unknown,
                created: number | null,
                error: unknown
              ) => void;
            }
          ) => {
            for (let i = 0; i < metadata.length; i++) {
              opts?.before?.(i);
              if (i === 1) {
                // Second image fails
                await opts?.result?.(
                  i,
                  metadata[i],
                  null,
                  new Error('Upload failed')
                );
              } else {
                await opts?.result?.(i, metadata[i], i + 1, null);
              }
            }
          }
        );

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123');

        // Verify failed image was marked as "failed"
        expect(mockPrismaClient.image.update).toHaveBeenCalledWith({
          where: { id: 'img-2' },
          data: { status: 'failed' },
        });

        // Verify other images were marked as "uploaded"
        expect(mockPrismaClient.image.update).toHaveBeenCalledWith({
          where: { id: 'img-1' },
          data: { status: 'uploaded' },
        });
        expect(mockPrismaClient.image.update).toHaveBeenCalledWith({
          where: { id: 'img-3' },
          data: { status: 'uploaded' },
        });
      });

      it('should continue uploading after individual image failure', async () => {
        // Make first image upload fail via uploadImages mock
        (uploadImages as Mock).mockImplementation(
          async (
            _paths: string[],
            metadata: unknown[],
            _uploader: unknown,
            _store: unknown,
            opts?: {
              before?: (index: number) => void;
              result?: (
                index: number,
                m: unknown,
                created: number | null,
                error: unknown
              ) => void;
            }
          ) => {
            for (let i = 0; i < metadata.length; i++) {
              opts?.before?.(i);
              if (i === 0) {
                // First image fails
                await opts?.result?.(
                  i,
                  metadata[i],
                  null,
                  new Error('Upload failed')
                );
              } else {
                await opts?.result?.(i, metadata[i], i + 1, null);
              }
            }
          }
        );

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        const result = await uploader.uploadScan('scan-123');

        // uploadImages was called once (it handles all images internally)
        expect(uploadImages).toHaveBeenCalledTimes(1);

        // Result should reflect partial success
        expect(result.success).toBe(true);
        expect(result.uploaded).toBe(2);
        expect(result.failed).toBe(1);
        expect(result.total).toBe(3);
      });

      it('should return UploadResult with statistics', async () => {
        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        const result = await uploader.uploadScan('scan-123');

        expect(result).toEqual({
          success: true,
          scanId: 'scan-123',
          uploaded: 3,
          failed: 0,
          total: 3,
          errors: [],
        });
      });

      it('should return success=false when all uploads fail', async () => {
        // Make all uploads fail via uploadImages mock
        (uploadImages as Mock).mockImplementation(
          async (
            _paths: string[],
            metadata: unknown[],
            _uploader: unknown,
            _store: unknown,
            opts?: {
              before?: (index: number) => void;
              result?: (
                index: number,
                m: unknown,
                created: number | null,
                error: unknown
              ) => void;
            }
          ) => {
            for (let i = 0; i < metadata.length; i++) {
              opts?.before?.(i);
              // All images fail
              await opts?.result?.(
                i,
                metadata[i],
                null,
                new Error('All uploads failed')
              );
            }
          }
        );

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        const result = await uploader.uploadScan('scan-123');

        expect(result.success).toBe(false);
        expect(result.uploaded).toBe(0);
        expect(result.failed).toBe(3);
        expect(result.errors).toHaveLength(3);
      });

      it('should throw error for non-existent scan', async () => {
        mockPrismaClient.scan.findUnique.mockResolvedValue(null);

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();

        await expect(uploader.uploadScan('non-existent')).rejects.toThrow(
          'Scan not found: non-existent'
        );
      });

      it('should handle scan with no images', async () => {
        mockPrismaClient.scan.findUnique.mockResolvedValue({
          ...mockScan,
          images: [],
        });

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        const result = await uploader.uploadScan('scan-123');

        expect(result.success).toBe(true);
        expect(result.uploaded).toBe(0);
        expect(result.total).toBe(0);
      });
    });

    describe('progress callback', () => {
      it('should call progress callback for each image', async () => {
        const progressCallback: UploadProgressCallback = vi.fn();

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123', progressCallback);

        // Should be called for each image (3 times)
        expect(progressCallback).toHaveBeenCalledTimes(3);
      });

      it('should report correct progress values', async () => {
        const progressCallback: UploadProgressCallback = vi.fn();

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123', progressCallback);

        // First call: 1/3 complete
        expect(progressCallback).toHaveBeenNthCalledWith(1, {
          current: 1,
          total: 3,
          percentage: Math.round((1 / 3) * 100),
          imageId: 'img-1',
          status: 'uploaded',
        });

        // Second call: 2/3 complete
        expect(progressCallback).toHaveBeenNthCalledWith(2, {
          current: 2,
          total: 3,
          percentage: Math.round((2 / 3) * 100),
          imageId: 'img-2',
          status: 'uploaded',
        });

        // Third call: 3/3 complete
        expect(progressCallback).toHaveBeenNthCalledWith(3, {
          current: 3,
          total: 3,
          percentage: 100,
          imageId: 'img-3',
          status: 'uploaded',
        });
      });

      it('should report failed status in progress callback', async () => {
        // Make second image fail via uploadImages mock
        (uploadImages as Mock).mockImplementation(
          async (
            _paths: string[],
            metadata: unknown[],
            _uploader: unknown,
            _store: unknown,
            opts?: {
              before?: (index: number) => void;
              result?: (
                index: number,
                m: unknown,
                created: number | null,
                error: unknown
              ) => void;
            }
          ) => {
            for (let i = 0; i < metadata.length; i++) {
              opts?.before?.(i);
              if (i === 1) {
                await opts?.result?.(
                  i,
                  metadata[i],
                  null,
                  new Error('Upload failed')
                );
              } else {
                await opts?.result?.(i, metadata[i], i + 1, null);
              }
            }
          }
        );

        const progressCallback: UploadProgressCallback = vi.fn();

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123', progressCallback);

        // Second call should report failed status
        expect(progressCallback).toHaveBeenNthCalledWith(2, {
          current: 2,
          total: 3,
          percentage: Math.round((2 / 3) * 100),
          imageId: 'img-2',
          status: 'failed',
        });
      });
    });

    describe('batch upload', () => {
      const mockScan2: MockScan = {
        id: 'scan-456',
        plant_id: 'PLANT-002',
        images: [
          {
            id: 'img-4',
            scan_id: 'scan-456',
            frame_number: 0,
            path: '/test/scans/PLANT-002/frame_0.png',
            status: 'pending',
          },
        ],
      };

      beforeEach(() => {
        mockPrismaClient.scan.findUnique.mockImplementation(
          ({ where }: { where: { id: string } }) => {
            if (where.id === 'scan-123') return Promise.resolve(mockScan);
            if (where.id === 'scan-456') return Promise.resolve(mockScan2);
            return Promise.resolve(null);
          }
        );
      });

      it('should upload multiple scans sequentially', async () => {
        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        const results = await uploader.uploadBatch(['scan-123', 'scan-456']);

        expect(results).toHaveLength(2);
        expect(results[0].scanId).toBe('scan-123');
        expect(results[1].scanId).toBe('scan-456');

        // uploadImages called once per scan (2 scans total)
        expect(uploadImages).toHaveBeenCalledTimes(2);
      });

      it('should continue batch on individual scan failure', async () => {
        // Track which scan is being processed
        let callCount = 0;

        // Make all uploads for first scan fail, second scan succeeds
        (uploadImages as Mock).mockImplementation(
          async (
            _paths: string[],
            metadata: unknown[],
            _uploader: unknown,
            _store: unknown,
            opts?: {
              before?: (index: number) => void;
              result?: (
                index: number,
                m: unknown,
                created: number | null,
                error: unknown
              ) => void;
            }
          ) => {
            callCount++;
            for (let i = 0; i < metadata.length; i++) {
              opts?.before?.(i);
              if (callCount === 1) {
                // First scan - all images fail
                await opts?.result?.(i, metadata[i], null, new Error('Failed'));
              } else {
                // Second scan - succeeds
                await opts?.result?.(i, metadata[i], i + 1, null);
              }
            }
          }
        );

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        const results = await uploader.uploadBatch(['scan-123', 'scan-456']);

        expect(results).toHaveLength(2);
        expect(results[0].success).toBe(false);
        expect(results[0].failed).toBe(3);
        expect(results[1].success).toBe(true);
        expect(results[1].uploaded).toBe(1);
      });

      it('should call batch progress callback with overall progress', async () => {
        const batchProgressCallback = vi.fn();

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadBatch(
          ['scan-123', 'scan-456'],
          batchProgressCallback
        );

        // Should be called after each scan completes
        expect(batchProgressCallback).toHaveBeenCalledTimes(2);

        expect(batchProgressCallback).toHaveBeenNthCalledWith(1, {
          currentScan: 1,
          totalScans: 2,
          scanId: 'scan-123',
          scanResult: expect.objectContaining({ scanId: 'scan-123' }),
        });

        expect(batchProgressCallback).toHaveBeenNthCalledWith(2, {
          currentScan: 2,
          totalScans: 2,
          scanId: 'scan-456',
          scanResult: expect.objectContaining({ scanId: 'scan-456' }),
        });
      });
    });

    describe('logging behavior', () => {
      it('should use console.debug (not console.log) for non-error upload messages', async () => {
        const debugSpy = vi
          .spyOn(console, 'debug')
          .mockImplementation(() => {});
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123');

        // Should use console.debug for progress/success messages
        expect(debugSpy).toHaveBeenCalled();

        // console.log should NOT be called for upload progress
        const logCalls = logSpy.mock.calls.filter(
          (call) => typeof call[0] === 'string' && call[0].includes('[Upload]')
        );
        expect(logCalls).toHaveLength(0);

        debugSpy.mockRestore();
        logSpy.mockRestore();
      });

      it('should use console.error for failed uploads', async () => {
        const errorSpy = vi
          .spyOn(console, 'error')
          .mockImplementation(() => {});

        // Make all uploads fail
        (uploadImages as Mock).mockImplementation(
          async (
            _paths: string[],
            metadata: unknown[],
            _uploader: unknown,
            _store: unknown,
            opts?: {
              before?: (index: number) => void;
              result?: (
                index: number,
                m: unknown,
                created: number | null,
                error: unknown
              ) => void;
            }
          ) => {
            for (let i = 0; i < metadata.length; i++) {
              opts?.before?.(i);
              await opts?.result?.(
                i,
                metadata[i],
                null,
                new Error('Upload failed')
              );
            }
          }
        );

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123');

        // Should use console.error for failures
        expect(errorSpy).toHaveBeenCalled();

        errorSpy.mockRestore();
      });
    });

    describe('uploadImages options', () => {
      it('should pass correct image paths to uploadImages', async () => {
        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123');

        // Verify absolute image paths are passed to uploadImages
        // Image.path stores relative paths; uploader prepends scansDir (/test/scans)
        const callArgs = (uploadImages as Mock).mock.calls[0];
        const imagePaths = callArgs[0] as string[];
        expect(imagePaths).toHaveLength(3);
        expect(imagePaths[0]).toContain('/test/scans');
        expect(imagePaths[0]).toContain(mockScan.images[0].path);
      });

      it('should pass nWorkers and pngCompression in options', async () => {
        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123');

        // Verify options include worker and compression settings
        // Note: bucket is hardcoded inside bloom-fs, not passed as an option
        expect(uploadImages).toHaveBeenCalledWith(
          expect.any(Array),
          expect.any(Array),
          expect.any(Object),
          expect.any(Object),
          expect.objectContaining({
            nWorkers: 4,
            pngCompression: 9,
          })
        );
      });
    });

    /**
     * Database Registration Tests (fix-upload-database-registration)
     *
     * These tests verify that uploads create records in the Supabase database
     * using @salk-hpi/bloom-fs uploadImages function, matching pilot behavior.
     */
    describe('database registration (bloom-fs integration)', () => {
      it('should create SupabaseStore during authentication', async () => {
        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();

        // Should create both SupabaseUploader and SupabaseStore
        expect(SupabaseUploader).toHaveBeenCalledWith(mockSupabaseClient);
        expect(SupabaseStore).toHaveBeenCalledWith(mockSupabaseClient);
      });

      it('should call uploadImages from bloom-fs instead of direct uploader', async () => {
        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123');

        // Should call bloom-fs uploadImages
        expect(uploadImages).toHaveBeenCalledTimes(1);

        // Should pass absolute image paths (scansDir + relative path)
        const callArgs = (uploadImages as Mock).mock.calls[0];
        const imagePaths = callArgs[0] as string[];
        expect(imagePaths).toHaveLength(3);
        // scansDir from mockCredentials is '/test/scans'
        expect(imagePaths[0]).toContain('/test/scans');
        expect(imagePaths[0]).toContain(mockScan.images[0].path);
      });

      it('should build CylImageMetadata with correct experiment fields', async () => {
        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123');

        // Get the metadata passed to uploadImages
        const uploadImagesCall = (uploadImages as Mock).mock.calls[0];
        const metadata = uploadImagesCall[1];

        // First image metadata
        expect(metadata[0]).toMatchObject({
          species: 'arabidopsis',
          experiment: 'Test Experiment',
          scientist_name: 'Dr. Test Scientist',
          scientist_email: 'scientist@salk.edu',
        });
      });

      it('should build CylImageMetadata with correct phenotyper fields', async () => {
        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123');

        const uploadImagesCall = (uploadImages as Mock).mock.calls[0];
        const metadata = uploadImagesCall[1];

        expect(metadata[0]).toMatchObject({
          phenotyper_name: 'Test Phenotyper',
          phenotyper_email: 'phenotyper@salk.edu',
        });
      });

      it('should build CylImageMetadata with correct scan fields', async () => {
        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123');

        const uploadImagesCall = (uploadImages as Mock).mock.calls[0];
        const metadata = uploadImagesCall[1];

        expect(metadata[0]).toMatchObject({
          plant_qr_code: 'PLANT-001',
          accession_name: 'ACC-001',
          wave_number: 1,
          plant_age_days: 14,
          device_name: 'TestScanner',
          num_frames: 3,
        });
      });

      it('should build CylImageMetadata with correct camera settings', async () => {
        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123');

        const uploadImagesCall = (uploadImages as Mock).mock.calls[0];
        const metadata = uploadImagesCall[1];

        expect(metadata[0]).toMatchObject({
          exposure_time: 100,
          gain: 1.0,
          brightness: 50,
          contrast: 50,
          gamma: 1.0,
          seconds_per_rot: 60,
        });
      });

      it('should set frame_number from each image', async () => {
        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123');

        const uploadImagesCall = (uploadImages as Mock).mock.calls[0];
        const metadata = uploadImagesCall[1];

        // Each image should have its own frame_number
        expect(metadata[0].frame_number).toBe(1);
        expect(metadata[1].frame_number).toBe(2);
        expect(metadata[2].frame_number).toBe(3);
      });

      it('should use "unknown" for missing phenotyper fields', async () => {
        // Scan without phenotyper
        const scanWithoutPhenotyper = {
          ...mockScan,
          phenotyper: undefined,
        };
        mockPrismaClient.scan.findUnique.mockResolvedValue(
          scanWithoutPhenotyper
        );

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123');

        const uploadImagesCall = (uploadImages as Mock).mock.calls[0];
        const metadata = uploadImagesCall[1];

        expect(metadata[0]).toMatchObject({
          phenotyper_name: 'unknown',
          phenotyper_email: 'unknown',
        });
      });

      it('should use "unknown" for missing scientist fields', async () => {
        // Scan without scientist in experiment
        const scanWithoutScientist = {
          ...mockScan,
          experiment: {
            ...mockExperiment,
            scientist: undefined,
          },
        };
        mockPrismaClient.scan.findUnique.mockResolvedValue(
          scanWithoutScientist
        );

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123');

        const uploadImagesCall = (uploadImages as Mock).mock.calls[0];
        const metadata = uploadImagesCall[1];

        expect(metadata[0]).toMatchObject({
          scientist_name: 'unknown',
          scientist_email: 'unknown',
        });
      });

      it('should include date_scanned as ISO string', async () => {
        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123');

        const uploadImagesCall = (uploadImages as Mock).mock.calls[0];
        const metadata = uploadImagesCall[1];

        expect(metadata[0].date_scanned).toBe('2024-01-15T10:30:00.000Z');
      });

      it('should pass SupabaseUploader and SupabaseStore to uploadImages', async () => {
        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123');

        const uploadImagesCall = (uploadImages as Mock).mock.calls[0];
        const passedUploader = uploadImagesCall[2];
        const passedStore = uploadImagesCall[3];

        // Should be the mock instances
        expect(passedUploader).toBe(mockUploader);
        expect(passedStore).toBe(mockStore);
      });

      it('should fetch scan with experiment, phenotyper, and scientist relations', async () => {
        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123');

        // Verify Prisma query includes necessary relations
        expect(mockPrismaClient.scan.findUnique).toHaveBeenCalledWith({
          where: { id: 'scan-123' },
          include: {
            images: true,
            experiment: {
              include: {
                scientist: true,
              },
            },
            phenotyper: true,
          },
        });
      });
    });

    /**
     * add-cylinderscan-delete-upload-integrity, tasks.md 3.1/3.3/3.5/3.7.
     * See design.md Decisions 7-10 for the full rationale — an earlier
     * draft also attempted retry-time re-verification of already-
     * 'uploaded' images; that was found unimplementable during review and
     * is explicitly out of scope (Decision 9).
     */
    describe('soft-delete guard (Decision: Upload Excludes Soft-Deleted Scans)', () => {
      it('rejects uploadScan for a deleted scan without calling the upload function', async () => {
        mockPrismaClient.scan.findUnique.mockResolvedValue({
          ...mockScan,
          deleted: true,
        });

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        const result = await uploader.uploadScan('scan-123');

        expect(result.success).toBe(false);
        expect(uploadImages).not.toHaveBeenCalled();
        expect(mockPrismaClient.image.update).not.toHaveBeenCalled();
      });

      it('uploadBatch skips a deleted scan while still processing the others', async () => {
        mockPrismaClient.scan.findUnique.mockImplementation(
          ({ where }: { where: { id: string } }) => {
            if (where.id === 'scan-deleted') {
              return Promise.resolve({
                ...mockScan,
                id: 'scan-deleted',
                deleted: true,
              });
            }
            return Promise.resolve(mockScan);
          }
        );

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        const results = await uploader.uploadBatch(['scan-deleted', 'scan-123']);

        expect(results).toHaveLength(2);
        expect(results[0].success).toBe(false);
        expect(results[1].success).toBe(true);
        expect(results[1].uploaded).toBe(3);
      });
    });

    describe('retry-skip filter and index-safety (Decisions 9 & 10)', () => {
      function scanWithMixedStatuses(): MockScan {
        return {
          ...mockScan,
          images: [
            { ...mockScan.images[0], id: 'img-A', status: 'uploaded' },
            { ...mockScan.images[1], id: 'img-B', status: 'failed' },
            { ...mockScan.images[2], id: 'img-C', status: 'pending' },
          ],
        };
      }

      it('only passes non-uploaded images to the bloom-fs upload call', async () => {
        mockPrismaClient.scan.findUnique.mockResolvedValue(
          scanWithMixedStatuses()
        );

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        const result = await uploader.uploadScan('scan-123');

        const callArgs = (uploadImages as Mock).mock.calls[0];
        const imagePaths = callArgs[0] as string[];
        expect(imagePaths).toHaveLength(2);
        expect(result.total).toBe(2);
      });

      it("never touches an already-'uploaded' image's status", async () => {
        mockPrismaClient.scan.findUnique.mockResolvedValue(
          scanWithMixedStatuses()
        );

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123');

        const updatedImageIds = (
          mockPrismaClient.image.update as Mock
        ).mock.calls.map((call) => call[0].where.id);
        expect(updatedImageIds).not.toContain('img-A');
      });

      it('applies status updates to the correct image, not by stale array position', async () => {
        mockPrismaClient.scan.findUnique.mockResolvedValue(
          scanWithMixedStatuses()
        );
        // bloom-fs reports: filtered index 0 (img-B) succeeds, index 1
        // (img-C) fails. A naive scan.images[index] implementation would
        // apply these to img-A (index 0) and img-B (index 1) instead.
        (uploadImages as Mock).mockImplementation(
          async (
            _paths: string[],
            metadata: unknown[],
            _uploader: unknown,
            _store: unknown,
            opts?: {
              result?: (
                index: number,
                m: unknown,
                created: number | null,
                error: unknown
              ) => void;
            }
          ) => {
            await opts?.result?.(0, metadata[0], 1, null);
            await opts?.result?.(1, metadata[1], null, new Error('failed'));
          }
        );

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123');

        const updateCalls = (mockPrismaClient.image.update as Mock).mock.calls;
        const statusById = new Map(
          updateCalls.map((call) => [call[0].where.id, call[0].data.status])
        );
        expect(statusById.get('img-B')).toBe('uploaded');
        expect(statusById.get('img-C')).toBe('failed');
        expect(statusById.has('img-A')).toBe(false);
      });

      it('marks only the filtered subset as uploading, not the already-uploaded image', async () => {
        mockPrismaClient.scan.findUnique.mockResolvedValue(
          scanWithMixedStatuses()
        );

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123');

        const uploadingCalls = (
          mockPrismaClient.image.update as Mock
        ).mock.calls.filter((call) => call[0].data.status === 'uploading');
        const uploadingIds = uploadingCalls.map((call) => call[0].where.id);
        expect(uploadingIds).not.toContain('img-A');
        expect(uploadingIds.sort()).toEqual(['img-B', 'img-C']);
      });

      it('an all-uploaded scan makes zero bloom-fs calls and leaves every status untouched', async () => {
        mockPrismaClient.scan.findUnique.mockResolvedValue({
          ...mockScan,
          images: mockScan.images.map((img) => ({
            ...img,
            status: 'uploaded' as const,
          })),
        });

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        const result = await uploader.uploadScan('scan-123');

        expect(uploadImages).not.toHaveBeenCalled();
        expect(mockPrismaClient.image.update).not.toHaveBeenCalled();
        expect(result.total).toBe(0);
        expect(result.success).toBe(true);
      });
    });

    describe('storage-existence verification (Decision 7)', () => {
      it('marks the image uploaded when the object is confirmed present', async () => {
        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        const result = await uploader.uploadScan('scan-123');

        expect(result.uploaded).toBe(3);
        expect(mockPrismaClient.image.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: { status: 'uploaded' } })
        );
      });

      it('marks the image failed with a distinguishing message when confirmed missing', async () => {
        mockSupabaseClient.storage.from.mockReturnValue({
          list: vi.fn().mockResolvedValue({ data: [], error: null }),
        });

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        const result = await uploader.uploadScan('scan-123');

        expect(result.uploaded).toBe(0);
        expect(result.failed).toBe(3);
        expect(result.errors[0]).toContain('not found in storage');
      });

      it('treats a null object_path lookup as inconclusive, not confirmed-missing', async () => {
        vi.useFakeTimers();
        mockSupabaseClient.from.mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        });

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        const uploadPromise = uploader.uploadScan('scan-123');
        await vi.runAllTimersAsync();
        const result = await uploadPromise;

        expect(result.failed).toBe(3);
        expect(result.errors[0]).toContain('verification could not be confirmed');
        expect(result.errors[0]).not.toContain('not found in storage');
        vi.useRealTimers();
      });

      it('retries a transient verification failure and succeeds on a later attempt', async () => {
        vi.useFakeTimers();
        let callCount = 0;
        mockSupabaseClient.from.mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockImplementation(() => {
                callCount++;
                if (callCount < 3) {
                  return Promise.resolve({
                    data: null,
                    error: new Error('network error'),
                  });
                }
                return Promise.resolve({
                  data: { object_path: 'cyl-images/found.png' },
                  error: null,
                });
              }),
            }),
          }),
        });
        // Single-image scan to keep the attempt count deterministic.
        mockPrismaClient.scan.findUnique.mockResolvedValue({
          ...mockScan,
          images: [mockScan.images[0]],
        });

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        const uploadPromise = uploader.uploadScan('scan-123');
        await vi.runAllTimersAsync();
        const result = await uploadPromise;

        expect(callCount).toBe(3);
        expect(result.uploaded).toBe(1);
        vi.useRealTimers();
      });

      it('marks failed with a distinct message after exhausting all verification retries', async () => {
        vi.useFakeTimers();
        mockSupabaseClient.from.mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi
                .fn()
                .mockResolvedValue({ data: null, error: new Error('down') }),
            }),
          }),
        });
        mockPrismaClient.scan.findUnique.mockResolvedValue({
          ...mockScan,
          images: [mockScan.images[0]],
        });

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        const uploadPromise = uploader.uploadScan('scan-123');
        await vi.runAllTimersAsync();
        const result = await uploadPromise;

        expect(result.failed).toBe(1);
        expect(result.errors[0]).toContain('verification could not be confirmed');
        vi.useRealTimers();
      });

      it('bounds verification concurrency at the same nWorkers as the upload phase', async () => {
        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123');

        expect(concurrentMap).toHaveBeenCalledWith(
          expect.any(Array),
          4,
          expect.any(Function)
        );
      });
    });

    describe('uploadScan awaits verification before returning (Decision 8)', () => {
      it('does not resolve while a verification call is still pending, and reflects final status once it resolves', async () => {
        mockPrismaClient.scan.findUnique.mockResolvedValue({
          ...mockScan,
          images: [mockScan.images[0], mockScan.images[1]],
        });

        let resolveVerify: (value: unknown) => void = () => {};
        const verifyPromise = new Promise((resolve) => {
          resolveVerify = resolve;
        });
        let lookupCallCount = 0;
        mockSupabaseClient.from.mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockImplementation(() => {
                lookupCallCount++;
                // First image's lookup resolves immediately; second's
                // stays pending until the test manually resolves it.
                if (lookupCallCount === 1) {
                  return Promise.resolve({
                    data: { object_path: 'cyl-images/found.png' },
                    error: null,
                  });
                }
                return verifyPromise.then(() => ({
                  data: { object_path: 'cyl-images/found.png' },
                  error: null,
                }));
              }),
            }),
          }),
        });

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();

        let settled = false;
        const uploadPromise = uploader
          .uploadScan('scan-123')
          .then((result) => {
            settled = true;
            return result;
          });

        // Flush microtasks without resolving verifyPromise.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(settled).toBe(false);

        resolveVerify(undefined);
        const result = await uploadPromise;

        expect(settled).toBe(true);
        expect(result.uploaded).toBe(2);
      });
    });
  });
});
