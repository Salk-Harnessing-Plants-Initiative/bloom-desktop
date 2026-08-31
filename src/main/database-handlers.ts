/**
 * Database IPC Handlers
 *
 * Provides IPC handlers for database operations, exposing CRUD operations
 * for all models to the renderer process.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { getDatabase } from './database';
import type { Prisma, PrismaClient } from '@prisma/client';
import { ImageUploader, UploadResult } from './image-uploader';
import { resolveScanPath } from './scan-protocol';
import { getScansDir } from './config-store';
import * as fs from 'fs';
import * as path from 'path';

// This file is shared code and must not import from graviscan/ directly
// (enforced by @typescript-eslint/no-restricted-imports). GraviScan-specific
// audit logging for linkGraviMetadata/unlinkGraviMetadata is injected via
// setAuditLogger() instead — wired to the real scanLog() from
// graviscan/wiring.ts's initGraviScan(), which runs only in graviscan mode.
let auditLogger: (message: string) => void = () => {};
export function setAuditLogger(fn: (message: string) => void): void {
  auditLogger = fn;
}

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

/** `fs.promises` has no direct equivalent to `fs.existsSync`. */
async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
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
    if (
      data.wave_number !== undefined &&
      !isValidWaveNumber(data.wave_number)
    ) {
      return {
        success: false,
        error: 'wave_number, when provided, must be a non-negative integer',
      };
    }
    const sessionId = (data.session_id as string | null) ?? null;
    const cycleNumber = (data.cycle_number as number | null) ?? null;
    const scannerId = data.scanner_id as string;
    const plateIndex = data.plate_index as string;
    const fields = {
      experiment_id: data.experiment_id as string,
      phenotyper_id: data.phenotyper_id as string,
      scanner_id: scannerId,
      session_id: sessionId,
      cycle_number: cycleNumber,
      wave_number: typeof data.wave_number === 'number' ? data.wave_number : 0,
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
      plate_index: plateIndex,
      resolution: data.resolution as number,
      format: typeof data.format === 'string' ? data.format : 'tiff',
    };
    // Upsert on (session_id, scanner_id, plate_index, cycle_number), not a
    // plain create — a duplicated/retried job-complete event for the same
    // physical scan must not create a second GraviScan row. `update: {}`
    // is a deliberate no-op: this assumes a retry always carries identical
    // data to the first attempt (see design.md Decision 2's named risk).
    //
    // Only meaningful when both session_id and cycle_number are present —
    // that pair is what identifies "the same job." Without them (one-shot/
    // test captures with no session), there is no job identity to dedupe
    // against: Prisma's compound-unique lookup would still match on
    // `IS NULL AND IS NULL`, silently collapsing two distinct, legitimate
    // captures into one row and discarding the second's image path. Fall
    // back to a plain create in that case.
    const created =
      sessionId !== null && cycleNumber !== null
        ? await db.graviScan.upsert({
            where: {
              session_id_scanner_id_plate_index_cycle_number: {
                session_id: sessionId,
                scanner_id: scannerId,
                plate_index: plateIndex,
                cycle_number: cycleNumber,
              },
            },
            create: fields,
            update: {},
          })
        : await db.graviScan.create({ data: fields });
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
          graviScans: { include: { images: true; phenotyper: true } };
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
          graviScans: {
            where: scansWhere,
            include: { images: true, phenotyper: true },
          },
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
    scans: Prisma.GraviScanGetPayload<{
      include: { phenotyper: true; scanner: true };
    }>[];
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
      include: { phenotyper: true, scanner: true },
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
  scannerId: string,
  waveNumber?: number
): Promise<DatabaseResponse> {
  try {
    if (!isNonEmptyString(experimentId) || !isNonEmptyString(scannerId)) {
      return {
        success: false,
        error: 'experimentId and scannerId must be non-empty strings',
      };
    }
    if (waveNumber !== undefined && !isValidWaveNumber(waveNumber)) {
      return {
        success: false,
        error: 'waveNumber, when provided, must be a non-negative integer',
      };
    }
    const rows = await db.graviScanPlateAssignment.findMany({
      where: {
        experiment_id: experimentId,
        scanner_id: scannerId,
        wave_number: typeof waveNumber === 'number' ? waveNumber : 0,
      },
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
  assignments: PlateAssignmentUpsertInput[],
  waveNumber?: number
): Promise<DatabaseResponse> {
  try {
    if (!isNonEmptyString(experimentId) || !isNonEmptyString(scannerId)) {
      return {
        success: false,
        error: 'experimentId and scannerId must be non-empty strings',
      };
    }
    if (waveNumber !== undefined && !isValidWaveNumber(waveNumber)) {
      return {
        success: false,
        error: 'waveNumber, when provided, must be a non-negative integer',
      };
    }
    const wave = typeof waveNumber === 'number' ? waveNumber : 0;
    const rows = await db.$transaction(async (tx) => {
      const written = [];
      for (const a of assignments) {
        // verification_status/previous_plate_barcode are owned by the
        // verify-plates flow, not plate assignment — omitting them from
        // the update payload (rather than defaulting to
        // 'pending'/null) leaves Prisma's existing column value
        // untouched, so an operator editing an unrelated field here
        // can't silently erase a verification result written moments
        // earlier by a different caller.
        const update: Record<string, unknown> = {
          plate_barcode: a.plate_barcode ?? null,
          transplant_date: a.transplant_date
            ? new Date(a.transplant_date)
            : null,
          custom_note: a.custom_note ?? null,
          selected: a.selected ?? true,
        };
        if (a.verification_status !== undefined) {
          update.verification_status = a.verification_status;
        }
        if (a.previous_plate_barcode !== undefined) {
          update.previous_plate_barcode = a.previous_plate_barcode;
        }
        const row = await tx.graviScanPlateAssignment.upsert({
          where: {
            experiment_id_scanner_id_plate_index_wave_number: {
              experiment_id: experimentId,
              scanner_id: scannerId,
              plate_index: a.plate_index,
              wave_number: wave,
            },
          },
          create: {
            experiment_id: experimentId,
            scanner_id: scannerId,
            plate_index: a.plate_index,
            wave_number: wave,
            plate_barcode: a.plate_barcode ?? null,
            transplant_date: a.transplant_date
              ? new Date(a.transplant_date)
              : null,
            custom_note: a.custom_note ?? null,
            selected: a.selected ?? true,
            verification_status: a.verification_status ?? 'pending',
            previous_plate_barcode: a.previous_plate_barcode ?? null,
          },
          update,
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
    if (plates.length === 0) {
      // A spreadsheet whose columns didn't auto-map and were never fixed
      // manually produces zero recognized plates (every row's plate_id
      // resolves to '' and is skipped) — without this check the caller
      // gets a false {success: true} for an import that wrote nothing.
      return {
        success: false,
        error:
          'No plates found — check that every required column is mapped correctly',
      };
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
      const seenSectionIds = new Set<string>();
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
        if (seenSectionIds.has(section.plate_section_id)) {
          return {
            success: false,
            error: `plate ${plate.plate_id} has duplicate section ID ${section.plate_section_id}`,
          };
        }
        seenSectionIds.add(section.plate_section_id);
      }
    }

    // plant_qr must be unique across the whole upload, not just within one
    // plate (the DB's own @@unique([gravi_plate_id, plant_qr]) only covers
    // the latter) — the same physical plant can't legitimately appear on two
    // different plates in one wave's metadata (#313).
    const qrToPlateId = new Map<string, string>();
    for (const plate of plates) {
      for (const section of plate.sections) {
        const existingPlateId = qrToPlateId.get(section.plant_qr);
        if (existingPlateId !== undefined) {
          return {
            success: false,
            error: `plant QR ${section.plant_qr} appears on both plate ${existingPlateId} and plate ${plate.plate_id}`,
          };
        }
        qrToPlateId.set(section.plant_qr, plate.plate_id);
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

export function isValidWaveNumber(value: unknown): value is number {
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
    auditLogger(
      `[linkGraviMetadata] experiment=${experimentId} wave=${waveNumber} accession=${created.accession.name} (${accessionId})`
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
      include: { accession: true },
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
    auditLogger(
      `[unlinkGraviMetadata] experiment=${experimentId} wave=${waveNumber} accession=${existing.accession.name} (${existing.accession_id})`
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

/** One scan the export batch could not copy — enough detail to identify and re-attempt it. */
export interface ScansExportFailure {
  scanId: string;
  experimentName: string;
  captureDate: Date;
  reason: string;
}

export interface ScansExportData {
  exportedFiles: number;
  exportedScans: number;
  skippedFiles: number;
  failedScans: ScansExportFailure[];
}

export interface ScansExportProgress {
  totalFiles: number;
  completedFiles: number;
  currentScanId: string;
}

/**
 * Export selected scans' files to `destinationDir`, preserving each scan's
 * relative `path` under the destination.
 *
 * `scansDir` is injected (rather than read from config internally) so tests
 * can point it at a temp directory — mirrors `resolveScanPath`'s own
 * dependency-injection style.
 *
 * Files are copied via `.tmp`-then-`fs.promises.rename`, one at a time, in the
 * SAME order they're listed (`metadata.json` first) — this must stay fully
 * sequential (never `Promise.all` over the file list) because the
 * metadata-before-frames guarantee is about *completion* order, not just the
 * order copies are started in. A per-file failure marks only that scan as
 * failed (in `failedScans`, with whatever files already succeeded left in
 * place — see design.md's accepted residual risk) and does not touch other
 * scans in the batch.
 */
export async function scansExport(
  db: Db,
  scansDir: string,
  params: { scanIds: string[]; destinationDir: string },
  onProgress?: (progress: ScansExportProgress) => void
): Promise<DatabaseResponse<ScansExportData>> {
  try {
    const { scanIds, destinationDir } = params;
    if (!Array.isArray(scanIds) || scanIds.length === 0) {
      return { success: false, error: 'scanIds must be a non-empty array' };
    }
    if (!isNonEmptyString(destinationDir)) {
      return {
        success: false,
        error: 'destinationDir must be a non-empty string',
      };
    }

    try {
      await fs.promises.mkdir(destinationDir, { recursive: true });
      // fs.access(W_OK) is well-known to be unreliable for detecting a
      // genuinely write-protected/read-only external drive on Windows —
      // exactly the USB-drive scenario this feature targets. A real
      // write-then-delete probe is the only check that's actually trustworthy
      // here.
      const probePath = path.join(
        destinationDir,
        `.bloom-export-write-probe-${Date.now()}`
      );
      await fs.promises.writeFile(probePath, '');
      await fs.promises.unlink(probePath);
    } catch (error) {
      return {
        success: false,
        error: `Destination directory is not writable: ${errorMessage(error)}`,
      };
    }

    const scans = await db.scan.findMany({
      where: { id: { in: scanIds }, deleted: false },
      include: { experiment: true },
      orderBy: { capture_date: 'desc' },
    });

    const failedScans: ScansExportFailure[] = [];

    // Pass 1: resolve + containment-check every scan's source and
    // destination path, and list its files, before copying anything. A scan
    // that fails here goes straight to `failedScans` and never contributes
    // to `totalFiles` — progress reporting only covers scans whose files
    // are actually going to be attempted.
    const processable: Array<{
      scanId: string;
      resolvedSource: string;
      resolvedDest: string;
      files: string[];
    }> = [];

    for (const scan of scans) {
      const fail = (reason: string) =>
        failedScans.push({
          scanId: scan.id,
          experimentName: scan.experiment.name,
          captureDate: scan.capture_date,
          reason,
        });

      const resolvedSource = resolveScanPath(
        path.join(scansDir, scan.path),
        scansDir
      );
      if (!resolvedSource) {
        fail('Scan path escapes the configured scans directory');
        continue;
      }

      const resolvedDest = resolveScanPath(
        path.join(destinationDir, scan.path),
        destinationDir
      );
      if (!resolvedDest) {
        fail('Scan path escapes the destination directory');
        continue;
      }

      let files: string[];
      try {
        files = await fs.promises.readdir(resolvedSource);
      } catch (error) {
        fail(`Could not read scan source folder: ${errorMessage(error)}`);
        continue;
      }

      // metadata.json first, so it's always written (and renamed into
      // place) before any NNN.png frame from the same scan.
      files.sort((a, b) => {
        if (a === 'metadata.json') return -1;
        if (b === 'metadata.json') return 1;
        return 0;
      });

      processable.push({
        scanId: scan.id,
        resolvedSource,
        resolvedDest,
        files,
      });
    }

    const totalFiles = processable.reduce((sum, p) => sum + p.files.length, 0);
    let completedFiles = 0;
    let exportedFiles = 0;
    let exportedScans = 0;
    let skippedFiles = 0;

    // Pass 2: sequential, per-file copy. Deliberately not parallelized —
    // see this function's doc comment on why completion order matters.
    for (const entry of processable) {
      const scan = scans.find((s) => s.id === entry.scanId)!;
      await fs.promises.mkdir(entry.resolvedDest, { recursive: true });

      let scanFailureReason: string | null = null;

      for (const filename of entry.files) {
        const finalFile = path.join(entry.resolvedDest, filename);
        const tmpFile = `${finalFile}.tmp`;

        try {
          // Unconditional: a stray .tmp from an earlier crashed attempt at
          // this exact file must not linger just because this run happens
          // to skip the file (final already present some other way).
          if (await pathExists(tmpFile)) {
            await fs.promises.unlink(tmpFile);
          }

          if (await pathExists(finalFile)) {
            skippedFiles++;
          } else {
            await fs.promises.copyFile(
              path.join(entry.resolvedSource, filename),
              tmpFile
            );
            await fs.promises.rename(tmpFile, finalFile);
            exportedFiles++;
          }
        } catch (error) {
          scanFailureReason ??= errorMessage(error);
        }

        completedFiles++;
        onProgress?.({
          totalFiles,
          completedFiles,
          currentScanId: entry.scanId,
        });

        // Stop this scan's remaining files as soon as one fails — critically,
        // this is what stops a metadata.json failure from being masked by a
        // LATER frame file still copying successfully, which would produce
        // exactly the "frames present, metadata missing" state the
        // metadata-first reordering above exists to prevent. It also means a
        // mid-batch failure leaves a contiguous, diagnosable prefix of files
        // rather than scattered gaps.
        if (scanFailureReason) {
          completedFiles +=
            entry.files.length - entry.files.indexOf(filename) - 1;
          onProgress?.({
            totalFiles,
            completedFiles,
            currentScanId: entry.scanId,
          });
          break;
        }
      }

      if (scanFailureReason) {
        failedScans.push({
          scanId: scan.id,
          experimentName: scan.experiment.name,
          captureDate: scan.capture_date,
          reason: scanFailureReason,
        });
      } else {
        exportedScans++;
      }
    }

    return {
      success: true,
      data: { exportedFiles, exportedScans, skippedFiles, failedScans },
    };
  } catch (error) {
    console.error('[DB] Failed to export scans:', error);
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Soft-delete a scan (sets `deleted: true`) and keep its on-disk
 * `metadata.json` in sync with the same flag, per
 * add-cylinderscan-delete-upload-integrity's "Scan Delete IPC Handler"
 * requirement. `scan.path` can be absolute (legacy/pilot-imported scans)
 * or relative to `scansDir` — mirrors the same guard
 * `image-uploader.ts:255-257` uses for `Image.path`. A missing
 * `metadata.json` (e.g. a legacy scan captured before metadata.json
 * support existed) logs a warning but does not fail the delete.
 *
 * `markMetadataDeleted` is injected rather than imported directly: this
 * file is shared code and must not import from `cylinderscan/` (enforced
 * by `@typescript-eslint/no-restricted-imports`) — only `main.ts` (the
 * orchestrator) may import mode-specific modules, so `main.ts` supplies
 * the real implementation when it calls `registerDatabaseHandlers()`.
 */
export async function scansDelete(
  db: Db,
  id: string,
  scansDir: string,
  markMetadataDeleted: (outputDir: string) => void
): Promise<DatabaseResponse> {
  try {
    const scan = await db.scan.update({
      where: { id },
      data: { deleted: true },
    });
    logDatabaseOperation('DELETE', 'Scan', `id=${id} (soft delete)`);

    const outputDir = path.isAbsolute(scan.path)
      ? scan.path
      : path.join(scansDir, scan.path);
    try {
      markMetadataDeleted(outputDir);
    } catch (error) {
      // ENOENT is the expected, benign case: a legacy scan captured before
      // metadata.json support existed. Anything else (corrupt JSON,
      // permission denied) is a real integrity problem masked by the same
      // exception shape — log it louder so it doesn't read as routine.
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        console.warn(
          `[DB] Scan ${id}: no metadata.json found at ${outputDir} (legacy scan) — soft-delete proceeded without syncing it.`,
          error
        );
      } else {
        console.error(
          `[DB] Scan ${id}: metadata.json at ${outputDir} could not be read/updated — soft-delete proceeded, but this file may need manual attention.`,
          error
        );
      }
    }

    return { success: true, data: scan };
  } catch (error) {
    console.error('[DB] Failed to delete scan:', error);
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Checks whether a non-deleted scan already exists matching
 * `(plant_id, experiment_id, wave_number, plant_age_days)` — backs
 * `db:scans:checkDuplicate`, replacing the imprecise same-day/
 * (plant_id+experiment_id) check `getMostRecentScanDate` used to back.
 * Each of the four fields is validated independently; a malformed
 * argument returns an error rather than `{ data: false }`, since the
 * latter would read as "no duplicate" rather than "the check could not
 * run."
 */
export async function checkDuplicateScan(
  db: Db,
  plantId: string,
  experimentId: string,
  waveNumber: number,
  plantAgeDays: number
): Promise<DatabaseResponse<boolean>> {
  try {
    if (!isNonEmptyString(plantId)) {
      return { success: false, error: 'plantId must be a non-empty string' };
    }
    if (!isNonEmptyString(experimentId)) {
      return {
        success: false,
        error: 'experimentId must be a non-empty string',
      };
    }
    if (!isValidWaveNumber(waveNumber)) {
      return {
        success: false,
        error: 'waveNumber must be a non-negative integer',
      };
    }
    if (!isValidWaveNumber(plantAgeDays)) {
      return {
        success: false,
        error: 'plantAgeDays must be a non-negative integer',
      };
    }

    const scan = await db.scan.findFirst({
      where: {
        plant_id: plantId,
        experiment_id: experimentId,
        wave_number: waveNumber,
        plant_age_days: plantAgeDays,
        deleted: false,
      },
      select: { id: true },
    });

    return { success: true, data: scan !== null };
  } catch (error) {
    console.error('[DB] Failed to check for duplicate scan:', error);
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Register all database IPC handlers
 *
 * Handlers follow naming convention: db:{model}:{action}
 * All handlers return DatabaseResponse for consistent error handling
 *
 * @param deps.markMetadataDeleted - Injected by `main.ts`, since this
 * file (shared code) is not allowed to import `cylinderscan/` directly.
 * See `scansDelete()`'s doc comment.
 * @param deps.getMainWindow - Needed only by `db:scans:export`, to push
 *   progress events via `webContents.send`. Called fresh at send-time (not
 *   cached), matching `graviscan:download-images`'s convention, since the
 *   window may close mid-export.
 */
export function registerDatabaseHandlers(deps: {
  markMetadataDeleted: (outputDir: string) => void;
  getMainWindow?: () => BrowserWindow | null;
}) {
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
                images: {
                  select: {
                    id: true,
                    status: true,
                    path: true,
                    frame_number: true,
                  },
                },
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
    'db:scans:export',
    (
      _event,
      params: { scanIds: string[]; destinationDir: string }
    ): Promise<DatabaseResponse<ScansExportData>> => {
      const scansDir = getScansDir();
      const onProgress = (progress: ScansExportProgress) => {
        const win = deps.getMainWindow?.();
        if (win && !win.isDestroyed()) {
          win.webContents.send('db:scans:export-progress', progress);
        }
      };
      return scansExport(db, scansDir, params, onProgress);
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
    'db:scans:checkDuplicate',
    async (
      _event,
      plantId: string,
      experimentId: string,
      waveNumber: number,
      plantAgeDays: number
    ): Promise<DatabaseResponse<boolean>> => {
      return checkDuplicateScan(
        db,
        plantId,
        experimentId,
        waveNumber,
        plantAgeDays
      );
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
            images: {
              select: { status: true },
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
   * Count failed-status images across all non-deleted scans, regardless of
   * capture date — a date-unscoped complement to getRecent's today-only
   * scope, so a stale failed upload from a prior day still surfaces on the
   * Home dashboard (Tier 4, #104).
   */
  ipcMain.handle(
    'db:scans:getFailedUploadCount',
    async (): Promise<DatabaseResponse> => {
      try {
        const failedCount = await db.image.count({
          where: { status: 'failed', scan: { deleted: false } },
        });

        logDatabaseOperation(
          'READ',
          'Image',
          `getFailedUploadCount count=${failedCount}`
        );

        return { success: true, data: { failedCount } };
      } catch (error) {
        console.error('[DB] Failed to get failed upload count:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * Soft delete a scan by setting deleted=true, and keep metadata.json
   * on disk in sync with the same flag. Does NOT delete associated Image
   * records or any files (see scansDelete()).
   */
  ipcMain.handle(
    'db:scans:delete',
    async (_event, id: string): Promise<DatabaseResponse> => {
      return scansDelete(db, id, getScansDir(), deps.markMetadataDeleted);
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
    (_event, experimentId, scannerId, waveNumber) =>
      graviscanPlateAssignmentsList(db, experimentId, scannerId, waveNumber)
  );
  ipcMain.handle(
    'db:graviscanPlateAssignments:upsertMany',
    (_event, experimentId, scannerId, assignments, waveNumber) =>
      graviscanPlateAssignmentsUpsertMany(
        db,
        experimentId,
        scannerId,
        assignments,
        waveNumber
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
