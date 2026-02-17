/**
 * Database Upgrade Script
 *
 * Upgrades existing databases (created via db push or from pilot) to be
 * migration-compatible while preserving all data.
 *
 * Usage:
 *   npx ts-node scripts/upgrade-database.ts [database-path]
 *   npm run db:upgrade
 *
 * If no database path is provided, uses the default dev database path.
 */

import * as fs from 'fs';
import * as path from 'path';

import Database from 'better-sqlite3';
import { detectSchemaVersion, SchemaVersion } from './detect-schema-version';

/**
 * Result of a database upgrade operation
 */
export interface UpgradeResult {
  status: 'upgraded' | 'already-current' | 'error';
  fromVersion?: SchemaVersion;
  toVersion?: SchemaVersion;
  backupPath?: string;
  error?: string;
}

/**
 * Known migrations with their checksums
 * Checksums are SHA-256 hashes of migration.sql files (computed by Prisma)
 * These must match exactly for `prisma migrate status` to pass
 */
const MIGRATIONS: Record<string, { checksum: string; name: string }> = {
  '20251028040530_init': {
    checksum: '30988f39ce45f569219c734eae8c18587c0f79326b3f7dbd6f4c9b84f72f1240',
    name: '20251028040530_init',
  },
  '20251125180403_add_genotype_id_to_plant_mappings': {
    checksum: '428b3a040b4abac2721c37eb047f5259552b1141737e3ef19c1cca3455abf54a',
    name: '20251125180403_add_genotype_id_to_plant_mappings',
  },
  '20260211195433_cleanup_accession_fields': {
    checksum: 'ed0532a62d4c4c49ad2d06101e11e4ada508e235121a82e73a20d6fb09f89036',
    name: '20260211195433_cleanup_accession_fields',
  },
};

/**
 * Generate a unique ID for migration records
 */
function generateMigrationId(): string {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

/**
 * Create the _prisma_migrations table
 */
function createMigrationsTable(db: Database.Database): void {
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
}

/**
 * Insert a migration record
 */
function insertMigrationRecord(
  db: Database.Database,
  migrationKey: string
): void {
  const migration = MIGRATIONS[migrationKey];
  if (!migration) {
    throw new Error(`Unknown migration: ${migrationKey}`);
  }

  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, started_at, applied_steps_count)
    VALUES (?, ?, ?, ?, ?, 1)
  `
  ).run(generateMigrationId(), migration.checksum, migration.name, now, now);
}

/**
 * Apply V1 to V2 migration (add genotype_id column)
 */
function applyV1ToV2(db: Database.Database): void {
  // Check if genotype_id column exists
  const columns = db
    .prepare("PRAGMA table_info('PlantAccessionMappings')")
    .all() as Array<{ name: string }>;
  const hasGenotypeId = columns.some((c) => c.name === 'genotype_id');

  if (!hasGenotypeId) {
    db.exec(`
      ALTER TABLE "PlantAccessionMappings" ADD COLUMN "genotype_id" TEXT;
    `);

    // Copy accession_id values to genotype_id for data preservation
    db.exec(`
      UPDATE "PlantAccessionMappings" SET "genotype_id" = "accession_id";
    `);
  }
}

/**
 * Apply V2 to V3 migration (cleanup_accession_fields)
 * This is the complex migration that:
 * - Renames genotype_id to accession_name
 * - Removes accession_id from PlantAccessionMappings
 * - Renames accession_id to accession_name in Scan
 */
function applyV2ToV3(db: Database.Database): void {
  // Begin transaction for safety
  db.exec('BEGIN TRANSACTION;');

  try {
    // 1. Recreate PlantAccessionMappings with new schema
    db.exec(`
      CREATE TABLE "new_PlantAccessionMappings" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "plant_barcode" TEXT NOT NULL,
        "accession_name" TEXT,
        "accession_file_id" TEXT NOT NULL,
        CONSTRAINT "PlantAccessionMappings_accession_file_id_fkey"
          FOREIGN KEY ("accession_file_id") REFERENCES "Accessions" ("id")
          ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `);

    // Copy data, using genotype_id as accession_name (V2) or accession_id (V1)
    // Check which column exists
    const mappingColumns = db
      .prepare("PRAGMA table_info('PlantAccessionMappings')")
      .all() as Array<{ name: string }>;
    const hasGenotypeId = mappingColumns.some((c) => c.name === 'genotype_id');

    if (hasGenotypeId) {
      // V2: use genotype_id
      db.exec(`
        INSERT INTO "new_PlantAccessionMappings" (id, plant_barcode, accession_name, accession_file_id)
        SELECT id, plant_barcode, genotype_id, accession_file_id FROM "PlantAccessionMappings";
      `);
    } else {
      // V1: use accession_id
      db.exec(`
        INSERT INTO "new_PlantAccessionMappings" (id, plant_barcode, accession_name, accession_file_id)
        SELECT id, plant_barcode, accession_id, accession_file_id FROM "PlantAccessionMappings";
      `);
    }

    db.exec(`
      DROP TABLE "PlantAccessionMappings";
      ALTER TABLE "new_PlantAccessionMappings" RENAME TO "PlantAccessionMappings";
    `);

    // 2. Recreate Scan table with new schema
    db.exec(`
      CREATE TABLE "new_Scan" (
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
        CONSTRAINT "Scan_phenotyper_id_fkey"
          FOREIGN KEY ("phenotyper_id") REFERENCES "Phenotyper" ("id")
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "Scan_experiment_id_fkey"
          FOREIGN KEY ("experiment_id") REFERENCES "Experiment" ("id")
          ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `);

    // Copy data, mapping accession_id to accession_name
    db.exec(`
      INSERT INTO "new_Scan" (
        id, experiment_id, phenotyper_id, scanner_name, plant_id, accession_name,
        path, capture_date, num_frames, exposure_time, gain, brightness, contrast,
        gamma, seconds_per_rot, wave_number, plant_age_days, deleted
      )
      SELECT
        id, experiment_id, phenotyper_id, scanner_name, plant_id, accession_id,
        path, capture_date, num_frames, exposure_time, gain, brightness, contrast,
        gamma, seconds_per_rot, wave_number, plant_age_days, deleted
      FROM "Scan";
    `);

    db.exec(`
      DROP TABLE "Scan";
      ALTER TABLE "new_Scan" RENAME TO "Scan";
    `);

    // Recreate indexes
    db.exec(`
      CREATE INDEX "Scan_experiment_id_idx" ON "Scan"("experiment_id");
      CREATE INDEX "Scan_phenotyper_id_idx" ON "Scan"("phenotyper_id");
      CREATE INDEX "Scan_plant_id_idx" ON "Scan"("plant_id");
      CREATE INDEX "Scan_capture_date_idx" ON "Scan"("capture_date");
    `);

    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

/**
 * Upgrade a database to the current schema version
 *
 * @param dbPath Path to the SQLite database file
 * @returns UpgradeResult with status and details
 */
export async function upgradeDatabase(dbPath: string): Promise<UpgradeResult> {
  // Check if database exists
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }

  // Detect current schema version
  const currentVersion = await detectSchemaVersion(dbPath);

  // Handle already-current databases
  if (currentVersion === 'v3' || currentVersion === 'migrated') {
    console.log(`Database is already at current version (${currentVersion})`);
    return {
      status: 'already-current',
    };
  }

  // Handle unknown schema
  if (currentVersion === 'unknown') {
    throw new Error(
      'Unknown schema version. Cannot upgrade database with unrecognized structure.'
    );
  }

  // Create backup before any modifications
  const backupPath = dbPath + '.backup';
  console.log(`Creating backup at: ${backupPath}`);
  fs.copyFileSync(dbPath, backupPath);

  console.log(`Upgrading database from ${currentVersion} to v3...`);

  const db = new Database(dbPath);

  try {
    // Enable foreign keys
    db.pragma('foreign_keys = OFF'); // Disable during schema changes

    // Create migrations table
    createMigrationsTable(db);

    // Apply migrations based on current version
    if (currentVersion === 'v1') {
      // V1 → V2 → V3
      console.log('  Applying V1 → V2 migration (add genotype_id)...');
      applyV1ToV2(db);
      insertMigrationRecord(db, '20251028040530_init');
      insertMigrationRecord(
        db,
        '20251125180403_add_genotype_id_to_plant_mappings'
      );

      console.log('  Applying V2 → V3 migration (cleanup accession fields)...');
      applyV2ToV3(db);
      insertMigrationRecord(db, '20260211195433_cleanup_accession_fields');
    } else if (currentVersion === 'v2') {
      // V2 → V3
      insertMigrationRecord(db, '20251028040530_init');
      insertMigrationRecord(
        db,
        '20251125180403_add_genotype_id_to_plant_mappings'
      );

      console.log('  Applying V2 → V3 migration (cleanup accession fields)...');
      applyV2ToV3(db);
      insertMigrationRecord(db, '20260211195433_cleanup_accession_fields');
    }

    // Re-enable foreign keys
    db.pragma('foreign_keys = ON');

    // Verify foreign key integrity
    const fkCheck = db.pragma('foreign_key_check') as unknown[];
    if (fkCheck.length > 0) {
      console.warn('Warning: Foreign key violations detected:', fkCheck);
    }

    console.log('Database upgrade complete!');

    return {
      status: 'upgraded',
      fromVersion: currentVersion,
      toVersion: 'v3',
      backupPath,
    };
  } catch (error) {
    // Restore from backup on error
    console.error('Upgrade failed, restoring from backup...');
    fs.copyFileSync(backupPath, dbPath);
    throw error;
  } finally {
    db.close();
  }
}

/**
 * Get the default development database path
 */
function getDefaultDbPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(homeDir, '.bloom', 'dev.db');
}

// CLI support - run directly with ts-node
if (require.main === module) {
  const dbPath = process.argv[2] || getDefaultDbPath();

  console.log('=== Bloom Database Upgrade Tool ===\n');
  console.log(`Database: ${dbPath}`);

  if (!fs.existsSync(dbPath)) {
    console.error(`\nError: Database not found at ${dbPath}`);
    console.log(
      '\nUsage: npx ts-node scripts/upgrade-database.ts [database-path]'
    );
    process.exit(1);
  }

  upgradeDatabase(dbPath)
    .then((result) => {
      console.log('\n=== Result ===');
      console.log(`Status: ${result.status}`);
      if (result.fromVersion) {
        console.log(`From version: ${result.fromVersion}`);
      }
      if (result.toVersion) {
        console.log(`To version: ${result.toVersion}`);
      }
      if (result.backupPath) {
        console.log(`Backup saved at: ${result.backupPath}`);
      }
    })
    .catch((error) => {
      console.error('\n=== Error ===');
      console.error(error.message);
      process.exit(1);
    });
}
