/**
 * Unit tests for image-uploader module
 *
 * TDD: These tests are written first before implementation (RED phase).
 * The tests define the expected behavior of the image upload service.
 *
 * Related: openspec/changes/add-browse-scans (Phase 5)
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

interface MockScan {
  id: string;
  plant_id: string;
  images: MockImage[];
}

// Mock modules before importing
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

vi.mock('@salk-hpi/bloom-js', () => ({
  SupabaseUploader: vi.fn(),
}));

// Mock config-store
vi.mock('../../src/main/config-store', () => ({
  loadEnvConfig: vi.fn(),
}));

// Import after mocking
import { createClient } from '@supabase/supabase-js';
import { SupabaseUploader } from '@salk-hpi/bloom-js';
import { loadEnvConfig } from '../../src/main/config-store';

// Import the module under test (will fail until implemented)
import {
  ImageUploader,
  UploadResult,
  UploadProgressCallback,
} from '../../src/main/image-uploader';

describe('image-uploader (add-browse-scans Phase 5)', () => {
  // Mock instances
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockSupabaseClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockUploader: any;
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

  const mockScan: MockScan = {
    id: 'scan-123',
    plant_id: 'PLANT-001',
    images: [
      {
        id: 'img-1',
        scan_id: 'scan-123',
        frame_number: 0,
        path: '/test/scans/PLANT-001/frame_0.png',
        status: 'pending',
      },
      {
        id: 'img-2',
        scan_id: 'scan-123',
        frame_number: 1,
        path: '/test/scans/PLANT-001/frame_1.png',
        status: 'pending',
      },
      {
        id: 'img-3',
        scan_id: 'scan-123',
        frame_number: 2,
        path: '/test/scans/PLANT-001/frame_2.png',
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

      it('should call SupabaseUploader.uploadImage for each image', async () => {
        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123');

        expect(mockUploader.uploadImage).toHaveBeenCalledTimes(3);

        // Verify upload was called with correct paths
        for (const image of mockScan.images) {
          expect(mockUploader.uploadImage).toHaveBeenCalledWith(
            image.path,
            expect.stringContaining('scan-123'), // destination path includes scan ID
            expect.any(String), // bucket name
            expect.any(Object) // options
          );
        }
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
        // Make second image upload fail
        mockUploader.uploadImage
          .mockResolvedValueOnce({ error: null })
          .mockResolvedValueOnce({ error: { message: 'Upload failed' } })
          .mockResolvedValueOnce({ error: null });

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
        // Make first image upload fail
        mockUploader.uploadImage
          .mockResolvedValueOnce({ error: { message: 'Upload failed' } })
          .mockResolvedValueOnce({ error: null })
          .mockResolvedValueOnce({ error: null });

        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        const result = await uploader.uploadScan('scan-123');

        // Should still upload all 3 images
        expect(mockUploader.uploadImage).toHaveBeenCalledTimes(3);

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
        mockUploader.uploadImage.mockResolvedValue({
          error: { message: 'All uploads failed' },
        });

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
        mockUploader.uploadImage
          .mockResolvedValueOnce({ error: null })
          .mockResolvedValueOnce({ error: { message: 'Upload failed' } })
          .mockResolvedValueOnce({ error: null });

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

        // Total uploads: 3 + 1 = 4
        expect(mockUploader.uploadImage).toHaveBeenCalledTimes(4);
      });

      it('should continue batch on individual scan failure', async () => {
        // Make all uploads for first scan fail
        mockUploader.uploadImage
          .mockResolvedValueOnce({ error: { message: 'Failed 1' } })
          .mockResolvedValueOnce({ error: { message: 'Failed 2' } })
          .mockResolvedValueOnce({ error: { message: 'Failed 3' } })
          .mockResolvedValueOnce({ error: null }); // Second scan succeeds

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

    describe('destination path generation', () => {
      it('should generate correct storage path for images', async () => {
        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123');

        // Verify destination path format: scans/{scanId}/frame_{N}.png
        expect(mockUploader.uploadImage).toHaveBeenCalledWith(
          mockScan.images[0].path,
          expect.stringMatching(/scans\/scan-123\/frame_0\.png/),
          expect.any(String),
          expect.any(Object)
        );
      });

      it('should use correct storage bucket', async () => {
        const uploader = new ImageUploader(mockPrismaClient);
        await uploader.authenticate();
        await uploader.uploadScan('scan-123');

        // Should use the correct bucket name (e.g., 'images' or configured bucket)
        expect(mockUploader.uploadImage).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          'images', // Expected bucket name
          expect.any(Object)
        );
      });
    });
  });
});
