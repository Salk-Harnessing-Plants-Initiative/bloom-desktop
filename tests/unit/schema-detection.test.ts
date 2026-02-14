/**
 * Unit Tests: Schema Version Detection
 *
 * Tests for detecting the schema version of a SQLite database.
 * These tests follow TDD - they are written before the implementation.
 *
 * Schema versions:
 * - v1 (init): PlantAccessionMappings has accession_id, no genotype_id
 * - v2 (add_genotype_id): PlantAccessionMappings has genotype_id
 * - v3 (cleanup): PlantAccessionMappings has accession_name, no accession_id
 * - migrated: Database has _prisma_migrations table
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import {
  detectSchemaVersion,
  SchemaVersion,
} from '../../scripts/detect-schema-version';

const FIXTURES_DIR = path.join(__dirname, '../fixtures/databases');

describe('detectSchemaVersion', () => {
  // Ensure fixtures exist before running tests
  beforeAll(() => {
    const fixtures = ['v1-init.db', 'v2-add-genotype.db', 'v3-current.db'];
    for (const fixture of fixtures) {
      const fixturePath = path.join(FIXTURES_DIR, fixture);
      if (!fs.existsSync(fixturePath)) {
        throw new Error(
          `Fixture not found: ${fixturePath}. Run: npx ts-node scripts/generate-db-fixtures.ts`
        );
      }
    }
  });

  describe('detects schema versions from fixtures', () => {
    it('detects v1 schema (has accession_id, no genotype_id)', async () => {
      const dbPath = path.join(FIXTURES_DIR, 'v1-init.db');
      const version = await detectSchemaVersion(dbPath);
      expect(version).toBe('v1');
    });

    it('detects v2 schema (has genotype_id)', async () => {
      const dbPath = path.join(FIXTURES_DIR, 'v2-add-genotype.db');
      const version = await detectSchemaVersion(dbPath);
      expect(version).toBe('v2');
    });

    it('detects v3 schema (has accession_name, no accession_id)', async () => {
      const dbPath = path.join(FIXTURES_DIR, 'v3-current.db');
      const version = await detectSchemaVersion(dbPath);
      expect(version).toBe('v3');
    });
  });

  describe('detects migrated databases', () => {
    let tempDbPath: string;

    afterAll(() => {
      // Clean up temp database
      if (tempDbPath && fs.existsSync(tempDbPath)) {
        fs.unlinkSync(tempDbPath);
      }
    });

    it('returns "migrated" for databases with _prisma_migrations table', async () => {
      // Create a temp database with V3 schema AND _prisma_migrations table
      tempDbPath = path.join(FIXTURES_DIR, 'temp-migrated.db');
      const db = new Database(tempDbPath);

      try {
        // Create V3 schema
        db.exec(`
          CREATE TABLE "PlantAccessionMappings" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "plant_barcode" TEXT NOT NULL,
            "accession_name" TEXT,
            "accession_file_id" TEXT NOT NULL
          );
        `);

        // Add _prisma_migrations table (this marks it as migrated)
        db.exec(`
          CREATE TABLE "_prisma_migrations" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "checksum" TEXT NOT NULL,
            "finished_at" DATETIME,
            "migration_name" TEXT NOT NULL,
            "logs" TEXT,
            "rolled_back_at" DATETIME,
            "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "applied_steps_count" INTEGER NOT NULL DEFAULT 0
          );
        `);

        // Insert a migration record
        db.exec(`
          INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at)
          VALUES ('test-migration', 'abc123', '20251028040530_init', datetime('now'));
        `);
      } finally {
        db.close();
      }

      const version = await detectSchemaVersion(tempDbPath);
      expect(version).toBe('migrated');

      // Clean up
      fs.unlinkSync(tempDbPath);
      tempDbPath = '';
    });
  });

  describe('handles edge cases', () => {
    let tempDbPath: string;

    afterAll(() => {
      // Clean up temp database
      if (tempDbPath && fs.existsSync(tempDbPath)) {
        fs.unlinkSync(tempDbPath);
      }
    });

    it('throws error for non-existent database', async () => {
      await expect(
        detectSchemaVersion('/nonexistent/path/database.db')
      ).rejects.toThrow();
    });

    it('handles empty database gracefully', async () => {
      tempDbPath = path.join(FIXTURES_DIR, 'temp-empty.db');

      // Create empty database
      const db = new Database(tempDbPath);
      db.close();

      await expect(detectSchemaVersion(tempDbPath)).rejects.toThrow(
        /PlantAccessionMappings.*not found|unknown schema/i
      );

      // Clean up
      fs.unlinkSync(tempDbPath);
      tempDbPath = '';
    });

    it('handles database without PlantAccessionMappings table', async () => {
      tempDbPath = path.join(FIXTURES_DIR, 'temp-no-mappings.db');

      // Create database with only some tables
      const db = new Database(tempDbPath);
      db.exec(`
        CREATE TABLE "Scientist" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "name" TEXT NOT NULL,
          "email" TEXT NOT NULL
        );
      `);
      db.close();

      await expect(detectSchemaVersion(tempDbPath)).rejects.toThrow(
        /PlantAccessionMappings.*not found|unknown schema/i
      );

      // Clean up
      fs.unlinkSync(tempDbPath);
      tempDbPath = '';
    });

    it('returns unknown for unrecognized schema structure', async () => {
      tempDbPath = path.join(FIXTURES_DIR, 'temp-unknown.db');

      // Create database with unusual PlantAccessionMappings structure
      const db = new Database(tempDbPath);
      db.exec(`
        CREATE TABLE "PlantAccessionMappings" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "plant_barcode" TEXT NOT NULL,
          "some_other_field" TEXT
        );
      `);
      db.close();

      const version = await detectSchemaVersion(tempDbPath);
      expect(version).toBe('unknown');

      // Clean up
      fs.unlinkSync(tempDbPath);
      tempDbPath = '';
    });
  });

  describe('version detection logic', () => {
    it('correctly identifies v1 by presence of accession_id and absence of genotype_id', async () => {
      // V1 has: accession_id, plant_barcode, accession_file_id
      // V1 does NOT have: genotype_id, accession_name
      const dbPath = path.join(FIXTURES_DIR, 'v1-init.db');
      const db = new Database(dbPath, { readonly: true });

      try {
        const columns = db
          .prepare("PRAGMA table_info('PlantAccessionMappings')")
          .all() as Array<{ name: string }>;
        const columnNames = columns.map((c) => c.name);

        expect(columnNames).toContain('accession_id');
        expect(columnNames).toContain('plant_barcode');
        expect(columnNames).toContain('accession_file_id');
        expect(columnNames).not.toContain('genotype_id');
        expect(columnNames).not.toContain('accession_name');
      } finally {
        db.close();
      }
    });

    it('correctly identifies v2 by presence of genotype_id', async () => {
      // V2 has: accession_id, plant_barcode, genotype_id, accession_file_id
      const dbPath = path.join(FIXTURES_DIR, 'v2-add-genotype.db');
      const db = new Database(dbPath, { readonly: true });

      try {
        const columns = db
          .prepare("PRAGMA table_info('PlantAccessionMappings')")
          .all() as Array<{ name: string }>;
        const columnNames = columns.map((c) => c.name);

        expect(columnNames).toContain('accession_id');
        expect(columnNames).toContain('genotype_id');
        expect(columnNames).not.toContain('accession_name');
      } finally {
        db.close();
      }
    });

    it('correctly identifies v3 by presence of accession_name and absence of accession_id', async () => {
      // V3 has: plant_barcode, accession_name, accession_file_id
      // V3 does NOT have: accession_id, genotype_id
      const dbPath = path.join(FIXTURES_DIR, 'v3-current.db');
      const db = new Database(dbPath, { readonly: true });

      try {
        const columns = db
          .prepare("PRAGMA table_info('PlantAccessionMappings')")
          .all() as Array<{ name: string }>;
        const columnNames = columns.map((c) => c.name);

        expect(columnNames).toContain('plant_barcode');
        expect(columnNames).toContain('accession_name');
        expect(columnNames).toContain('accession_file_id');
        expect(columnNames).not.toContain('accession_id');
        expect(columnNames).not.toContain('genotype_id');
      } finally {
        db.close();
      }
    });
  });
});

describe('SchemaVersion type', () => {
  it('includes all expected version values', () => {
    const validVersions: SchemaVersion[] = [
      'v1',
      'v2',
      'v3',
      'migrated',
      'unknown',
    ];
    // TypeScript will error if any of these are not valid SchemaVersion values
    expect(validVersions).toHaveLength(5);
  });
});
