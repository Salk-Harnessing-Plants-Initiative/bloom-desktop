// @vitest-environment node
/**
 * Unit tests for `scansDelete` (add-cylinderscan-delete-upload-integrity,
 * tasks.md 1.3/1.4) — the standalone, db-injected soft-delete handler
 * backing `db:scans:delete`, extended to keep the scan's on-disk
 * `metadata.json` in sync with the `deleted` flag.
 *
 * Uses a real SQLite database via Prisma, matching the convention in
 * tests/unit/graviscan/database-handlers.test.ts. Unlike that file, this
 * one uses its OWN sqlite file (not the shared `dev.db`) — found during
 * implementation that vitest runs test files in parallel by default, and
 * two files sharing one Prisma-backed SQLite database race on
 * `deleteMany()`/`create()` calls against shared tables (Experiment,
 * Phenotyper), causing intermittent FK-constraint failures unrelated to
 * either file's actual logic. `beforeAll` provisions this file's schema
 * via `prisma migrate deploy` so no separate local setup step is needed
 * beyond having `BLOOM_DATABASE_URL` (any valid value) set for the
 * `@prisma/client` import to resolve.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { scansDelete } from '../../src/main/database-handlers';
import {
  writeMetadataJson,
  markMetadataDeleted,
} from '../../src/main/cylinderscan/scan-metadata-json';
import type { ScannerSettings } from '../../src/types/scanner';

// Resolved by Prisma relative to prisma/schema.prisma, not this file's cwd.
const TEST_DB_RELATIVE_URL = 'file:./dev-scans-delete-test.db';
const TEST_DB_ABSOLUTE_PATH = path.join(
  __dirname,
  '..',
  '..',
  'prisma',
  'dev-scans-delete-test.db'
);

const prisma = new PrismaClient({ datasourceUrl: TEST_DB_RELATIVE_URL });

async function cleanDatabase() {
  await prisma.image.deleteMany();
  await prisma.scan.deleteMany();
  await prisma.experiment.deleteMany();
  await prisma.phenotyper.deleteMany();
}

async function seedScan(overrides: { path: string; deleted?: boolean }) {
  const phenotyper = await prisma.phenotyper.create({
    data: { name: 'Test Phenotyper', email: `p-${Date.now()}@salk.edu` },
  });
  const experiment = await prisma.experiment.create({
    data: { name: 'Test Experiment', species: 'Amaranthus' },
  });
  return prisma.scan.create({
    data: {
      experiment_id: experiment.id,
      phenotyper_id: phenotyper.id,
      scanner_name: 'TestScanner',
      plant_id: 'PLANT-001',
      path: overrides.path,
      num_frames: 3,
      exposure_time: 10000,
      gain: 100,
      brightness: 0,
      contrast: 0,
      gamma: 1.0,
      seconds_per_rot: 7.0,
      wave_number: 1,
      plant_age_days: 14,
      deleted: overrides.deleted ?? false,
    },
  });
}

function makeScannerSettings(
  overrides?: Partial<ScannerSettings>
): ScannerSettings {
  return {
    camera: { exposure_time: 10000, gain: 100, gamma: 1.0 },
    daq: {
      device_name: 'cDAQ1Mod1',
      sampling_rate: 40000,
      step_pin: 0,
      dir_pin: 1,
      steps_per_revolution: 6400,
      num_frames: 3,
      seconds_per_rot: 7.0,
    },
    num_frames: 3,
    output_path: '/tmp/unused',
    metadata: {
      experiment_id: 'exp-001',
      phenotyper_id: 'user-001',
      scanner_name: 'TestScanner',
      plant_id: 'PLANT-001',
      plant_age_days: 14,
      wave_number: 1,
    },
    ...overrides,
  };
}

beforeAll(async () => {
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, BLOOM_DATABASE_URL: TEST_DB_RELATIVE_URL },
    stdio: 'ignore',
    shell: true,
  });
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

describe('scansDelete', () => {
  let scansDir: string;

  beforeEach(() => {
    scansDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-scans-delete-'));
  });

  afterEach(() => {
    if (fs.existsSync(scansDir)) {
      fs.rmSync(scansDir, { recursive: true, force: true });
    }
  });

  it('soft-deletes the scan and marks metadata.json deleted, given a relative scan.path', async () => {
    const relativeScanPath = path.join('2026-03-05', 'PLANT-001', 'uuid-1');
    const outputDir = path.join(scansDir, relativeScanPath);
    fs.mkdirSync(outputDir, { recursive: true });
    writeMetadataJson(outputDir, makeScannerSettings({ output_path: outputDir }));

    const scan = await seedScan({ path: relativeScanPath });
    const result = await scansDelete(prisma, scan.id, scansDir, markMetadataDeleted);

    expect(result.success).toBe(true);
    const updated = await prisma.scan.findUnique({ where: { id: scan.id } });
    expect(updated?.deleted).toBe(true);

    const metadata = JSON.parse(
      fs.readFileSync(path.join(outputDir, 'metadata.json'), 'utf-8')
    );
    expect(metadata.deleted).toBe(true);
  });

  it('resolves an absolute scan.path directly, not joined with scansDir', async () => {
    const absoluteOutputDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'bloom-scan-absolute-')
    );
    writeMetadataJson(
      absoluteOutputDir,
      makeScannerSettings({ output_path: absoluteOutputDir })
    );

    const scan = await seedScan({ path: absoluteOutputDir });
    try {
      const result = await scansDelete(prisma, scan.id, scansDir, markMetadataDeleted);

      expect(result.success).toBe(true);
      const metadata = JSON.parse(
        fs.readFileSync(
          path.join(absoluteOutputDir, 'metadata.json'),
          'utf-8'
        )
      );
      expect(metadata.deleted).toBe(true);
    } finally {
      fs.rmSync(absoluteOutputDir, { recursive: true, force: true });
    }
  });

  it('preserves all other metadata.json fields unchanged', async () => {
    const relativeScanPath = path.join('2026-03-05', 'PLANT-002', 'uuid-2');
    const outputDir = path.join(scansDir, relativeScanPath);
    fs.mkdirSync(outputDir, { recursive: true });
    writeMetadataJson(outputDir, makeScannerSettings({ output_path: outputDir }));
    const before = JSON.parse(
      fs.readFileSync(path.join(outputDir, 'metadata.json'), 'utf-8')
    );

    const scan = await seedScan({ path: relativeScanPath });
    await scansDelete(prisma, scan.id, scansDir, markMetadataDeleted);

    const after = JSON.parse(
      fs.readFileSync(path.join(outputDir, 'metadata.json'), 'utf-8')
    );
    const afterRest = { ...after };
    delete afterRest.deleted;
    expect(afterRest).toEqual(before);
  });

  it('still soft-deletes and returns success when metadata.json does not exist', async () => {
    const relativeScanPath = path.join('2026-03-05', 'PLANT-003', 'uuid-3');
    // Intentionally do not create outputDir/metadata.json — simulates a
    // legacy scan captured before metadata.json support existed.
    const scan = await seedScan({ path: relativeScanPath });

    const result = await scansDelete(prisma, scan.id, scansDir, markMetadataDeleted);

    expect(result.success).toBe(true);
    const updated = await prisma.scan.findUnique({ where: { id: scan.id } });
    expect(updated?.deleted).toBe(true);
  });

  it('returns an error when the scan does not exist', async () => {
    const result = await scansDelete(prisma, 'nonexistent-id', scansDir, markMetadataDeleted);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
