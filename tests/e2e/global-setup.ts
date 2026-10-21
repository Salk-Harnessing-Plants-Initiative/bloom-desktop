/**
 * Playwright global setup, once per run: give the run its own temp folder (see
 * helpers/pyinstaller-temp.ts) and create the empty template databases that every
 * E2E test copies (see helpers/test-database.ts).
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { TEMPLATE_DB_PATHS, TemplateKind } from './helpers/test-database';
import { useRunTempDir } from './helpers/pyinstaller-temp';

const PRISMA_COMMANDS: Record<TemplateKind, string> = {
  push: 'npx prisma db push --skip-generate',
  migrations: 'npx prisma migrate deploy',
};

export default function globalSetup(): void {
  // Playwright passes the environment set here on to the test workers.
  useRunTempDir();
  for (const kind of Object.keys(TEMPLATE_DB_PATHS) as TemplateKind[]) {
    const template = TEMPLATE_DB_PATHS[kind];
    fs.mkdirSync(path.dirname(template), { recursive: true });
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      fs.rmSync(template + suffix, { force: true });
    }
    execSync(PRISMA_COMMANDS[kind], {
      cwd: path.join(__dirname, '..', '..'),
      env: { ...process.env, BLOOM_DATABASE_URL: `file:${template}` },
      stdio: 'pipe',
    });
  }
}
