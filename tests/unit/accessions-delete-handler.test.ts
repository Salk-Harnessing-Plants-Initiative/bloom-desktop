/**
 * db:accessions:delete through its IPC handler, on a copy of the migrated template
 * database: a file whose experiments have scans stays; one without scans is deleted
 * with its plant mappings, and its experiments are left without a file.
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

import { registerDatabaseHandlers } from '../../src/main/database-handlers';

const privateDbPath =
  fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-accession-delete-db-')) +
  path.sep +
  'dev.db';
fs.copyFileSync(TEMPLATE_DB_ABSOLUTE_PATH, privateDbPath);
const prisma = new PrismaClient({
  datasources: { db: { url: `file:${privateDbPath}` } },
});
holder.db = prisma;

type Result = { success: boolean; error?: string };
const remove = (id: unknown) =>
  handlers.get('db:accessions:delete')!({}, id) as Promise<Result>;

async function clean() {
  await prisma.image.deleteMany();
  await prisma.scan.deleteMany();
  await prisma.experiment.deleteMany();
  await prisma.plantAccessionMappings.deleteMany();
  await prisma.accessions.deleteMany();
  await prisma.phenotyper.deleteMany();
}

async function fileWithExperiment(scans: Array<{ deleted: boolean }>) {
  const file = await prisma.accessions.create({
    data: {
      name: 'STL_soy_accessions.xlsx',
      mappings: {
        create: [{ plant_barcode: 'STL-001', accession_name: 'Col-0' }],
      },
    },
  });
  const experiment = await prisma.experiment.create({
    data: {
      name: '2026-11-10 STL Soy',
      species: 'Soybean',
      accession_id: file.id,
    },
  });
  const phenotyper = await prisma.phenotyper.create({
    data: { name: 'Emily', email: `emily-${file.id}@example.org` },
  });
  for (const [i, s] of scans.entries()) {
    await prisma.scan.create({
      data: {
        experiment_id: experiment.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'SlowScanner',
        plant_id: `STL-00${i + 1}`,
        path: `scans/${i}`,
        num_frames: 72,
        exposure_time: 10000,
        gain: 100,
        brightness: 0,
        contrast: 0,
        gamma: 1,
        seconds_per_rot: 7,
        wave_number: 1,
        plant_age_days: 10,
        deleted: s.deleted,
      },
    });
  }
  return { file, experiment };
}

beforeAll(async () => {
  await prisma.$connect();
  registerDatabaseHandlers({ markMetadataDeleted: () => undefined });
});
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
  fs.rmSync(path.dirname(privateDbPath), { recursive: true, force: true });
});
beforeEach(clean);

describe('db:accessions:delete', () => {
  it('refuses a file whose experiment has scans, and changes nothing', async () => {
    const { file, experiment } = await fileWithExperiment([{ deleted: false }]);
    const result = await remove(file.id);
    expect(result).toEqual({
      success: false,
      error:
        "This accession file can't be deleted: experiments that use it have scans: 2026-11-10 STL Soy (1 scan).",
    });
    expect(await prisma.accessions.count()).toBe(1);
    expect(await prisma.plantAccessionMappings.count()).toBe(1);
    expect(
      (await prisma.experiment.findUnique({ where: { id: experiment.id } }))
        ?.accession_id
    ).toBe(file.id);
  });

  it('deletes a file whose experiment has only deleted scans, leaving it without a file', async () => {
    const { file, experiment } = await fileWithExperiment([{ deleted: true }]);
    expect((await remove(file.id)).success).toBe(true);
    expect(await prisma.accessions.count()).toBe(0);
    expect(await prisma.plantAccessionMappings.count()).toBe(0);
    expect(
      (await prisma.experiment.findUnique({ where: { id: experiment.id } }))
        ?.accession_id
    ).toBeNull();
  });

  it('refuses a request without an id', async () => {
    expect(await remove(undefined)).toEqual({
      success: false,
      error: 'id must be a non-empty string',
    });
  });
});
