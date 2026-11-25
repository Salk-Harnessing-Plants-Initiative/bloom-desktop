/**
 * Integration test: the Accessions page's search over plant mappings on a real
 * database, through the real Prisma client. Barcodes and accession names match in
 * any case, counts are per file, and %, _ and \ in the text match only themselves.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { searchAccessionFiles } from '../../src/main/accession-search-handlers';

const MIGRATIONS_DIR = path.join(__dirname, '../../prisma/migrations');

describe('accession file search on a real database', () => {
  let dir: string;
  let prisma: PrismaClient;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-accession-search-'));
    const dbPath = path.join(dir, 'bloom.db');
    const db = new Database(dbPath);
    for (const name of fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((n) => /^\d{14}_/.test(n))
      .sort()) {
      db.exec(
        fs.readFileSync(
          path.join(MIGRATIONS_DIR, name, 'migration.sql'),
          'utf8'
        )
      );
    }
    db.exec(`
      INSERT INTO "Accessions" ("id", "name") VALUES
        ('stl', 'STL_soy_accessions.xlsx'),
        ('kcs', 'KCS_lines.xlsx'),
        ('odd', 'Odd_barcodes.xlsx');
    `);
    const add = db.prepare(
      `INSERT INTO "PlantAccessionMappings" ("id", "plant_barcode", "accession_name", "accession_file_id")
       VALUES (?, ?, ?, ?)`
    );
    add.run('m1', 'STL-001', 'Williams 82', 'stl');
    add.run('m2', 'STL-002', 'Williams 82', 'stl');
    add.run('m3', 'STL-003', 'Col-0', 'stl');
    for (let i = 1; i <= 4; i++) add.run(`k${i}`, `KCS-00${i}`, 'Col-0', 'kcs');
    add.run('o1', 'A_1', null, 'odd');
    add.run('o2', 'AB1', 'x', 'odd');
    add.run('o3', '50%-mix', 'x', 'odd');
    db.close();
    prisma = new PrismaClient({
      datasources: { db: { url: `file:${dbPath}` } },
    });
  });

  afterEach(async () => {
    await prisma.$disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const search = async (text: string) =>
    Object.fromEntries(
      (await searchAccessionFiles({ db: prisma }, text)).data!.map((m) => [
        m.accession_file_id,
        m.matching_plants,
      ])
    );

  it('finds the file holding a barcode, in any case', async () => {
    expect(await search('stl-003')).toEqual({ stl: 1 });
    expect(await search('STL-00')).toEqual({ stl: 3 });
  });

  it('counts the plants of each file whose accession name matches', async () => {
    expect(await search('col-0')).toEqual({ stl: 1, kcs: 4 });
    expect(await search('williams')).toEqual({ stl: 2 });
  });

  it('takes % and _ literally, and skips plants with no accession name safely', async () => {
    expect(await search('a_1')).toEqual({ odd: 1 });
    expect(await search('50%')).toEqual({ odd: 1 });
    expect(await search('nothing like this')).toEqual({});
  });
});
