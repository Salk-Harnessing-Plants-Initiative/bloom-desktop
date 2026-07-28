/**
 * GraviScan Upload Orchestration
 *
 * Uploads local GraviScan images to Supabase cloud:
 * 1. Calls insert_gravi_image RPC to create scan metadata
 * 2. Uploads raw image file to graviscan-images storage bucket
 * 3. Creates gravi_images row with the storage path
 * 4. Updates local SQLite status to "uploaded"
 *
 * IMPORTANT: Uses dynamic imports for @supabase/supabase-js and
 * @salk-hpi/bloom-js to avoid loading these modules at app startup. This
 * prevents startup issues in the packaged app, matching the pattern used in
 * image-uploader.ts and config-store.ts.
 *
 * Ported from stranded branch commit 84b54e6 (src/main/graviscan-upload.ts),
 * which never made it into the modular src/main/graviscan/ refactor. Adapted
 * to current conventions (loadEnvConfig(), dynamic imports) and to the
 * currently-installed @salk-hpi/bloom-js@0.2.1, whose SupabaseStore/
 * SupabaseUploader surface has drifted from what the reference file assumed
 * — see inline comments below and task-6-report.md for the full list of
 * deviations.
 */

import { PrismaClient } from '@prisma/client';
import type {
  SupabaseStore,
  SupabaseUploader,
  GraviImageMetadata,
} from '@salk-hpi/bloom-js';
import { resolveGraviScanPath } from './graviscan-path-utils';
import { loadEnvConfig } from './config-store';
import type {
  GraviScanStoreExtensions,
  GraviScanSessionParams,
  GraviScanMetadataParams,
} from '../types/graviscan-store';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as crypto from 'crypto';

export interface UploadProgress {
  total: number;
  completed: number;
  failed: number;
  currentFile: string;
}

export interface UploadResult {
  success: boolean;
  uploaded: number;
  skipped: number;
  failed: number;
  errors: string[];
}

/**
 * Locally validate that Bloom credentials are present in ~/.bloom/.env (via
 * loadEnvConfig(), same source image-uploader.ts uses). Pure local check —
 * no network call — so callers can bail out before touching the DB or the
 * network when credentials are missing.
 */
function validateBloomConfig(
  config: ReturnType<typeof loadEnvConfig>
): string | null {
  if (
    !config.bloom_api_url ||
    !config.bloom_anon_key ||
    !config.bloom_scanner_username ||
    !config.bloom_scanner_password
  ) {
    return 'Bloom credentials not found in ~/.bloom/.env';
  }
  return null;
}

/**
 * Authenticate with Supabase and create the store + uploader clients.
 * Assumes `config` has already passed validateBloomConfig().
 */
async function authenticateBloomClients(
  config: ReturnType<typeof loadEnvConfig>
): Promise<
  | {
      store: SupabaseStore;
      uploader: SupabaseUploader;
    }
  | { error: string }
> {
  // Dynamic imports to avoid loading Supabase at app startup
  const { createClient } = await import('@supabase/supabase-js');
  const { SupabaseStore, SupabaseUploader } = await import(
    '@salk-hpi/bloom-js'
  );

  const supabase = createClient(config.bloom_api_url, config.bloom_anon_key);
  const { error: authError } = await supabase.auth.signInWithPassword({
    email: config.bloom_scanner_username,
    password: config.bloom_scanner_password,
  });

  if (authError) {
    return { error: `Authentication failed: ${authError.message}` };
  }

  return {
    store: new SupabaseStore(supabase),
    uploader: new SupabaseUploader(supabase),
  };
}

/**
 * Map a file extension to a storage Content-Type for raw (non-re-encoded)
 * uploads.
 */
function rawContentType(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.tif':
    case '.tiff':
      return 'image/tiff';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Upload a file's raw bytes to Supabase Storage, without re-encoding.
 *
 * The installed @salk-hpi/bloom-js's SupabaseUploader only exposes
 * uploadImage() (re-encodes to PNG via sharp) and uploadJpegImage()
 * (re-encodes to JPEG) — both lossy and inappropriate for GraviScan's raw
 * TIFF captures, and neither matches the reference file's `uploadRawFile()`
 * call (which does not exist in the installed package at all — verified via
 * `grep -r uploadRawFile node_modules/@salk-hpi/bloom-js`). SupabaseUploader
 * exposes its underlying Supabase client as a public `supabase` property, so
 * we call `.storage.from(bucket).upload(...)` directly the same way
 * uploadImage()/uploadJpegImage() do internally, minus the sharp re-encode.
 */
async function uploadRawFile(
  uploader: SupabaseUploader,
  filePath: string,
  storagePath: string,
  bucket: string
): Promise<{ error: Error | null }> {
  try {
    const buffer = await fs.promises.readFile(filePath);
    const contentType = rawContentType(path.extname(filePath));
    const { error } = await uploader.supabase.storage
      .from(bucket)
      .upload(storagePath, buffer, { contentType });
    return { error: error ? new Error(error.message) : null };
  } catch (err) {
    return { error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Upload a list of scan+image jobs to Supabase.
 * Shared logic used by both per-experiment and global upload.
 */
async function processImageJobs(
  db: PrismaClient,
  store: SupabaseStore,
  uploader: SupabaseUploader,
  imageJobs: Array<{
    scan: {
      id: string;
      scanner: { name: string };
      phenotyper: { name: string; email: string };
      experiment: {
        name: string;
        species: string;
        scientist: { name: string; email: string } | null;
        accession: {
          name: string;
          graviPlateAccessions: Array<{
            id: string;
            plate_id: string;
            accession: string;
            transplant_date?: Date | null;
            custom_note?: string | null;
            sections: Array<{
              plate_section_id: string;
              plant_qr: string;
              medium: string | null;
            }>;
          }>;
        } | null;
      };
      plate_barcode: string | null;
      capture_date: Date;
      grid_mode: string;
      plate_index: string;
      resolution: number;
      format: string;
      cycle_number: number | null;
      wave_number: number;
      session_id: string | null;
    };
    image: { id: string; path: string };
  }>,
  sessionIdMap: Map<string, number>,
  metadataIdMap: Map<string, number>,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadResult> {
  // Bounded concurrency for Bloom uploads. Each image is 3 round-trips
  // (insert RPC → file upload → update RPC); 4 workers keeps HTTPS pipes
  // saturated without overwhelming Bloom's API or the local network when
  // running alongside rclone's Box backup.
  const UPLOAD_CONCURRENCY = 4;

  const errors: string[] = [];
  const total = imageJobs.length;
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  type Job = (typeof imageJobs)[number];

  const processOne = async (job: Job): Promise<void> => {
    const { scan, image } = job;
    try {
      // Resolve stale paths (DB may have _st_ only, disk file renamed with _et_)
      const resolvedPath = resolveGraviScanPath(image.path);
      if (!resolvedPath) {
        errors.push(`File not found: ${image.path}`);
        await db.graviImage.update({
          where: { id: image.id },
          data: { status: 'failed' },
        });
        failed++;
        return;
      }
      if (resolvedPath !== image.path) {
        console.log(
          `[GraviScan:UPLOAD] Resolved stale path: ${path.basename(image.path)} → ${path.basename(resolvedPath)}`
        );
        await db.graviImage.update({
          where: { id: image.id },
          data: { path: resolvedPath },
        });
        await db.graviScan.update({
          where: { id: scan.id },
          data: { path: resolvedPath },
        });
        image.path = resolvedPath;
      }

      // Find the matching plate metadata for this scan's plant barcode
      const matchedPlate = scan.experiment.accession?.graviPlateAccessions.find(
        (p) => p.plate_id === scan.plate_barcode
      );

      const metadata: GraviImageMetadata & Record<string, unknown> = {
        species: scan.experiment.species,
        experiment: scan.experiment.name,
        scanner_name: scan.scanner.name,
        phenotyper_name: scan.phenotyper.name,
        phenotyper_email: scan.phenotyper.email,
        scientist_name: scan.experiment.scientist?.name || scan.phenotyper.name,
        scientist_email:
          scan.experiment.scientist?.email || scan.phenotyper.email,
        // NOTE: @salk-hpi/bloom-js's installed GraviImageMetadata type (and
        // its insertGraviImageMetadata RPC wrapper) names this field
        // `plant_barcode`, not `plate_barcode` — verified against
        // node_modules/@salk-hpi/bloom-js/dist/core/supabase/data-store.js,
        // which maps `metadata.plant_barcode` to the `plant_barcode_` RPC
        // param. GraviScan's own Prisma schema calls it `plate_barcode`;
        // this is purely an external API naming difference.
        plant_barcode: scan.plate_barcode,
        capture_date: scan.capture_date.toISOString(),
        grid_mode: scan.grid_mode,
        plate_index: scan.plate_index,
        resolution: scan.resolution,
        format: scan.format,
        accession_name:
          matchedPlate?.accession ||
          scan.experiment.accession?.graviPlateAccessions[0]?.accession,
        // The fields below (cycle_number..custom_note) are not yet forwarded
        // by the installed package's insertGraviImageMetadata RPC call (it
        // only relays a fixed field list — see data-store.js). They're kept
        // here for forward-compatibility: harmless extra properties today,
        // automatically wired up once bloom-js's RPC wrapper catches up.
        cycle_number: scan.cycle_number ?? undefined,
        wave_number: scan.wave_number ?? 0,
        session_id: scan.session_id
          ? sessionIdMap.get(scan.session_id)
          : undefined,
        system_name: process.env.GRAVISCAN_SYSTEM_NAME ?? undefined,
        metadata_id: matchedPlate
          ? metadataIdMap.get(matchedPlate.id)
          : undefined,
        transplant_date: matchedPlate?.transplant_date
          ? matchedPlate.transplant_date.toISOString()
          : undefined,
        custom_note: matchedPlate?.custom_note ?? undefined,
      };

      const { created: scanId, error: rpcError } =
        await store.insertGraviImageMetadata(metadata);

      if (rpcError) {
        errors.push(`RPC error for ${image.path}: ${rpcError.message}`);
        await db.graviImage.update({
          where: { id: image.id },
          data: { status: 'failed' },
        });
        failed++;
        return;
      }

      if (scanId === null) {
        await db.graviImage.update({
          where: { id: image.id },
          data: { status: 'uploaded' },
        });
        skipped++;
        return;
      }

      const ext = path.extname(image.path);
      const originalName = path.basename(image.path, ext);
      const shortId = crypto.randomUUID().slice(0, 8);
      const storagePath = `gravi-images/${originalName}_${shortId}${ext}`;
      const uploadResult = await uploadRawFile(
        uploader,
        image.path,
        storagePath,
        'graviscan-images'
      );

      if (uploadResult.error) {
        errors.push(
          `Upload error for ${image.path}: ${uploadResult.error.message}`
        );
        await db.graviImage.update({
          where: { id: image.id },
          data: { status: 'failed' },
        });
        failed++;
        return;
      }

      // Native SupabaseStore.updateGraviImageMetadata only accepts
      // `object_path` — the installed package's `gravi_images` table has no
      // file_hash/file_size_bytes columns (verified against
      // database.types.d.ts), so those reference-file fields are dropped.
      const { error: imageError } = await store.updateGraviImageMetadata(
        scanId,
        { object_path: storagePath }
      );

      if (imageError) {
        errors.push(
          `Image record error for ${image.path}: ${imageError.message}`
        );
        await db.graviImage.update({
          where: { id: image.id },
          data: { status: 'failed' },
        });
        failed++;
        return;
      }

      await db.graviImage.update({
        where: { id: image.id },
        data: { status: 'uploaded' },
      });
      uploaded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      errors.push(`Error processing ${image.path}: ${msg}`);
      await db.graviImage.update({
        where: { id: image.id },
        data: { status: 'failed' },
      });
      failed++;
    }
  };

  // Worker-pool pattern: N workers share a single index cursor and pull
  // from `imageJobs` until the queue is exhausted. Counter mutations are
  // safe because JS is single-threaded between awaits.
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const idx = cursor++;
      if (idx >= imageJobs.length) return;
      const job = imageJobs[idx];
      await processOne(job);
      onProgress?.({
        total,
        completed: uploaded + skipped + failed,
        failed,
        currentFile: path.basename(job.image.path),
      });
    }
  };

  const workerCount = Math.min(UPLOAD_CONCURRENCY, imageJobs.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  onProgress?.({
    total,
    completed: uploaded + skipped + failed,
    failed,
    currentFile: '',
  });

  return { success: failed === 0, uploaded, skipped, failed, errors };
}

/**
 * Upload sessions to Supabase and return a map of local session IDs to
 * Supabase session IDs.
 *
 * `SupabaseStore.insertGraviScanSession` does not exist in the installed
 * @salk-hpi/bloom-js@0.2.1 (no method, no backing RPC/table wrapper) —
 * verified via `grep -r insertGraviScanSession node_modules/@salk-hpi/bloom-js`
 * returning nothing. Feature-detect and skip gracefully rather than fail the
 * whole Bloom upload on a feature the installed package doesn't support yet;
 * this activates automatically once bloom-js adds it.
 */
async function uploadSessions(
  store: SupabaseStore,
  scans: Array<{
    session_id: string | null;
    session: {
      scan_mode: string;
      interval_seconds: number | null;
      duration_seconds: number | null;
      total_cycles: number | null;
      started_at: Date;
      completed_at: Date | null;
      cancelled: boolean;
    } | null;
    experiment: {
      name: string;
      species: string;
      scientist: { name: string; email: string } | null;
      accession: {
        name: string;
        graviPlateAccessions: Array<{ accession: string }>;
      } | null;
    };
    phenotyper: { name: string; email: string };
  }>
): Promise<{ sessionIdMap: Map<string, number>; errors: string[] }> {
  const sessionIdMap = new Map<string, number>();
  const errors: string[] = [];

  const extendedStore = store as GraviScanStoreExtensions;
  if (typeof extendedStore.insertGraviScanSession !== 'function') {
    console.log(
      '[GraviScan:UPLOAD] SupabaseStore.insertGraviScanSession not available in installed @salk-hpi/bloom-js — skipping session upload'
    );
    return { sessionIdMap, errors };
  }

  const seenSessionIds = new Set<string>();

  for (const scan of scans) {
    if (
      !scan.session_id ||
      !scan.session ||
      seenSessionIds.has(scan.session_id)
    )
      continue;
    seenSessionIds.add(scan.session_id);

    try {
      const params: GraviScanSessionParams = {
        species: scan.experiment.species,
        experiment: scan.experiment.name,
        phenotyper_name: scan.phenotyper.name,
        phenotyper_email: scan.phenotyper.email,
        scientist_name: scan.experiment.scientist?.name || scan.phenotyper.name,
        scientist_email:
          scan.experiment.scientist?.email || scan.phenotyper.email,
        accession_name:
          scan.experiment.accession?.graviPlateAccessions?.[0]?.accession,
        scan_mode: scan.session.scan_mode,
        interval_seconds: scan.session.interval_seconds ?? undefined,
        duration_seconds: scan.session.duration_seconds ?? undefined,
        total_cycles: scan.session.total_cycles ?? undefined,
        actual_duration_seconds:
          scan.session.started_at && scan.session.completed_at
            ? Math.round(
                (new Date(scan.session.completed_at).getTime() -
                  new Date(scan.session.started_at).getTime()) /
                  1000
              )
            : undefined,
        completed_at: scan.session.completed_at
          ? new Date(scan.session.completed_at).toISOString()
          : undefined,
        cancelled: scan.session.cancelled,
        system_name: process.env.GRAVISCAN_SYSTEM_NAME ?? undefined,
      };

      const { created: supabaseSessionId, error } =
        await extendedStore.insertGraviScanSession(params);
      if (error) {
        errors.push(
          `Session upload error for ${scan.session_id}: ${error.message}`
        );
      } else if (supabaseSessionId !== null) {
        sessionIdMap.set(scan.session_id, supabaseSessionId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      errors.push(`Session upload error for ${scan.session_id}: ${msg}`);
    }
  }

  return { sessionIdMap, errors };
}

/**
 * Upload plate metadata (GraviPlateAccession + sections) to Supabase.
 * Returns a map of local GraviPlateAccession IDs to Supabase metadata IDs.
 *
 * `SupabaseStore.insertGraviScanMetadata` does not exist in the installed
 * @salk-hpi/bloom-js@0.2.1 either — same feature-detection rationale as
 * uploadSessions() above.
 */
async function uploadMetadata(
  store: SupabaseStore,
  scans: Array<{
    wave_number: number;
    experiment: {
      accession: {
        graviPlateAccessions: Array<{
          id: string;
          plate_id: string;
          accession: string;
          transplant_date: Date | null;
          custom_note: string | null;
          sections: Array<{
            plate_section_id: string;
            plant_qr: string;
            medium: string | null;
          }>;
        }>;
      } | null;
    };
  }>
): Promise<{ metadataIdMap: Map<string, number>; errors: string[] }> {
  const metadataIdMap = new Map<string, number>();
  const errors: string[] = [];

  const extendedStore = store as GraviScanStoreExtensions;
  if (typeof extendedStore.insertGraviScanMetadata !== 'function') {
    console.log(
      '[GraviScan:UPLOAD] SupabaseStore.insertGraviScanMetadata not available in installed @salk-hpi/bloom-js — skipping metadata upload'
    );
    return { metadataIdMap, errors };
  }

  const seenPlateIds = new Set<string>();

  for (const scan of scans) {
    if (!scan.experiment.accession) {
      continue;
    }

    for (const plate of scan.experiment.accession.graviPlateAccessions) {
      if (seenPlateIds.has(plate.id)) continue;
      seenPlateIds.add(plate.id);

      try {
        const params: GraviScanMetadataParams = {
          accession_name: plate.accession,
          plate_id: plate.plate_id,
          wave_number: scan.wave_number,
          transplant_date: plate.transplant_date
            ? plate.transplant_date.toISOString()
            : null,
          custom_note: plate.custom_note,
          sections: plate.sections.map((s) => ({
            plate_section_id: s.plate_section_id,
            plant_qr: s.plant_qr,
            medium: s.medium,
          })),
        };

        const { created: supabaseMetadataId, error } =
          await extendedStore.insertGraviScanMetadata(params);
        if (error) {
          errors.push(
            `Metadata upload error for plate ${plate.plate_id}: ${error.message}`
          );
        } else if (supabaseMetadataId !== null) {
          metadataIdMap.set(plate.id, supabaseMetadataId);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        errors.push(
          `Metadata upload error for plate ${plate.plate_id}: ${msg}`
        );
      }
    }
  }

  return { metadataIdMap, errors };
}

/**
 * Upload all pending/failed scans across ALL experiments to Supabase.
 *
 * Ordering is deliberate: validate credentials locally (no network) before
 * touching the DB, then check for pending work (cheap Prisma read) before
 * paying for a real Supabase auth round-trip. This means a scanner with no
 * pending uploads never calls Supabase at all, and a scanner with missing
 * credentials never queries the DB at all.
 */
export async function uploadAllPendingScans(
  db: PrismaClient,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadResult> {
  const envPath = path.join(os.homedir(), '.bloom', '.env');
  const config = loadEnvConfig(envPath);

  const configError = validateBloomConfig(config);
  if (configError) {
    return {
      success: false,
      uploaded: 0,
      skipped: 0,
      failed: 0,
      errors: [configError],
    };
  }

  const scans = await db.graviScan.findMany({
    where: {
      deleted: false,
      images: {
        some: { status: { in: ['pending', 'failed'] } },
      },
    },
    include: {
      images: { where: { status: { in: ['pending', 'failed'] } } },
      scanner: true,
      phenotyper: true,
      session: true,
      experiment: {
        include: {
          scientist: true,
          accession: {
            include: {
              graviPlateAccessions: {
                include: { sections: true },
              },
            },
          },
        },
      },
    },
  });

  if (scans.length === 0) {
    return { success: true, uploaded: 0, skipped: 0, failed: 0, errors: [] };
  }

  const clients = await authenticateBloomClients(config);
  if ('error' in clients) {
    return {
      success: false,
      uploaded: 0,
      skipped: 0,
      failed: 0,
      errors: [clients.error],
    };
  }

  // Upload sessions first, then map local session IDs to Supabase session IDs
  const { sessionIdMap, errors: sessionErrors } = await uploadSessions(
    clients.store,
    scans
  );

  // Upload plate metadata, then map local GraviPlateAccession IDs to Supabase metadata IDs
  const { metadataIdMap, errors: metadataErrors } = await uploadMetadata(
    clients.store,
    scans
  );

  const imageJobs = scans.flatMap((scan) =>
    scan.images.map((img) => ({ scan, image: img }))
  );

  const result = await processImageJobs(
    db,
    clients.store,
    clients.uploader,
    imageJobs,
    sessionIdMap,
    metadataIdMap,
    onProgress
  );
  result.errors = [...sessionErrors, ...metadataErrors, ...result.errors];
  if (sessionErrors.length > 0 || metadataErrors.length > 0)
    result.success = false;

  return result;
}
