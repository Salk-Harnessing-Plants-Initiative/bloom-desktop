/**
 * Upload all's query (#449) on a real database: which scans count as waiting. Pilot
 * scans must never be picked, or a station's whole history would be sent again (#448).
 * Runs on a copy of the migrated template database (see scans-export.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { TEMPLATE_DB_ABSOLUTE_PATH } from './global-setup';
import { waitingScans } from '../../src/main/scan-upload-all-handlers';
import { scanListWhere, type ScanWhere } from '../../src/main/scan-filters';

const privateDbPath =
  fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-upload-all-db-')) +
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

beforeAll(() => prisma.$connect());
afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
  fs.rmSync(path.dirname(privateDbPath), { recursive: true, force: true });
});
beforeEach(cleanDatabase);

async function seedExperiments() {
  const scientist = await prisma.scientist.create({
    data: { name: 'Dr S', email: 's@example.org' },
  });
  const phenotyper = await prisma.phenotyper.create({
    data: { name: 'P', email: 'p@example.org' },
  });
  const experiment = (name: string) =>
    prisma.experiment.create({
      data: { name, species: 'Alfalfa', scientist_id: scientist.id },
    });
  const [a, b] = [await experiment('A'), await experiment('B')];
  const scan = (
    experiment_id: string,
    plant_id: string,
    statuses: string[],
    extra: { deleted?: boolean; capture_date?: Date } = {}
  ) =>
    prisma.scan.create({
      data: {
        experiment_id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'FastScanner',
        plant_id,
        path: plant_id,
        num_frames: statuses.length,
        exposure_time: 1000,
        gain: 1,
        brightness: 0,
        contrast: 0,
        gamma: 1,
        seconds_per_rot: 7,
        wave_number: 1,
        plant_age_days: 10,
        ...extra,
        images: {
          create: statuses.map((status, i) => ({
            frame_number: i + 1,
            path: `${plant_id}/${i + 1}.png`,
            status,
          })),
        },
      },
    });
  return { a, b, scan };
}

const plants = async (where: ScanWhere = { deleted: false }) =>
  (await waitingScans(prisma as never, where)).map((s) => s.plant_id);

const whereFor = (filters: Parameters<typeof scanListWhere>[0]) => {
  const query = scanListWhere(filters);
  if ('error' in query) throw new Error(query.error);
  return query.where;
};

describe('waitingScans on a real database', () => {
  it("picks scans with a 'pending' or 'failed' frame", async () => {
    const { a, scan } = await seedExperiments();
    await scan(a.id, 'pending', ['pending', 'pending']);
    await scan(a.id, 'partly-failed', ['uploaded', 'failed']);
    await scan(a.id, 'uploaded', ['uploaded', 'uploaded']);

    expect((await plants()).sort()).toEqual(['partly-failed', 'pending']);
  });

  it("never picks scans carrying only the pilot's statuses (#448)", async () => {
    const { a, scan } = await seedExperiments();
    await scan(a.id, 'pilot-uploaded', ['UPLOADED', 'UPLOADED']);
    await scan(a.id, 'pilot-captured', ['CAPTURED']);

    expect(await plants()).toEqual([]);
  });

  it('leaves out deleted scans, interrupted scans, and scans with no frames', async () => {
    const { a, scan } = await seedExperiments();
    await scan(a.id, 'deleted', ['pending'], { deleted: true });
    await scan(a.id, 'interrupted', ['uploading']);
    await scan(a.id, 'no-frames', []);

    expect(await plants()).toEqual([]);
  });

  it('keeps to the filters, oldest first', async () => {
    const { a, b, scan } = await seedExperiments();
    await scan(a.id, 'newer', ['pending'], {
      capture_date: new Date('2026-10-20T12:00:00'),
    });
    await scan(a.id, 'older', ['pending'], {
      capture_date: new Date('2026-10-10T12:00:00'),
    });
    await scan(b.id, 'other-experiment', ['pending'], {
      capture_date: new Date('2026-10-15T12:00:00'),
    });

    expect(await plants(whereFor({ experimentId: a.id }))).toEqual([
      'older',
      'newer',
    ]);
    expect(await plants(whereFor({ dateFrom: '2026-10-15' }))).toEqual([
      'other-experiment',
      'newer',
    ]);
  });
});
