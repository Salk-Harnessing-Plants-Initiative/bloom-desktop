/**
 * Playwright global setup: create the empty template databases that every E2E
 * test copies (see helpers/test-database.ts), once per run.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { TEMPLATE_DB_PATHS, TemplateKind } from './helpers/test-database';

const PRISMA_COMMANDS: Record<TemplateKind, string> = {
  push: 'npx prisma db push --skip-generate',
  migrations: 'npx prisma migrate deploy',
};

export default function globalSetup(): void {
  for (const kind of Object.keys(TEMPLATE_DB_PATHS) as TemplateKind[]) {
    const template = TEMPLATE_DB_PATHS[kind];
    fs.mkdirSync(path.dirname(template), { recursive: true });
    fs.rmSync(template, { force: true });
    execSync(PRISMA_COMMANDS[kind], {
      cwd: path.join(__dirname, '..', '..'),
      env: { ...process.env, BLOOM_DATABASE_URL: `file:${template}` },
      stdio: 'pipe',
    });
  }
}
