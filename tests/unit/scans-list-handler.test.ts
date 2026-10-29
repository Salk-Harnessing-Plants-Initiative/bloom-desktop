/**
 * db:scans:list through its IPC handler: the summary branch and the page-size caps.
 * Runs on a copy of the migrated template database (see scans-export.test.ts).
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest';
import fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { TEMPLATE_DB_ABSOLUTE_PATH } from './global-setup';

const { handlers, holder } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  holder: { db: null as unknown },
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) =>
      handlers.set(channel, fn),
  },
  BrowserWindow: class {},
}));
vi.mock('../../src/main/database', () => ({
  getDatabase: () => holder.db,
}));

import {
  registerDatabaseHandlers,
  MAX_SUMMARY_PAGE_SIZE,
} from '../../src/main/database-handlers';

const privateDbPath =
  fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-scan-list-db-')) +
  path.sep +
  'dev.db';
fs.copyFileSync(TEMPLATE_DB_ABSOLUTE_PATH, privateDbPath);
const prisma = new PrismaClient({
  datasources: { db: { url: `file:${privateDbPath}` } },
});
holder.db = prisma;

type ListResult = {
  success: boolean;
  data: { scans: Record<string, unknown>[]; total: number; pageSize: number };
};
const list = (filters: object) =>
  handlers.get('db:scans:list')!({}, filters) as Promise<ListResult>;

async function cleanDatabase() {
  await prisma.image.deleteMany();
  await prisma.scan.deleteMany();
  await prisma.experiment.deleteMany();
  await prisma.phenotyper.deleteMany();
  await prisma.scientist.deleteMany();
}

beforeAll(async () => {
  await prisma.$connect();
  registerDatabaseHandlers({ markMetadataDeleted: () => undefined });
});
afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
  fs.rmSync(path.dirname(privateDbPath), { recursive: true, force: true });
});
beforeEach(cleanDatabase);

async function seed() {
  const scientist = await prisma.scientist.create({
    data: { name: 'Dr S', email: 's@example.org' },
  });
  const phenotyper = await prisma.phenotyper.create({
    data: { name: 'P', email: 'p@example.org' },
  });
  const make = async (name: string) =>
    prisma.experiment.create({
      data: { name, species: 'Alfalfa', scientist_id: scientist.id },
    });
  const [a, b] = [await make('A'), await make('B')];
  const scan = (experiment_id: string, plant_id: string, deleted = false) =>
    prisma.scan.create({
      data: {
        experiment_id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'FastScanner',
        plant_id,
        path: plant_id,
        num_frames: 72,
        exposure_time: 1000,
        gain: 1,
        brightness: 0,
        contrast: 0,
        gamma: 1,
        seconds_per_rot: 7,
        wave_number: 1,
        plant_age_days: 10,
        deleted,
        images: {
          create: [{ frame_number: 1, path: `${plant_id}/1.png` }],
        },
      },
    });
  await scan(a.id, 'A1');
  await scan(a.id, 'A-deleted', true);
  await scan(b.id, 'B1');
  return { a };
}

describe('db:scans:list', () => {
  it('returns summaries without image rows when summary is true', async () => {
    await seed();
    const result = await list({ page: 1, pageSize: 10, summary: true });

    expect(result.success).toBe(true);
    expect(result.data.scans).toHaveLength(2);
    for (const scan of result.data.scans) {
      expect(scan).not.toHaveProperty('images');
      expect(scan).not.toHaveProperty('phenotyper');
      expect(scan).toHaveProperty('plant_id');
    }
  });

  it('keeps the experiment filter and leaves out deleted scans in summaries', async () => {
    const { a } = await seed();
    const result = await list({
      page: 1,
      pageSize: 10,
      summary: true,
      experimentId: a.id,
    });

    expect(result.data.scans.map((s) => s.plant_id)).toEqual(['A1']);
    expect(result.data.total).toBe(1);
  });

  it('caps summary pages at MAX_SUMMARY_PAGE_SIZE and full pages at 100', async () => {
    const summary = await list({ page: 1, pageSize: 5000, summary: true });
    const full = await list({ page: 1, pageSize: 5000 });

    expect(summary.data.pageSize).toBe(MAX_SUMMARY_PAGE_SIZE);
    expect(full.data.pageSize).toBe(100);
  });

  it('still returns full scans, with image rows, without summary', async () => {
    await seed();
    const result = await list({ page: 1, pageSize: 10 });

    expect(result.data.scans[0]).toHaveProperty('images');
  });

  it('treats only summary: true as a summary request', async () => {
    await seed();
    const result = await list({ page: 1, pageSize: 10, summary: 'yes' });

    expect(result.data.scans[0]).toHaveProperty('images');
    expect(result.data.pageSize).toBe(10);
  });
});
