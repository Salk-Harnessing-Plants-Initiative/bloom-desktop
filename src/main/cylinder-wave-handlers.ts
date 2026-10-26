/**
 * CylinderScan wave dates (#407, #428): each wave's sowing, germination and
 * transfer-to-cylinder dates. Capture Scan computes the plant age from the
 * germination date, so the dates are checked here as well as in the renderer:
 * germination and sowing are required and not in the future, sowing is on or
 * before germination, a germination date out of order with another wave's (or a
 * wave number that skips ahead) needs a note, and once a wave has scans its dates
 * only change with a reason. Every set and change is logged with the dates before
 * and after. Saved scans keep the age they were saved with.
 */

import type { IpcMain } from 'electron';
import type { DatabaseResponse } from '../types/database';
import type {
  CylinderWaveCreateInput,
  CylinderWaveDateChangeInput,
  CylinderWaveInfo,
  WaveDatesInput,
} from '../types/cylinder-wave';
import {
  MAX_REASON_LENGTH,
  checkNewWave,
  checkWaveDateChange,
  storedWaveDates,
  type WaveDates,
} from '../utils/wave-dates';

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

/** The dates as the renderer sent them, trimmed. */
function enteredDates(input: Partial<WaveDatesInput>): WaveDates {
  return {
    germination: trimmed(input?.germinationDate),
    sowing: trimmed(input?.sowingDate),
    transfer: trimmed(input?.transferDate),
  };
}

/** The dates as saved: a transfer date on the germination day is stored as null ("same day"). */
function datesToSave(dates: WaveDates): {
  germination_date: string;
  sowing_date: string;
  transfer_date: string | null;
} {
  return {
    germination_date: dates.germination,
    sowing_date: dates.sowing,
    transfer_date:
      dates.transfer && dates.transfer !== dates.germination
        ? dates.transfer
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
      ? await db.cylinderWaveDateChange.findMany({
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
    germination_date: row.germination_date,
    sowing_date: row.sowing_date,
    transfer_date: row.transfer_date,
    note: row.note,
    set_by_name: row.set_by_phenotyper_id
      ? (names.get(row.set_by_phenotyper_id) ?? null)
      : SET_BY_ADMIN,
    set_at: row.updatedAt.toISOString(),
    changes: changes
      .filter((c) => c.wave_id === row.id)
      .map((c) => ({
        id: c.id,
        old_germination_date: c.old_germination_date,
        new_germination_date: c.new_germination_date,
        old_sowing_date: c.old_sowing_date,
        new_sowing_date: c.new_sowing_date,
        old_transfer_date: c.old_transfer_date,
        new_transfer_date: c.new_transfer_date,
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
  const dates = enteredDates(input);
  const toSave = datesToSave(dates);
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
        error: `Wave ${input.waveNumber} already has its dates.`,
      };
    }
    const check = checkNewWave(
      input.waveNumber,
      dates,
      existing,
      (deps.now ?? (() => new Date()))()
    );
    if (check.error) return { success: false, error: check.error };
    if (check.noteNeeded && !note)
      return { success: false, error: check.noteNeeded };
    // The first dates are logged too, so the history shows who set them and when.
    const row = await deps.db.$transaction(async (tx) => {
      const created = await tx.cylinderWave.create({
        data: {
          experiment_id: experimentId,
          wave_number: input.waveNumber,
          ...toSave,
          note: note || null,
          set_by_phenotyper_id: phenotyperId,
        },
      });
      await tx.cylinderWaveDateChange.create({
        data: {
          wave_id: created.id,
          old_germination_date: null,
          new_germination_date: toSave.germination_date,
          old_sowing_date: null,
          new_sowing_date: toSave.sowing_date,
          old_transfer_date: null,
          new_transfer_date: toSave.transfer_date,
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

export async function changeDates(
  deps: CylinderWaveDeps,
  input: CylinderWaveDateChangeInput
): Promise<DatabaseResponse<CylinderWaveInfo>> {
  const waveId = trimmed(input?.waveId);
  const reason = trimmed(input?.reason);
  const phenotyperId = trimmed(input?.phenotyperId);
  if (!waveId)
    return { success: false, error: 'waveId must be a non-empty string' };
  const dates = enteredDates(input);
  const toSave = datesToSave(dates);
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
    const { saveError } = checkWaveDateChange(
      {
        waveNumber: wave.wave_number,
        current: storedWaveDates(wave),
        next: storedWaveDates(toSave),
        reason,
        waveHasScans: current.scanCount > 0,
      },
      others,
      (deps.now ?? (() => new Date()))()
    );
    if (saveError) return { success: false, error: saveError };

    const updated = await deps.db.$transaction(async (tx) => {
      await tx.cylinderWaveDateChange.create({
        data: {
          wave_id: wave.id,
          old_germination_date: wave.germination_date,
          new_germination_date: toSave.germination_date,
          old_sowing_date: wave.sowing_date,
          new_sowing_date: toSave.sowing_date,
          old_transfer_date: wave.transfer_date,
          new_transfer_date: toSave.transfer_date,
          reason: reason || null,
          changed_by_phenotyper_id: phenotyperId,
        },
      });
      // "Set by" follows the latest change; the change table keeps the history.
      return tx.cylinderWave.update({
        where: { id: wave.id },
        data: {
          ...toSave,
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
    'db:cylinderWaves:changeDates',
    (_event, input: CylinderWaveDateChangeInput) => changeDates(deps, input)
  );
}
