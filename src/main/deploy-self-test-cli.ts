/**
 * Runs the deploy self-test from main.ts with the real database, uploader, machine
 * config and sharp. Kept apart from deploy-self-test.ts so that module's logic is
 * testable without Electron. Modules are imported lazily, so a normal app start
 * never loads them from here.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import type { DeploySelfTestRequest } from '../types/deploy-self-test';
import {
  EXIT_BAD_ARGS,
  runDeploySelfTest,
  writeSelfTestResult,
  type SelfTestDbLike,
} from './deploy-self-test';

const ENV_PATH = path.join(os.homedir(), '.bloom', '.env');

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
        background: { r: 40 * frame, g: 120, b: 60 },
      },
    })
      .png()
      .toFile(path.join(dir, `${String(frame).padStart(3, '0')}.png`));
  }
}

/** Returns the process exit code. */
export async function runDeploySelfTestCli(
  request: DeploySelfTestRequest
): Promise<number> {
  if (request.kind === 'invalid') {
    console.error(`[DeploySelfTest] ${request.error}`);
    if (request.resultFile) {
      await fs.promises.writeFile(
        request.resultFile,
        JSON.stringify({ ok: false, errors: [request.error] }, null, 2)
      );
    }
    return EXIT_BAD_ARGS;
  }
  const { loadEnvConfig } = await import('./config-store');
  const { initializeDatabaseAsync, closeDatabase } = await import('./database');
  const { ImageUploader } = await import('./image-uploader');

  try {
    const result = await runDeploySelfTest(request.options, {
      version: app.getVersion(),
      now: () => new Date(),
      loadConfig: () => loadEnvConfig(ENV_PATH),
      // The path the app uses when no BLOOM_DATABASE_URL overrides it.
      stationDatabasePath: path.join(
        os.homedir(),
        '.bloom',
        'data',
        'bloom.db'
      ),
      openDatabase: async (databasePath) =>
        (await initializeDatabaseAsync(
          databasePath
        )) as unknown as SelfTestDbLike,
      createUploader: (db) =>
        new ImageUploader(
          db as unknown as ConstructorParameters<typeof ImageUploader>[0]
        ),
      writeFrames,
    });
    return await writeSelfTestResult(request.options.resultFile, result);
  } finally {
    await closeDatabase();
  }
}
