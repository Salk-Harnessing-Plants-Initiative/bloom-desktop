/**
 * The database the CylinderScan scanner sees in tests: one experiment ("exp-001") whose
 * wave 1 germinated `ageDays` days ago, so a plant scanned today is that many days old.
 * The scanner checks the age against it and saves the scan under the plant's row,
 * created at its first scan, in a transaction that keeps its writes only if it
 * succeeds (so a plant row written outside it is caught).
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
  /** Plant rows and their change log, as committed. */
  const saved = {
    plants: [] as Record<string, unknown>[],
    plantChanges: [] as Record<string, unknown>[],
  };
  /** The writes the scanner makes, on the given tables. */
  const writesTo = (t: typeof saved) => ({
    scan: { create: scanCreate },
    cylinderPlant: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: 'plant-1', ...data };
        t.plants.push(row);
        return row;
      }),
    },
    cylinderPlantDateChange: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        t.plantChanges.push(data);
        return data;
      }),
    },
  });
  /** The last transaction's client, to check the writes it made. */
  let tx = writesTo(saved);
  const outside = writesTo(saved);
  const db = {
    saved,
    get tx() {
      return tx;
    },
    scan: outside.scan,
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
      create: outside.cylinderPlant.create,
    },
    cylinderPlantDateChange: outside.cylinderPlantDateChange,
    // Like Prisma's: its writes are kept only if the whole callback succeeds.
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      const pending: typeof saved = { plants: [], plantChanges: [] };
      tx = writesTo(pending);
      const result = await fn(tx);
      saved.plants.push(...pending.plants);
      saved.plantChanges.push(...pending.plantChanges);
      return result;
    }),
  };
  return db;
}
