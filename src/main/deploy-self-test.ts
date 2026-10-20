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
import type { PrismaClient } from '@prisma/client';
import type { MachineConfig } from './config-store';
import type {
  DeploySelfTestOptions,
  DeploySelfTestRequest,
  DeploySelfTestResult,
} from '../types/deploy-self-test';

export const DEPLOY_SELF_TEST_FLAG = '--deploy-self-test';
/** Marks everything the self-test creates in Bloom, so analysts can filter it out. */
export const SELF_TEST_TAG = 'DEPLOY-TEST';
export const SELF_TEST_FRAME_COUNT = 3;
const SELF_TEST_FRAME_SIZE_PX = 64;
const SELF_TEST_PERSON = {
  name: 'Deploy Self-Test',
  email: 'deploy-self-test@bloom-desktop.invalid',
};
/** Longer messages (Prisma's include a slice of the app bundle) keep only their last line. */
const MAX_ERROR_CHARS = 1000;
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
      resultFile: resultFile ? path.resolve(resultFile) : undefined,
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
  return `${SELF_TEST_TAG} ${scannerName}`;
}

/** e.g. `DEPLOY-0.2.1-20261020T193005123Z`: unique per run, so Bloom never sees a repeat. */
export function selfTestPlantId(version: string, now: Date): string {
  const stamp = now.toISOString().replace(/[-:.]/g, '');
  return `DEPLOY-${version}-${stamp}`;
}

export function selfTestFrameName(frameNumber: number): string {
  return `${String(frameNumber).padStart(3, '0')}.png`;
}

/** Keeps errors readable in the result file and the deploy summary. */
export function shortError(message: string): string {
  if (message.length <= MAX_ERROR_CHARS) return message;
  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return (lines[lines.length - 1] ?? message).slice(0, MAX_ERROR_CHARS);
}

/** A failed result for runs that stop before or outside the self-test itself. */
export function failedResult(
  version: string,
  now: Date,
  errors: string[],
  species = ''
): DeploySelfTestResult {
  return {
    ok: false,
    version,
    scanner: '',
    species,
    experiment: '',
    plantId: '',
    frames: SELF_TEST_FRAME_COUNT,
    uploaded: 0,
    failed: 0,
    errors: errors.map(shortError),
    startedAt: now.toISOString(),
    finishedAt: now.toISOString(),
  };
}

export type SelfTestDbLike = Pick<
  PrismaClient,
  'phenotyper' | 'scientist' | 'experiment' | 'scan'
>;

export interface SelfTestUploaderLike {
  authenticate(): Promise<void>;
  uploadScan(
    scanId: string
  ): Promise<{ uploaded: number; failed: number; errors: string[] }>;
}

export interface DeploySelfTestDeps {
  version: string;
  now: () => Date;
  /** The station's machine config. */
  loadConfig: () => Pick<MachineConfig, 'scanner_mode' | 'scanner_name'>;
  /** Every path the station's own database may have; the self-test refuses them. */
  stationDatabasePaths: string[];
  openDatabase: (databasePath: string) => Promise<SelfTestDbLike>;
  /** An uploader on the database last opened by `openDatabase`. */
  createUploader: () => SelfTestUploaderLike;
  /** Writes `count` PNG frames named by selfTestFrameName into `dir`. */
  writeFrames: (dir: string, count: number, sizePx: number) => Promise<void>;
  tmpDir?: string;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Same file by path (case-insensitive where the OS usually is) or, if both exist, by real path. */
export async function isSameFile(a: string, b: string): Promise<boolean> {
  const caseInsensitive =
    process.platform === 'win32' || process.platform === 'darwin';
  const norm = (p: string) =>
    caseInsensitive ? path.resolve(p).toLowerCase() : path.resolve(p);
  if (norm(a) === norm(b)) return true;
  if (!(await exists(a)) || !(await exists(b))) return false;
  const [realA, realB] = await Promise.all([
    fs.promises.realpath(a),
    fs.promises.realpath(b),
  ]);
  return norm(realA) === norm(realB);
}

/** Why the self-test can't use this database copy, or null if it can. */
async function databaseProblem(
  databasePath: string,
  stationDatabasePaths: string[]
): Promise<string | null> {
  for (const station of stationDatabasePaths) {
    if (await isSameFile(databasePath, station)) {
      return "Refusing to use the station's own database; pass a copy with --database";
    }
  }
  if (!(await exists(databasePath))) {
    return `Database copy not found: ${databasePath}`;
  }
  return null;
}

/** Errors from Bloom when the species or scanner isn't registered there. */
function bloomSetupHint(
  errors: string[],
  species: string,
  scanner: string
): string | null {
  return errors.some((e) => /does not exist/i.test(e))
    ? `Check that species "${species}" and scanner "${scanner}" exist in Bloom`
    : null;
}

export async function runDeploySelfTest(
  options: DeploySelfTestOptions,
  deps: DeploySelfTestDeps
): Promise<DeploySelfTestResult> {
  const startedAt = deps.now();
  const result: DeploySelfTestResult = {
    ...failedResult(deps.version, startedAt, [], options.species),
    plantId: selfTestPlantId(deps.version, startedAt),
  };
  const finish = () => {
    const errors = [...new Set(result.errors.map(shortError))];
    const hint = bloomSetupHint(errors, options.species, result.scanner);
    result.errors = hint ? [hint, ...errors] : errors;
    result.finishedAt = deps.now().toISOString();
    return result;
  };

  let scanDir: string | null = null;
  try {
    const config = deps.loadConfig();
    result.scanner = config.scanner_name;
    result.experiment = selfTestExperimentName(config.scanner_name);

    const problem = await databaseProblem(
      options.databasePath,
      deps.stationDatabasePaths
    );
    if (problem) {
      result.errors.push(problem);
      return finish();
    }
    if (config.scanner_mode !== 'cylinderscan' || !config.scanner_name) {
      result.errors.push(
        'Machine Configuration must be CylinderScan with a scanner name'
      );
      return finish();
    }

    scanDir = await fs.promises.mkdtemp(
      path.join(deps.tmpDir ?? os.tmpdir(), 'bloom-deploy-self-test-')
    );
    await deps.writeFrames(
      scanDir,
      SELF_TEST_FRAME_COUNT,
      SELF_TEST_FRAME_SIZE_PX
    );
    const db = await deps.openDatabase(options.databasePath);
    const personUpsert = {
      where: { email: SELF_TEST_PERSON.email },
      update: {},
      create: SELF_TEST_PERSON,
    };
    const phenotyper = await db.phenotyper.upsert(personUpsert);
    const scientist = await db.scientist.upsert(personUpsert);
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
    const frameDir = scanDir;
    const scan = await db.scan.create({
      data: {
        experiment_id: experiment.id,
        phenotyper_id: phenotyper.id,
        scanner_name: config.scanner_name,
        plant_id: result.plantId,
        accession_name: SELF_TEST_TAG,
        path: frameDir,
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
            path: path.join(frameDir, selfTestFrameName(i + 1)),
            status: 'pending',
          })),
        },
      },
    });

    const uploader = deps.createUploader();
    await uploader.authenticate();
    const upload = await uploader.uploadScan(scan.id);
    result.uploaded = upload.uploaded;
    result.failed = upload.failed;
    result.errors.push(...upload.errors);
    result.ok =
      upload.uploaded === SELF_TEST_FRAME_COUNT && upload.failed === 0;
    if (!result.ok && upload.errors.length === 0) {
      result.errors.push(
        `Uploaded ${upload.uploaded} of ${SELF_TEST_FRAME_COUNT} frames`
      );
    }
  } catch (error) {
    result.errors.push(
      error instanceof Error ? error.message : 'Unknown error'
    );
  } finally {
    if (scanDir) {
      // A file still held by antivirus must not turn a good upload into a failure.
      await fs.promises
        .rm(scanDir, { recursive: true, force: true })
        .catch((): undefined => undefined);
    }
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
