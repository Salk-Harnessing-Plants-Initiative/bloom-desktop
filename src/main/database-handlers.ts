/**
 * Database IPC Handlers
 *
 * Provides IPC handlers for database operations, exposing CRUD operations
 * for all models to the renderer process.
 */

import { ipcMain } from 'electron';
import { getDatabase } from './database';
import type { Prisma, PrismaClient } from '@prisma/client';
import { ImageUploader, UploadResult } from './image-uploader';

/**
 * Standard response format for database operations
 */
interface DatabaseResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Log database operation for testing/debugging (dev mode only)
 * Format: [DB:OPERATION] Model: details
 */
function logDatabaseOperation(
  operation: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE',
  model: string,
  details: string
) {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[DB:${operation}] ${model}: ${details}`);
  }
}

// =============================================================================
// GraviScan data layer (add-graviscan-data-layer-and-events)
//
// Exported as standalone, db-injected functions (rather than inline inside
// registerDatabaseHandlers()'s closure like the handlers above) so they can
// be unit-tested directly against a real Prisma client — see
// tests/unit/graviscan/database-handlers.test.ts, which follows the
// real-SQLite-database convention established by
// tests/integration/database.test.ts (no mocked Prisma client).
// =============================================================================

/** Minimal PrismaClient surface these functions need — kept as the full
 * `PrismaClient` type (not a narrower interface) since these functions
 * use `$transaction`, which a narrower structural type would need to
 * duplicate the signature of. */
type Db = PrismaClient;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Natural-sort comparator: "P2" sorts before "P10". Ported fresh (not
 * copied from the reference implementation) per tasks.md 5.5 — verified
 * by test, not assumed correct.
 */
function naturalCompare(a: string, b: string): number {
  const chunk = /(\d+)|(\D+)/g;
  const aParts = a.match(chunk) ?? [a];
  const bParts = b.match(chunk) ?? [b];
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const ap = aParts[i] ?? '';
    const bp = bParts[i] ?? '';
    if (ap === bp) continue;
    const an = Number(ap);
    const bn = Number(bp);
    if (!Number.isNaN(an) && !Number.isNaN(bn) && ap !== '' && bp !== '') {
      return an - bn;
    }
    return ap < bp ? -1 : 1;
  }
  return 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

// -----------------------------------------------------------------------
// database.graviscans.*
// -----------------------------------------------------------------------

export interface GraviScanCreateInput {
  experiment_id: string;
  phenotyper_id: string;
  scanner_id: string;
  session_id?: string | null;
  cycle_number?: number | null;
  wave_number?: number;
  plate_barcode?: string | null;
  transplant_date?: string | Date | null;
  custom_note?: string | null;
  path: string;
  capture_date?: string | Date;
  scan_started_at?: string | Date | null;
  scan_ended_at?: string | Date | null;
  grid_mode: string;
  plate_index: string;
  resolution: number;
  format?: string;
}

/**
 * Create a GraviScan row.
 *
 * NOTE for future callers (Tier 4/5, tasks.md 2.3a): a caller writing
 * `GraviScan.resolution` from a COMPLETED scan MUST source it from that
 * scan's `achieved_resolution` (the field the "GraviScan Scan-Worker
 * Achieved-Resolution Readback" requirement threads through the
 * `scan-complete` event payload), not the pre-scan requested value this
 * `create` call persists — otherwise the #232 fix (see design.md) never
 * reaches the queryable database record. This handler itself is a
 * pre-scan create, not a post-scan write path, so its own signature is
 * unaffected; this is a forward-looking note for the caller that adds
 * the completion-time write.
 */
export async function graviscansCreate(
  db: Db,
  data: Partial<GraviScanCreateInput> & Record<string, unknown>
): Promise<DatabaseResponse> {
  try {
    for (const field of [
      'experiment_id',
      'phenotyper_id',
      'scanner_id',
    ] as const) {
      if (!isNonEmptyString(data[field])) {
        return { success: false, error: `${field} must be a non-empty string` };
      }
    }
    const created = await db.graviScan.create({
      data: {
        experiment_id: data.experiment_id as string,
        phenotyper_id: data.phenotyper_id as string,
        scanner_id: data.scanner_id as string,
        session_id: (data.session_id as string | null) ?? null,
        cycle_number: (data.cycle_number as number | null) ?? null,
        wave_number:
          typeof data.wave_number === 'number' ? data.wave_number : 0,
        plate_barcode: (data.plate_barcode as string | null) ?? null,
        transplant_date: data.transplant_date
          ? new Date(data.transplant_date as string | Date)
          : null,
        custom_note: (data.custom_note as string | null) ?? null,
        path: data.path as string,
        capture_date: data.capture_date
          ? new Date(data.capture_date as string | Date)
          : undefined,
        scan_started_at: data.scan_started_at
          ? new Date(data.scan_started_at as string | Date)
          : null,
        scan_ended_at: data.scan_ended_at
          ? new Date(data.scan_ended_at as string | Date)
          : null,
        grid_mode: data.grid_mode as string,
        plate_index: data.plate_index as string,
        resolution: data.resolution as number,
        format: typeof data.format === 'string' ? data.format : 'tiff',
      },
    });
    logDatabaseOperation('CREATE', 'GraviScan', `id=${created.id}`);
    return { success: true, data: created };
  } catch (error) {
    console.error('[DB] Failed to create GraviScan:', error);
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Max `wave_number` across an experiment's non-deleted GraviScan rows.
 * Returns -1 when the experiment has zero such rows.
 */
export async function graviscansGetMaxWaveNumber(
  db: Db,
  experimentId: string
): Promise<DatabaseResponse<number>> {
  try {
    if (!isNonEmptyString(experimentId)) {
      return {
        success: false,
        error: 'experimentId must be a non-empty string',
      };
    }
    const result = await db.graviScan.aggregate({
      where: { experiment_id: experimentId, deleted: false },
      _max: { wave_number: true },
    });
    return { success: true, data: result._max.wave_number ?? -1 };
  } catch (error) {
    console.error('[DB] Failed to get max wave number:', error);
    return { success: false, error: errorMessage(error) };
  }
}

export interface CheckBarcodeUniqueInWaveInput {
  experiment_id: string;
  wave_number: number;
  plate_barcode: string;
}

/**
 * Case-insensitive (`.trim().toLowerCase()`, applied in application code —
 * `mode: 'insensitive'` is Postgres-only, unavailable on this SQLite
 * datasource) barcode-uniqueness check, scoped to (experiment_id,
 * wave_number). See design.md Decision 4.
 */
export async function graviscansCheckBarcodeUniqueInWave(
  db: Db,
  args: CheckBarcodeUniqueInWaveInput
): Promise<DatabaseResponse<{ isDuplicate: boolean }>> {
  try {
    if (!isNonEmptyString(args?.experiment_id)) {
      return {
        success: false,
        error: 'experiment_id must be a non-empty string',
      };
    }
    const normalized = (args.plate_barcode ?? '').trim().toLowerCase();
    const rows = await db.graviScan.findMany({
      where: {
        experiment_id: args.experiment_id,
        wave_number: args.wave_number,
        deleted: false,
        plate_barcode: { not: null },
      },
      select: { plate_barcode: true },
    });
    const isDuplicate = rows.some(
      (r) => (r.plate_barcode ?? '').trim().toLowerCase() === normalized
    );
    return { success: true, data: { isDuplicate } };
  } catch (error) {
    console.error('[DB] Failed to check barcode uniqueness:', error);
    return { success: false, error: errorMessage(error) };
  }
}

export interface UpdateGridTimestampsInput {
  experiment_id: string;
  ids: string[];
  scan_started_at?: string | Date;
  scan_ended_at?: string | Date;
}

/**
 * Update scan_started_at/scan_ended_at for `ids`, scoped to
 * `experiment_id` (design.md Decision 3 — the reference implementation's
 * `updateMany({ where: { id: { in: ids } } })` has no experiment scope at
 * all, so any caller-supplied id list can write across experiments; this
 * is the required fix, and a **breaking** signature change relative to
 * the reference method it ports from).
 */
export async function graviscansUpdateGridTimestamps(
  db: Db,
  args: UpdateGridTimestampsInput
): Promise<DatabaseResponse<{ updatedCount: number }>> {
  try {
    if (!isNonEmptyString(args?.experiment_id)) {
      return {
        success: false,
        error: 'experiment_id must be a non-empty string',
      };
    }
    if (!Array.isArray(args.ids)) {
      return { success: false, error: 'ids must be an array' };
    }
    const data: Prisma.GraviScanUpdateManyMutationInput = {};
    if (args.scan_started_at !== undefined) {
      data.scan_started_at = new Date(args.scan_started_at);
    }
    if (args.scan_ended_at !== undefined) {
      data.scan_ended_at = new Date(args.scan_ended_at);
    }
    const result = await db.graviScan.updateMany({
      where: { id: { in: args.ids }, experiment_id: args.experiment_id },
      data,
    });
    return { success: true, data: { updatedCount: result.count } };
  } catch (error) {
    console.error('[DB] Failed to update grid timestamps:', error);
    return { success: false, error: errorMessage(error) };
  }
}

export interface BrowseByExperimentFilters {
  dateFrom?: string;
  dateTo?: string;
  experimentName?: string;
  accession?: string;
  uploadStatus?: string;
}

export interface BrowseByExperimentArgs {
  offset: number;
  limit: number;
  filters?: BrowseByExperimentFilters;
}

/**
 * Cross-experiment browse/listing view (deliberately NOT scoped to a
 * single experiment — see the "GraviScan Database Handlers —
 * graviscans.*" spec requirement's explicit carve-out for this handler).
 */
export async function graviscansBrowseByExperiment(
  db: Db,
  args: BrowseByExperimentArgs
): Promise<
  DatabaseResponse<{
    experiments: Array<
      Prisma.ExperimentGetPayload<{
        include: {
          accession: true;
          graviScans: { include: { images: true } };
          graviPlateAssignments: true;
        };
      }> & { hasNeedsReview: boolean }
    >;
    total: number;
  }>
> {
  try {
    const filters = args.filters ?? {};
    const where: Prisma.ExperimentWhereInput = {};
    if (filters.experimentName) {
      where.name = { contains: filters.experimentName };
    }
    if (filters.accession) {
      where.accession = { name: { contains: filters.accession } };
    }

    let dateFilter: Prisma.DateTimeFilter | undefined;
    if (filters.dateFrom || filters.dateTo) {
      dateFilter = {};
      // Anchor both bounds in LOCAL time (matching db:scans:list's existing
      // dateFrom/dateTo convention in this same file) — parsing dateFrom as
      // UTC-midnight (`new Date(dateStr)`) while mutating dateTo's hours in
      // local time would silently shift the window by the local UTC offset.
      if (filters.dateFrom) {
        dateFilter.gte = new Date(filters.dateFrom + 'T00:00:00');
      }
      if (filters.dateTo) {
        dateFilter.lte = new Date(filters.dateTo + 'T23:59:59.999');
      }
      where.graviScans = {
        some: { deleted: false, capture_date: dateFilter },
      };
    }

    const scansWhere: Prisma.GraviScanWhereInput = { deleted: false };
    if (dateFilter) scansWhere.capture_date = dateFilter;

    const [total, experiments] = await Promise.all([
      db.experiment.count({ where }),
      db.experiment.findMany({
        where,
        skip: args.offset,
        take: args.limit,
        orderBy: { name: 'asc' },
        include: {
          accession: true,
          graviScans: { where: scansWhere, include: { images: true } },
          graviPlateAssignments: true,
        },
      }),
    ]);

    let result = experiments.map((exp) => ({
      ...exp,
      hasNeedsReview: exp.graviPlateAssignments.some(
        (a) => a.verification_status === 'needs_review'
      ),
    }));

    if (filters.uploadStatus) {
      const status = filters.uploadStatus;
      result = result.filter((exp) => {
        const statuses = exp.graviScans.flatMap((s) =>
          s.images.map((img) => img.status)
        );
        switch (status) {
          case 'pending':
            return (
              statuses.length === 0 || statuses.every((s) => s === 'pending')
            );
          case 'uploaded':
            return (
              statuses.length > 0 && statuses.every((s) => s === 'uploaded')
            );
          case 'failed':
            return statuses.some((s) => s === 'failed');
          default:
            return true;
        }
      });
    }

    return { success: true, data: { experiments: result, total } };
  } catch (error) {
    console.error('[DB] Failed to browse GraviScan experiments:', error);
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Single-experiment detail view: non-deleted scans ordered by
 * (cycle_number, scanner_id, plate_index), plus a verificationStatusMap
 * keyed "scannerId:plateIndex". Never leaks another experiment's rows,
 * even when it shares a scanner (the exact bug class the verify-plates
 * port already found and fixed once).
 */
export async function graviscansExperimentDetail(
  db: Db,
  experimentId: string
): Promise<
  DatabaseResponse<{
    scans: Prisma.GraviScanGetPayload<object>[];
    verificationStatusMap: Record<string, string>;
  }>
> {
  try {
    if (!isNonEmptyString(experimentId)) {
      return {
        success: false,
        error: 'experimentId must be a non-empty string',
      };
    }
    const experiment = await db.experiment.findUnique({
      where: { id: experimentId },
    });
    if (!experiment) {
      return { success: false, error: `Experiment not found: ${experimentId}` };
    }
    const scans = await db.graviScan.findMany({
      where: { experiment_id: experimentId, deleted: false },
      orderBy: [
        { cycle_number: 'asc' },
        { scanner_id: 'asc' },
        { plate_index: 'asc' },
      ],
    });
    const assignments = await db.graviScanPlateAssignment.findMany({
      where: { experiment_id: experimentId },
    });
    const verificationStatusMap: Record<string, string> = {};
    for (const a of assignments) {
      verificationStatusMap[`${a.scanner_id}:${a.plate_index}`] =
        a.verification_status;
    }
    return { success: true, data: { scans, verificationStatusMap } };
  } catch (error) {
    console.error('[DB] Failed to get experiment detail:', error);
    return { success: false, error: errorMessage(error) };
  }
}

// -----------------------------------------------------------------------
// database.graviscanSessions.*
// -----------------------------------------------------------------------

export interface GraviScanSessionCreateInput {
  experiment_id: string;
  phenotyper_id: string;
  scan_mode: string;
  interval_seconds?: number | null;
  duration_seconds?: number | null;
  total_cycles?: number | null;
}

export async function graviscanSessionsCreate(
  db: Db,
  data: GraviScanSessionCreateInput
): Promise<DatabaseResponse> {
  try {
    if (!isNonEmptyString(data?.experiment_id)) {
      return {
        success: false,
        error: 'experiment_id must be a non-empty string',
      };
    }
    if (!isNonEmptyString(data?.phenotyper_id)) {
      return {
        success: false,
        error: 'phenotyper_id must be a non-empty string',
      };
    }
    const created = await db.graviScanSession.create({
      data: {
        experiment_id: data.experiment_id,
        phenotyper_id: data.phenotyper_id,
        scan_mode: data.scan_mode,
        interval_seconds: data.interval_seconds ?? null,
        duration_seconds: data.duration_seconds ?? null,
        total_cycles: data.total_cycles ?? null,
      },
    });
    logDatabaseOperation('CREATE', 'GraviScanSession', `id=${created.id}`);
    return { success: true, data: created };
  } catch (error) {
    console.error('[DB] Failed to create GraviScanSession:', error);
    return { success: false, error: errorMessage(error) };
  }
}

export interface GraviScanSessionCompleteInput {
  session_id: string;
  cancelled?: boolean;
}

export async function graviscanSessionsComplete(
  db: Db,
  args: GraviScanSessionCompleteInput
): Promise<DatabaseResponse> {
  try {
    if (!isNonEmptyString(args?.session_id)) {
      return { success: false, error: 'session_id must be a non-empty string' };
    }
    const updated = await db.graviScanSession.update({
      where: { id: args.session_id },
      data: { completed_at: new Date(), cancelled: args.cancelled ?? false },
    });
    return { success: true, data: updated };
  } catch (error) {
    // Prisma throws (P2025) when the row doesn't exist — caught here so
    // the IPC boundary never sees an unhandled rejection.
    console.error('[DB] Failed to complete GraviScanSession:', error);
    return { success: false, error: errorMessage(error) };
  }
}

// -----------------------------------------------------------------------
// database.graviscanPlateAssignments.*
// -----------------------------------------------------------------------

export async function graviscanPlateAssignmentsList(
  db: Db,
  experimentId: string,
  scannerId: string
): Promise<DatabaseResponse> {
  try {
    if (!isNonEmptyString(experimentId) || !isNonEmptyString(scannerId)) {
      return {
        success: false,
        error: 'experimentId and scannerId must be non-empty strings',
      };
    }
    const rows = await db.graviScanPlateAssignment.findMany({
      where: { experiment_id: experimentId, scanner_id: scannerId },
      orderBy: { plate_index: 'asc' },
    });
    return { success: true, data: rows };
  } catch (error) {
    console.error('[DB] Failed to list plate assignments:', error);
    return { success: false, error: errorMessage(error) };
  }
}

export interface PlateAssignmentUpsertInput {
  plate_index: string;
  plate_barcode?: string | null;
  transplant_date?: string | Date | null;
  custom_note?: string | null;
  selected?: boolean;
  verification_status?: string;
  previous_plate_barcode?: string | null;
}

export async function graviscanPlateAssignmentsUpsertMany(
  db: Db,
  experimentId: string,
  scannerId: string,
  assignments: PlateAssignmentUpsertInput[]
): Promise<DatabaseResponse> {
  try {
    if (!isNonEmptyString(experimentId) || !isNonEmptyString(scannerId)) {
      return {
        success: false,
        error: 'experimentId and scannerId must be non-empty strings',
      };
    }
    const rows = await db.$transaction(async (tx) => {
      const written = [];
      for (const a of assignments) {
        const row = await tx.graviScanPlateAssignment.upsert({
          where: {
            experiment_id_scanner_id_plate_index: {
              experiment_id: experimentId,
              scanner_id: scannerId,
              plate_index: a.plate_index,
            },
          },
          create: {
            experiment_id: experimentId,
            scanner_id: scannerId,
            plate_index: a.plate_index,
            plate_barcode: a.plate_barcode ?? null,
            transplant_date: a.transplant_date
              ? new Date(a.transplant_date)
              : null,
            custom_note: a.custom_note ?? null,
            selected: a.selected ?? true,
            verification_status: a.verification_status ?? 'pending',
            previous_plate_barcode: a.previous_plate_barcode ?? null,
          },
          update: {
            plate_barcode: a.plate_barcode ?? null,
            transplant_date: a.transplant_date
              ? new Date(a.transplant_date)
              : null,
            custom_note: a.custom_note ?? null,
            selected: a.selected ?? true,
            verification_status: a.verification_status ?? 'pending',
            previous_plate_barcode: a.previous_plate_barcode ?? null,
          },
        });
        written.push(row);
      }
      return written;
    });
    return { success: true, data: rows };
  } catch (error) {
    console.error('[DB] Failed to upsert plate assignments:', error);
    return { success: false, error: errorMessage(error) };
  }
}

// -----------------------------------------------------------------------
// database.graviPlateAccessions.*
// -----------------------------------------------------------------------

export interface GraviPlateSectionInput {
  plate_section_id: string;
  plant_qr: string;
  medium?: string | null;
}

export interface GraviPlateInput {
  plate_id: string;
  accession: string;
  transplant_date?: string | Date | null;
  custom_note?: string | null;
  sections: GraviPlateSectionInput[];
}

export async function graviPlateAccessionsCreateWithSections(
  db: Db,
  accessionData: { name: string },
  plates: GraviPlateInput[]
): Promise<
  DatabaseResponse<{
    metadataFileId: string;
    totalPlates: number;
    totalSections: number;
  }>
> {
  try {
    if (!isNonEmptyString(accessionData?.name)) {
      return {
        success: false,
        error: 'accessionData.name must be a non-empty string',
      };
    }
    if (!Array.isArray(plates)) {
      return { success: false, error: 'plates must be an array' };
    }
    for (const plate of plates) {
      if (
        !isNonEmptyString(plate?.plate_id) ||
        !isNonEmptyString(plate?.accession)
      ) {
        return {
          success: false,
          error: 'each plate requires a non-empty plate_id and accession',
        };
      }
      if (!Array.isArray(plate.sections)) {
        return {
          success: false,
          error: `plate ${plate.plate_id} sections must be an array`,
        };
      }
      for (const section of plate.sections) {
        if (
          !isNonEmptyString(section?.plate_section_id) ||
          !isNonEmptyString(section?.plant_qr)
        ) {
          return {
            success: false,
            error:
              'each section requires a non-empty plate_section_id and plant_qr',
          };
        }
      }
    }

    const result = await db.$transaction(async (tx) => {
      const accessionRow = await tx.accessions.create({
        data: { name: accessionData.name },
      });
      let totalSections = 0;
      for (const plate of plates) {
        const plateRow = await tx.graviPlateAccession.create({
          data: {
            metadata_file_id: accessionRow.id,
            plate_id: plate.plate_id,
            accession: plate.accession,
            transplant_date: plate.transplant_date
              ? new Date(plate.transplant_date)
              : null,
            custom_note: plate.custom_note ?? null,
          },
        });
        for (const section of plate.sections) {
          await tx.graviPlateSectionMapping.create({
            data: {
              gravi_plate_id: plateRow.id,
              plate_section_id: section.plate_section_id,
              plant_qr: section.plant_qr,
              medium: section.medium ?? null,
            },
          });
          totalSections++;
        }
      }
      return {
        metadataFileId: accessionRow.id,
        totalPlates: plates.length,
        totalSections,
      };
    });
    logDatabaseOperation(
      'CREATE',
      'GraviPlateAccession',
      `metadataFileId=${result.metadataFileId} plates=${result.totalPlates} sections=${result.totalSections}`
    );
    return { success: true, data: result };
  } catch (error) {
    console.error(
      '[DB] Failed to create plate accessions with sections:',
      error
    );
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Naturally-sorted plates (and each plate's naturally-sorted sections)
 * for a metadata file. Empty array (not an error) when the file has zero
 * plates.
 */
export async function graviPlateAccessionsList(
  db: Db,
  metadataFileId: string
): Promise<DatabaseResponse> {
  try {
    if (!isNonEmptyString(metadataFileId)) {
      return {
        success: false,
        error: 'metadataFileId must be a non-empty string',
      };
    }
    const plates = await db.graviPlateAccession.findMany({
      where: { metadata_file_id: metadataFileId },
      include: { sections: true },
    });
    const sorted = plates
      .map((p) => ({
        ...p,
        sections: [...p.sections].sort((a, b) =>
          naturalCompare(a.plate_section_id, b.plate_section_id)
        ),
      }))
      .sort((a, b) => naturalCompare(a.plate_id, b.plate_id));
    return { success: true, data: sorted };
  } catch (error) {
    console.error('[DB] Failed to list plate accessions:', error);
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Lists `Accessions` rows that have at least one linked
 * `GraviPlateAccession` child. Takes NO filesystem path argument — see
 * design.md Open Question 5: this queries rows with linked children, it
 * does not list a directory.
 */
export async function graviPlateAccessionsListFiles(
  db: Db
): Promise<DatabaseResponse> {
  try {
    const rows = await db.accessions.findMany({
      where: { graviPlateAccessions: { some: {} } },
      include: {
        graviPlateAccessions: true,
        experiments: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    });
    const data = rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.createdAt,
      plateCount: r.graviPlateAccessions.length,
      experimentNames: r.experiments.map((e) => e.name),
    }));
    return { success: true, data };
  } catch (error) {
    console.error('[DB] Failed to list plate accession files:', error);
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Sums how many rows reference an `Accessions` metadata file across both
 * linking mechanisms: the single-accession `Experiment.accession_id` FK
 * (cylinderscan) and the per-wave `GraviExperimentWaveMetadata.accession_id`
 * FK (graviscan, add-wave-scoped-metadata-linking). Used by
 * `graviPlateAccessionsDelete` to block deleting a metadata file that's
 * still referenced by either mechanism.
 */
export async function countMetadataReferences(
  db: Db,
  metadataFileId: string
): Promise<number> {
  const [experimentRefs, waveMetadataRefs] = await Promise.all([
    db.experiment.count({ where: { accession_id: metadataFileId } }),
    db.graviExperimentWaveMetadata.count({
      where: { accession_id: metadataFileId },
    }),
  ]);
  return experimentRefs + waveMetadataRefs;
}

/**
 * Deletes an `Accessions` row (and, via schema-level `onDelete: Cascade`,
 * its `GraviPlateAccession`/`GraviPlateSectionMapping` children) unless
 * it is still referenced, per `countMetadataReferences`, by either
 * `Experiment.accession_id` or `GraviExperimentWaveMetadata.accession_id`.
 */
export async function graviPlateAccessionsDelete(
  db: Db,
  metadataFileId: string
): Promise<DatabaseResponse> {
  try {
    if (!isNonEmptyString(metadataFileId)) {
      return {
        success: false,
        error: 'metadataFileId must be a non-empty string',
      };
    }
    const refCount = await countMetadataReferences(db, metadataFileId);
    if (refCount > 0) {
      return {
        success: false,
        error:
          'Cannot delete: this metadata file is linked to one or more experiments',
      };
    }
    await db.$transaction(async (tx) => {
      const plates = await tx.graviPlateAccession.findMany({
        where: { metadata_file_id: metadataFileId },
        select: { id: true },
      });
      const plateIds = plates.map((p) => p.id);
      if (plateIds.length > 0) {
        await tx.graviPlateSectionMapping.deleteMany({
          where: { gravi_plate_id: { in: plateIds } },
        });
        await tx.graviPlateAccession.deleteMany({
          where: { metadata_file_id: metadataFileId },
        });
      }
      await tx.accessions.delete({ where: { id: metadataFileId } });
    });
    logDatabaseOperation(
      'DELETE',
      'GraviPlateAccession',
      `metadataFileId=${metadataFileId}`
    );
    return { success: true };
  } catch (error) {
    console.error('[DB] Failed to delete plate accession file:', error);
    return { success: false, error: errorMessage(error) };
  }
}

// -----------------------------------------------------------------------
// database.experiments.{linkGraviMetadata,unlinkGraviMetadata,listGraviMetadata}
// (add-wave-scoped-metadata-linking)
// -----------------------------------------------------------------------

/** Largest value Prisma's `Int` column can store (32-bit signed). */
const INT32_MAX = 2147483647;

function isValidWaveNumber(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= INT32_MAX
  );
}

/**
 * Links a GraviScan metadata file to a specific `(experimentId, waveNumber)`.
 * Validates existence/type of both the experiment and the accession before
 * writing — a bad id in the reference implementation this was ported from
 * just threw a raw Prisma error; see design.md Decisions 1-4.
 */
export async function linkGraviMetadata(
  db: Db,
  experimentId: string,
  waveNumber: number,
  accessionId: string
): Promise<
  DatabaseResponse<
    Prisma.GraviExperimentWaveMetadataGetPayload<{
      include: { accession: true };
    }>
  >
> {
  try {
    if (!isNonEmptyString(experimentId)) {
      return {
        success: false,
        error: 'experimentId must be a non-empty string',
      };
    }
    if (!isNonEmptyString(accessionId)) {
      return {
        success: false,
        error: 'accessionId must be a non-empty string',
      };
    }
    if (!isValidWaveNumber(waveNumber)) {
      return {
        success: false,
        error: `waveNumber must be a non-negative integer no greater than ${INT32_MAX}`,
      };
    }

    const experiment = await db.experiment.findUnique({
      where: { id: experimentId },
    });
    if (!experiment) {
      return { success: false, error: `Experiment not found: ${experimentId}` };
    }
    if (experiment.experiment_type !== 'graviscan') {
      return {
        success: false,
        error: `Experiment ${experimentId} is not a graviscan experiment`,
      };
    }

    const accession = await db.accessions.findUnique({
      where: { id: accessionId },
      include: { graviPlateAccessions: { select: { id: true }, take: 1 } },
    });
    if (!accession) {
      return {
        success: false,
        error: `Metadata file not found: ${accessionId}`,
      };
    }
    if (accession.graviPlateAccessions.length === 0) {
      return {
        success: false,
        error: `Metadata file ${accessionId} has no plate or section data, so it can't be linked as GraviScan wave metadata`,
      };
    }

    const existing = await db.graviExperimentWaveMetadata.findUnique({
      where: {
        experiment_id_wave_number: {
          experiment_id: experimentId,
          wave_number: waveNumber,
        },
      },
    });
    if (existing) {
      return {
        success: false,
        error: `Wave ${waveNumber} already has metadata linked — unlink it first if you want to link a different file`,
      };
    }

    const created = await db.graviExperimentWaveMetadata.create({
      data: {
        experiment_id: experimentId,
        wave_number: waveNumber,
        accession_id: accessionId,
      },
      include: { accession: true },
    });
    logDatabaseOperation(
      'CREATE',
      'GraviExperimentWaveMetadata',
      `experimentId=${experimentId} waveNumber=${waveNumber} accessionId=${accessionId}`
    );
    return { success: true, data: created };
  } catch (error) {
    console.error('[DB] Failed to link GraviScan wave metadata:', error);
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Removes the `GraviExperimentWaveMetadata` link for `(experimentId,
 * waveNumber)`. Returns a friendly error for a non-existent link instead of
 * letting Prisma's raw `P2025` ("record not found") surface — the reference
 * implementation this was ported from did the latter.
 */
export async function unlinkGraviMetadata(
  db: Db,
  experimentId: string,
  waveNumber: number
): Promise<DatabaseResponse> {
  try {
    if (!isNonEmptyString(experimentId)) {
      return {
        success: false,
        error: 'experimentId must be a non-empty string',
      };
    }
    if (!isValidWaveNumber(waveNumber)) {
      return {
        success: false,
        error: `waveNumber must be a non-negative integer no greater than ${INT32_MAX}`,
      };
    }

    const existing = await db.graviExperimentWaveMetadata.findUnique({
      where: {
        experiment_id_wave_number: {
          experiment_id: experimentId,
          wave_number: waveNumber,
        },
      },
    });
    if (!existing) {
      return {
        success: false,
        error: `Nothing to unlink — wave ${waveNumber} has no metadata file linked`,
      };
    }

    await db.graviExperimentWaveMetadata.delete({
      where: {
        experiment_id_wave_number: {
          experiment_id: experimentId,
          wave_number: waveNumber,
        },
      },
    });
    logDatabaseOperation(
      'DELETE',
      'GraviExperimentWaveMetadata',
      `experimentId=${experimentId} waveNumber=${waveNumber}`
    );
    return { success: true };
  } catch (error) {
    console.error('[DB] Failed to unlink GraviScan wave metadata:', error);
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Lists an experiment's linked GraviScan wave metadata, ordered by
 * `wave_number` ascending, each with its `accession` included.
 */
export async function listGraviMetadata(
  db: Db,
  experimentId: string
): Promise<
  DatabaseResponse<
    Prisma.GraviExperimentWaveMetadataGetPayload<{
      include: { accession: true };
    }>[]
  >
> {
  try {
    if (!isNonEmptyString(experimentId)) {
      return {
        success: false,
        error: 'experimentId must be a non-empty string',
      };
    }
    const rows = await db.graviExperimentWaveMetadata.findMany({
      where: { experiment_id: experimentId },
      include: { accession: true },
      orderBy: { wave_number: 'asc' },
    });
    return { success: true, data: rows };
  } catch (error) {
    console.error('[DB] Failed to list GraviScan wave metadata:', error);
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Register all database IPC handlers
 *
 * Handlers follow naming convention: db:{model}:{action}
 * All handlers return DatabaseResponse for consistent error handling
 */
export function registerDatabaseHandlers() {
  const db = getDatabase();

  // ============================================
  // Experiments
  // ============================================

  ipcMain.handle('db:experiments:list', async (): Promise<DatabaseResponse> => {
    try {
      const experiments = await db.experiment.findMany({
        include: {
          scientist: true,
          accession: true,
        },
        orderBy: { name: 'asc' },
      });
      return { success: true, data: experiments };
    } catch (error) {
      console.error('[DB] Failed to list experiments:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(
    'db:experiments:create',
    async (
      _event,
      data: Prisma.ExperimentCreateInput
    ): Promise<DatabaseResponse> => {
      try {
        const experiment = await db.experiment.create({ data });
        logDatabaseOperation(
          'CREATE',
          'Experiment',
          `id=${experiment.id} name="${experiment.name}"`
        );
        return { success: true, data: experiment };
      } catch (error) {
        console.error('[DB] Failed to create experiment:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:experiments:get',
    async (_event, id: string): Promise<DatabaseResponse> => {
      try {
        const experiment = await db.experiment.findUnique({
          where: { id },
          include: {
            scientist: true,
            accession: true,
            scans: {
              orderBy: { capture_date: 'desc' },
              take: 10, // Limit to recent 10 scans
            },
          },
        });
        return { success: true, data: experiment };
      } catch (error) {
        console.error('[DB] Failed to get experiment:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:experiments:update',
    async (
      _event,
      id: string,
      data: Prisma.ExperimentUpdateInput
    ): Promise<DatabaseResponse> => {
      try {
        const experiment = await db.experiment.update({
          where: { id },
          data,
        });
        return { success: true, data: experiment };
      } catch (error) {
        console.error('[DB] Failed to update experiment:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:experiments:delete',
    async (_event, id: string): Promise<DatabaseResponse> => {
      try {
        await db.experiment.delete({ where: { id } });
        return { success: true };
      } catch (error) {
        console.error('[DB] Failed to delete experiment:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:experiments:attachAccession',
    async (
      _event,
      experimentId: string,
      accessionId: string
    ): Promise<DatabaseResponse> => {
      try {
        const experiment = await db.experiment.update({
          where: { id: experimentId },
          data: { accession_id: accessionId },
          include: { accession: true },
        });
        logDatabaseOperation(
          'UPDATE',
          'Experiment',
          `id=${experimentId} attached accession=${accessionId}`
        );
        return { success: true, data: experiment };
      } catch (error) {
        console.error('[DB] Failed to attach accession to experiment:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // ============================================
  // Phenotypers
  // ============================================

  ipcMain.handle('db:phenotypers:list', async (): Promise<DatabaseResponse> => {
    try {
      const phenotypers = await db.phenotyper.findMany({
        orderBy: { name: 'asc' },
      });
      return { success: true, data: phenotypers };
    } catch (error) {
      console.error('[DB] Failed to list phenotypers:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(
    'db:phenotypers:create',
    async (
      _event,
      data: Prisma.PhenotyperCreateInput
    ): Promise<DatabaseResponse> => {
      try {
        const phenotyper = await db.phenotyper.create({ data });
        logDatabaseOperation(
          'CREATE',
          'Phenotyper',
          `id=${phenotyper.id} name="${phenotyper.name}"`
        );
        return { success: true, data: phenotyper };
      } catch (error) {
        console.error('[DB] Failed to create phenotyper:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // ============================================
  // Scientists
  // ============================================

  ipcMain.handle('db:scientists:list', async (): Promise<DatabaseResponse> => {
    try {
      const scientists = await db.scientist.findMany({
        orderBy: { name: 'asc' },
      });
      return { success: true, data: scientists };
    } catch (error) {
      console.error('[DB] Failed to list scientists:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(
    'db:scientists:create',
    async (
      _event,
      data: Prisma.ScientistCreateInput
    ): Promise<DatabaseResponse> => {
      try {
        const scientist = await db.scientist.create({ data });
        logDatabaseOperation(
          'CREATE',
          'Scientist',
          `id=${scientist.id} email="${scientist.email}"`
        );
        return { success: true, data: scientist };
      } catch (error) {
        console.error('[DB] Failed to create scientist:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // ============================================
  // Accessions
  // ============================================

  ipcMain.handle('db:accessions:list', async (): Promise<DatabaseResponse> => {
    try {
      const accessions = await db.accessions.findMany({
        include: {
          experiments: {
            select: {
              name: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      });
      return { success: true, data: accessions };
    } catch (error) {
      console.error('[DB] Failed to list accessions:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(
    'db:accessions:create',
    async (
      _event,
      data: Prisma.AccessionsCreateInput
    ): Promise<DatabaseResponse> => {
      try {
        const accession = await db.accessions.create({ data });
        logDatabaseOperation(
          'CREATE',
          'Accession',
          `id=${accession.id} name="${accession.name}"`
        );
        return { success: true, data: accession };
      } catch (error) {
        console.error('[DB] Failed to create accession:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:accessions:createWithMappings',
    async (
      _event,
      accessionData: { name: string },
      mappings: { plant_barcode: string; accession_name?: string }[]
    ): Promise<DatabaseResponse> => {
      try {
        // Create accession with plant mappings in atomic transaction
        const result = await db.$transaction(async (tx) => {
          const accession = await tx.accessions.create({
            data: { name: accessionData.name },
          });

          // Process mappings in batches of 100
          const batchSize = 100;
          let totalCreated = 0;

          for (let i = 0; i < mappings.length; i += batchSize) {
            const batch = mappings.slice(i, i + batchSize);
            await tx.plantAccessionMappings.createMany({
              data: batch.map((m) => ({
                accession_file_id: accession.id,
                plant_barcode: m.plant_barcode,
                accession_name: m.accession_name ?? null,
              })),
            });
            totalCreated += batch.length;
          }

          return { accession, mappingCount: totalCreated };
        });

        logDatabaseOperation(
          'CREATE',
          'Accession with Mappings',
          `id=${result.accession.id} name="${result.accession.name}" mappings=${result.mappingCount}`
        );

        return {
          success: true,
          data: {
            ...result.accession,
            mappingCount: result.mappingCount,
          },
        };
      } catch (error) {
        console.error('[DB] Failed to create accession with mappings:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:accessions:getMappings',
    async (_event, accessionId: string): Promise<DatabaseResponse> => {
      try {
        const mappings = await db.plantAccessionMappings.findMany({
          where: { accession_file_id: accessionId },
          orderBy: { plant_barcode: 'asc' },
        });
        return { success: true, data: mappings };
      } catch (error) {
        console.error('[DB] Failed to get accession mappings:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:accessions:update',
    async (
      _event,
      id: string,
      data: { name: string }
    ): Promise<DatabaseResponse> => {
      try {
        if (!data.name || data.name.trim() === '') {
          return {
            success: false,
            error: 'Name cannot be empty',
          };
        }

        const accession = await db.accessions.update({
          where: { id },
          data: { name: data.name.trim() },
        });

        logDatabaseOperation(
          'UPDATE',
          'Accession',
          `id=${accession.id} name="${accession.name}"`
        );

        return { success: true, data: accession };
      } catch (error) {
        console.error('[DB] Failed to update accession:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:accessions:delete',
    async (_event, id: string): Promise<DatabaseResponse> => {
      try {
        // Delete in transaction (cascade will handle plant mappings)
        const result = await db.$transaction(async (tx) => {
          // First delete all plant mappings
          await tx.plantAccessionMappings.deleteMany({
            where: { accession_file_id: id },
          });

          // Then delete the accession
          const accession = await tx.accessions.delete({
            where: { id },
          });

          return accession;
        });

        logDatabaseOperation('DELETE', 'Accession', `id=${id}`);

        return { success: true, data: result };
      } catch (error) {
        console.error('[DB] Failed to delete accession:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:accessions:updateMapping',
    async (
      _event,
      mappingId: string,
      data: { accession_name: string }
    ): Promise<DatabaseResponse> => {
      try {
        if (!data.accession_name || data.accession_name.trim() === '') {
          return {
            success: false,
            error: 'Accession name cannot be empty',
          };
        }

        const mapping = await db.plantAccessionMappings.update({
          where: { id: mappingId },
          data: { accession_name: data.accession_name.trim() },
        });

        logDatabaseOperation(
          'UPDATE',
          'PlantAccessionMapping',
          `id=${mappingId} accession_name="${data.accession_name}"`
        );

        return { success: true, data: mapping };
      } catch (error) {
        console.error('[DB] Failed to update mapping:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:accessions:getPlantBarcodes',
    async (
      _event,
      accessionId: string
    ): Promise<DatabaseResponse<string[]>> => {
      try {
        const mappings = await db.plantAccessionMappings.findMany({
          where: { accession_file_id: accessionId },
          select: { plant_barcode: true },
        });

        const barcodes = mappings.map((m) => m.plant_barcode);
        return { success: true, data: barcodes };
      } catch (error) {
        console.error('[DB] Failed to get plant barcodes:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:accessions:getAccessionNameByBarcode',
    async (
      _event,
      plantBarcode: string,
      experimentId: string
    ): Promise<DatabaseResponse<string | null>> => {
      try {
        // First get the experiment to find its accession
        const experiment = await db.experiment.findUnique({
          where: { id: experimentId },
          select: { accession_id: true },
        });

        if (!experiment?.accession_id) {
          return { success: true, data: null };
        }

        // Find the mapping for this barcode in the experiment's accession
        const mapping = await db.plantAccessionMappings.findFirst({
          where: {
            accession_file_id: experiment.accession_id,
            plant_barcode: plantBarcode,
          },
          select: { accession_name: true },
        });

        return { success: true, data: mapping?.accession_name || null };
      } catch (error) {
        console.error('[DB] Failed to get accession name by barcode:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // ============================================
  // Scans
  // ============================================

  ipcMain.handle(
    'db:scans:create',
    async (_event, data: Prisma.ScanCreateInput): Promise<DatabaseResponse> => {
      try {
        const scan = await db.scan.create({ data });
        logDatabaseOperation(
          'CREATE',
          'Scan',
          `id=${scan.id} plant="${scan.plant_id}"`
        );
        return { success: true, data: scan };
      } catch (error) {
        console.error('[DB] Failed to create scan:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:scans:list',
    async (
      _event,
      filters?: {
        // Legacy filters (simple list)
        experiment_id?: string;
        phenotyper_id?: string;
        plant_id?: string;
        // New pagination filters (BrowseScans feature)
        page?: number;
        pageSize?: number;
        experimentId?: string;
        dateFrom?: string;
        dateTo?: string;
      }
    ): Promise<DatabaseResponse> => {
      try {
        // Check if pagination params are provided
        const isPaginated =
          typeof filters?.page === 'number' &&
          typeof filters?.pageSize === 'number';

        if (isPaginated) {
          // Paginated query (BrowseScans feature)
          const page = Math.max(1, filters.page!);
          const pageSize = Math.min(100, Math.max(1, filters.pageSize!));
          const skip = (page - 1) * pageSize;

          // Build where clause - always exclude soft-deleted scans
          const where: {
            deleted: boolean;
            experiment_id?: string;
            capture_date?: { gte?: Date; lte?: Date };
          } = {
            deleted: false,
          };

          // Experiment filter
          if (filters.experimentId) {
            where.experiment_id = filters.experimentId;
          }

          // Date range filter
          // Note: Append 'T00:00:00' to parse as local time, not UTC
          // (plain date strings like "2025-02-17" are parsed as UTC midnight)
          if (filters.dateFrom || filters.dateTo) {
            // Validate date format (YYYY-MM-DD)
            const datePattern = /^\d{4}-\d{2}-\d{2}$/;
            if (filters.dateFrom && !datePattern.test(filters.dateFrom)) {
              return {
                success: false,
                error: `Invalid dateFrom format: "${filters.dateFrom}". Expected YYYY-MM-DD.`,
              };
            }
            if (filters.dateTo && !datePattern.test(filters.dateTo)) {
              return {
                success: false,
                error: `Invalid dateTo format: "${filters.dateTo}". Expected YYYY-MM-DD.`,
              };
            }

            where.capture_date = {};
            if (filters.dateFrom) {
              // Start of day in local time
              where.capture_date.gte = new Date(filters.dateFrom + 'T00:00:00');
            }
            if (filters.dateTo) {
              // End of day in local time (inclusive)
              where.capture_date.lte = new Date(
                filters.dateTo + 'T23:59:59.999'
              );
            }
          }

          // Execute count and findMany in parallel
          const [total, scans] = await Promise.all([
            db.scan.count({ where }),
            db.scan.findMany({
              where,
              include: {
                experiment: {
                  include: {
                    scientist: true,
                  },
                },
                phenotyper: true,
                images: { select: { id: true, status: true } },
              },
              orderBy: { capture_date: 'desc' },
              skip,
              take: pageSize,
            }),
          ]);

          logDatabaseOperation(
            'READ',
            'Scan',
            `list paginated page=${page} pageSize=${pageSize} total=${total}`
          );

          return {
            success: true,
            data: {
              scans,
              total,
              page,
              pageSize,
            },
          };
        } else {
          // Legacy query (simple list without pagination)
          const scans = await db.scan.findMany({
            where: {
              experiment_id: filters?.experiment_id,
              phenotyper_id: filters?.phenotyper_id,
              plant_id: filters?.plant_id,
            },
            include: {
              experiment: {
                include: {
                  scientist: true,
                },
              },
              phenotyper: true,
              images: { select: { id: true, status: true } }, // Just id/status, not full image data
            },
            orderBy: { capture_date: 'desc' },
          });
          return { success: true, data: scans };
        }
      } catch (error) {
        console.error('[DB] Failed to list scans:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:scans:get',
    async (_event, id: string): Promise<DatabaseResponse> => {
      try {
        const scan = await db.scan.findUnique({
          where: { id },
          include: {
            experiment: {
              include: {
                scientist: true,
              },
            },
            phenotyper: true,
            images: {
              orderBy: { frame_number: 'asc' },
            },
          },
        });
        return { success: true, data: scan };
      } catch (error) {
        console.error('[DB] Failed to get scan:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:scans:getMostRecentScanDate',
    async (
      _event,
      plantId: string,
      experimentId: string
    ): Promise<DatabaseResponse<string | null>> => {
      try {
        const scan = await db.scan.findFirst({
          where: {
            plant_id: plantId,
            experiment_id: experimentId,
            deleted: false,
          },
          orderBy: { capture_date: 'desc' },
          select: { capture_date: true },
        });

        return {
          success: true,
          data: scan?.capture_date?.toISOString() || null,
        };
      } catch (error) {
        console.error('[DB] Failed to get most recent scan date:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:scans:getRecent',
    async (
      _event,
      options?: { limit?: number; experimentId?: string }
    ): Promise<DatabaseResponse> => {
      try {
        // Validate and clamp limit to safe range
        const MAX_LIMIT = 100;
        const DEFAULT_LIMIT = 10;
        const requestedLimit = options?.limit;
        let limit = DEFAULT_LIMIT;

        if (
          typeof requestedLimit === 'number' &&
          Number.isFinite(requestedLimit)
        ) {
          const normalizedLimit = Math.floor(requestedLimit);
          if (normalizedLimit >= 1) {
            limit = Math.min(normalizedLimit, MAX_LIMIT);
          }
        }

        // Calculate today's date range
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // Build where clause
        const where: {
          capture_date: { gte: Date; lt: Date };
          deleted: boolean;
          experiment_id?: string;
        } = {
          capture_date: {
            gte: today,
            lt: tomorrow,
          },
          deleted: false,
        };

        // Optional experiment filter
        if (options?.experimentId) {
          where.experiment_id = options.experimentId;
        }

        const scans = await db.scan.findMany({
          where,
          orderBy: { capture_date: 'desc' },
          take: limit,
          include: {
            experiment: {
              select: { name: true },
            },
          },
        });

        logDatabaseOperation(
          'READ',
          'Scan',
          `getRecent count=${scans.length} limit=${limit}`
        );

        return { success: true, data: scans };
      } catch (error) {
        console.error('[DB] Failed to get recent scans:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * Soft delete a scan by setting deleted=true
   * Does NOT delete associated Image records
   */
  ipcMain.handle(
    'db:scans:delete',
    async (_event, id: string): Promise<DatabaseResponse> => {
      try {
        const scan = await db.scan.update({
          where: { id },
          data: { deleted: true },
        });
        logDatabaseOperation('DELETE', 'Scan', `id=${id} (soft delete)`);
        return { success: true, data: scan };
      } catch (error) {
        console.error('[DB] Failed to delete scan:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * Upload a scan's images to Bloom remote storage
   * Uses credentials from ~/.bloom/.env (machine configuration)
   */
  ipcMain.handle(
    'db:scans:upload',
    async (_event, scanId: string): Promise<DatabaseResponse<UploadResult>> => {
      try {
        const uploader = new ImageUploader(db);
        await uploader.authenticate();
        const result = await uploader.uploadScan(scanId);
        logDatabaseOperation(
          'UPDATE',
          'Scan',
          `id=${scanId} uploaded ${result.uploaded}/${result.total} images`
        );
        return { success: true, data: result };
      } catch (error) {
        console.error('[DB] Failed to upload scan:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * Upload multiple scans' images to Bloom remote storage (batch)
   * Uses credentials from ~/.bloom/.env (machine configuration)
   */
  ipcMain.handle(
    'db:scans:uploadBatch',
    async (
      _event,
      scanIds: string[]
    ): Promise<DatabaseResponse<UploadResult[]>> => {
      try {
        const uploader = new ImageUploader(db);
        await uploader.authenticate();
        const results = await uploader.uploadBatch(scanIds);
        const totalUploaded = results.reduce((sum, r) => sum + r.uploaded, 0);
        const totalImages = results.reduce((sum, r) => sum + r.total, 0);
        logDatabaseOperation(
          'UPDATE',
          'Scan',
          `batch upload: ${scanIds.length} scans, ${totalUploaded}/${totalImages} images`
        );
        return { success: true, data: results };
      } catch (error) {
        console.error('[DB] Failed to batch upload scans:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // ============================================
  // Images
  // ============================================

  ipcMain.handle(
    'db:images:create',
    async (
      _event,
      data: Prisma.ImageCreateManyInput[]
    ): Promise<DatabaseResponse> => {
      try {
        // Use createMany for bulk insert (more efficient)
        const result = await db.image.createMany({ data });
        return { success: true, data: result };
      } catch (error) {
        console.error('[DB] Failed to create images:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // ============================================
  // GraviScans (add-graviscan-data-layer-and-events)
  // ============================================

  ipcMain.handle(
    'db:experiments:linkGraviMetadata',
    (_event, experimentId, waveNumber, accessionId) =>
      linkGraviMetadata(db, experimentId, waveNumber, accessionId)
  );
  ipcMain.handle(
    'db:experiments:unlinkGraviMetadata',
    (_event, experimentId, waveNumber) =>
      unlinkGraviMetadata(db, experimentId, waveNumber)
  );
  ipcMain.handle('db:experiments:listGraviMetadata', (_event, experimentId) =>
    listGraviMetadata(db, experimentId)
  );

  ipcMain.handle('db:graviscans:create', (_event, data) =>
    graviscansCreate(db, data)
  );
  ipcMain.handle('db:graviscans:getMaxWaveNumber', (_event, experimentId) =>
    graviscansGetMaxWaveNumber(db, experimentId)
  );
  ipcMain.handle('db:graviscans:checkBarcodeUniqueInWave', (_event, args) =>
    graviscansCheckBarcodeUniqueInWave(db, args)
  );
  ipcMain.handle('db:graviscans:updateGridTimestamps', (_event, args) =>
    graviscansUpdateGridTimestamps(db, args)
  );
  ipcMain.handle('db:graviscans:browseByExperiment', (_event, args) =>
    graviscansBrowseByExperiment(db, args)
  );
  ipcMain.handle('db:graviscans:experimentDetail', (_event, experimentId) =>
    graviscansExperimentDetail(db, experimentId)
  );

  // ============================================
  // GraviScan Sessions
  // ============================================

  ipcMain.handle('db:graviscanSessions:create', (_event, data) =>
    graviscanSessionsCreate(db, data)
  );
  ipcMain.handle('db:graviscanSessions:complete', (_event, args) =>
    graviscanSessionsComplete(db, args)
  );

  // ============================================
  // GraviScan Plate Assignments
  // ============================================

  ipcMain.handle(
    'db:graviscanPlateAssignments:list',
    (_event, experimentId, scannerId) =>
      graviscanPlateAssignmentsList(db, experimentId, scannerId)
  );
  ipcMain.handle(
    'db:graviscanPlateAssignments:upsertMany',
    (_event, experimentId, scannerId, assignments) =>
      graviscanPlateAssignmentsUpsertMany(
        db,
        experimentId,
        scannerId,
        assignments
      )
  );

  // ============================================
  // GraviScan Plate Accessions
  // ============================================

  ipcMain.handle(
    'db:graviPlateAccessions:createWithSections',
    (_event, accessionData, plates) =>
      graviPlateAccessionsCreateWithSections(db, accessionData, plates)
  );
  ipcMain.handle('db:graviPlateAccessions:list', (_event, metadataFileId) =>
    graviPlateAccessionsList(db, metadataFileId)
  );
  ipcMain.handle('db:graviPlateAccessions:listFiles', () =>
    graviPlateAccessionsListFiles(db)
  );
  ipcMain.handle('db:graviPlateAccessions:delete', (_event, metadataFileId) =>
    graviPlateAccessionsDelete(db, metadataFileId)
  );

  console.log('[DB] Registered all database IPC handlers');
}
