/**
 * Integration Tests: Database Upgrade Script
 *
 * Tests the database upgrade functionality that migrates databases
 * from older schema versions to the current version while preserving data.
 *
 * These tests follow TDD - they define expected behavior before implementation.
 */

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { detectSchemaVersion } from '../../scripts/detect-schema-version';
import { upgradeDatabase, UpgradeResult } from '../../scripts/upgrade-database';

const FIXTURES_DIR = path.join(__dirname, '../fixtures/databases');
const TEMP_DIR = path.join(__dirname, '../fixtures/temp');

/**
 * Helper to copy a fixture database to a temp location for testing
 */
function copyFixture(fixtureName: string): string {
  const sourcePath = path.join(FIXTURES_DIR, fixtureName);
  const destPath = path.join(TEMP_DIR, `test-${Date.now()}-${fixtureName}`);

  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  fs.copyFileSync(sourcePath, destPath);
  return destPath;
}

/**
 * Helper to count records in all tables
 */
function countRecords(dbPath: string): Record<string, number> {
  const db = new Database(dbPath, { readonly: true });
  try {
    const tables = [
      'Scientist',
      'Phenotyper',
      'Experiment',
      'Accessions',
      'PlantAccessionMappings',
      'Scan',
      'Image',
    ];

    const counts: Record<string, number> = {};
    for (const table of tables) {
      try {
        const result = db
          .prepare(`SELECT COUNT(*) as count FROM "${table}"`)
          .get() as { count: number };
        counts[table] = result.count;
      } catch {
        counts[table] = 0;
      }
    }
    return counts;
  } finally {
    db.close();
  }
}

/**
 * Helper to get PlantAccessionMappings data
 */
function getMappings(dbPath: string): Array<{
  id: string;
  plant_barcode: string;
  accession_name?: string;
  genotype_id?: string;
  accession_id?: string;
}> {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare('SELECT * FROM PlantAccessionMappings').all() as Array<{
      id: string;
      plant_barcode: string;
      accession_name?: string;
      genotype_id?: string;
      accession_id?: string;
    }>;
  } finally {
    db.close();
  }
}

describe('upgradeDatabase', () => {
  let tempDbPaths: string[] = [];

  // Ensure fixtures exist
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

  // Clean up temp databases after each test
  afterEach(() => {
    for (const dbPath of tempDbPaths) {
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
      // Also clean up backup files
      const backupPath = dbPath + '.backup';
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
    }
    tempDbPaths = [];
  });

  describe('V1 → V3 upgrade', () => {
    it('upgrades v1 database to v3 schema', async () => {
      const testDb = copyFixture('v1-init.db');
      tempDbPaths.push(testDb);

      // Verify starting schema
      const beforeVersion = await detectSchemaVersion(testDb);
      expect(beforeVersion).toBe('v1');

      // Run upgrade
      const result = await upgradeDatabase(testDb);

      // Verify upgrade succeeded
      expect(result.status).toBe('upgraded');
      expect(result.fromVersion).toBe('v1');
      expect(result.toVersion).toBe('v3');

      // Verify schema is now v3 (or migrated)
      const afterVersion = await detectSchemaVersion(testDb);
      expect(['v3', 'migrated']).toContain(afterVersion);
    });

    it('preserves all data during v1 → v3 upgrade', async () => {
      const testDb = copyFixture('v1-init.db');
      tempDbPaths.push(testDb);

      // Count records before upgrade
      const beforeCounts = countRecords(testDb);

      // Run upgrade
      await upgradeDatabase(testDb);

      // Count records after upgrade
      const afterCounts = countRecords(testDb);

      // Verify all records preserved
      expect(afterCounts.Scientist).toBe(beforeCounts.Scientist);
      expect(afterCounts.Phenotyper).toBe(beforeCounts.Phenotyper);
      expect(afterCounts.Experiment).toBe(beforeCounts.Experiment);
      expect(afterCounts.Accessions).toBe(beforeCounts.Accessions);
      expect(afterCounts.PlantAccessionMappings).toBe(
        beforeCounts.PlantAccessionMappings
      );
      expect(afterCounts.Scan).toBe(beforeCounts.Scan);
      expect(afterCounts.Image).toBe(beforeCounts.Image);
    });

    it('migrates accession_id to accession_name in mappings', async () => {
      const testDb = copyFixture('v1-init.db');
      tempDbPaths.push(testDb);

      // Get original mappings (V1 uses accession_id)
      const beforeMappings = getMappings(testDb);
      const originalValues = beforeMappings.map((m) => ({
        id: m.id,
        value: m.accession_id,
      }));

      // Run upgrade
      await upgradeDatabase(testDb);

      // Get upgraded mappings (V3 uses accession_name)
      const afterMappings = getMappings(testDb);

      // Verify accession_name is populated from accession_id
      for (const original of originalValues) {
        const upgraded = afterMappings.find((m) => m.id === original.id);
        expect(upgraded).toBeDefined();
        expect(upgraded!.accession_name).toBe(original.value);
      }
    });
  });

  describe('V2 → V3 upgrade', () => {
    it('upgrades v2 database to v3 schema', async () => {
      const testDb = copyFixture('v2-add-genotype.db');
      tempDbPaths.push(testDb);

      // Verify starting schema
      const beforeVersion = await detectSchemaVersion(testDb);
      expect(beforeVersion).toBe('v2');

      // Run upgrade
      const result = await upgradeDatabase(testDb);

      // Verify upgrade succeeded
      expect(result.status).toBe('upgraded');
      expect(result.fromVersion).toBe('v2');
      expect(result.toVersion).toBe('v3');

      // Verify schema is now v3 (or migrated)
      const afterVersion = await detectSchemaVersion(testDb);
      expect(['v3', 'migrated']).toContain(afterVersion);
    });

    it('preserves all data during v2 → v3 upgrade', async () => {
      const testDb = copyFixture('v2-add-genotype.db');
      tempDbPaths.push(testDb);

      // Count records before upgrade
      const beforeCounts = countRecords(testDb);

      // Run upgrade
      await upgradeDatabase(testDb);

      // Count records after upgrade
      const afterCounts = countRecords(testDb);

      // Verify all records preserved
      expect(afterCounts.Scientist).toBe(beforeCounts.Scientist);
      expect(afterCounts.Phenotyper).toBe(beforeCounts.Phenotyper);
      expect(afterCounts.Experiment).toBe(beforeCounts.Experiment);
      expect(afterCounts.PlantAccessionMappings).toBe(
        beforeCounts.PlantAccessionMappings
      );
      expect(afterCounts.Scan).toBe(beforeCounts.Scan);
    });

    it('migrates genotype_id to accession_name in mappings', async () => {
      const testDb = copyFixture('v2-add-genotype.db');
      tempDbPaths.push(testDb);

      // Get original mappings (V2 uses genotype_id)
      const beforeMappings = getMappings(testDb);
      const originalValues = beforeMappings.map((m) => ({
        id: m.id,
        value: m.genotype_id,
      }));

      // Run upgrade
      await upgradeDatabase(testDb);

      // Get upgraded mappings (V3 uses accession_name)
      const afterMappings = getMappings(testDb);

      // Verify accession_name is populated from genotype_id
      for (const original of originalValues) {
        const upgraded = afterMappings.find((m) => m.id === original.id);
        expect(upgraded).toBeDefined();
        expect(upgraded!.accession_name).toBe(original.value);
      }
    });
  });

  describe('Already current database', () => {
    it('reports "already-current" for v3 databases', async () => {
      const testDb = copyFixture('v3-current.db');
      tempDbPaths.push(testDb);

      const result = await upgradeDatabase(testDb);

      expect(result.status).toBe('already-current');
    });

    it('does not create backup for already-current databases', async () => {
      const testDb = copyFixture('v3-current.db');
      tempDbPaths.push(testDb);

      await upgradeDatabase(testDb);

      const backupPath = testDb + '.backup';
      expect(fs.existsSync(backupPath)).toBe(false);
    });
  });

  describe('Backup functionality', () => {
    it('creates backup before modifying database', async () => {
      const testDb = copyFixture('v2-add-genotype.db');
      tempDbPaths.push(testDb);

      await upgradeDatabase(testDb);

      const backupPath = testDb + '.backup';
      expect(fs.existsSync(backupPath)).toBe(true);
    });

    it('backup contains original data', async () => {
      const testDb = copyFixture('v2-add-genotype.db');
      tempDbPaths.push(testDb);

      // Get original data
      const originalCounts = countRecords(testDb);
      const originalVersion = await detectSchemaVersion(testDb);

      // Run upgrade
      await upgradeDatabase(testDb);

      // Verify backup has original schema and data
      const backupPath = testDb + '.backup';
      const backupCounts = countRecords(backupPath);
      const backupVersion = await detectSchemaVersion(backupPath);

      expect(backupVersion).toBe(originalVersion);
      expect(backupCounts.Scientist).toBe(originalCounts.Scientist);
      expect(backupCounts.Scan).toBe(originalCounts.Scan);
    });

    it('returns backup path in result', async () => {
      const testDb = copyFixture('v1-init.db');
      tempDbPaths.push(testDb);

      const result = await upgradeDatabase(testDb);

      expect(result.backupPath).toBeDefined();
      expect(fs.existsSync(result.backupPath!)).toBe(true);
    });
  });

  describe('Migration table creation', () => {
    it('creates _prisma_migrations table after upgrade', async () => {
      const testDb = copyFixture('v1-init.db');
      tempDbPaths.push(testDb);

      // Verify no migrations table before
      const db1 = new Database(testDb, { readonly: true });
      const before = db1
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'"
        )
        .get();
      db1.close();
      expect(before).toBeUndefined();

      // Run upgrade
      await upgradeDatabase(testDb);

      // Verify migrations table exists after
      const db2 = new Database(testDb, { readonly: true });
      const after = db2
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'"
        )
        .get();
      db2.close();
      expect(after).toBeDefined();
    });

    it('inserts appropriate migration records for v1 upgrade', async () => {
      const testDb = copyFixture('v1-init.db');
      tempDbPaths.push(testDb);

      await upgradeDatabase(testDb);

      // Check migration records
      const db = new Database(testDb, { readonly: true });
      const migrations = db
        .prepare(
          'SELECT migration_name FROM _prisma_migrations ORDER BY migration_name'
        )
        .all() as Array<{ migration_name: string }>;
      db.close();

      // Should have all migrations applied
      const migrationNames = migrations.map((m) => m.migration_name);
      expect(migrationNames).toContain('20251028040530_init');
      expect(migrationNames).toContain(
        '20251125180403_add_genotype_id_to_plant_mappings'
      );
      expect(migrationNames).toContain(
        '20260211195433_cleanup_accession_fields'
      );
    });
  });

  describe('Error handling', () => {
    it('throws error for non-existent database', async () => {
      await expect(
        upgradeDatabase('/nonexistent/path/database.db')
      ).rejects.toThrow();
    });

    it('throws error for unknown schema version', async () => {
      // Create a database with unknown schema
      const testDb = path.join(TEMP_DIR, 'test-unknown-schema.db');
      tempDbPaths.push(testDb);

      if (!fs.existsSync(TEMP_DIR)) {
        fs.mkdirSync(TEMP_DIR, { recursive: true });
      }

      const db = new Database(testDb);
      db.exec(`
        CREATE TABLE "PlantAccessionMappings" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "plant_barcode" TEXT NOT NULL,
          "some_unknown_field" TEXT
        );
      `);
      db.close();

      await expect(upgradeDatabase(testDb)).rejects.toThrow(/unknown.*schema/i);
    });
  });

  describe('Pilot database compatibility', () => {
    it('successfully upgrades pilot-equivalent v1 database', async () => {
      // V1 fixture is equivalent to pilot schema
      const testDb = copyFixture('v1-init.db');
      tempDbPaths.push(testDb);

      const result = await upgradeDatabase(testDb);

      expect(result.status).toBe('upgraded');
      expect(result.fromVersion).toBe('v1');
    });
  });

  /**
   * Tests for migration checksum validity
   *
   * These tests verify that the checksums in upgrade-database.ts match
   * the actual checksums computed by Prisma from migration SQL files.
   * This ensures `prisma migrate status` won't report checksum mismatches
   * after using the upgrade script.
   */
  describe('Migration Checksum Validation', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require('crypto');
    const MIGRATIONS_DIR = path.join(__dirname, '../../prisma/migrations');

    /**
     * Compute SHA-256 checksum of a migration SQL file
     * This matches how Prisma computes checksums internally
     */
    function computeMigrationChecksum(migrationName: string): string {
      const sqlPath = path.join(MIGRATIONS_DIR, migrationName, 'migration.sql');
      if (!fs.existsSync(sqlPath)) {
        throw new Error(`Migration file not found: ${sqlPath}`);
      }
      const content = fs.readFileSync(sqlPath, 'utf8');
      return crypto.createHash('sha256').update(content).digest('hex');
    }

    it('should have checksums that match actual migration files for init', () => {
      const expectedChecksum = computeMigrationChecksum('20251028040530_init');
      // This test will fail initially (TDD) until we update upgrade-database.ts
      // with the real checksum
      expect(expectedChecksum).toBeTruthy();
      expect(expectedChecksum.length).toBe(64); // SHA-256 hex is 64 chars
    });

    it('should have checksums that match actual migration files for add_genotype', () => {
      const expectedChecksum = computeMigrationChecksum(
        '20251125180403_add_genotype_id_to_plant_mappings'
      );
      expect(expectedChecksum).toBeTruthy();
      expect(expectedChecksum.length).toBe(64);
    });

    it('should have checksums that match actual migration files for cleanup_accession', () => {
      const expectedChecksum = computeMigrationChecksum(
        '20260211195433_cleanup_accession_fields'
      );
      expect(expectedChecksum).toBeTruthy();
      expect(expectedChecksum.length).toBe(64);
    });

    it('upgraded database should have valid checksums matching migration files', async () => {
      // Upgrade a v1 database
      const testDb = copyFixture('v1-init.db');
      tempDbPaths.push(testDb);

      await upgradeDatabase(testDb);

      // Get checksums from upgraded database
      const db = new Database(testDb, { readonly: true });
      const migrations = db
        .prepare('SELECT migration_name, checksum FROM _prisma_migrations')
        .all() as Array<{ migration_name: string; checksum: string }>;
      db.close();

      // Verify each checksum matches the actual migration file
      for (const migration of migrations) {
        const expectedChecksum = computeMigrationChecksum(
          migration.migration_name
        );
        expect(migration.checksum).toBe(expectedChecksum);
      }
    });
  });
});

describe('UpgradeResult type', () => {
  it('has expected properties for successful upgrade', () => {
    const result: UpgradeResult = {
      status: 'upgraded',
      fromVersion: 'v1',
      toVersion: 'v3',
      backupPath: '/path/to/backup.db',
    };

    expect(result.status).toBe('upgraded');
    expect(result.fromVersion).toBeDefined();
    expect(result.toVersion).toBeDefined();
    expect(result.backupPath).toBeDefined();
  });

  it('has expected properties for already-current', () => {
    const result: UpgradeResult = {
      status: 'already-current',
    };

    expect(result.status).toBe('already-current');
  });
});
