/**
 * db:experiments:create through its IPC handler: new GraviScan experiment
 * names may not contain file-name marker words.
 * Runs on a copy of the migrated template database (see scans-list-handler.test.ts).
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
  fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-exp-name-db-')) +
  path.sep +
  'dev.db';
fs.copyFileSync(TEMPLATE_DB_ABSOLUTE_PATH, privateDbPath);
const prisma = new PrismaClient({
  datasources: { db: { url: `file:${privateDbPath}` } },
});
holder.db = prisma;

type Result = { success: boolean; error?: string; data?: { id: string } };
const create = (data: object) =>
  handlers.get('db:experiments:create')!({}, data) as Promise<Result>;

beforeAll(async () => {
  await prisma.$connect();
  registerDatabaseHandlers({ markMetadataDeleted: () => undefined });
});
afterAll(async () => {
  await prisma.experiment.deleteMany();
  await prisma.$disconnect();
  fs.rmSync(path.dirname(privateDbPath), { recursive: true, force: true });
});
beforeEach(async () => {
  await prisma.experiment.deleteMany();
});

describe('db:experiments:create', () => {
  it('refuses a GraviScan experiment named with a marker word, and saves nothing', async () => {
    const result = await create({
      name: 'Plot st 2',
      species: 'Arabidopsis',
      experiment_type: 'graviscan',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('"st"');
    expect(await prisma.experiment.count()).toBe(0);
  });

  it('creates a GraviScan experiment with a normal name', async () => {
    const result = await create({
      name: 'Perceptome Screen',
      species: 'Arabidopsis',
      experiment_type: 'graviscan',
    });
    expect(result.success).toBe(true);
    expect(await prisma.experiment.count()).toBe(1);
  });

  it('refuses a GraviScan experiment named with more than 20 characters, and saves nothing', async () => {
    const result = await create({
      name: 'GA-Root-Growth-Kinetics-EXP',
      species: 'Arabidopsis',
      experiment_type: 'graviscan',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('20 characters');
    expect(await prisma.experiment.count()).toBe(0);
  });

  it('creates a CylinderScan experiment with the same marker name', async () => {
    const result = await create({
      name: 'Plot st 2',
      species: 'Arabidopsis',
      experiment_type: 'cylinderscan',
    });
    expect(result.success).toBe(true);
  });
});
