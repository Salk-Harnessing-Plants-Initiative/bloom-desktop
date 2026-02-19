/**
 * Image Upload Service
 *
 * Handles uploading scan images to Bloom remote storage via Supabase.
 * Uses SupabaseUploader from @salk-hpi/bloom-js for image compression and upload.
 *
 * Related: openspec/changes/add-browse-scans (Phase 5)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SupabaseUploader } from '@salk-hpi/bloom-js';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from './config-store';
import path from 'path';
import os from 'os';

// Default env path for credentials
const BLOOM_DIR = path.join(os.homedir(), '.bloom');
const ENV_PATH = path.join(BLOOM_DIR, '.env');

// Storage bucket name for images
const STORAGE_BUCKET = 'images';

/**
 * Result of uploading a single scan
 */
export interface UploadResult {
  success: boolean;
  scanId: string;
  uploaded: number;
  failed: number;
  total: number;
  errors: string[];
}

/**
 * Progress info for a single image upload
 */
export interface UploadProgress {
  current: number;
  total: number;
  percentage: number;
  imageId: string;
  status: 'uploaded' | 'failed';
}

/**
 * Callback for upload progress updates
 */
export type UploadProgressCallback = (progress: UploadProgress) => void;

/**
 * Progress info for batch upload
 */
export interface BatchProgress {
  currentScan: number;
  totalScans: number;
  scanId: string;
  scanResult: UploadResult;
}

/**
 * Callback for batch upload progress updates
 */
export type BatchProgressCallback = (progress: BatchProgress) => void;

/**
 * Image uploader service for uploading scan images to Bloom storage
 */
export class ImageUploader {
  private prisma: PrismaClient;
  private supabase: SupabaseClient | null = null;
  private uploader: SupabaseUploader | null = null;
  private authenticated = false;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Authenticate with Bloom/Supabase using stored credentials
   * Must be called before uploading
   */
  async authenticate(): Promise<void> {
    // Load credentials from config
    const config = loadEnvConfig(ENV_PATH);

    // Validate credentials exist
    if (!config.bloom_scanner_username || !config.bloom_scanner_password) {
      throw new Error('Missing Bloom credentials');
    }

    if (!config.bloom_anon_key) {
      throw new Error('Missing Bloom credentials');
    }

    // Create Supabase client
    this.supabase = createClient(config.bloom_api_url, config.bloom_anon_key);

    // Authenticate with email/password
    const { error: authError } = await this.supabase.auth.signInWithPassword({
      email: config.bloom_scanner_username,
      password: config.bloom_scanner_password,
    });

    if (authError) {
      throw new Error(`Authentication failed: ${authError.message}`);
    }

    // Create uploader instance
    this.uploader = new SupabaseUploader(this.supabase);
    this.authenticated = true;
  }

  /**
   * Upload all images for a single scan
   *
   * @param scanId - The scan ID to upload
   * @param onProgress - Optional callback for progress updates
   * @returns Upload result with statistics
   */
  async uploadScan(
    scanId: string,
    onProgress?: UploadProgressCallback
  ): Promise<UploadResult> {
    if (!this.authenticated || !this.uploader) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    // Fetch scan with images
    const scan = await this.prisma.scan.findUnique({
      where: { id: scanId },
      include: { images: true },
    });

    if (!scan) {
      throw new Error(`Scan not found: ${scanId}`);
    }

    const result: UploadResult = {
      success: true,
      scanId,
      uploaded: 0,
      failed: 0,
      total: scan.images.length,
      errors: [],
    };

    // Upload each image
    for (let i = 0; i < scan.images.length; i++) {
      const image = scan.images[i];

      // Mark as uploading
      await this.prisma.image.update({
        where: { id: image.id },
        data: { status: 'uploading' },
      });

      // Generate destination path
      const filename = path.basename(image.path);
      const destPath = `scans/${scanId}/${filename}`;

      try {
        // Upload image
        const { error: uploadError } = await this.uploader.uploadImage(
          image.path,
          destPath,
          STORAGE_BUCKET,
          { pngCompression: 9 }
        );

        if (uploadError) {
          // Mark as failed
          await this.prisma.image.update({
            where: { id: image.id },
            data: { status: 'failed' },
          });
          result.failed++;
          result.errors.push(
            `Image ${image.id}: ${uploadError.message || 'Upload failed'}`
          );

          // Report progress with failed status
          onProgress?.({
            current: i + 1,
            total: scan.images.length,
            percentage: Math.round(((i + 1) / scan.images.length) * 100),
            imageId: image.id,
            status: 'failed',
          });
        } else {
          // Mark as uploaded
          await this.prisma.image.update({
            where: { id: image.id },
            data: { status: 'uploaded' },
          });
          result.uploaded++;

          // Report progress with uploaded status
          onProgress?.({
            current: i + 1,
            total: scan.images.length,
            percentage: Math.round(((i + 1) / scan.images.length) * 100),
            imageId: image.id,
            status: 'uploaded',
          });
        }
      } catch (err) {
        // Handle unexpected errors
        await this.prisma.image.update({
          where: { id: image.id },
          data: { status: 'failed' },
        });
        result.failed++;
        result.errors.push(
          `Image ${image.id}: ${err instanceof Error ? err.message : 'Unknown error'}`
        );

        onProgress?.({
          current: i + 1,
          total: scan.images.length,
          percentage: Math.round(((i + 1) / scan.images.length) * 100),
          imageId: image.id,
          status: 'failed',
        });
      }
    }

    // Set overall success based on failures
    result.success = result.failed === 0 || result.uploaded > 0;

    // If all uploads failed, mark as unsuccessful
    if (result.uploaded === 0 && result.total > 0) {
      result.success = false;
    }

    return result;
  }

  /**
   * Upload multiple scans in sequence
   *
   * @param scanIds - Array of scan IDs to upload
   * @param onProgress - Optional callback for overall batch progress
   * @returns Array of upload results
   */
  async uploadBatch(
    scanIds: string[],
    onProgress?: BatchProgressCallback
  ): Promise<UploadResult[]> {
    const results: UploadResult[] = [];

    for (let i = 0; i < scanIds.length; i++) {
      const scanId = scanIds[i];
      const scanResult = await this.uploadScan(scanId);
      results.push(scanResult);

      // Report batch progress
      onProgress?.({
        currentScan: i + 1,
        totalScans: scanIds.length,
        scanId,
        scanResult,
      });
    }

    return results;
  }
}
