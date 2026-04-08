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
import {
  upgradeDatabase,
  UpgradeResult,
  MIGRATIONS,
} from '../../scripts/upgrade-database';

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

  describe('V1 → V4 upgrade', () => {
    it('upgrades v1 database to v4 schema', async () => {
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
      expect(result.toVersion).toBe('v4');

      // Verify schema is now v4
      const afterVersion = await detectSchemaVersion(testDb);
      expect(afterVersion).toBe('v4');
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

      // Get upgraded mappings (V3+ uses accession_name)
      const afterMappings = getMappings(testDb);

      // Verify accession_name is populated from accession_id
      for (const original of originalValues) {
        const upgraded = afterMappings.find((m) => m.id === original.id);
        expect(upgraded).toBeDefined();
        expect(upgraded!.accession_name).toBe(original.value);
      }
    });

    it('adds experiment_type defaulting to cylinderscan during v1 → v4 upgrade', async () => {
      const testDb = copyFixture('v1-init.db');
      tempDbPaths.push(testDb);

      await upgradeDatabase(testDb);

      const db = new Database(testDb, { readonly: true });
      const experiments = db
        .prepare('SELECT experiment_type FROM Experiment')
        .all() as Array<{ experiment_type: string }>;
      db.close();

      for (const exp of experiments) {
        expect(exp.experiment_type).toBe('cylinderscan');
      }
    });
  });

  describe('V2 → V4 upgrade', () => {
    it('upgrades v2 database to v4 schema', async () => {
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
      expect(result.toVersion).toBe('v4');

      // Verify schema is now v4
      const afterVersion = await detectSchemaVersion(testDb);
      expect(afterVersion).toBe('v4');
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

      // Get upgraded mappings (V3+ uses accession_name)
      const afterMappings = getMappings(testDb);

      // Verify accession_name is populated from genotype_id
      for (const original of originalValues) {
        const upgraded = afterMappings.find((m) => m.id === original.id);
        expect(upgraded).toBeDefined();
        expect(upgraded!.accession_name).toBe(original.value);
      }
    });
  });

  describe('V3 → V4 upgrade', () => {
    it('upgrades v3 database to v4 schema', async () => {
      const testDb = copyFixture('v3-current.db');
      tempDbPaths.push(testDb);

      const beforeVersion = await detectSchemaVersion(testDb);
      expect(beforeVersion).toBe('v3');

      const result = await upgradeDatabase(testDb);

      expect(result.status).toBe('upgraded');
      expect(result.fromVersion).toBe('v3');
      expect(result.toVersion).toBe('v4');

      const afterVersion = await detectSchemaVersion(testDb);
      expect(afterVersion).toBe('v4');
    });

    it('preserves existing experiments with experiment_type = cylinderscan', async () => {
      const testDb = copyFixture('v3-current.db');
      tempDbPaths.push(testDb);

      await upgradeDatabase(testDb);

      const db = new Database(testDb, { readonly: true });
      const experiments = db
        .prepare('SELECT experiment_type FROM Experiment')
        .all() as Array<{ experiment_type: string }>;
      db.close();

      expect(experiments.length).toBeGreaterThan(0);
      for (const exp of experiments) {
        expect(exp.experiment_type).toBe('cylinderscan');
      }
    });

    it('creates all 8 GraviScan tables after v3 → v4 upgrade', async () => {
      const testDb = copyFixture('v3-current.db');
      tempDbPaths.push(testDb);

      await upgradeDatabase(testDb);

      const db = new Database(testDb, { readonly: true });
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        .all() as Array<{ name: string }>;
      db.close();

      const tableNames = tables.map((t) => t.name);
      const graviTables = [
        'GraviScan',
        'GraviScanSession',
        'GraviScanPlateAssignment',
        'GraviImage',
        'GraviScanner',
        'GraviConfig',
        'GraviPlateAccession',
        'GraviPlateSectionMapping',
      ];

      for (const table of graviTables) {
        expect(tableNames).toContain(table);
      }
    });

    it('preserves all data during v3 → v4 upgrade', async () => {
      const testDb = copyFixture('v3-current.db');
      tempDbPaths.push(testDb);

      const beforeCounts = countRecords(testDb);

      await upgradeDatabase(testDb);

      const afterCounts = countRecords(testDb);

      expect(afterCounts.Scientist).toBe(beforeCounts.Scientist);
      expect(afterCounts.Phenotyper).toBe(beforeCounts.Phenotyper);
      expect(afterCounts.Experiment).toBe(beforeCounts.Experiment);
      expect(afterCounts.PlantAccessionMappings).toBe(
        beforeCounts.PlantAccessionMappings
      );
      expect(afterCounts.Scan).toBe(beforeCounts.Scan);
      expect(afterCounts.Image).toBe(beforeCounts.Image);
    });
  });

  describe('Migrated-V3 → V4 upgrade', () => {
    it('upgrades a migrated v3 database to v4', async () => {
      // Create a v3 DB with _prisma_migrations table (simulates prisma migrate deploy on v3)
      const testDb = path.join(TEMP_DIR, `test-${Date.now()}-migrated-v3.db`);
      tempDbPaths.push(testDb);

      if (!fs.existsSync(TEMP_DIR)) {
        fs.mkdirSync(TEMP_DIR, { recursive: true });
      }

      // Copy v3 fixture and add migrations table
      fs.copyFileSync(path.join(FIXTURES_DIR, 'v3-current.db'), testDb);
      const db = new Database(testDb);
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
        INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, started_at, applied_steps_count)
        VALUES ('m1', 'abc', '20251028040530_init', datetime('now'), datetime('now'), 1);
        INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, started_at, applied_steps_count)
        VALUES ('m2', 'def', '20251125180403_add_genotype_id_to_plant_mappings', datetime('now'), datetime('now'), 1);
        INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, started_at, applied_steps_count)
        VALUES ('m3', 'ghi', '20260211195433_cleanup_accession_fields', datetime('now'), datetime('now'), 1);
      `);
      db.close();

      const beforeVersion = await detectSchemaVersion(testDb);
      expect(beforeVersion).toBe('migrated');

      const result = await upgradeDatabase(testDb);

      expect(result.status).toBe('upgraded');
      expect(result.fromVersion).toBe('migrated');
      expect(result.toVersion).toBe('v4');

      const afterVersion = await detectSchemaVersion(testDb);
      expect(afterVersion).toBe('v4');
    });
  });

  describe('Empty V3 → V4 upgrade', () => {
    it('upgrades empty v3 database to v4 cleanly', async () => {
      const testDb = path.join(TEMP_DIR, `test-${Date.now()}-empty-v3.db`);
      tempDbPaths.push(testDb);

      if (!fs.existsSync(TEMP_DIR)) {
        fs.mkdirSync(TEMP_DIR, { recursive: true });
      }

      // Create v3 schema with no data
      const db = new Database(testDb);
      db.exec(`
        CREATE TABLE "Phenotyper" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "name" TEXT NOT NULL,
          "email" TEXT NOT NULL
        );
        CREATE UNIQUE INDEX "Phenotyper_email_key" ON "Phenotyper"("email");
        CREATE TABLE "Scientist" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "name" TEXT NOT NULL,
          "email" TEXT NOT NULL
        );
        CREATE UNIQUE INDEX "Scientist_email_key" ON "Scientist"("email");
        CREATE TABLE "Accessions" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "name" TEXT NOT NULL,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE "Experiment" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "name" TEXT NOT NULL,
          "species" TEXT NOT NULL,
          "scientist_id" TEXT,
          "accession_id" TEXT,
          CONSTRAINT "Experiment_accession_id_fkey" FOREIGN KEY ("accession_id") REFERENCES "Accessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
          CONSTRAINT "Experiment_scientist_id_fkey" FOREIGN KEY ("scientist_id") REFERENCES "Scientist" ("id") ON DELETE SET NULL ON UPDATE CASCADE
        );
        CREATE TABLE "PlantAccessionMappings" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "plant_barcode" TEXT NOT NULL,
          "accession_name" TEXT,
          "accession_file_id" TEXT NOT NULL,
          CONSTRAINT "PlantAccessionMappings_accession_file_id_fkey" FOREIGN KEY ("accession_file_id") REFERENCES "Accessions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
        );
        CREATE TABLE "Scan" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "experiment_id" TEXT NOT NULL,
          "phenotyper_id" TEXT NOT NULL,
          "scanner_name" TEXT NOT NULL,
          "plant_id" TEXT NOT NULL,
          "accession_name" TEXT,
          "path" TEXT NOT NULL,
          "capture_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "num_frames" INTEGER NOT NULL,
          "exposure_time" INTEGER NOT NULL,
          "gain" REAL NOT NULL,
          "brightness" REAL NOT NULL,
          "contrast" REAL NOT NULL,
          "gamma" REAL NOT NULL,
          "seconds_per_rot" REAL NOT NULL,
          "wave_number" INTEGER NOT NULL,
          "plant_age_days" INTEGER NOT NULL,
          "deleted" BOOLEAN NOT NULL DEFAULT false,
          CONSTRAINT "Scan_phenotyper_id_fkey" FOREIGN KEY ("phenotyper_id") REFERENCES "Phenotyper" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
          CONSTRAINT "Scan_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "Experiment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
        );
        CREATE TABLE "Image" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "scan_id" TEXT NOT NULL,
          "frame_number" INTEGER NOT NULL,
          "path" TEXT NOT NULL,
          "status" TEXT NOT NULL DEFAULT 'pending',
          CONSTRAINT "Image_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "Scan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
        );
      `);
      db.close();

      const beforeVersion = await detectSchemaVersion(testDb);
      expect(beforeVersion).toBe('v3');

      const result = await upgradeDatabase(testDb);

      expect(result.status).toBe('upgraded');
      expect(result.fromVersion).toBe('v3');
      expect(result.toVersion).toBe('v4');
    });
  });

  describe('Already current database', () => {
    it('reports "already-current" for v4 databases', async () => {
      // Create a v3 fixture, upgrade it to v4, then verify already-current
      const testDb = copyFixture('v3-current.db');
      tempDbPaths.push(testDb);

      // First upgrade to v4
      await upgradeDatabase(testDb);

      // Now try upgrading again - should be already-current
      const result = await upgradeDatabase(testDb);
      expect(result.status).toBe('already-current');
    });

    it('does not create backup for already-current databases', async () => {
      const testDb = copyFixture('v3-current.db');
      tempDbPaths.push(testDb);

      // Upgrade to v4 first
      await upgradeDatabase(testDb);

      // Clean up backup from first upgrade
      const backupPath = testDb + '.backup';
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }

      // Now try again
      await upgradeDatabase(testDb);
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

      // Should have all 5 migrations applied
      const migrationNames = migrations.map((m) => m.migration_name);
      expect(migrationNames).toContain('20251028040530_init');
      expect(migrationNames).toContain(
        '20251125180403_add_genotype_id_to_plant_mappings'
      );
      expect(migrationNames).toContain(
        '20260211195433_cleanup_accession_fields'
      );
      expect(migrationNames).toContain('20260408170411_add_experiment_type');
      expect(migrationNames).toContain('20260408170532_add_graviscan_models');
      expect(migrations).toHaveLength(5);
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
      const computedChecksum = computeMigrationChecksum('20251028040530_init');
      expect(computedChecksum).toBe(MIGRATIONS['20251028040530_init'].checksum);
    });

    it('should have checksums that match actual migration files for add_genotype', () => {
      const computedChecksum = computeMigrationChecksum(
        '20251125180403_add_genotype_id_to_plant_mappings'
      );
      expect(computedChecksum).toBe(
        MIGRATIONS['20251125180403_add_genotype_id_to_plant_mappings'].checksum
      );
    });

    it('should have checksums that match actual migration files for cleanup_accession', () => {
      const computedChecksum = computeMigrationChecksum(
        '20260211195433_cleanup_accession_fields'
      );
      expect(computedChecksum).toBe(
        MIGRATIONS['20260211195433_cleanup_accession_fields'].checksum
      );
    });

    it('should have checksums that match actual migration files for add_experiment_type', () => {
      const computedChecksum = computeMigrationChecksum(
        '20260408170411_add_experiment_type'
      );
      expect(computedChecksum).toBe(
        MIGRATIONS['20260408170411_add_experiment_type'].checksum
      );
    });

    it('should have checksums that match actual migration files for add_graviscan_models', () => {
      const computedChecksum = computeMigrationChecksum(
        '20260408170532_add_graviscan_models'
      );
      expect(computedChecksum).toBe(
        MIGRATIONS['20260408170532_add_graviscan_models'].checksum
      );
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
      toVersion: 'v4',
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

describe('FK behavior tests (GraviScan models)', () => {
  let tempDbPaths: string[] = [];

  afterEach(() => {
    for (const dbPath of tempDbPaths) {
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
      const backupPath = dbPath + '.backup';
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
    }
    tempDbPaths = [];
  });

  /**
   * Helper to create a v4 database with sample GraviScan data for FK tests
   */
  function createV4WithGraviData(): string {
    const testDb = path.join(TEMP_DIR, `test-${Date.now()}-fk.db`);
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }

    // Copy v3 fixture and upgrade
    fs.copyFileSync(path.join(FIXTURES_DIR, 'v3-current.db'), testDb);

    // Synchronous upgrade inline (open, apply v3→v4 manually)
    const db = new Database(testDb);
    db.pragma('foreign_keys = OFF');

    // Create migrations table
    db.exec(`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
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

    // Add experiment_type column
    db.exec(`
      PRAGMA defer_foreign_keys=ON;
      CREATE TABLE "new_Experiment" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "species" TEXT NOT NULL,
        "scientist_id" TEXT,
        "accession_id" TEXT,
        "experiment_type" TEXT NOT NULL DEFAULT 'cylinderscan',
        CONSTRAINT "Experiment_accession_id_fkey" FOREIGN KEY ("accession_id") REFERENCES "Accessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "Experiment_scientist_id_fkey" FOREIGN KEY ("scientist_id") REFERENCES "Scientist" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      );
      INSERT INTO "new_Experiment" ("accession_id", "id", "name", "scientist_id", "species")
        SELECT "accession_id", "id", "name", "scientist_id", "species" FROM "Experiment";
      DROP TABLE "Experiment";
      ALTER TABLE "new_Experiment" RENAME TO "Experiment";
      PRAGMA defer_foreign_keys=OFF;
    `);

    // Create GraviScan tables
    db.exec(`
      CREATE TABLE "GraviScanner" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "display_name" TEXT,
        "vendor_id" TEXT NOT NULL DEFAULT '04b8',
        "product_id" TEXT NOT NULL DEFAULT '013a',
        "usb_port" TEXT,
        "usb_bus" INTEGER,
        "usb_device" INTEGER,
        "enabled" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL
      );
      CREATE TABLE "GraviScanSession" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "experiment_id" TEXT NOT NULL,
        "phenotyper_id" TEXT NOT NULL,
        "scan_mode" TEXT NOT NULL DEFAULT 'single',
        "interval_seconds" INTEGER,
        "duration_seconds" INTEGER,
        "total_cycles" INTEGER,
        "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "completed_at" DATETIME,
        "cancelled" BOOLEAN NOT NULL DEFAULT false,
        CONSTRAINT "GraviScanSession_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "Experiment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "GraviScanSession_phenotyper_id_fkey" FOREIGN KEY ("phenotyper_id") REFERENCES "Phenotyper" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
      );
      CREATE TABLE "GraviScan" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "experiment_id" TEXT NOT NULL,
        "phenotyper_id" TEXT NOT NULL,
        "scanner_id" TEXT NOT NULL,
        "session_id" TEXT,
        "cycle_number" INTEGER,
        "wave_number" INTEGER NOT NULL DEFAULT 0,
        "plate_barcode" TEXT,
        "transplant_date" DATETIME,
        "custom_note" TEXT,
        "path" TEXT NOT NULL,
        "capture_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "scan_started_at" DATETIME,
        "scan_ended_at" DATETIME,
        "grid_mode" TEXT NOT NULL,
        "plate_index" TEXT NOT NULL,
        "resolution" INTEGER NOT NULL,
        "format" TEXT NOT NULL DEFAULT 'tiff',
        "deleted" BOOLEAN NOT NULL DEFAULT false,
        CONSTRAINT "GraviScan_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "Experiment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "GraviScan_phenotyper_id_fkey" FOREIGN KEY ("phenotyper_id") REFERENCES "Phenotyper" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "GraviScan_scanner_id_fkey" FOREIGN KEY ("scanner_id") REFERENCES "GraviScanner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "GraviScan_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "GraviScanSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      );
      CREATE TABLE "GraviScanPlateAssignment" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "experiment_id" TEXT NOT NULL,
        "scanner_id" TEXT NOT NULL,
        "plate_index" TEXT NOT NULL,
        "plate_barcode" TEXT,
        "transplant_date" DATETIME,
        "custom_note" TEXT,
        "selected" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        CONSTRAINT "GraviScanPlateAssignment_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "Experiment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "GraviScanPlateAssignment_scanner_id_fkey" FOREIGN KEY ("scanner_id") REFERENCES "GraviScanner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
      );
      CREATE TABLE "GraviImage" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "graviscan_id" TEXT NOT NULL,
        "path" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "box_status" TEXT NOT NULL DEFAULT 'pending',
        CONSTRAINT "GraviImage_graviscan_id_fkey" FOREIGN KEY ("graviscan_id") REFERENCES "GraviScan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
      );
      CREATE TABLE "GraviConfig" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "grid_mode" TEXT NOT NULL DEFAULT '2grid',
        "resolution" INTEGER NOT NULL DEFAULT 1200,
        "format" TEXT NOT NULL DEFAULT 'tiff',
        "usb_signature" TEXT,
        "updatedAt" DATETIME NOT NULL
      );
      CREATE TABLE "GraviPlateAccession" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "metadata_file_id" TEXT NOT NULL,
        "plate_id" TEXT NOT NULL,
        "accession" TEXT NOT NULL,
        "transplant_date" DATETIME,
        "custom_note" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "GraviPlateAccession_metadata_file_id_fkey" FOREIGN KEY ("metadata_file_id") REFERENCES "Accessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
      CREATE TABLE "GraviPlateSectionMapping" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "gravi_plate_id" TEXT NOT NULL,
        "plate_section_id" TEXT NOT NULL,
        "plant_qr" TEXT NOT NULL,
        "medium" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "GraviPlateSectionMapping_gravi_plate_id_fkey" FOREIGN KEY ("gravi_plate_id") REFERENCES "GraviPlateAccession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    db.pragma('foreign_keys = ON');
    db.close();

    return testDb;
  }

  it('CASCADE: deleting Accessions cascade-deletes GraviPlateAccession and GraviPlateSectionMapping', () => {
    const testDb = createV4WithGraviData();
    tempDbPaths.push(testDb);

    const db = new Database(testDb);
    db.pragma('foreign_keys = ON');

    // Insert test data
    db.exec(`
      INSERT INTO "Accessions" (id, name) VALUES ('acc-fk-test', 'FK Test Accession');
      INSERT INTO "GraviPlateAccession" (id, metadata_file_id, plate_id, accession, createdAt)
        VALUES ('gpa-001', 'acc-fk-test', 'plate-A', 'Col-0', datetime('now'));
      INSERT INTO "GraviPlateSectionMapping" (id, gravi_plate_id, plate_section_id, plant_qr, createdAt)
        VALUES ('gpsm-001', 'gpa-001', 'section-1', 'QR-001', datetime('now'));
    `);

    // Verify data exists
    const beforeGPA = db
      .prepare('SELECT COUNT(*) as count FROM GraviPlateAccession')
      .get() as { count: number };
    const beforeGPSM = db
      .prepare('SELECT COUNT(*) as count FROM GraviPlateSectionMapping')
      .get() as { count: number };
    expect(beforeGPA.count).toBe(1);
    expect(beforeGPSM.count).toBe(1);

    // Delete the Accessions record - should CASCADE
    db.exec("DELETE FROM Accessions WHERE id = 'acc-fk-test'");

    // Verify cascade deletion
    const afterGPA = db
      .prepare('SELECT COUNT(*) as count FROM GraviPlateAccession')
      .get() as { count: number };
    const afterGPSM = db
      .prepare('SELECT COUNT(*) as count FROM GraviPlateSectionMapping')
      .get() as { count: number };
    expect(afterGPA.count).toBe(0);
    expect(afterGPSM.count).toBe(0);

    db.close();
  });

  it('SET NULL: deleting GraviScanSession sets session_id to NULL on linked GraviScan records', () => {
    const testDb = createV4WithGraviData();
    tempDbPaths.push(testDb);

    const db = new Database(testDb);
    db.pragma('foreign_keys = ON');

    // Insert test data
    db.exec(`
      INSERT INTO "GraviScanner" (id, name, updatedAt) VALUES ('scanner-001', 'Test Scanner', datetime('now'));
      INSERT INTO "GraviScanSession" (id, experiment_id, phenotyper_id, started_at)
        VALUES ('session-001', 'exp-001', 'phe-001', datetime('now'));
      INSERT INTO "GraviScan" (id, experiment_id, phenotyper_id, scanner_id, session_id, path, grid_mode, plate_index, resolution, capture_date)
        VALUES ('gscan-001', 'exp-001', 'phe-001', 'scanner-001', 'session-001', '/scans/gscan-001', '2grid', '0', 1200, datetime('now'));
    `);

    // Verify session_id is set
    const before = db
      .prepare("SELECT session_id FROM GraviScan WHERE id = 'gscan-001'")
      .get() as { session_id: string | null };
    expect(before.session_id).toBe('session-001');

    // Delete the session
    db.exec("DELETE FROM GraviScanSession WHERE id = 'session-001'");

    // Verify session_id is now NULL (SET NULL behavior)
    const after = db
      .prepare("SELECT session_id FROM GraviScan WHERE id = 'gscan-001'")
      .get() as { session_id: string | null };
    expect(after.session_id).toBeNull();

    db.close();
  });

  it('Default: creating Experiment without experiment_type defaults to cylinderscan', () => {
    const testDb = createV4WithGraviData();
    tempDbPaths.push(testDb);

    const db = new Database(testDb);
    db.pragma('foreign_keys = ON');

    // Insert experiment without specifying experiment_type
    db.exec(`
      INSERT INTO "Experiment" (id, name, species)
        VALUES ('exp-default-test', 'Default Type Test', 'Arabidopsis thaliana');
    `);

    const result = db
      .prepare(
        "SELECT experiment_type FROM Experiment WHERE id = 'exp-default-test'"
      )
      .get() as { experiment_type: string };
    expect(result.experiment_type).toBe('cylinderscan');

    db.close();
  });
});
