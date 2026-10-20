/**
 * Deploy self-test: `Bloom Desktop --deploy-self-test --database=<copy> --species=<name>
 * --result-file=<path>`.
 *
 * Run by the station deploy after installing. Without opening a window or touching
 * the station's own database or scans folder, it creates a short synthetic scan in
 * the experiment `DEPLOY-TEST <scanner name>`, uploads it to Bloom with the app's own
 * upload code and the station's saved credentials, and writes a JSON result.
 * Exit codes: 0 uploaded, 1 failed, 2 bad arguments.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  DeploySelfTestOptions,
  DeploySelfTestRequest,
  DeploySelfTestResult,
} from '../types/deploy-self-test';

export const DEPLOY_SELF_TEST_FLAG = '--deploy-self-test';
export const SELF_TEST_FRAME_COUNT = 3;
const SELF_TEST_FRAME_SIZE_PX = 64;
const SELF_TEST_ACCESSION = 'DEPLOY-TEST';
const SELF_TEST_PERSON = {
  name: 'Deploy Self-Test',
  email: 'deploy-self-test@bloom-desktop.invalid',
};
export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_BAD_ARGS = 2;

/** `--name=value` from argv, or undefined. */
function argValue(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = argv.find((a) => a.startsWith(prefix));
  return arg === undefined ? undefined : arg.slice(prefix.length);
}

/** Null when the app wasn't started in self-test mode. */
export function parseDeploySelfTestArgs(
  argv: string[]
): DeploySelfTestRequest | null {
  if (!argv.includes(DEPLOY_SELF_TEST_FLAG)) return null;
  const databasePath = argValue(argv, 'database');
  const species = argValue(argv, 'species')?.trim();
  const resultFile = argValue(argv, 'result-file');
  const missing = [
    !databasePath && '--database',
    !species && '--species',
    !resultFile && '--result-file',
  ].filter(Boolean);
  if (missing.length > 0) {
    return {
      kind: 'invalid',
      error: `Missing ${missing.join(', ')}`,
      resultFile,
    };
  }
  return {
    kind: 'run',
    options: {
      databasePath: path.resolve(databasePath as string),
      species: species as string,
      resultFile: path.resolve(resultFile as string),
    },
  };
}

export function selfTestExperimentName(scannerName: string): string {
  return `DEPLOY-TEST ${scannerName}`;
}

/** e.g. `DEPLOY-0.2.1-20261020T193005Z`: unique per run, so Bloom never sees a repeat. */
export function selfTestPlantId(version: string, now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  return `DEPLOY-${version}-${stamp}`;
}

/** Minimal Prisma surface the self-test uses (DI for tests). */
export interface SelfTestDbLike {
  phenotyper: {
    upsert(args: object): Promise<{ id: string }>;
  };
  scientist: {
    upsert(args: object): Promise<{ id: string }>;
  };
  experiment: {
    findFirst(args: object): Promise<{ id: string } | null>;
    create(args: object): Promise<{ id: string }>;
  };
  scan: {
    create(args: object): Promise<{ id: string }>;
  };
}

export interface SelfTestUploaderLike {
  authenticate(): Promise<void>;
  uploadScan(
    scanId: string
  ): Promise<{ uploaded: number; failed: number; errors: string[] }>;
}

export interface DeploySelfTestDeps {
  version: string;
  now: () => Date;
  /** The station's machine config (scanner name, mode). */
  loadConfig: () => { scanner_mode: string; scanner_name: string };
  /** Path of the station's own database; the self-test refuses to write to it. */
  stationDatabasePath: string;
  openDatabase: (databasePath: string) => Promise<SelfTestDbLike>;
  createUploader: (db: SelfTestDbLike) => SelfTestUploaderLike;
  /** Writes `count` PNG frames named 001.png… into `dir`. */
  writeFrames: (dir: string, count: number, sizePx: number) => Promise<void>;
  tmpDir?: string;
}

function sameFile(a: string, b: string): boolean {
  const norm = (p: string) =>
    process.platform === 'win32'
      ? path.resolve(p).toLowerCase()
      : path.resolve(p);
  return norm(a) === norm(b);
}

export async function runDeploySelfTest(
  options: DeploySelfTestOptions,
  deps: DeploySelfTestDeps
): Promise<DeploySelfTestResult> {
  const startedAt = deps.now();
  const config = deps.loadConfig();
  const result: DeploySelfTestResult = {
    ok: false,
    version: deps.version,
    scanner: config.scanner_name,
    species: options.species,
    experiment: selfTestExperimentName(config.scanner_name),
    plantId: selfTestPlantId(deps.version, startedAt),
    frames: SELF_TEST_FRAME_COUNT,
    uploaded: 0,
    failed: 0,
    errors: [],
    startedAt: startedAt.toISOString(),
    finishedAt: '',
  };
  const finish = () => {
    result.finishedAt = deps.now().toISOString();
    return result;
  };

  if (sameFile(options.databasePath, deps.stationDatabasePath)) {
    result.errors.push(
      "Refusing to use the station's own database; pass a copy with --database"
    );
    return finish();
  }
  if (config.scanner_mode !== 'cylinderscan' || !config.scanner_name) {
    result.errors.push(
      'Machine Configuration must be CylinderScan with a scanner name'
    );
    return finish();
  }

  const scanDir = await fs.promises.mkdtemp(
    path.join(deps.tmpDir ?? os.tmpdir(), 'bloom-deploy-self-test-')
  );
  try {
    await deps.writeFrames(
      scanDir,
      SELF_TEST_FRAME_COUNT,
      SELF_TEST_FRAME_SIZE_PX
    );
    const db = await deps.openDatabase(options.databasePath);
    const person = (model: SelfTestDbLike['phenotyper']) =>
      model.upsert({
        where: { email: SELF_TEST_PERSON.email },
        update: {},
        create: SELF_TEST_PERSON,
      });
    const phenotyper = await person(db.phenotyper);
    const scientist = await person(db.scientist);
    const experimentWhere = {
      name: result.experiment,
      species: options.species,
    };
    const experiment =
      (await db.experiment.findFirst({ where: experimentWhere })) ??
      (await db.experiment.create({
        data: {
          ...experimentWhere,
          scientist_id: scientist.id,
          experiment_type: 'cylinderscan',
        },
      }));
    const scan = await db.scan.create({
      data: {
        experiment_id: experiment.id,
        phenotyper_id: phenotyper.id,
        scanner_name: config.scanner_name,
        plant_id: result.plantId,
        accession_name: SELF_TEST_ACCESSION,
        path: scanDir,
        capture_date: startedAt,
        num_frames: SELF_TEST_FRAME_COUNT,
        exposure_time: 0,
        gain: 0,
        brightness: 0,
        contrast: 0,
        gamma: 1,
        seconds_per_rot: 0,
        wave_number: 0,
        plant_age_days: 0,
        images: {
          create: Array.from({ length: SELF_TEST_FRAME_COUNT }, (_, i) => ({
            frame_number: i + 1,
            path: path.join(scanDir, `${String(i + 1).padStart(3, '0')}.png`),
            status: 'pending',
          })),
        },
      },
    });

    const uploader = deps.createUploader(db);
    await uploader.authenticate();
    const upload = await uploader.uploadScan(scan.id);
    result.uploaded = upload.uploaded;
    result.failed = upload.failed;
    result.errors.push(...upload.errors);
    result.ok =
      upload.uploaded === SELF_TEST_FRAME_COUNT && upload.failed === 0;
    if (!result.ok && result.errors.length === 0) {
      result.errors.push(
        `Uploaded ${upload.uploaded} of ${SELF_TEST_FRAME_COUNT} frames`
      );
    }
  } catch (error) {
    result.errors.push(
      error instanceof Error ? error.message : 'Unknown error'
    );
  } finally {
    await fs.promises.rm(scanDir, { recursive: true, force: true });
  }
  return finish();
}

/** Writes the result and returns the process exit code. */
export async function writeSelfTestResult(
  resultFile: string,
  result: DeploySelfTestResult
): Promise<number> {
  await fs.promises.mkdir(path.dirname(resultFile), { recursive: true });
  await fs.promises.writeFile(resultFile, JSON.stringify(result, null, 2));
  console.log(
    `[DeploySelfTest] ${result.ok ? 'passed' : 'failed'}: ${result.plantId}` +
      (result.errors.length ? ` (${result.errors.join('; ')})` : '')
  );
  return result.ok ? EXIT_OK : EXIT_FAILED;
}
