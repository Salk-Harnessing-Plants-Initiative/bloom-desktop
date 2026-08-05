// @vitest-environment node
/**
 * Unit tests for `checkDuplicateScan` (add-cylinderscan-delete-upload-integrity,
 * tasks.md 4.1) — backs `db:scans:checkDuplicate`, checking for a
 * non-deleted scan matching (plant_id, experiment_id, wave_number,
 * plant_age_days).
 *
 * Uses its own isolated SQLite database, copied in beforeAll from the
 * pristine template built once by tests/unit/global-setup.ts — matching
 * scans-delete.test.ts's convention. See that file's header comment for
 * why a per-file copy (rather than sharing dev.db, or copying dev.db
 * itself) is necessary.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { checkDuplicateScan } from '../../src/main/database-handlers';
import { TEMPLATE_DB_ABSOLUTE_PATH } from './global-setup';

const TEST_DB_RELATIVE_URL = 'file:./dev-check-duplicate-test.db';
const SOURCE_DB_ABSOLUTE_PATH = TEMPLATE_DB_ABSOLUTE_PATH;
const TEST_DB_ABSOLUTE_PATH = path.join(
  __dirname,
  '..',
  '..',
  'prisma',
  'dev-check-duplicate-test.db'
);

const prisma = new PrismaClient({ datasourceUrl: TEST_DB_RELATIVE_URL });

async function cleanDatabase() {
  await prisma.image.deleteMany();
  await prisma.scan.deleteMany();
  await prisma.experiment.deleteMany();
  await prisma.phenotyper.deleteMany();
}

async function seedScan(overrides: {
  plant_id: string;
  experiment_id: string;
  wave_number: number;
  plant_age_days: number;
  deleted?: boolean;
}) {
  const phenotyper = await prisma.phenotyper.create({
    data: { name: 'Test Phenotyper', email: `p-${Date.now()}@salk.edu` },
  });
  return prisma.scan.create({
    data: {
      experiment_id: overrides.experiment_id,
      phenotyper_id: phenotyper.id,
      scanner_name: 'TestScanner',
      plant_id: overrides.plant_id,
      path: 'unused',
      num_frames: 3,
      exposure_time: 10000,
      gain: 100,
      brightness: 0,
      contrast: 0,
      gamma: 1.0,
      seconds_per_rot: 7.0,
      wave_number: overrides.wave_number,
      plant_age_days: overrides.plant_age_days,
      deleted: overrides.deleted ?? false,
    },
  });
}

async function seedExperiment(id: string) {
  return prisma.experiment.create({
    data: { id, name: `Experiment ${id}`, species: 'Arabidopsis' },
  });
}

beforeAll(async () => {
  if (!fs.existsSync(SOURCE_DB_ABSOLUTE_PATH)) {
    throw new Error(
      `${SOURCE_DB_ABSOLUTE_PATH} does not exist — vitest's globalSetup ` +
        `(tests/unit/global-setup.ts) should have created it before any ` +
        `test file ran.`
    );
  }
  fs.copyFileSync(SOURCE_DB_ABSOLUTE_PATH, TEST_DB_ABSOLUTE_PATH);
  await prisma.$connect();
});

afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    const file = `${TEST_DB_ABSOLUTE_PATH}${suffix}`;
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
});

beforeEach(async () => {
  await cleanDatabase();
});

describe('checkDuplicateScan', () => {
  it('returns true when a matching non-deleted scan exists', async () => {
    await seedExperiment('exp-1');
    await seedScan({
      plant_id: 'PLANT_001',
      experiment_id: 'exp-1',
      wave_number: 2,
      plant_age_days: 21,
    });

    const result = await checkDuplicateScan(
      prisma,
      'PLANT_001',
      'exp-1',
      2,
      21
    );

    expect(result).toEqual({ success: true, data: true });
  });

  it('returns false when wave_number differs', async () => {
    await seedExperiment('exp-1');
    await seedScan({
      plant_id: 'PLANT_001',
      experiment_id: 'exp-1',
      wave_number: 2,
      plant_age_days: 21,
    });

    const result = await checkDuplicateScan(
      prisma,
      'PLANT_001',
      'exp-1',
      3,
      21
    );

    expect(result).toEqual({ success: true, data: false });
  });

  it('returns false when plant_age_days differs', async () => {
    await seedExperiment('exp-1');
    await seedScan({
      plant_id: 'PLANT_001',
      experiment_id: 'exp-1',
      wave_number: 2,
      plant_age_days: 21,
    });

    const result = await checkDuplicateScan(
      prisma,
      'PLANT_001',
      'exp-1',
      2,
      25
    );

    expect(result).toEqual({ success: true, data: false });
  });

  it('returns false when experiment_id differs (same plant_id elsewhere)', async () => {
    await seedExperiment('exp-1');
    await seedExperiment('exp-2');
    await seedScan({
      plant_id: 'PLANT_001',
      experiment_id: 'exp-1',
      wave_number: 2,
      plant_age_days: 21,
    });

    const result = await checkDuplicateScan(
      prisma,
      'PLANT_001',
      'exp-2',
      2,
      21
    );

    expect(result).toEqual({ success: true, data: false });
  });

  it('returns false when the only match is soft-deleted', async () => {
    await seedExperiment('exp-1');
    await seedScan({
      plant_id: 'PLANT_001',
      experiment_id: 'exp-1',
      wave_number: 2,
      plant_age_days: 21,
      deleted: true,
    });

    const result = await checkDuplicateScan(
      prisma,
      'PLANT_001',
      'exp-1',
      2,
      21
    );

    expect(result).toEqual({ success: true, data: false });
  });

  it.each([
    ['', 'exp-1', 2, 21],
    [undefined, 'exp-1', 2, 21],
    ['PLANT_001', '', 2, 21],
    ['PLANT_001', undefined, 2, 21],
  ])(
    'returns an error, not false, for invalid plantId/experimentId: %s %s',
    async (plantId, experimentId, waveNumber, plantAgeDays) => {
      const result = await checkDuplicateScan(
        prisma,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plantId as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        experimentId as any,
        waveNumber,
        plantAgeDays
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    }
  );

  it.each([
    [-1, 21],
    [1.5, 21],
    [NaN, 21],
    [2, -1],
    [2, 1.5],
    [2, NaN],
  ])(
    'returns an error, not false, for invalid waveNumber/plantAgeDays: %s %s',
    async (waveNumber, plantAgeDays) => {
      const result = await checkDuplicateScan(
        prisma,
        'PLANT_001',
        'exp-1',
        waveNumber,
        plantAgeDays
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    }
  );
});
