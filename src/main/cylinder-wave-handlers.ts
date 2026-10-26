/**
 * CylinderScan wave sowing dates (#407). Capture Scan calculates the plant age
 * from the wave's sowing date, so the date is checked here as well as in the
 * renderer: a future date is refused; a date out of order with another wave's, or
 * a wave number that skips ahead, needs a note; what the date is (its
 * basis: transfer, sowing, germination or other) is required; and once a wave has
 * scans, its date or basis only changes with a reason, recorded with the old and
 * new date.
 * Saved scans keep the age they were saved with.
 */

import type { IpcMain } from 'electron';
import type { DatabaseResponse } from '../types/database';
import type {
  CylinderWaveCreateInput,
  CylinderWaveDateChangeInput,
  CylinderWaveInfo,
} from '../types/cylinder-wave';
import {
  MAX_REASON_LENGTH,
  checkNewWave,
  checkSowingDateChange,
} from '../utils/sowing-date';
import { startDateBasisError } from '../utils/start-date-basis';

import type { CylinderWaveDbLike, WaveRow } from './cylinder-wave-db';

export type {
  CylinderWaveDbLike,
  CylinderWaveTxLike,
} from './cylinder-wave-db';

export interface CylinderWaveDeps {
  db: CylinderWaveDbLike;
  /** Today's date; injectable for tests. */
  now?: () => Date;
}

function fail(error: unknown): DatabaseResponse<never> {
  console.error('[CylinderWave]', error);
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
  };
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const PHENOTYPER_REQUIRED = 'Choose the phenotyper first.';

/** The basis as saved: its description only for "other". */
function basisFields(input: {
  startDateBasis: string;
  startDateBasisOther?: string;
}): { start_date_basis: string; start_date_basis_other: string | null } {
  return {
    start_date_basis: input.startDateBasis,
    start_date_basis_other:
      input.startDateBasis === 'other'
        ? trimmed(input.startDateBasisOther)
        : null,
  };
}

/**
 * Who set or changed a date with no phenotyper: only the start-date backfill, run by an
 * admin (Capture Scan always needs a phenotyper).
 */
export const SET_BY_ADMIN = 'admin';

/**
 * The phenotyper setting or changing a date: required and must exist, so the
 * log can always say who. Returns an error message, or null when it's fine.
 */
async function phenotyperError(
  db: CylinderWaveDbLike,
  phenotyperId: string
): Promise<string | null> {
  if (!phenotyperId) return PHENOTYPER_REQUIRED;
  const found = await db.phenotyper.findMany({
    where: { id: { in: [phenotyperId] } },
    select: { id: true, name: true },
  });
  return found.length > 0 ? null : 'That phenotyper no longer exists.';
}

async function withScanCounts(
  db: CylinderWaveDbLike,
  rows: WaveRow[]
): Promise<CylinderWaveInfo[]> {
  const changes =
    rows.length > 0
      ? await db.cylinderWaveSowingDateChange.findMany({
          where: { wave_id: { in: rows.map((r) => r.id) } },
          orderBy: { changedAt: 'asc' },
        })
      : [];
  const ids = [
    ...new Set(
      [
        ...rows.map((r) => r.set_by_phenotyper_id),
        ...changes.map((c) => c.changed_by_phenotyper_id),
      ].filter((id): id is string => !!id)
    ),
  ];
  const names = new Map(
    ids.length > 0
      ? (
          await db.phenotyper.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true },
          })
        ).map((p) => [p.id, p.name])
      : []
  );
  // One query for every wave's live scans, rather than one per wave.
  const counts =
    rows.length > 0
      ? await db.scan.groupBy({
          by: ['experiment_id', 'wave_number'],
          where: {
            experiment_id: {
              in: [...new Set(rows.map((r) => r.experiment_id))],
            },
            wave_number: { in: [...new Set(rows.map((r) => r.wave_number))] },
            deleted: false,
          },
          _count: { _all: true },
        })
      : [];
  const scanCount = (row: WaveRow) =>
    counts.find(
      (c) =>
        c.experiment_id === row.experiment_id &&
        c.wave_number === row.wave_number
    )?._count._all ?? 0;
  return rows.map((row) => ({
    id: row.id,
    wave_number: row.wave_number,
    sowing_date: row.sowing_date,
    start_date_basis: row.start_date_basis,
    start_date_basis_other: row.start_date_basis_other,
    note: row.note,
    set_by_name: row.set_by_phenotyper_id
      ? (names.get(row.set_by_phenotyper_id) ?? null)
      : SET_BY_ADMIN,
    set_at: row.updatedAt.toISOString(),
    changes: changes
      .filter((c) => c.wave_id === row.id)
      .map((c) => ({
        id: c.id,
        old_sowing_date: c.old_sowing_date,
        new_sowing_date: c.new_sowing_date,
        start_date_basis: c.start_date_basis,
        start_date_basis_other: c.start_date_basis_other,
        reason: c.reason,
        changed_by_name: c.changed_by_phenotyper_id
          ? (names.get(c.changed_by_phenotyper_id) ?? null)
          : SET_BY_ADMIN,
        changed_at: c.changedAt.toISOString(),
      })),
    scanCount: scanCount(row),
  }));
}

export async function listWaves(
  deps: CylinderWaveDeps,
  experimentId: string
): Promise<DatabaseResponse<CylinderWaveInfo[]>> {
  if (!trimmed(experimentId)) {
    return { success: false, error: 'experimentId must be a non-empty string' };
  }
  try {
    const rows = await deps.db.cylinderWave.findMany({
      where: { experiment_id: experimentId },
      orderBy: { wave_number: 'asc' },
    });
    return { success: true, data: await withScanCounts(deps.db, rows) };
  } catch (error) {
    return fail(error);
  }
}

export async function createWave(
  deps: CylinderWaveDeps,
  input: CylinderWaveCreateInput
): Promise<DatabaseResponse<CylinderWaveInfo>> {
  const experimentId = trimmed(input?.experimentId);
  const note = trimmed(input?.note);
  const phenotyperId = trimmed(input?.phenotyperId);
  if (!experimentId) {
    return { success: false, error: 'experimentId must be a non-empty string' };
  }
  if (!isNonNegativeInteger(input.waveNumber)) {
    return {
      success: false,
      error: 'waveNumber must be a non-negative integer',
    };
  }
  if (note.length > MAX_REASON_LENGTH) {
    return {
      success: false,
      error: `Keep the note under ${MAX_REASON_LENGTH} characters.`,
    };
  }
  const basisError = startDateBasisError(
    input.startDateBasis,
    input.startDateBasisOther
  );
  if (basisError) return { success: false, error: basisError };
  const basis = basisFields(input);
  try {
    const who = await phenotyperError(deps.db, phenotyperId);
    if (who) return { success: false, error: who };
    const existing = await deps.db.cylinderWave.findMany({
      where: { experiment_id: experimentId },
      orderBy: { wave_number: 'asc' },
    });
    if (existing.some((w) => w.wave_number === input.waveNumber)) {
      return {
        success: false,
        error: `Wave ${input.waveNumber} already has a start date.`,
      };
    }
    const check = checkNewWave(
      input.waveNumber,
      input.sowingDate,
      existing,
      (deps.now ?? (() => new Date()))()
    );
    if (check.error) return { success: false, error: check.error };
    if (check.noteNeeded && !note)
      return { success: false, error: check.noteNeeded };
    // The first date is logged too, so the history shows who set it and when.
    const row = await deps.db.$transaction(async (tx) => {
      const created = await tx.cylinderWave.create({
        data: {
          experiment_id: experimentId,
          wave_number: input.waveNumber,
          sowing_date: input.sowingDate,
          ...basis,
          note: note || null,
          set_by_phenotyper_id: phenotyperId,
        },
      });
      await tx.cylinderWaveSowingDateChange.create({
        data: {
          wave_id: created.id,
          old_sowing_date: null,
          new_sowing_date: input.sowingDate,
          ...basis,
          reason: note || null,
          changed_by_phenotyper_id: phenotyperId,
        },
      });
      return created;
    });
    const [info] = await withScanCounts(deps.db, [row]);
    return { success: true, data: info };
  } catch (error) {
    return fail(error);
  }
}

export async function changeSowingDate(
  deps: CylinderWaveDeps,
  input: CylinderWaveDateChangeInput
): Promise<DatabaseResponse<CylinderWaveInfo>> {
  const waveId = trimmed(input?.waveId);
  const reason = trimmed(input?.reason);
  const phenotyperId = trimmed(input?.phenotyperId);
  if (!waveId)
    return { success: false, error: 'waveId must be a non-empty string' };
  const basisError = startDateBasisError(
    input.startDateBasis,
    input.startDateBasisOther
  );
  if (basisError) return { success: false, error: basisError };
  const basis = basisFields(input);
  try {
    const wave = await deps.db.cylinderWave.findUnique({
      where: { id: waveId },
    });
    if (!wave) return { success: false, error: 'That wave no longer exists.' };
    const who = await phenotyperError(deps.db, phenotyperId);
    if (who) return { success: false, error: who };
    const [current] = await withScanCounts(deps.db, [wave]);
    const others = (
      await deps.db.cylinderWave.findMany({
        where: { experiment_id: wave.experiment_id },
        orderBy: { wave_number: 'asc' },
      })
    ).filter((w) => w.id !== wave.id);
    const { saveError } = checkSowingDateChange(
      {
        waveNumber: wave.wave_number,
        currentDate: wave.sowing_date,
        newDate: input.sowingDate,
        reason,
        waveHasScans: current.scanCount > 0,
        basisChanged:
          basis.start_date_basis !== wave.start_date_basis ||
          basis.start_date_basis_other !== wave.start_date_basis_other,
      },
      others,
      (deps.now ?? (() => new Date()))()
    );
    if (saveError) return { success: false, error: saveError };

    const updated = await deps.db.$transaction(async (tx) => {
      await tx.cylinderWaveSowingDateChange.create({
        data: {
          wave_id: wave.id,
          old_sowing_date: wave.sowing_date,
          new_sowing_date: input.sowingDate,
          ...basis,
          reason: reason || null,
          changed_by_phenotyper_id: phenotyperId,
        },
      });
      // "Set by" follows the latest change; the change table keeps the history.
      return tx.cylinderWave.update({
        where: { id: wave.id },
        data: {
          sowing_date: input.sowingDate,
          ...basis,
          set_by_phenotyper_id: phenotyperId,
        },
      });
    });
    const [info] = await withScanCounts(deps.db, [updated]);
    return { success: true, data: info };
  } catch (error) {
    return fail(error);
  }
}

export function registerCylinderWaveHandlers(
  deps: CylinderWaveDeps & { ipcMain: Pick<IpcMain, 'handle'> }
): void {
  deps.ipcMain.handle('db:cylinderWaves:list', (_event, experimentId: string) =>
    listWaves(deps, experimentId)
  );
  deps.ipcMain.handle(
    'db:cylinderWaves:create',
    (_event, input: CylinderWaveCreateInput) => createWave(deps, input)
  );
  deps.ipcMain.handle(
    'db:cylinderWaves:changeSowingDate',
    (_event, input: CylinderWaveDateChangeInput) =>
      changeSowingDate(deps, input)
  );
}
