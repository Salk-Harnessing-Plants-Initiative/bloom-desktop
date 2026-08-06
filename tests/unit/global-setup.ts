/**
 * Vitest globalSetup — runs once, in the main process, before any test file
 * starts (no worker contention, no concurrent access to shared state).
 *
 * Builds a pristine, freshly-migrated SQLite template database that
 * per-file isolated-DB tests (e.g. scans-delete.test.ts,
 * scans-check-duplicate.test.ts) copy from in their own beforeAll, instead
 * of copying the live `prisma/dev.db`. Copying dev.db directly was found to
 * be unsafe during a full-suite run: dev.db is also the shared scratch
 * database for other real-Prisma test files (e.g.
 * tests/unit/graviscan/database-handlers.test.ts), so a mid-run copy can
 * capture GraviScan-family rows (GraviScan, GraviScanSession, GraviImage,
 * GraviExperimentWaveMetadata, etc. — all FK'd to Experiment) that a
 * narrower cleanDatabase() scoped to Image/Scan/Experiment/Phenotyper can't
 * purge, causing `experiment.deleteMany()` to fail with a foreign key
 * violation. A template built once, before any test touches dev.db, has no
 * such entangled state.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export const TEMPLATE_DB_ABSOLUTE_PATH = path.join(
  __dirname,
  '..',
  '..',
  'prisma',
  'test-template.db'
);

export default function setup() {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    const file = `${TEMPLATE_DB_ABSOLUTE_PATH}${suffix}`;
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: path.join(__dirname, '..', '..'),
    env: {
      ...process.env,
      BLOOM_DATABASE_URL: 'file:./test-template.db',
    },
    stdio: 'ignore',
    shell: true,
  });
}
