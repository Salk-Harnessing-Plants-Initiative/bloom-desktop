/**
 * Unit tests for the better-sqlite3-based table-existence check, ported from
 * scripts/lib/verify-database.sh's verify_table_exists()/verify_schema().
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { verifyDbTables } from '../integration/lib/verify-db-tables';

const tempDbPaths: string[] = [];

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-db-tables-test-'));
  const dbPath = path.join(dir, 'test.db');
  tempDbPaths.push(dbPath);
  return dbPath;
}

afterEach(() => {
  for (const dbPath of tempDbPaths.splice(0)) {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  }
});

describe('verifyDbTables', () => {
  it('reports all present when every expected table exists', () => {
    const dbPath = makeTempDbPath();
    const db = new Database(dbPath);
    db.exec('CREATE TABLE Scientist (id INTEGER PRIMARY KEY);');
    db.exec('CREATE TABLE Scan (id INTEGER PRIMARY KEY);');
    db.close();

    const result = verifyDbTables(dbPath, ['Scientist', 'Scan']);

    expect(result.allPresent).toBe(true);
    expect(result.missingTables).toEqual([]);
  });

  it('reports the specific list of missing tables when several are absent', () => {
    const dbPath = makeTempDbPath();
    const db = new Database(dbPath);
    db.exec('CREATE TABLE Scientist (id INTEGER PRIMARY KEY);');
    db.close();

    const result = verifyDbTables(dbPath, [
      'Scientist',
      'Scan',
      'Image',
      'GraviScan',
    ]);

    expect(result.allPresent).toBe(false);
    expect(result.missingTables).toEqual(['Scan', 'Image', 'GraviScan']);
  });

  it('reports every table missing against a database with no matching tables', () => {
    const dbPath = makeTempDbPath();
    const db = new Database(dbPath);
    db.exec('CREATE TABLE UnrelatedTable (id INTEGER PRIMARY KEY);');
    db.close();

    const result = verifyDbTables(dbPath, ['Scientist', 'Scan']);

    expect(result.allPresent).toBe(false);
    expect(result.missingTables).toEqual(['Scientist', 'Scan']);
  });
});
