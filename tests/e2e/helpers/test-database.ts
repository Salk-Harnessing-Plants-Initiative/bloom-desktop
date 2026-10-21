/**
 * E2E Test Helper: test databases
 *
 * Every E2E test starts from an empty database with the current schema. Running
 * `npx prisma db push` before each test did that, but it starts a shell, Node and
 * Prisma's engine every time: hundreds of processes per CI shard, on top of each
 * test's Electron and Python processes. On Windows runners that is what made
 * processes fail to start (0xC0000142, "worker process exited unexpectedly").
 *
 * Instead, global-setup.ts builds the empty databases once per run, and each test
 * copies one to its own database file: `push` (`prisma db push`, the schema only)
 * or `migrations` (`prisma migrate deploy`, with the _prisma_migrations table),
 * matching what the test used to run.
 */

import * as fs from 'fs';
import * as path from 'path';

export type TemplateKind = 'push' | 'migrations';

/** The empty databases global-setup.ts creates once per Playwright run. */
export const TEMPLATE_DB_PATHS: Record<TemplateKind, string> = {
  push: path.join(__dirname, '..', '.template', 'push.db'),
  migrations: path.join(__dirname, '..', '.template', 'migrations.db'),
};

const SQLITE_SIDE_FILES = ['-journal', '-wal', '-shm'];

/**
 * Replace `dbPath` with a fresh copy of a template database. Call it before
 * anything (the app, a PrismaClient) opens `dbPath`.
 */
export function resetTestDatabase(
  dbPath: string,
  kind: TemplateKind = 'push'
): void {
  const template = TEMPLATE_DB_PATHS[kind];
  if (!fs.existsSync(template)) {
    throw new Error(
      `E2E template database missing at ${template}; it is created by tests/e2e/global-setup.ts.`
    );
  }
  for (const file of [dbPath, ...SQLITE_SIDE_FILES.map((s) => dbPath + s)]) {
    fs.rmSync(file, { force: true });
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.copyFileSync(template, dbPath);
}
