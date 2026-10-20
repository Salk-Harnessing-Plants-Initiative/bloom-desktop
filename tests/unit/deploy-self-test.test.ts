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
  failedResult,
  isSameFile,
  parseDeploySelfTestArgs,
  runDeploySelfTest,
  selfTestExperimentName,
  selfTestFrameName,
  selfTestPlantId,
  shortError,
  writeSelfTestResult,
  type DeploySelfTestDeps,
  type SelfTestUploaderLike,
} from '../../src/main/deploy-self-test';
import type { DeploySelfTestOptions } from '../../src/types/deploy-self-test';
import { TEMPLATE_DB_ABSOLUTE_PATH } from './global-setup';

const NOW = new Date('2026-10-20T19:30:05.123Z');
const FULL_UPLOAD = { uploaded: SELF_TEST_FRAME_COUNT, failed: 0, errors: [] };

let tmp: string;
let copy: string;
let station: string;
let prisma: PrismaClient | null = null;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-self-test-'));
  copy = path.join(tmp, 'copy.db');
  fs.copyFileSync(TEMPLATE_DB_ABSOLUTE_PATH, copy);
  station = path.join(tmp, 'station', 'bloom.db');
});

afterEach(async () => {
  await prisma?.$disconnect();
  prisma = null;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function options(
  overrides: Partial<DeploySelfTestOptions> = {}
): DeploySelfTestOptions {
  return {
    databasePath: copy,
    species: 'Sorghum',
    resultFile: path.join(tmp, 'result.json'),
    ...overrides,
  };
}

function fakeUploader(
  upload: { uploaded: number; failed: number; errors: string[] } = FULL_UPLOAD
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

function deps(overrides: Partial<DeploySelfTestDeps> = {}): DeploySelfTestDeps {
  return {
    version: '0.2.1',
    now: () => NOW,
    loadConfig: () => ({
      scanner_mode: 'cylinderscan',
      scanner_name: 'FastScanner',
    }),
    stationDatabasePaths: [station],
    openDatabase: async (p) => {
      prisma = new PrismaClient({ datasourceUrl: `file:${p}` });
      return prisma;
    },
    createUploader: () => fakeUploader(),
    writeFrames: async (dir, count) => {
      for (let i = 1; i <= count; i++) {
        fs.writeFileSync(path.join(dir, selfTestFrameName(i)), 'png');
      }
    },
    tmpDir: tmp,
    ...overrides,
  };
}

async function runWith(upload: {
  uploaded: number;
  failed: number;
  errors: string[];
}) {
  return runDeploySelfTest(
    options(),
    deps({ createUploader: () => fakeUploader(upload) })
  );
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
      resultFile: path.resolve('r.json'),
    });
  });
});

describe('names and messages', () => {
  it('files the test under one experiment per scanner', () => {
    expect(selfTestExperimentName('FastScanner')).toBe(
      'DEPLOY-TEST FastScanner'
    );
  });

  it('gives each run a unique plant ID from the version and time', () => {
    expect(selfTestPlantId('0.2.1', NOW)).toBe(
      'DEPLOY-0.2.1-20261020T193005123Z'
    );
  });

  it('keeps only the last line of a very long error', () => {
    const prismaStyle = `Invalid invocation in\n${'x'.repeat(5000)}\n\nThe table \`main.Phenotyper\` does not exist`;
    expect(shortError(prismaStyle)).toBe(
      'The table `main.Phenotyper` does not exist'
    );
    expect(shortError('short\nmessage')).toBe('short\nmessage');
  });

  it('builds a complete failed result for runs that stop early', () => {
    expect(failedResult('0.2.1', NOW, ['boom'], 'Sorghum')).toMatchObject({
      ok: false,
      version: '0.2.1',
      species: 'Sorghum',
      errors: ['boom'],
      startedAt: NOW.toISOString(),
    });
  });
});

describe('isSameFile', () => {
  it('matches a path through a symlinked folder', async () => {
    if (process.platform === 'win32') return; // symlinks need extra rights there
    fs.mkdirSync(path.dirname(station), { recursive: true });
    fs.copyFileSync(TEMPLATE_DB_ABSOLUTE_PATH, station);
    const link = path.join(tmp, 'link');
    fs.symlinkSync(path.dirname(station), link);
    expect(await isSameFile(path.join(link, 'bloom.db'), station)).toBe(true);
  });

  it('ignores case on Windows and macOS', async () => {
    const platform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      expect(await isSameFile('/A/Bloom.db', '/a/bloom.DB')).toBe(true);
    } finally {
      Object.defineProperty(process, 'platform', { value: platform });
    }
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
      plantId: 'DEPLOY-0.2.1-20261020T193005123Z',
      uploaded: SELF_TEST_FRAME_COUNT,
      failed: 0,
      errors: [],
    });
    const scan = await prisma!.scan.findFirstOrThrow({
      include: { images: true, experiment: true },
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

  it('reuses the test experiment for the same species, not another', async () => {
    const reopen = (at: number, species: string) =>
      runDeploySelfTest(
        options({ species }),
        deps({ now: () => new Date(NOW.getTime() + at) })
      ).then(() => prisma?.$disconnect());
    await reopen(0, 'Sorghum');
    await reopen(60_000, 'Sorghum');
    await reopen(120_000, 'Arabidopsis');
    prisma = new PrismaClient({ datasourceUrl: `file:${copy}` });
    expect(await prisma.experiment.count()).toBe(2);
    expect(await prisma.scan.count()).toBe(3);
  });

  it("refuses the station's own database and opens nothing", async () => {
    fs.mkdirSync(path.dirname(station), { recursive: true });
    fs.copyFileSync(TEMPLATE_DB_ABSOLUTE_PATH, station);
    const before = fs.statSync(station).mtimeMs;
    const openDatabase = vi.fn();
    const result = await runDeploySelfTest(
      options({ databasePath: station }),
      deps({ openDatabase })
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/station's own database/);
    expect(openDatabase).not.toHaveBeenCalled();
    expect(fs.statSync(station).mtimeMs).toBe(before);
  });

  it('reports a missing copy and does not create it', async () => {
    const missing = path.join(tmp, 'nope.db');
    const result = await runDeploySelfTest(
      options({ databasePath: missing }),
      deps()
    );
    expect(result.errors).toEqual([`Database copy not found: ${missing}`]);
    expect(fs.existsSync(missing)).toBe(false);
  });

  it('needs CylinderScan mode', async () => {
    const result = await runDeploySelfTest(
      options(),
      deps({
        loadConfig: () => ({ scanner_mode: 'graviscan', scanner_name: 'X' }),
      })
    );
    expect(result.errors[0]).toMatch(/CylinderScan/);
  });

  it('needs a scanner name', async () => {
    const result = await runDeploySelfTest(
      options(),
      deps({
        loadConfig: () => ({ scanner_mode: 'cylinderscan', scanner_name: '' }),
      })
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/scanner name/);
  });

  it('reports a config error instead of throwing', async () => {
    const result = await runDeploySelfTest(
      options(),
      deps({
        loadConfig: () => {
          throw new Error('Cannot read .env');
        },
      })
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['Cannot read .env']);
  });

  it('fails when nothing was uploaded', async () => {
    const result = await runWith({ uploaded: 0, failed: 0, errors: [] });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      `Uploaded 0 of ${SELF_TEST_FRAME_COUNT} frames`,
    ]);
  });

  it('fails when a frame fails, keeping the upload errors once', async () => {
    const result = await runWith({
      uploaded: 2,
      failed: 1,
      errors: ['Image 3: timeout', 'Image 3: timeout'],
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['Image 3: timeout']);
  });

  it('adds a hint when Bloom lacks the species or scanner', async () => {
    const result = await runWith({
      uploaded: 0,
      failed: 3,
      errors: ['Species Sorghum does not exist'],
    });
    expect(result.errors[0]).toBe(
      'Check that species "Sorghum" and scanner "FastScanner" exist in Bloom'
    );
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
  it('creates the folder, writes the JSON and maps the outcome to an exit code', async () => {
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
