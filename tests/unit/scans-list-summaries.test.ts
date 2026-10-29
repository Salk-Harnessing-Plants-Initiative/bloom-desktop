/**
 * listScanSummaries: the scan list Export Scans loads, with no image rows. Runs on a
 * copy of the migrated template database (see scans-export.test.ts for why a copy).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { listScanSummaries } from '../../src/main/database-handlers';
import { TEMPLATE_DB_ABSOLUTE_PATH } from './global-setup';

const privateDbPath =
  fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-scan-summaries-db-')) +
  path.sep +
  'dev.db';
fs.copyFileSync(TEMPLATE_DB_ABSOLUTE_PATH, privateDbPath);

const prisma = new PrismaClient({
  datasources: { db: { url: `file:${privateDbPath}` } },
});

async function cleanDatabase() {
  await prisma.image.deleteMany();
  await prisma.scan.deleteMany();
  await prisma.experiment.deleteMany();
  await prisma.phenotyper.deleteMany();
  await prisma.scientist.deleteMany();
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
  fs.rmSync(path.dirname(privateDbPath), { recursive: true, force: true });
});
beforeEach(cleanDatabase);

async function seed(count: number) {
  const scientist = await prisma.scientist.create({
    data: { name: 'Dr S', email: 's@example.org' },
  });
  const phenotyper = await prisma.phenotyper.create({
    data: { name: 'P', email: 'p@example.org' },
  });
  const experiment = await prisma.experiment.create({
    data: { name: 'Alfalfa A', species: 'Alfalfa', scientist_id: scientist.id },
  });
  for (let i = 0; i < count; i++) {
    await prisma.scan.create({
      data: {
        experiment_id: experiment.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'FastScanner',
        plant_id: `P${i}`,
        path: `scan-${i}`,
        capture_date: new Date(Date.UTC(2026, 9, 1 + i)),
        num_frames: 72,
        exposure_time: 1000,
        gain: 1,
        brightness: 0,
        contrast: 0,
        gamma: 1,
        seconds_per_rot: 7,
        wave_number: 1,
        plant_age_days: 10,
        deleted: i === count - 1,
        images: {
          create: [1, 2, 3].map((frame_number) => ({
            frame_number,
            path: `scan-${i}/${frame_number}.png`,
            status: 'pending',
          })),
        },
      },
    });
  }
  return experiment;
}

describe('listScanSummaries', () => {
  it('returns only the fields a scan list shows, newest first, without image rows', async () => {
    const experiment = await seed(3);

    const result = await listScanSummaries(prisma, { deleted: false }, 1, 10);

    expect(result.total).toBe(2);
    expect(result.scans.map((s) => s.plant_id)).toEqual(['P1', 'P0']);
    expect(Object.keys(result.scans[0]).sort()).toEqual(
      [
        'capture_date',
        'experiment',
        'experiment_id',
        'id',
        'plant_id',
        'scanner_name',
      ].sort()
    );
    expect(result.scans[0].experiment).toEqual({ name: 'Alfalfa A' });
    expect(result.scans[0].experiment_id).toBe(experiment.id);
  });

  it('pages through the scans', async () => {
    await seed(4);

    const first = await listScanSummaries(prisma, { deleted: false }, 1, 2);
    const second = await listScanSummaries(prisma, { deleted: false }, 2, 2);

    expect(first.scans.map((s) => s.plant_id)).toEqual(['P2', 'P1']);
    expect(second.scans.map((s) => s.plant_id)).toEqual(['P0']);
    expect(second).toMatchObject({ total: 3, page: 2, pageSize: 2 });
  });
});
