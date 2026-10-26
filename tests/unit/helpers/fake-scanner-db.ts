/**
 * The database the CylinderScan scanner sees in tests: one experiment ("exp-001") whose
 * wave 1 germinated `ageDays` days ago, so a plant scanned today is that many days old.
 * The scanner checks the age against it and saves the scan under the plant's row,
 * created at its first scan, in a transaction.
 */

import { vi } from 'vitest';
import { toIsoDate } from '../../../src/utils/wave-dates';

export function daysAgoIso(days: number): string {
  const now = new Date();
  return toIsoDate(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - days)
  );
}

export function fakeScannerDb(
  scanCreate: (args: unknown) => unknown,
  ageDays = 14
) {
  const db = {
    scan: { create: scanCreate },
    cylinderWave: {
      findMany: vi.fn(async () => [
        {
          id: 'wave-1',
          experiment_id: 'exp-001',
          wave_number: 1,
          dates_per_plant: false,
          germination_date: daysAgoIso(ageDays),
          sowing_date: daysAgoIso(ageDays + 3),
          transfer_date: null,
          note: null,
          set_by_phenotyper_id: 'phenotyper-001',
          updatedAt: new Date(),
        },
      ]),
    },
    cylinderPlant: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'plant-1',
        ...data,
      })),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  return db;
}
