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
import type { ImageStatus } from '../types/database';
import { loadEnvConfig, getScansDir as getConfiguredScansDir } from './config-store';
import path from 'path';
import os from 'os';
import type {
  TypedSupabaseClient,
  SupabaseUploader,
  SupabaseStore,
} from '@salk-hpi/bloom-js';
import type { uploadImages, concurrentMap } from '@salk-hpi/bloom-fs';

/** Verification-call attempt count and delay — design.md Decision 7. */
const VERIFICATION_MAX_ATTEMPTS = 3;
const VERIFICATION_RETRY_DELAY_MS = 500;

/** Concurrency bound for the post-upload verification pass — matches the
 * upload phase's own nWorkers (Decision 8's revision after an unbounded
 * Promise.all was found to fan out to the scan's full image count). */
const VERIFICATION_CONCURRENCY = 4;

type VerificationOutcome = 'present' | 'missing' | 'inconclusive';

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
  status: Extract<ImageStatus, 'uploaded' | 'failed'>;
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
  private supabase: TypedSupabaseClient | null = null;
  private uploader: SupabaseUploader | null = null;
  private store: SupabaseStore | null = null;
  private uploadImagesFn: typeof uploadImages | null = null;
  private concurrentMapFn: typeof concurrentMap | null = null;
  private authenticated = false;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Get the scans directory from machine config.
   * Used to resolve relative Image.path values to absolute paths for upload.
   */
  private async getScansDir(): Promise<string> {
    return getConfiguredScansDir();
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
    const { uploadImages, concurrentMap } = await import('@salk-hpi/bloom-fs');

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
    this.concurrentMapFn = concurrentMap;
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
   * Look up a freshly-uploaded image's `object_path` from `cyl_images`
   * (bloom-fs's own `result` callback never returns it) and check whether
   * the object actually exists in Supabase storage. Returns a three-way
   * outcome — a lookup/check failure ('inconclusive') must not be treated
   * the same as a confirmed-missing object, since a subsequent retry
   * would otherwise re-upload an image whose bytes may already exist,
   * recreating the duplicate-remote-row risk the retry-skip fix (Decision
   * 9) exists to prevent. See design.md Decision 7.
   */
  private async verifyUploadedObject(
    createdId: number
  ): Promise<VerificationOutcome> {
    if (!this.supabase) return 'inconclusive';

    const { data, error } = await this.supabase
      .from('cyl_images')
      .select('object_path')
      .eq('id', createdId)
      .single();

    if (error || !data?.object_path) {
      return 'inconclusive';
    }

    const objectPath = data.object_path as string;
    const dir = path.posix.dirname(objectPath);
    const filename = path.posix.basename(objectPath);

    const { data: listData, error: listError } = await this.supabase.storage
      .from('images')
      .list(dir, { search: filename });

    if (listError) {
      return 'inconclusive';
    }

    const found = (listData || []).some((item) => item.name === filename);
    return found ? 'present' : 'missing';
  }

  /**
   * Retries `verifyUploadedObject` on an inconclusive (network/lookup
   * failure) outcome, up to VERIFICATION_MAX_ATTEMPTS total attempts with
   * a fixed delay between them — absorbs ordinary transient blips without
   * conflating them with a confirmed-missing object.
   */
  private async verifyUploadedObjectWithRetry(
    createdId: number
  ): Promise<VerificationOutcome> {
    let outcome: VerificationOutcome = 'inconclusive';

    for (let attempt = 1; attempt <= VERIFICATION_MAX_ATTEMPTS; attempt++) {
      outcome = await this.verifyUploadedObject(createdId);
      if (outcome !== 'inconclusive') {
        return outcome;
      }
      if (attempt < VERIFICATION_MAX_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, VERIFICATION_RETRY_DELAY_MS)
        );
      }
    }

    return outcome;
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
    if (
      !this.authenticated ||
      !this.uploader ||
      !this.store ||
      !this.uploadImagesFn ||
      !this.concurrentMapFn
    ) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }
    const uploadImagesFn = this.uploadImagesFn;
    const concurrentMapFn = this.concurrentMapFn;

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

    // Reject soft-deleted scans outright — no images uploaded, no status
    // changed. See "Upload Excludes Soft-Deleted Scans" (upload spec).
    if (scan.deleted) {
      return {
        success: false,
        scanId,
        uploaded: 0,
        failed: 0,
        total: 0,
        errors: [`Scan ${scanId} is deleted; upload refused`],
      };
    }

    // Retry-skip (Decision 9): only attempt images not already
    // 'uploaded'. This tier does NOT re-verify already-'uploaded' images
    // (found unimplementable — no local record of a prior upload's
    // remote reference exists; see design.md Decision 9).
    const imagesToUpload = scan.images.filter(
      (image) => image.status !== 'uploaded'
    );

    const result: UploadResult = {
      success: true,
      scanId,
      uploaded: 0,
      failed: 0,
      total: imagesToUpload.length,
      errors: [],
    };

    if (imagesToUpload.length === 0) {
      return result;
    }

    // Build absolute image paths for bloom-fs uploadImages
    // Image.path stores relative paths (pilot-compatible), so prepend scansDir
    const scansDir = await this.getScansDir();
    const imagePaths = imagesToUpload.map((image) =>
      path.isAbsolute(image.path) ? image.path : path.join(scansDir, image.path)
    );
    const metadata = imagesToUpload.map((image) =>
      this.buildCylImageMetadata(scan, image)
    );

    // Mark only the filtered subset as uploading (Decision 10) — an
    // already-'uploaded' image must never be touched by this call, or it
    // would be flipped to 'uploading' and never resolved back since it's
    // excluded from the upload call below.
    const uploadingStatus: ImageStatus = 'uploading';
    for (const image of imagesToUpload) {
      await this.prisma.image.update({
        where: { id: image.id },
        data: { status: uploadingStatus },
      });
    }

    // The result callback only synchronously records outcomes into
    // `recorded` — it does NOT perform verification inline. bloom-fs
    // never awaits this callback internally (confirmed against its
    // compiled source), so doing async verification work here would let
    // uploadScan() return before it completes (Decision 8).
    const recorded: Array<{
      index: number;
      created: number | null;
      error: unknown;
    }> = [];

    // Use bloom-fs uploadImages for coordinated storage + database upload
    // Note: bucket is hardcoded to "images" inside bloom-fs
    await uploadImagesFn(imagePaths, metadata, this.uploader, this.store, {
      // Bounded concurrency for Bloom uploads. Each image is 3 round-trips
      // (insert RPC → file upload → update RPC); 4 workers keeps HTTPS
      // pipes saturated without overwhelming Bloom's API or the local
      // network — same rationale as GraviScan's identical constant
      // (graviscan-upload.ts's UPLOAD_CONCURRENCY). Evaluated against
      // pilot issue #110 (which used 10 workers) and left as-is — no
      // evidence current lab upload volume makes this a bottleneck.
      nWorkers: 4,
      pngCompression: 9,
      before: (index: number) => {
        // Called before each image upload starts
        console.debug(
          `[Upload] Uploading image ${index + 1}/${imagesToUpload.length}`
        );
      },
      result: (
        index: number,
        _m: unknown,
        created: number | null,
        error: unknown
      ) => {
        recorded.push({ index, created, error });
      },
    });

    // Verify and write status for every recorded entry, bounded at the
    // same nWorkers concurrency as the upload phase (Decision 8) — an
    // unbounded Promise.all here would fan out to the scan's full image
    // count rather than staying bounded. Each entry's work is isolated in
    // its own try/catch so one unexpected error doesn't discard every
    // other entry's already-completed status write.
    await concurrentMapFn(
      recorded,
      VERIFICATION_CONCURRENCY,
      async (entry: { index: number; created: number | null; error: unknown }) => {
        const image = imagesToUpload[entry.index];

        try {
          if (entry.error || entry.created === null) {
            const errorMsg =
              entry.error instanceof Error
                ? entry.error.message
                : entry.error
                  ? JSON.stringify(entry.error, null, 2)
                  : 'Upload failed (created=null)';
            console.error(`[Upload] Image ${image.id} FAILED:`, errorMsg);

            const failedStatus: ImageStatus = 'failed';
            await this.prisma.image.update({
              where: { id: image.id },
              data: { status: failedStatus },
            });
            result.failed++;
            result.errors.push(`Image ${image.id}: ${errorMsg}`);

            onProgress?.({
              current: entry.index + 1,
              total: imagesToUpload.length,
              percentage: Math.round(
                ((entry.index + 1) / imagesToUpload.length) * 100
              ),
              imageId: image.id,
              status: 'failed',
            });
            return;
          }

          const outcome = await this.verifyUploadedObjectWithRetry(
            entry.created
          );

          if (outcome === 'present') {
            console.debug(
              `[Upload] Image ${image.id} verified uploaded (id=${entry.created})`
            );
            const uploadedStatus: ImageStatus = 'uploaded';
            await this.prisma.image.update({
              where: { id: image.id },
              data: { status: uploadedStatus },
            });
            result.uploaded++;

            onProgress?.({
              current: entry.index + 1,
              total: imagesToUpload.length,
              percentage: Math.round(
                ((entry.index + 1) / imagesToUpload.length) * 100
              ),
              imageId: image.id,
              status: 'uploaded',
            });
          } else {
            const errorMsg =
              outcome === 'missing'
                ? 'upload reported success but object not found in storage'
                : 'upload succeeded but verification could not be confirmed';
            console.error(
              `[Upload] Image ${image.id} verification failed:`,
              errorMsg
            );

            const failedStatus: ImageStatus = 'failed';
            await this.prisma.image.update({
              where: { id: image.id },
              data: { status: failedStatus },
            });
            result.failed++;
            result.errors.push(`Image ${image.id}: ${errorMsg}`);

            onProgress?.({
              current: entry.index + 1,
              total: imagesToUpload.length,
              percentage: Math.round(
                ((entry.index + 1) / imagesToUpload.length) * 100
              ),
              imageId: image.id,
              status: 'failed',
            });
          }
        } catch (unexpectedError) {
          console.error(
            `[Upload] Unexpected error processing image ${image.id}:`,
            unexpectedError
          );
          result.failed++;
          result.errors.push(
            `Image ${image.id}: ${
              unexpectedError instanceof Error
                ? unexpectedError.message
                : 'Unknown error'
            }`
          );
        }
      }
    );

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
