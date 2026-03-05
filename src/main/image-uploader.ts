/**
 * Image Upload Service
 *
 * Handles uploading scan images to Bloom remote storage via Supabase.
 * Uses @salk-hpi/bloom-fs for coordinated storage and database operations,
 * matching the pilot implementation for feature parity.
 *
 * IMPORTANT: Uses dynamic imports for @supabase/supabase-js, @salk-hpi/bloom-js,
 * and @salk-hpi/bloom-fs to avoid loading these modules at app startup.
 * This prevents startup issues in the packaged app, matching the pattern
 * used in config-store.ts.
 *
 * Related: openspec/changes/add-browse-scans (Phase 5)
 * Related: openspec/changes/fix-upload-database-registration
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { loadEnvConfig } from './config-store';
import path from 'path';
import os from 'os';

// Default env path for credentials
const BLOOM_DIR = path.join(os.homedir(), '.bloom');
const ENV_PATH = path.join(BLOOM_DIR, '.env');

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
 * Type for scan with all required relations for building CylImageMetadata
 */
type ScanWithRelations = Prisma.ScanGetPayload<{
  include: {
    images: true;
    experiment: {
      include: {
        scientist: true;
      };
    };
    phenotyper: true;
  };
}>;

/**
 * Image uploader service for uploading scan images to Bloom storage
 *
 * Uses @salk-hpi/bloom-fs uploadImages function to coordinate both
 * storage upload and database registration, matching pilot behavior.
 *
 * Uses dynamic imports to load Supabase modules only when upload is initiated,
 * preventing startup issues in the packaged app.
 */
export class ImageUploader {
  private prisma: PrismaClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private supabase: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private uploader: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private store: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private uploadImagesFn: any = null;
  private authenticated = false;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Get the scans directory from machine config.
   * Used to resolve relative Image.path values to absolute paths for upload.
   */
  private async getScansDir(): Promise<string> {
    const config = loadEnvConfig(
      path.join(os.homedir(), '.bloom', '.env')
    );
    return config.scans_dir || path.join(os.homedir(), '.bloom', 'scans');
  }

  /**
   * Authenticate with Bloom/Supabase using stored credentials
   * Must be called before uploading
   *
   * Note: Uses dynamic imports to avoid loading Supabase at app startup,
   * matching the pattern in config-store.ts fetchScannersFromBloom()
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

    // Dynamic imports to avoid loading at app startup
    const { createClient } = await import('@supabase/supabase-js');
    const { SupabaseUploader, SupabaseStore } = await import(
      '@salk-hpi/bloom-js'
    );
    const { uploadImages } = await import('@salk-hpi/bloom-fs');

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

    // Create uploader and store instances for both storage and database operations
    this.uploader = new SupabaseUploader(this.supabase);
    this.store = new SupabaseStore(this.supabase);
    this.uploadImagesFn = uploadImages;
    this.authenticated = true;
  }

  /**
   * Build CylImageMetadata for a single image
   *
   * Constructs the metadata object required by @salk-hpi/bloom-fs uploadImages,
   * matching the pilot implementation structure.
   */
  private buildCylImageMetadata(
    scan: ScanWithRelations,
    image: ScanWithRelations['images'][0]
  ) {
    return {
      species: scan.experiment?.species,
      experiment: scan.experiment?.name,
      wave_number: scan.wave_number ?? undefined,
      germ_day: 0,
      germ_day_color: 'none',
      plant_age_days: scan.plant_age_days ?? undefined,
      date_scanned: scan.capture_date?.toISOString(),
      device_name: scan.scanner_name ?? undefined,
      plant_qr_code: scan.plant_id,
      frame_number: image.frame_number,
      accession_name: scan.accession_name ?? undefined,
      phenotyper_name: scan.phenotyper?.name || 'unknown',
      phenotyper_email: scan.phenotyper?.email || 'unknown',
      scientist_name: scan.experiment?.scientist?.name || 'unknown',
      scientist_email: scan.experiment?.scientist?.email || 'unknown',
      num_frames: scan.num_frames || 0,
      exposure_time: scan.exposure_time || 0,
      gain: scan.gain || 0,
      brightness: scan.brightness || 0,
      contrast: scan.contrast || 0,
      gamma: scan.gamma || 0,
      seconds_per_rot: scan.seconds_per_rot || 0,
    };
  }

  /**
   * Upload all images for a single scan
   *
   * Uses @salk-hpi/bloom-fs uploadImages to coordinate both storage upload
   * and database registration, ensuring images are visible in Bloom web interface.
   *
   * @param scanId - The scan ID to upload
   * @param onProgress - Optional callback for progress updates
   * @returns Upload result with statistics
   */
  async uploadScan(
    scanId: string,
    onProgress?: UploadProgressCallback
  ): Promise<UploadResult> {
    if (!this.authenticated || !this.uploader || !this.store) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    // Fetch scan with all required relations for building CylImageMetadata
    const scan = await this.prisma.scan.findUnique({
      where: { id: scanId },
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

    // Handle empty scan
    if (scan.images.length === 0) {
      return result;
    }

    // Build absolute image paths for bloom-fs uploadImages
    // Image.path stores relative paths (pilot-compatible), so prepend scansDir
    const scansDir = await this.getScansDir();
    const imagePaths = scan.images.map((image) =>
      image.path.startsWith('/') ? image.path : path.join(scansDir, image.path)
    );
    const metadata = scan.images.map((image) =>
      this.buildCylImageMetadata(scan, image)
    );

    // Mark all images as uploading
    for (const image of scan.images) {
      await this.prisma.image.update({
        where: { id: image.id },
        data: { status: 'uploading' },
      });
    }

    // Use bloom-fs uploadImages for coordinated storage + database upload
    // Note: bucket is hardcoded to "images" inside bloom-fs
    await this.uploadImagesFn(imagePaths, metadata, this.uploader, this.store, {
      nWorkers: 4,
      pngCompression: 9,
      before: (index: number) => {
        // Called before each image upload starts
        console.debug(
          `[Upload] Uploading image ${index + 1}/${scan.images.length}`
        );
      },
      result: async (
        index: number,
        _m: unknown,
        created: number | null,
        error: unknown
      ) => {
        const image = scan.images[index];

        if (error || created === null) {
          const errorMsg =
            error instanceof Error
              ? error.message
              : error
                ? JSON.stringify(error, null, 2)
                : 'Upload failed (created=null)';
          console.error(
            `[Upload] Image ${index + 1}/${scan.images.length} FAILED:`,
            error instanceof Error ? errorMsg : error
          );

          // Mark as failed
          await this.prisma.image.update({
            where: { id: image.id },
            data: { status: 'failed' },
          });
          result.failed++;
          result.errors.push(`Image ${image.id}: ${errorMsg}`);

          onProgress?.({
            current: index + 1,
            total: scan.images.length,
            percentage: Math.round(((index + 1) / scan.images.length) * 100),
            imageId: image.id,
            status: 'failed',
          });
        } else {
          console.debug(
            `[Upload] Image ${index + 1}/${scan.images.length} OK (id=${created})`
          );
          // Mark as uploaded
          await this.prisma.image.update({
            where: { id: image.id },
            data: { status: 'uploaded' },
          });
          result.uploaded++;

          onProgress?.({
            current: index + 1,
            total: scan.images.length,
            percentage: Math.round(((index + 1) / scan.images.length) * 100),
            imageId: image.id,
            status: 'uploaded',
          });
        }
      },
    });

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
