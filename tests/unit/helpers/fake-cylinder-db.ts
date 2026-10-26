/**
 * An in-memory fake of the tables the CylinderScan wave and plant handlers use
 * (CylinderWave, its change log, CylinderPlant, its change log, Scan counts and
 * Phenotyper), with a $transaction that applies writes directly.
 */

import { vi } from 'vitest';
import type { CylinderWaveDbLike } from '../../../src/main/cylinder-wave-db';

export interface FakeWave {
  id: string;
  experiment_id: string;
  wave_number: number;
  dates_per_plant: boolean;
  germination_date: string | null;
  sowing_date: string | null;
  transfer_date: string | null;
  note: string | null;
  set_by_phenotyper_id: string | null;
  updatedAt: Date;
}

export interface FakePlant {
  id: string;
  wave_id: string;
  plant_barcode: string;
  germination_date: string;
  sowing_date: string | null;
  transfer_date: string | null;
  uses_wave_dates: boolean;
  reason: string | null;
  set_by_phenotyper_id: string | null;
  updatedAt: Date;
}

export const SET_AT = new Date(2026, 0, 2, 9);
export const EDITED_AT = new Date(2026, 2, 10, 12);
export const phenotypers = [
  { id: 'ph-1', name: 'Demo Phenotyper' },
  { id: 'ph-2', name: 'Second Phenotyper' },
];

export function fakeCylinderDb(
  rows: FakeWave[],
  /** Saved scans per wave number. */
  scanCounts: Record<number, number> = {},
  plants: FakePlant[] = [],
  /** Saved scans per plant id. */
  plantScanCounts: Record<string, number> = {}
) {
  const changes: Record<string, unknown>[] = [];
  const plantChanges: Record<string, unknown>[] = [];
  const createWaveRow = vi.fn(async ({ data }) => {
    const row = { id: `w${rows.length + 1}`, ...data, updatedAt: SET_AT };
    rows.push(row);
    return row;
  });
  const plantKey =
    (where: {
      wave_id_plant_barcode: { wave_id: string; plant_barcode: string };
    }) =>
    (p: FakePlant) =>
      p.wave_id === where.wave_id_plant_barcode.wave_id &&
      p.plant_barcode === where.wave_id_plant_barcode.plant_barcode;
  const createPlant = vi.fn(async ({ data }) => {
    const row = { id: `p${plants.length + 1}`, ...data, updatedAt: EDITED_AT };
    plants.push(row);
    return row;
  });
  const tx = {
    cylinderWave: {
      create: createWaveRow,
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = rows.find((r) => r.id === where.id)!;
        Object.assign(row, data, { updatedAt: EDITED_AT });
        return row;
      },
    },
    cylinderWaveDateChange: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        changes.push({ id: `c${changes.length + 1}`, ...data });
        return data;
      },
    },
    cylinderPlant: {
      create: createPlant,
      update: vi.fn(async ({ where, data }) => {
        const row = plants.find(plantKey(where))!;
        Object.assign(row, data, { updatedAt: EDITED_AT });
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        const matching = plants.filter(
          (p) => p.wave_id === where.wave_id && p.uses_wave_dates
        );
        matching.forEach((p) => Object.assign(p, data));
        return { count: matching.length };
      }),
    },
    cylinderPlantDateChange: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        plantChanges.push({ id: `pc${plantChanges.length + 1}`, ...data });
        return data;
      },
    },
  };
  const db = {
    cylinderWave: {
      findMany: vi.fn(async ({ where }) =>
        rows
          .filter((r) => r.experiment_id === where.experiment_id)
          .sort((a, b) => a.wave_number - b.wave_number)
      ),
      findUnique: vi.fn(
        async ({ where }) => rows.find((r) => r.id === where.id) ?? null
      ),
      create: createWaveRow,
    },
    scan: {
      groupBy: vi.fn(async ({ where }) =>
        Object.entries(scanCounts)
          .map(([wave, n]) => ({
            experiment_id: 'exp',
            wave_number: Number(wave),
            _count: { _all: n },
          }))
          .filter((c) => where.wave_number.in.includes(c.wave_number))
      ),
      count: vi.fn(async ({ where }) =>
        where.cylinder_plant_id.in.reduce(
          (sum: number, id: string) => sum + (plantScanCounts[id] ?? 0),
          0
        )
      ),
    },
    cylinderWaveDateChange: {
      findMany: vi.fn(async ({ where }) =>
        changes
          .filter((c) => where.wave_id.in.includes(c.wave_id))
          .map((c) => ({ changedAt: EDITED_AT, ...c }))
      ),
    },
    cylinderPlant: {
      findMany: vi.fn(async ({ where }) =>
        plants.filter(
          (p) =>
            where.wave_id.in.includes(p.wave_id) &&
            (where.uses_wave_dates === undefined ||
              p.uses_wave_dates === where.uses_wave_dates)
        )
      ),
      findUnique: vi.fn(
        async ({ where }) => plants.find(plantKey(where)) ?? null
      ),
    },
    cylinderPlantDateChange: {
      findMany: vi.fn(async ({ where }) =>
        plantChanges
          .filter((c) => where.plant_id.in.includes(c.plant_id))
          .map((c) => ({ changedAt: EDITED_AT, ...c }))
      ),
    },
    phenotyper: {
      findMany: vi.fn(async ({ where }) =>
        phenotypers.filter((p) => where.id.in.includes(p.id))
      ),
    },
    $transaction: vi.fn(async (fn) => fn(tx)),
  };
  return {
    db: db as unknown as CylinderWaveDbLike,
    raw: db,
    tx,
    rows,
    changes,
    plants,
    plantChanges,
  };
}
