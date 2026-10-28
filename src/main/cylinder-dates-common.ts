/**
 * Helpers shared by the CylinderScan wave and plant date handlers (#407, #428).
 */

import type { DatabaseResponse } from '../types/database';
import type { WaveDatesInput } from '../types/cylinder-wave';
import type { WaveDates } from '../utils/wave-dates';
import type { CylinderWaveDbLike, DateColumns } from './cylinder-wave-db';

export const PHENOTYPER_REQUIRED = 'Choose the phenotyper first.';

/**
 * Who set or changed dates with no phenotyper: only the backfill, run by an admin
 * (Capture Scan always needs a phenotyper).
 */
export const SET_BY_ADMIN = 'admin';

export function fail(error: unknown): DatabaseResponse<never> {
  console.error('[CylinderWave]', error);
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
  };
}

export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** The dates as the renderer sent them, trimmed. */
export function enteredDates(input: Partial<WaveDatesInput>): WaveDates {
  return {
    germination: trimmed(input?.germinationDate),
    sowing: trimmed(input?.sowingDate),
    transfer: trimmed(input?.transferDate),
  };
}

/** The dates as saved: a transfer date on the germination day is stored as null ("same day"). */
export function datesToSave(dates: WaveDates): DateColumns {
  return {
    germination_date: dates.germination,
    sowing_date: dates.sowing || null,
    transfer_date:
      dates.transfer && dates.transfer !== dates.germination
        ? dates.transfer
        : null,
  };
}

/**
 * The phenotyper setting or changing dates: required and must exist, so the log can
 * always say who. Returns an error message, or null when it's fine.
 */
export async function phenotyperError(
  db: Pick<CylinderWaveDbLike, 'phenotyper'>,
  phenotyperId: string
): Promise<string | null> {
  if (!phenotyperId) return PHENOTYPER_REQUIRED;
  const found = await db.phenotyper.findMany({
    where: { id: { in: [phenotyperId] } },
    select: { id: true, name: true },
  });
  return found.length > 0 ? null : 'That phenotyper no longer exists.';
}

/** Phenotyper names by id, for "set by" and the logs; a null id is the backfill (admin). */
export async function phenotyperNames(
  db: Pick<CylinderWaveDbLike, 'phenotyper'>,
  ids: (string | null)[]
): Promise<(id: string | null) => string | null> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  const names = new Map(
    wanted.length > 0
      ? (
          await db.phenotyper.findMany({
            where: { id: { in: wanted } },
            select: { id: true, name: true },
          })
        ).map((p) => [p.id, p.name])
      : []
  );
  return (id) => (id ? (names.get(id) ?? null) : SET_BY_ADMIN);
}
