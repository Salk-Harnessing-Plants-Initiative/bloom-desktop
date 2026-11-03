/**
 * An experiment's camera settings (#483). A change adds a row, so the rows are the
 * history and the newest is what scans use. Capture Scan asks for a check when the
 * current settings weren't confirmed today by the phenotyper now scanning; confirming
 * unchanged values only updates the row's last check. A change needs a note, except
 * for an experiment's first settings.
 */

import type { IpcMain } from 'electron';
import type { DatabaseResponse } from '../types/database';
import type {
  CameraSettingsReference,
  CameraValues,
  ConfirmCameraSettingsInput,
  ExperimentCameraSettingsInfo,
  ExperimentCameraSettingsStatus,
} from '../types/experiment-camera-settings';
import { INITIAL_SETTINGS_NOTE } from '../types/experiment-camera-settings';
import {
  NOTE_REQUIRED,
  SETTINGS_CHANGED_MEANWHILE,
  cameraValuesError,
  referenceList,
  sameCameraValues,
  sameLocalDay,
} from '../utils/experiment-camera-settings';
import { MAX_REASON_LENGTH } from '../utils/wave-dates';
import {
  phenotyperError,
  phenotyperNames,
  trimmed,
} from './cylinder-dates-common';

function fail(error: unknown): DatabaseResponse<never> {
  console.error('[ExperimentCameraSettings]', error);
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
  };
}

export interface SettingsRow extends CameraValues {
  id: string;
  experiment_id: string;
  note: string;
  set_by_phenotyper_id: string | null;
  createdAt: Date;
  last_confirmed_at: Date | null;
  last_confirmed_by_phenotyper_id: string | null;
}

interface ScanGroupRow extends CameraValues {
  _count: { _all: number };
  _min: { capture_date: Date | null };
  _max: { capture_date: Date | null };
}

type SettingsCreateData = CameraValues & {
  experiment_id: string;
  note: string;
  set_by_phenotyper_id: string;
  last_confirmed_at: Date;
  last_confirmed_by_phenotyper_id: string;
};

interface SettingsTable {
  findMany(args: {
    where: { experiment_id: string };
    orderBy: Array<{ createdAt: 'desc' } | { id: 'desc' }>;
    take?: number;
  }): Promise<SettingsRow[]>;
  create(args: { data: SettingsCreateData }): Promise<SettingsRow>;
  update(args: {
    where: { id: string };
    data: { last_confirmed_at: Date; last_confirmed_by_phenotyper_id: string };
  }): Promise<SettingsRow>;
}

/** The part of the Prisma client these handlers use, so tests can pass a fake. */
export interface CameraSettingsDbLike {
  experiment: {
    findUnique(args: {
      where: { id: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  phenotyper: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; name: true };
    }): Promise<Array<{ id: string; name: string }>>;
  };
  scan: {
    groupBy(args: {
      by: ['exposure_time', 'gain', 'gamma'];
      where: {
        experiment_id: string;
        deleted: false;
        exposure_time: { gt: 0 };
      };
      _count: { _all: true };
      _min: { capture_date: true };
      _max: { capture_date: true };
    }): Promise<ScanGroupRow[]>;
    findFirst(args: {
      where: CameraValues & { experiment_id: string; deleted: false };
      orderBy: { capture_date: 'desc' };
      select: {
        images: {
          orderBy: { frame_number: 'asc' };
          take: 1;
          select: { path: true };
        };
      };
    }): Promise<{ images: Array<{ path: string }> } | null>;
  };
  experimentCameraSettings: SettingsTable;
  $transaction<T>(
    fn: (tx: { experimentCameraSettings: SettingsTable }) => Promise<T>
  ): Promise<T>;
}

export interface CameraSettingsDeps {
  db: CameraSettingsDbLike;
  /** The current time; injectable for tests. */
  now?: () => Date;
}

const NEWEST_FIRST: Array<{ createdAt: 'desc' } | { id: 'desc' }> = [
  { createdAt: 'desc' },
  { id: 'desc' },
];

function values(row: CameraValues): CameraValues {
  return {
    exposure_time: row.exposure_time,
    gain: row.gain,
    gamma: row.gamma,
  };
}

async function infos(
  db: CameraSettingsDbLike,
  rows: SettingsRow[]
): Promise<ExperimentCameraSettingsInfo[]> {
  const nameOf = await phenotyperNames(db, [
    ...rows.map((r) => r.set_by_phenotyper_id),
    ...rows.map((r) => r.last_confirmed_by_phenotyper_id),
  ]);
  return rows.map((row) => ({
    id: row.id,
    ...values(row),
    note: row.note,
    set_by_name: nameOf(row.set_by_phenotyper_id),
    created_at: row.createdAt.toISOString(),
    last_confirmed_at: row.last_confirmed_at?.toISOString() ?? null,
    last_confirmed_by_name: row.last_confirmed_by_phenotyper_id
      ? nameOf(row.last_confirmed_by_phenotyper_id)
      : null,
  }));
}

function newestRows(
  db: CameraSettingsDbLike,
  experimentId: string,
  take: number
) {
  return db.experimentCameraSettings.findMany({
    where: { experiment_id: experimentId },
    orderBy: NEWEST_FIRST,
    take,
  });
}

/** The current settings and whether `phenotyperId` must check them before scanning. */
export async function getStatus(
  deps: CameraSettingsDeps,
  experimentId: string,
  phenotyperId: string
): Promise<DatabaseResponse<ExperimentCameraSettingsStatus>> {
  const experiment = trimmed(experimentId);
  const phenotyper = trimmed(phenotyperId);
  if (!experiment) {
    return { success: false, error: 'experimentId must be a non-empty string' };
  }
  try {
    const [currentRow, previousRow] = await newestRows(deps.db, experiment, 2);
    if (!currentRow) {
      return {
        success: true,
        data: { current: null, confirmedToday: false, changedToday: null },
      };
    }
    const now = (deps.now ?? (() => new Date()))();
    const [current] = await infos(deps.db, [currentRow]);
    const confirmedToday =
      !!phenotyper &&
      currentRow.last_confirmed_at !== null &&
      sameLocalDay(currentRow.last_confirmed_at, now) &&
      currentRow.last_confirmed_by_phenotyper_id === phenotyper;
    // Rows copied from scans at install have no one to name: they aren't a change.
    const changedByOther =
      currentRow.set_by_phenotyper_id !== null &&
      currentRow.set_by_phenotyper_id !== phenotyper &&
      sameLocalDay(currentRow.createdAt, now);
    return {
      success: true,
      data: {
        current,
        confirmedToday,
        changedToday: changedByOther
          ? {
              by_name: current.set_by_name,
              at: current.created_at,
              from: previousRow ? values(previousRow) : null,
              to: values(currentRow),
              note: currentRow.note,
            }
          : null,
      },
    };
  } catch (error) {
    return fail(error);
  }
}

/** Every saved setting, newest first, with who set and last checked it. */
export async function listHistory(
  deps: CameraSettingsDeps,
  experimentId: string
): Promise<DatabaseResponse<ExperimentCameraSettingsInfo[]>> {
  const experiment = trimmed(experimentId);
  if (!experiment) {
    return { success: false, error: 'experimentId must be a non-empty string' };
  }
  try {
    const rows = await deps.db.experimentCameraSettings.findMany({
      where: { experiment_id: experiment },
      orderBy: NEWEST_FIRST,
    });
    return { success: true, data: await infos(deps.db, rows) };
  } catch (error) {
    return fail(error);
  }
}

/** "Used before in this experiment": each setting its live scans used, and saved ones. */
export async function listReference(
  deps: CameraSettingsDeps,
  experimentId: string
): Promise<DatabaseResponse<CameraSettingsReference[]>> {
  const experiment = trimmed(experimentId);
  if (!experiment) {
    return { success: false, error: 'experimentId must be a non-empty string' };
  }
  try {
    const groups = await deps.db.scan.groupBy({
      by: ['exposure_time', 'gain', 'gamma'],
      // Deleted scans aren't uploaded; 0 / 0 are deploy self-tests.
      where: {
        experiment_id: experiment,
        deleted: false,
        exposure_time: { gt: 0 },
      },
      _count: { _all: true },
      _min: { capture_date: true },
      _max: { capture_date: true },
    });
    // One small query per setting for its latest scan's first frame; an experiment
    // has a handful of settings, not one per scan.
    const latest = await Promise.all(
      groups.map((g) =>
        deps.db.scan.findFirst({
          where: { experiment_id: experiment, deleted: false, ...values(g) },
          orderBy: { capture_date: 'desc' },
          select: {
            images: {
              orderBy: { frame_number: 'asc' },
              take: 1,
              select: { path: true },
            },
          },
        })
      )
    );
    const saved = await deps.db.experimentCameraSettings.findMany({
      where: { experiment_id: experiment },
      orderBy: NEWEST_FIRST,
    });
    return {
      success: true,
      data: referenceList(
        groups.flatMap((g, i) =>
          g._min.capture_date && g._max.capture_date
            ? [
                {
                  ...values(g),
                  scan_count: g._count._all,
                  first_captured: g._min.capture_date,
                  last_captured: g._max.capture_date,
                  latest_image_path: latest[i]?.images[0]?.path ?? null,
                },
              ]
            : []
        ),
        saved.map((r) => ({ ...values(r), created_at: r.createdAt })),
        saved[0] ? values(saved[0]) : null
      ),
    };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Confirm and continue. Unchanged values update the current row's last check; changed
 * values add a row, already checked, and need a note unless they are the first.
 */
export async function confirmSettings(
  deps: CameraSettingsDeps,
  input: ConfirmCameraSettingsInput
): Promise<DatabaseResponse<ExperimentCameraSettingsStatus>> {
  const experimentId = trimmed(input?.experimentId);
  const phenotyperId = trimmed(input?.phenotyperId);
  const note = trimmed(input?.note);
  if (!experimentId) {
    return { success: false, error: 'experimentId must be a non-empty string' };
  }
  const entered: CameraValues = {
    exposure_time: input.exposure_time,
    gain: input.gain,
    gamma: input.gamma,
  };
  const invalid = cameraValuesError(entered);
  if (invalid) return { success: false, error: invalid };
  if (note.length > MAX_REASON_LENGTH) {
    return {
      success: false,
      error: `Keep the note under ${MAX_REASON_LENGTH} characters.`,
    };
  }
  try {
    const who = await phenotyperError(deps.db, phenotyperId);
    if (who) return { success: false, error: who };
    const experiment = await deps.db.experiment.findUnique({
      where: { id: experimentId },
      select: { id: true },
    });
    if (!experiment) {
      return { success: false, error: 'That experiment no longer exists.' };
    }
    const now = (deps.now ?? (() => new Date()))();
    const saved = await deps.db.$transaction(async (tx) => {
      const [current] = await tx.experimentCameraSettings.findMany({
        where: { experiment_id: experimentId },
        orderBy: NEWEST_FIRST,
        take: 1,
      });
      if ((current?.id ?? null) !== (input.currentSettingsId ?? null)) {
        return SETTINGS_CHANGED_MEANWHILE;
      }
      if (current && sameCameraValues(current, entered)) {
        await tx.experimentCameraSettings.update({
          where: { id: current.id },
          data: {
            last_confirmed_at: now,
            last_confirmed_by_phenotyper_id: phenotyperId,
          },
        });
        return null;
      }
      if (current && !note) return NOTE_REQUIRED;
      await tx.experimentCameraSettings.create({
        data: {
          experiment_id: experimentId,
          ...entered,
          note: note || INITIAL_SETTINGS_NOTE,
          set_by_phenotyper_id: phenotyperId,
          last_confirmed_at: now,
          last_confirmed_by_phenotyper_id: phenotyperId,
        },
      });
      return null;
    });
    if (saved) return { success: false, error: saved };
    return getStatus(deps, experimentId, phenotyperId);
  } catch (error) {
    return fail(error);
  }
}

export function registerExperimentCameraSettingsHandlers(
  deps: CameraSettingsDeps & { ipcMain: Pick<IpcMain, 'handle'> }
): void {
  deps.ipcMain.handle(
    'db:experimentCameraSettings:status',
    (_event, experimentId: string, phenotyperId: string) =>
      getStatus(deps, experimentId, phenotyperId)
  );
  deps.ipcMain.handle(
    'db:experimentCameraSettings:history',
    (_event, experimentId: string) => listHistory(deps, experimentId)
  );
  deps.ipcMain.handle(
    'db:experimentCameraSettings:reference',
    (_event, experimentId: string) => listReference(deps, experimentId)
  );
  deps.ipcMain.handle(
    'db:experimentCameraSettings:confirm',
    (_event, input: ConfirmCameraSettingsInput) => confirmSettings(deps, input)
  );
}
