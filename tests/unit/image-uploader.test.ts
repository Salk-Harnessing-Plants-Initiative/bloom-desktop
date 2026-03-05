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

// Types for testing
interface MockImage {
  id: string;
  scan_id: string;
  frame_number: number;
  path: string;
  status: string;
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
}));

// Mock config-store
vi.mock('../../src/main/config-store', () => ({
  loadEnvConfig: vi.fn(),
}));

// Import after mocking
import { createClient } from '@supabase/supabase-js';
import { SupabaseUploader, SupabaseStore } from '@salk-hpi/bloom-js';
import { uploadImages } from '@salk-hpi/bloom-fs';
import { loadEnvConfig } from '../../src/main/config-store';

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
  });
});
