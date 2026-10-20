/**
 * Runs the packaged app's deploy self-test (`--deploy-self-test`) the way the
 * station deploy does, with a temporary home folder and fake Bloom credentials
 * pointing at a closed local port, so nothing reaches Bloom. Verifies that the
 * installed build gets as far as logging in: it opens the database copy it is
 * given, writes the synthetic scan with its frames, reports the login failure in
 * the result file and exits 1. Also checks it refuses the station's own database.
 *
 * Run with: npm run test:package:self-test
 * Prerequisites: npm run make (or npm run package) must have been run.
 */

// Same reason as test-packaged-app-launch.ts: some terminals set this, and it
// would make the packaged binary run as plain Node.
delete process.env.ELECTRON_RUN_AS_NODE;

import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { resolveStagedAppPath } from './lib/resolve-staged-app-path';

const SELF_TEST_TIMEOUT_MS = 120_000;
const SCANNER_NAME = 'CIScanner';
// Port 9 (discard) is closed on CI runners, so login fails fast and locally.
const FAKE_ENV = [
  'SCANNER_MODE=cylinderscan',
  `SCANNER_NAME=${SCANNER_NAME}`,
  'CAMERA_IP_ADDRESS=10.0.0.45',
  'BLOOM_API_URL=http://127.0.0.1:9',
  'BLOOM_SCANNER_USERNAME=nobody@example.invalid',
  'BLOOM_SCANNER_PASSWORD=not-a-real-password',
  'BLOOM_ANON_KEY=not-a-real-key',
].join('\n');

interface SelfTestJson {
  ok: boolean;
  experiment: string;
  plantId: string;
  errors: string[];
}

function runSelfTest(
  appPath: string,
  home: string,
  database: string,
  resultFile: string
) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
  };
  delete env.BLOOM_DATABASE_URL;
  const run = spawnSync(
    appPath,
    [
      '--deploy-self-test',
      `--database=${database}`,
      '--species=Sorghum',
      `--result-file=${resultFile}`,
    ],
    { env, encoding: 'utf8', timeout: SELF_TEST_TIMEOUT_MS }
  );
  if (run.error) throw run.error;
  const result = JSON.parse(
    fs.readFileSync(resultFile, 'utf8')
  ) as SelfTestJson;
  return { status: run.status, result, output: `${run.stdout}${run.stderr}` };
}

function check(condition: boolean, message: string, detail = ''): void {
  if (!condition) throw new Error(`${message}${detail ? `\n${detail}` : ''}`);
  console.log(`[PASS] ${message}`);
}

function main(): void {
  const appPath = resolveStagedAppPath(process.platform, process.arch);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-self-test-ci-'));
  try {
    const home = path.join(work, 'home');
    fs.mkdirSync(path.join(home, '.bloom', 'data'), { recursive: true });
    fs.writeFileSync(path.join(home, '.bloom', '.env'), FAKE_ENV);

    const copy = path.join(work, 'copy.db');
    console.log('[INFO] Creating a migrated database copy...');
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, BLOOM_DATABASE_URL: `file:${copy}` },
      stdio: 'inherit',
    });

    console.log(`[INFO] Running ${appPath} --deploy-self-test`);
    const run = runSelfTest(
      appPath,
      home,
      copy,
      path.join(work, 'result.json')
    );
    check(run.status === 1, 'Self-test exits 1 when login fails', run.output);
    check(
      run.result.errors[0]?.startsWith('Authentication failed') === true,
      'Self-test reports the login failure',
      JSON.stringify(run.result)
    );
    check(
      run.result.experiment === `DEPLOY-TEST ${SCANNER_NAME}`,
      'Self-test uses the per-scanner test experiment'
    );
    const db = new Database(copy, { readonly: true });
    const images = db
      .prepare(
        'SELECT COUNT(*) AS n FROM Image JOIN Scan ON Scan.id = Image.scan_id WHERE Scan.plant_id = ?'
      )
      .get(run.result.plantId) as { n: number };
    db.close();
    check(images.n === 3, 'Self-test wrote its scan and frames to the copy');

    const station = path.join(home, '.bloom', 'data', 'bloom.db');
    const refused = runSelfTest(
      appPath,
      home,
      station,
      path.join(work, 'refused.json')
    );
    check(
      refused.status === 1 &&
        /station's own database/.test(refused.result.errors[0] ?? '') &&
        !fs.existsSync(station),
      "Self-test refuses the station's own database",
      JSON.stringify(refused.result)
    );
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    main();
    console.log('[PASS] Packaged deploy self-test verification passed');
  } catch (error) {
    console.error(
      `[FAIL] ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    process.exit(1);
  }
}
