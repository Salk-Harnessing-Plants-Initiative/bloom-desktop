/**
 * GraviScan Upload Orchestration
 *
 * Uploads local GraviScan images to Supabase cloud:
 * 1. Calls insert_gravi_image RPC to create scan metadata
 * 2. Uploads JPEG to graviscan-images storage bucket
 * 3. Creates gravi_images row with the storage path
 * 4. Updates local SQLite status to "uploaded"
 */

import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { SupabaseStore, SupabaseUploader } from '@salk-hpi/bloom-js';
import type { GraviImageMetadata } from '@salk-hpi/bloom-js';

// TODO: These types will be added to @salk-hpi/bloom-js in a future release
type GraviScanSessionParams = {
  species: string;
  experiment: string;
  phenotyper_name: string;
  phenotyper_email: string;
  scientist_name: string;
  scientist_email: string;
  accession_name?: string;
  scan_mode: string;
  interval_seconds?: number;
  duration_seconds?: number;
  total_cycles?: number;
  actual_duration_seconds?: number;
  completed_at?: string;
  cancelled: boolean;
};

type GraviScanMetadataParams = {
  accession_name: string;
  plate_id: string;
  transplant_date: string | null;
  custom_note: string | null;
  sections: Array<{ plate_section_id: string; plant_qr: string; medium: string | null }>;
};
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
 * Load Bloom credentials from ~/.bloom/.env
 */
function loadBloomCredentials(): {
  apiUrl: string;
  anonKey: string;
  username: string;
  password: string;
} | null {
  const envPath = path.join(os.homedir(), '.bloom', '.env');

  if (!fs.existsSync(envPath)) {
    return null;
  }

  const content = fs.readFileSync(envPath, 'utf-8');
  const vars: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    vars[trimmed.substring(0, eqIdx).trim()] = trimmed.substring(eqIdx + 1).trim();
  }

  const apiUrl = vars['BLOOM_API_URL'];
  const anonKey = vars['BLOOM_ANON_KEY'];
  const username = vars['BLOOM_SCANNER_USERNAME'];
  const password = vars['BLOOM_SCANNER_PASSWORD'];

  if (!apiUrl || !anonKey || !username || !password) {
    return null;
  }

  return { apiUrl, anonKey, username, password };
}

/**
 * Create authenticated Supabase store + uploader from ~/.bloom/.env credentials.
 * Returns null with error message if credentials are missing or auth fails.
 */
async function createAuthenticatedClients(): Promise<{
  store: SupabaseStore;
  uploader: SupabaseUploader;
} | { error: string }> {
  const creds = loadBloomCredentials();
  if (!creds) {
    return { error: 'Bloom credentials not found in ~/.bloom/.env' };
  }

  const supabase = createClient(creds.apiUrl, creds.anonKey);
  const { error: authError } = await supabase.auth.signInWithPassword({
    email: creds.username,
    password: creds.password,
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
 * Upload a list of scan+image jobs to Supabase.
 * Shared logic used by both per-experiment and global upload.
 */
async function processImageJobs(
  db: PrismaClient,
  store: SupabaseStore,
  uploader: SupabaseUploader,
  imageJobs: Array<{
    scan: {
      scanner: { name: string; slotAssignment: { slot_index: number } | null };
      phenotyper: { name: string; email: string };
      experiment: {
        name: string;
        species: string;
        scientist: { name: string; email: string } | null;
        accession: {
          name: string;
          graviPlateAccessions: Array<{ id: string; plate_id: string; accession: string; transplant_date?: Date | null; custom_note?: string | null }>;
        } | null;
      };
      plant_barcode: string | null;
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
  const errors: string[] = [];
  const total = imageJobs.length;
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const { scan, image } of imageJobs) {
    onProgress?.({
      total,
      completed: uploaded + skipped + failed,
      failed,
      currentFile: path.basename(image.path),
    });

    try {
      if (!fs.existsSync(image.path)) {
        errors.push(`File not found: ${image.path}`);
        await db.graviImage.update({ where: { id: image.id }, data: { status: 'failed' } });
        failed++;
        continue;
      }

      // Find the matching plate metadata for this scan's plate_index
      const matchedPlate = scan.experiment.accession?.graviPlateAccessions.find(
        (p) => p.plate_id === scan.plate_index
      );

      const metadata: GraviImageMetadata & Record<string, unknown> = {
        species: scan.experiment.species,
        experiment: scan.experiment.name,
        scanner_name: scan.scanner.name,
        phenotyper_name: scan.phenotyper.name,
        phenotyper_email: scan.phenotyper.email,
        scientist_name: scan.experiment.scientist?.name || scan.phenotyper.name,
        scientist_email: scan.experiment.scientist?.email || scan.phenotyper.email,
        plant_barcode: scan.plant_barcode,
        capture_date: scan.capture_date.toISOString(),
        grid_mode: scan.grid_mode,
        plate_index: scan.plate_index,
        resolution: scan.resolution,
        format: scan.format,
        accession_name: matchedPlate?.accession || scan.experiment.accession?.name,
        cycle_number: scan.cycle_number ?? undefined,
        wave_number: scan.wave_number ?? 0,
        session_id: scan.session_id ? sessionIdMap.get(scan.session_id) : undefined,
        scanner_number: scan.scanner.slotAssignment ? scan.scanner.slotAssignment.slot_index + 1 : undefined,
        metadata_id: matchedPlate ? metadataIdMap.get(matchedPlate.id) : undefined,
        transplant_date: matchedPlate?.transplant_date ? matchedPlate.transplant_date.toISOString() : undefined,
        custom_note: matchedPlate?.custom_note ?? undefined,
      };

      const { created: scanId, error: rpcError } =
        await store.insertGraviImageMetadata(metadata);

      if (rpcError) {
        errors.push(`RPC error for ${image.path}: ${rpcError.message}`);
        await db.graviImage.update({ where: { id: image.id }, data: { status: 'failed' } });
        failed++;
        continue;
      }

      if (scanId === null) {
        await db.graviImage.update({ where: { id: image.id }, data: { status: 'uploaded' } });
        skipped++;
        continue;
      }

      const originalName = path.basename(image.path, '.jpg');
      const shortId = crypto.randomUUID().slice(0, 8);
      const storagePath = `gravi-images/${originalName}_${shortId}.jpg`;
      const { error: uploadError } = await uploader.uploadJpegImage(
        image.path, storagePath, 'graviscan-images'
      );

      if (uploadError) {
        errors.push(`Upload error for ${image.path}: ${uploadError.message}`);
        await db.graviImage.update({ where: { id: image.id }, data: { status: 'failed' } });
        failed++;
        continue;
      }

      const { error: imageError } = await store.updateGraviImageMetadata(
        scanId, { object_path: storagePath }
      );

      if (imageError) {
        errors.push(`Image record error for ${image.path}: ${imageError.message}`);
        await db.graviImage.update({ where: { id: image.id }, data: { status: 'failed' } });
        failed++;
        continue;
      }

      await db.graviImage.update({ where: { id: image.id }, data: { status: 'uploaded' } });
      uploaded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      errors.push(`Error processing ${image.path}: ${msg}`);
      await db.graviImage.update({ where: { id: image.id }, data: { status: 'failed' } });
      failed++;
    }
  }

  onProgress?.({ total, completed: uploaded + skipped + failed, failed, currentFile: '' });

  return { success: failed === 0, uploaded, skipped, failed, errors };
}

/**
 * Upload sessions to Supabase and return a map of local session IDs to Supabase session IDs.
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
    experiment: { name: string; species: string; scientist: { name: string; email: string } | null; accession: { name: string } | null };
    phenotyper: { name: string; email: string };
  }>
): Promise<{ sessionIdMap: Map<string, number>; errors: string[] }> {
  const sessionIdMap = new Map<string, number>();
  const errors: string[] = [];
  const seenSessionIds = new Set<string>();

  for (const scan of scans) {
    if (!scan.session_id || !scan.session || seenSessionIds.has(scan.session_id)) continue;
    seenSessionIds.add(scan.session_id);

    const params: GraviScanSessionParams = {
      species: scan.experiment.species,
      experiment: scan.experiment.name,
      phenotyper_name: scan.phenotyper.name,
      phenotyper_email: scan.phenotyper.email,
      scientist_name: scan.experiment.scientist?.name || scan.phenotyper.name,
      scientist_email: scan.experiment.scientist?.email || scan.phenotyper.email,
      accession_name: scan.experiment.accession?.name,
      scan_mode: scan.session.scan_mode,
      interval_seconds: scan.session.interval_seconds ?? undefined,
      duration_seconds: scan.session.duration_seconds ?? undefined,
      total_cycles: scan.session.total_cycles ?? undefined,
      actual_duration_seconds: scan.session.started_at && scan.session.completed_at
        ? Math.round((new Date(scan.session.completed_at).getTime() - new Date(scan.session.started_at).getTime()) / 1000)
        : undefined,
      completed_at: scan.session.completed_at
        ? new Date(scan.session.completed_at).toISOString()
        : undefined,
      cancelled: scan.session.cancelled,
    };

    const { created: supabaseSessionId, error } = await (store as any).insertGraviScanSession(params);
    if (error) {
      errors.push(`Session upload error for ${scan.session_id}: ${error.message}`);
    } else if (supabaseSessionId !== null) {
      sessionIdMap.set(scan.session_id, supabaseSessionId);
    }
  }

  return { sessionIdMap, errors };
}

/**
 * Upload plate metadata (GraviPlateAccession + sections) to Supabase.
 * Returns a map of local GraviPlateAccession IDs to Supabase metadata IDs.
 */
async function uploadMetadata(
  store: SupabaseStore,
  scans: Array<{
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
  const seenPlateIds = new Set<string>();

  for (const scan of scans) {
    if (!scan.experiment.accession) {
      console.log('[UploadMetadata] No accession on experiment, skipping');
      continue;
    }

    console.log('[UploadMetadata] Accession found, plates:', scan.experiment.accession.graviPlateAccessions?.length ?? 0);

    for (const plate of scan.experiment.accession.graviPlateAccessions) {
      if (seenPlateIds.has(plate.id)) continue;
      seenPlateIds.add(plate.id);

      console.log('[UploadMetadata] Uploading plate:', plate.plate_id, 'accession:', plate.accession, 'sections:', plate.sections.length);

      const params: GraviScanMetadataParams = {
        accession_name: plate.accession,
        plate_id: plate.plate_id,
        transplant_date: plate.transplant_date ? plate.transplant_date.toISOString() : null,
        custom_note: plate.custom_note,
        sections: plate.sections.map((s) => ({
          plate_section_id: s.plate_section_id,
          plant_qr: s.plant_qr,
          medium: s.medium,
        })),
      };

      const { created: supabaseMetadataId, error } = await (store as any).insertGraviScanMetadata(params);
      console.log('[UploadMetadata] RPC result for plate', plate.plate_id, '→ metadataId:', supabaseMetadataId, 'error:', error?.message ?? 'none');
      if (error) {
        errors.push(`Metadata upload error for plate ${plate.plate_id}: ${error.message}`);
      } else if (supabaseMetadataId !== null) {
        metadataIdMap.set(plate.id, supabaseMetadataId);
      }
    }
  }

  return { metadataIdMap, errors };
}

/**
 * Upload all pending/failed scans across ALL experiments to Supabase.
 */
export async function uploadAllPendingScans(
  db: PrismaClient,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadResult> {
  const clients = await createAuthenticatedClients();
  if ('error' in clients) {
    return { success: false, uploaded: 0, skipped: 0, failed: 0, errors: [clients.error] };
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
      scanner: { include: { slotAssignment: true } },
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

  // Upload sessions first, then map local session IDs to Supabase session IDs
  const { sessionIdMap, errors: sessionErrors } = await uploadSessions(clients.store, scans);

  // Upload plate metadata, then map local GraviPlateAccession IDs to Supabase metadata IDs
  const { metadataIdMap, errors: metadataErrors } = await uploadMetadata(clients.store, scans);

  const imageJobs = scans.flatMap((scan) =>
    scan.images.map((img) => ({ scan, image: img }))
  );

  const result = await processImageJobs(db, clients.store, clients.uploader, imageJobs, sessionIdMap, metadataIdMap, onProgress);
  result.errors = [...sessionErrors, ...metadataErrors, ...result.errors];
  if (sessionErrors.length > 0 || metadataErrors.length > 0) result.success = false;

  return result;
}
