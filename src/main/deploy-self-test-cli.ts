/**
 * Runs the deploy self-test from main.ts with the real database, uploader, machine
 * config and sharp, then exits. Kept apart from deploy-self-test.ts so that module's
 * logic is testable without Electron. A result file is written on every path that
 * knows where it goes, including bad arguments, unexpected errors and the time limit.
 */
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import type { PrismaClient } from '@prisma/client';
import type { DeploySelfTestRequest } from '../types/deploy-self-test';
import {
  EXIT_BAD_ARGS,
  EXIT_FAILED,
  failedResult,
  runDeploySelfTest,
  selfTestFrameName,
  writeSelfTestResult,
} from './deploy-self-test';

const ENV_PATH = path.join(os.homedir(), '.bloom', '.env');
/** Longer than a normal run (seconds); a stalled connection otherwise waits 5 min per request. */
const SELF_TEST_TIMEOUT_MS = 180_000;
const FRAME_COLOR_STEP = 40;

async function writeFrames(
  dir: string,
  count: number,
  sizePx: number
): Promise<void> {
  const { default: sharp } = await import('sharp');
  for (let frame = 1; frame <= count; frame++) {
    await sharp({
      create: {
        width: sizePx,
        height: sizePx,
        channels: 3,
        background: { r: FRAME_COLOR_STEP * frame, g: 120, b: 60 },
      },
    })
      .png()
      .toFile(path.join(dir, selfTestFrameName(frame)));
  }
}

/** Every path the station's own database may have in this environment. */
async function stationDatabasePaths(): Promise<string[]> {
  const { getDatabasePath } = await import('./database');
  const defaultPath = (home: string) =>
    path.join(home, '.bloom', 'data', 'bloom.db');
  return [
    defaultPath(os.homedir()),
    defaultPath(app.getPath('home')),
    getDatabasePath(),
  ];
}

async function runSelfTest(
  request: Extract<DeploySelfTestRequest, { kind: 'run' }>
): Promise<number> {
  const { loadEnvConfig } = await import('./config-store');
  const { initializeDatabaseAsync, closeDatabase } = await import('./database');
  const { ImageUploader } = await import('./image-uploader');

  let prisma: PrismaClient | null = null;
  try {
    const result = await runDeploySelfTest(request.options, {
      version: app.getVersion(),
      now: () => new Date(),
      loadConfig: () => loadEnvConfig(ENV_PATH),
      stationDatabasePaths: await stationDatabasePaths(),
      openDatabase: async (databasePath) => {
        prisma = (await initializeDatabaseAsync(databasePath)) as PrismaClient;
        return prisma;
      },
      createUploader: () => {
        if (!prisma) throw new Error('Database copy was not opened');
        return new ImageUploader(prisma);
      },
      writeFrames,
    });
    return await writeSelfTestResult(request.options.resultFile, result);
  } finally {
    await closeDatabase().catch((): undefined => undefined);
  }
}

async function writeFailure(
  resultFile: string | undefined,
  message: string,
  species?: string
): Promise<void> {
  console.error(`[DeploySelfTest] ${message}`);
  if (!resultFile) return;
  await writeSelfTestResult(
    resultFile,
    failedResult(app.getVersion(), new Date(), [message], species)
  ).catch((error) =>
    console.error(
      '[DeploySelfTest] Could not write the result file:',
      error instanceof Error ? error.message : 'Unknown error'
    )
  );
}

/** Runs the self-test and exits the app with its code. Called once from main.ts. */
export async function startDeploySelfTest(
  request: DeploySelfTestRequest
): Promise<void> {
  // Called before 'ready'. The self-test draws nothing, and a station's runner service
  // may have no desktop for a GPU process; without one, Chromium exits at start.
  app.disableHardwareAcceleration();
  await app.whenReady();
  if (request.kind === 'invalid') {
    await writeFailure(request.resultFile, request.error);
    app.exit(EXIT_BAD_ARGS);
    return;
  }

  const { resultFile, species } = request.options;
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), SELF_TEST_TIMEOUT_MS);
  });
  let code: number;
  try {
    const outcome = await Promise.race([runSelfTest(request), timedOut]);
    if (outcome === 'timeout') {
      await writeFailure(
        resultFile,
        `Timed out after ${SELF_TEST_TIMEOUT_MS / 1000} s`,
        species
      );
      code = EXIT_FAILED;
    } else {
      code = outcome;
    }
  } catch (error) {
    await writeFailure(
      resultFile,
      error instanceof Error ? error.message : 'Unknown error',
      species
    );
    code = EXIT_FAILED;
  } finally {
    clearTimeout(timer);
  }
  app.exit(code);
}
