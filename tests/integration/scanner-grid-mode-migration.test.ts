/**
 * Integration test: the migration that adds GraviScanner.grid_mode (#491).
 *
 * The earlier migrations are replayed on an in-memory database, scanners are
 * saved as a station without the column would have them, then the new
 * migration runs. The column must match the GraviScan rig build's
 * (`TEXT NOT NULL DEFAULT '4grid'`), whose databases already have it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

const MIGRATIONS_DIR = path.join(__dirname, '../../prisma/migrations');
const GRID_MODE_MIGRATION = '20261106120000_add_scanner_grid_mode';

function migrationSql(name: string): string {
  return fs.readFileSync(
    path.join(MIGRATIONS_DIR, name, 'migration.sql'),
    'utf8'
  );
}

function earlierMigrations(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{14}_/.test(name))
    .sort()
    .filter((name) => name < GRID_MODE_MIGRATION);
}

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
}

describe('add_scanner_grid_mode migration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    for (const name of earlierMigrations()) db.exec(migrationSql(name));
    db.pragma('foreign_keys = ON');
  });

  function addScanner(id: string, port: string): void {
    db.prepare(
      `INSERT INTO "GraviScanner" ("id", "name", "usb_port", "updatedAt")
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
    ).run(id, `Scanner ${id}`, port);
  }

  it('adds grid_mode as TEXT NOT NULL DEFAULT 4grid, as on the rig', () => {
    db.exec(migrationSql(GRID_MODE_MIGRATION));

    const column = (
      db.prepare(`PRAGMA table_info("GraviScanner")`).all() as ColumnInfo[]
    ).find((c) => c.name === 'grid_mode');

    expect(column).toEqual(
      expect.objectContaining({
        type: 'TEXT',
        notnull: 1,
        dflt_value: "'4grid'",
      })
    );
  });

  it('gives every existing scanner 4grid', () => {
    addScanner('a', '1-1');
    addScanner('b', '1-2');

    db.exec(migrationSql(GRID_MODE_MIGRATION));

    const rows = db
      .prepare(`SELECT "id", "grid_mode" FROM "GraviScanner" ORDER BY "id"`)
      .all();
    expect(rows).toEqual([
      { id: 'a', grid_mode: '4grid' },
      { id: 'b', grid_mode: '4grid' },
    ]);
  });

  it('stores a different grid mode per scanner after it runs', () => {
    db.exec(migrationSql(GRID_MODE_MIGRATION));
    addScanner('a', '1-1');
    addScanner('b', '1-2');

    db.prepare(
      `UPDATE "GraviScanner" SET "grid_mode" = '2grid' WHERE "id" = 'a'`
    ).run();

    const rows = db
      .prepare(`SELECT "id", "grid_mode" FROM "GraviScanner" ORDER BY "id"`)
      .all();
    expect(rows).toEqual([
      { id: 'a', grid_mode: '2grid' },
      { id: 'b', grid_mode: '4grid' },
    ]);
  });
});
