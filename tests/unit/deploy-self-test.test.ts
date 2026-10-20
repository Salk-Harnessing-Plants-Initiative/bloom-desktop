/**
 * Tests for the deploy self-test (src/main/deploy-self-test.ts): argument parsing,
 * names, the station-database guard, failure reporting, and the rows it writes
 * through a real Prisma client against a copy of the migrated template database.
 * The uploader is faked; no network calls are made.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DEPLOY_SELF_TEST_FLAG,
  EXIT_FAILED,
  EXIT_OK,
  SELF_TEST_FRAME_COUNT,
  parseDeploySelfTestArgs,
  runDeploySelfTest,
  selfTestExperimentName,
  selfTestPlantId,
  writeSelfTestResult,
  type DeploySelfTestDeps,
  type SelfTestDbLike,
  type SelfTestUploaderLike,
} from '../../src/main/deploy-self-test';
import type { DeploySelfTestOptions } from '../../src/types/deploy-self-test';
import { TEMPLATE_DB_ABSOLUTE_PATH } from './global-setup';

const NOW = new Date('2026-10-20T19:30:05.123Z');

let tmp: string;
let prisma: PrismaClient | null = null;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-self-test-'));
});

afterEach(async () => {
  await prisma?.$disconnect();
  prisma = null;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function options(overrides: Partial<DeploySelfTestOptions> = {}) {
  return {
    databasePath: path.join(tmp, 'copy.db'),
    species: 'Sorghum',
    resultFile: path.join(tmp, 'result.json'),
    ...overrides,
  };
}

function fakeUploader(
  upload: { uploaded: number; failed: number; errors: string[] } = {
    uploaded: SELF_TEST_FRAME_COUNT,
    failed: 0,
    errors: [],
  }
): SelfTestUploaderLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    authenticate: vi.fn(async () => {
      calls.push('authenticate');
    }),
    uploadScan: vi.fn(async (scanId: string) => {
      calls.push(`upload:${scanId}`);
      return upload;
    }),
  };
}

/** A real Prisma client on a fresh copy of the migrated template database. */
function realDatabase(dbPath: string): SelfTestDbLike {
  fs.copyFileSync(TEMPLATE_DB_ABSOLUTE_PATH, dbPath);
  prisma = new PrismaClient({ datasourceUrl: `file:${dbPath}` });
  return prisma as unknown as SelfTestDbLike;
}

function deps(overrides: Partial<DeploySelfTestDeps> = {}): DeploySelfTestDeps {
  return {
    version: '0.2.1',
    now: () => NOW,
    loadConfig: () => ({
      scanner_mode: 'cylinderscan',
      scanner_name: 'FastScanner',
    }),
    stationDatabasePath: path.join(tmp, 'station', 'bloom.db'),
    openDatabase: async (p) => realDatabase(p),
    createUploader: () => fakeUploader(),
    writeFrames: async (dir, count) => {
      for (let i = 1; i <= count; i++) {
        fs.writeFileSync(
          path.join(dir, `${String(i).padStart(3, '0')}.png`),
          'png'
        );
      }
    },
    tmpDir: tmp,
    ...overrides,
  };
}

describe('parseDeploySelfTestArgs', () => {
  it('is null for a normal start', () => {
    expect(parseDeploySelfTestArgs(['Bloom Desktop.exe'])).toBeNull();
  });

  it('reads the database, species and result file', () => {
    const request = parseDeploySelfTestArgs([
      'Bloom Desktop.exe',
      DEPLOY_SELF_TEST_FLAG,
      '--database=C:/tmp/copy.db',
      '--species= Sorghum ',
      '--result-file=C:/tmp/result.json',
    ]);
    expect(request?.kind).toBe('run');
    if (request?.kind !== 'run') return;
    expect(request.options.species).toBe('Sorghum');
    expect(path.isAbsolute(request.options.databasePath)).toBe(true);
    expect(request.options.resultFile).toMatch(/result\.json$/);
  });

  it('names every missing argument, and keeps the result file if given', () => {
    const request = parseDeploySelfTestArgs([
      DEPLOY_SELF_TEST_FLAG,
      '--result-file=r.json',
    ]);
    expect(request).toEqual({
      kind: 'invalid',
      error: 'Missing --database, --species',
      resultFile: 'r.json',
    });
  });
});

describe('names', () => {
  it('files the test under one experiment per scanner', () => {
    expect(selfTestExperimentName('FastScanner')).toBe(
      'DEPLOY-TEST FastScanner'
    );
  });

  it('gives each run a unique plant ID from the version and time', () => {
    expect(selfTestPlantId('0.2.1', NOW)).toBe('DEPLOY-0.2.1-20261020T193005Z');
  });
});

describe('runDeploySelfTest', () => {
  it('writes a scan to the given copy and uploads it', async () => {
    const uploader = fakeUploader();
    const result = await runDeploySelfTest(
      options(),
      deps({ createUploader: () => uploader })
    );

    expect(result).toMatchObject({
      ok: true,
      scanner: 'FastScanner',
      species: 'Sorghum',
      experiment: 'DEPLOY-TEST FastScanner',
      plantId: 'DEPLOY-0.2.1-20261020T193005Z',
      uploaded: SELF_TEST_FRAME_COUNT,
      failed: 0,
      errors: [],
    });
    const scan = await prisma!.scan.findFirstOrThrow({
      include: { images: true, experiment: true, phenotyper: true },
    });
    expect(scan.plant_id).toBe(result.plantId);
    expect(scan.scanner_name).toBe('FastScanner');
    expect(scan.accession_name).toBe('DEPLOY-TEST');
    expect(scan.experiment).toMatchObject({
      name: 'DEPLOY-TEST FastScanner',
      species: 'Sorghum',
      experiment_type: 'cylinderscan',
    });
    expect(scan.images.map((i) => i.frame_number).sort()).toEqual([1, 2, 3]);
    expect(scan.images.every((i) => path.isAbsolute(i.path))).toBe(true);
    expect(uploader.calls).toEqual(['authenticate', `upload:${scan.id}`]);
  });

  it('reuses the test experiment on later runs', async () => {
    const opts = options();
    await runDeploySelfTest(opts, deps());
    await prisma!.$disconnect();
    const second = deps({
      now: () => new Date(NOW.getTime() + 60_000),
      openDatabase: async (p) => {
        prisma = new PrismaClient({ datasourceUrl: `file:${p}` });
        return prisma as unknown as SelfTestDbLike;
      },
    });
    await runDeploySelfTest(opts, second);
    expect(await prisma!.experiment.count()).toBe(1);
    expect(await prisma!.scan.count()).toBe(2);
  });

  it("refuses the station's own database and opens nothing", async () => {
    const openDatabase = vi.fn();
    const station = path.join(tmp, 'station', 'bloom.db');
    const result = await runDeploySelfTest(
      options({ databasePath: station }),
      deps({ openDatabase })
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/station's own database/);
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('needs CylinderScan mode and a scanner name', async () => {
    const result = await runDeploySelfTest(
      options(),
      deps({
        loadConfig: () => ({ scanner_mode: 'graviscan', scanner_name: 'X' }),
      })
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/CylinderScan/);
  });

  it('fails when not every frame uploads', async () => {
    const result = await runDeploySelfTest(
      options(),
      deps({
        createUploader: () =>
          fakeUploader({ uploaded: 2, failed: 1, errors: [] }),
      })
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      `Uploaded 2 of ${SELF_TEST_FRAME_COUNT} frames`,
    ]);
  });

  it('reports a login failure and removes its temp frames', async () => {
    const uploader = fakeUploader();
    uploader.authenticate = vi.fn(async () => {
      throw new Error('Authentication failed: Invalid login credentials');
    });
    const result = await runDeploySelfTest(
      options(),
      deps({ createUploader: () => uploader })
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      'Authentication failed: Invalid login credentials',
    ]);
    const leftovers = fs
      .readdirSync(tmp)
      .filter((f) => f.startsWith('bloom-deploy-self-test-'));
    expect(leftovers).toEqual([]);
  });
});

describe('writeSelfTestResult', () => {
  it('writes the JSON and maps the outcome to an exit code', async () => {
    const result = await runDeploySelfTest(options(), deps());
    const file = path.join(tmp, 'out', 'result.json');
    expect(await writeSelfTestResult(file, result)).toBe(EXIT_OK);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).plantId).toBe(
      result.plantId
    );
    expect(await writeSelfTestResult(file, { ...result, ok: false })).toBe(
      EXIT_FAILED
    );
  });
});
