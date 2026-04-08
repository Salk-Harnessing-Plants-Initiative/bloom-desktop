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
export const MIGRATIONS: Record<string, { checksum: string; name: string }> = {
  '20251028040530_init': {
    checksum:
      '30988f39ce45f569219c734eae8c18587c0f79326b3f7dbd6f4c9b84f72f1240',
    name: '20251028040530_init',
  },
  '20251125180403_add_genotype_id_to_plant_mappings': {
    checksum:
      '428b3a040b4abac2721c37eb047f5259552b1141737e3ef19c1cca3455abf54a',
    name: '20251125180403_add_genotype_id_to_plant_mappings',
  },
  '20260211195433_cleanup_accession_fields': {
    checksum:
      'ed0532a62d4c4c49ad2d06101e11e4ada508e235121a82e73a20d6fb09f89036',
    name: '20260211195433_cleanup_accession_fields',
  },
  '20260408170411_add_experiment_type': {
    checksum:
      '9daece665db8c75c261a36ff23ea2d451bf6d278c402cba8c562541b76775740',
    name: '20260408170411_add_experiment_type',
  },
  '20260408170532_add_graviscan_models': {
    checksum:
      '3029fd8912d761d5aa8b0b61e616ff71ee5d01a9c2a0991cfab820890b29a30f',
    name: '20260408170532_add_graviscan_models',
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
 * Apply V3 to V4 migration (add experiment_type + 8 GraviScan models)
 * This applies the two new migrations within a single transaction.
 */
function applyV3ToV4(db: Database.Database): void {
  // Begin transaction for safety
  db.exec('BEGIN TRANSACTION;');

  try {
    // Migration 1: Add experiment_type column to Experiment
    // Prisma uses table-rebuild pattern for SQLite ALTER TABLE
    db.exec(`
      PRAGMA defer_foreign_keys=ON;
      PRAGMA foreign_keys=OFF;

      CREATE TABLE "new_Experiment" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "species" TEXT NOT NULL,
        "scientist_id" TEXT,
        "accession_id" TEXT,
        "experiment_type" TEXT NOT NULL DEFAULT 'cylinderscan',
        CONSTRAINT "Experiment_accession_id_fkey"
          FOREIGN KEY ("accession_id") REFERENCES "Accessions" ("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "Experiment_scientist_id_fkey"
          FOREIGN KEY ("scientist_id") REFERENCES "Scientist" ("id")
          ON DELETE SET NULL ON UPDATE CASCADE
      );

      INSERT INTO "new_Experiment" ("accession_id", "id", "name", "scientist_id", "species")
        SELECT "accession_id", "id", "name", "scientist_id", "species" FROM "Experiment";

      DROP TABLE "Experiment";
      ALTER TABLE "new_Experiment" RENAME TO "Experiment";

      PRAGMA foreign_keys=ON;
      PRAGMA defer_foreign_keys=OFF;
    `);

    // Migration 2: Create all 8 GraviScan tables
    db.exec(`
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

      -- Indexes for GraviScan
      CREATE INDEX "GraviScan_experiment_id_idx" ON "GraviScan"("experiment_id");
      CREATE INDEX "GraviScan_phenotyper_id_idx" ON "GraviScan"("phenotyper_id");
      CREATE INDEX "GraviScan_scanner_id_idx" ON "GraviScan"("scanner_id");
      CREATE INDEX "GraviScan_session_id_idx" ON "GraviScan"("session_id");
      CREATE INDEX "GraviScan_capture_date_idx" ON "GraviScan"("capture_date");
      CREATE INDEX "GraviScan_experiment_id_wave_number_plate_barcode_idx" ON "GraviScan"("experiment_id", "wave_number", "plate_barcode");

      -- Indexes for GraviScanSession
      CREATE INDEX "GraviScanSession_experiment_id_idx" ON "GraviScanSession"("experiment_id");
      CREATE INDEX "GraviScanSession_phenotyper_id_idx" ON "GraviScanSession"("phenotyper_id");

      -- Indexes for GraviScanPlateAssignment
      CREATE INDEX "GraviScanPlateAssignment_experiment_id_idx" ON "GraviScanPlateAssignment"("experiment_id");
      CREATE INDEX "GraviScanPlateAssignment_scanner_id_idx" ON "GraviScanPlateAssignment"("scanner_id");
      CREATE UNIQUE INDEX "GraviScanPlateAssignment_experiment_id_scanner_id_plate_index_key" ON "GraviScanPlateAssignment"("experiment_id", "scanner_id", "plate_index");

      -- Indexes for GraviImage
      CREATE INDEX "GraviImage_graviscan_id_idx" ON "GraviImage"("graviscan_id");

      -- Indexes for GraviPlateAccession
      CREATE INDEX "GraviPlateAccession_metadata_file_id_idx" ON "GraviPlateAccession"("metadata_file_id");
      CREATE INDEX "GraviPlateAccession_plate_id_idx" ON "GraviPlateAccession"("plate_id");
      CREATE UNIQUE INDEX "GraviPlateAccession_metadata_file_id_plate_id_key" ON "GraviPlateAccession"("metadata_file_id", "plate_id");

      -- Indexes for GraviPlateSectionMapping
      CREATE INDEX "GraviPlateSectionMapping_gravi_plate_id_idx" ON "GraviPlateSectionMapping"("gravi_plate_id");
      CREATE INDEX "GraviPlateSectionMapping_plant_qr_idx" ON "GraviPlateSectionMapping"("plant_qr");
      CREATE UNIQUE INDEX "GraviPlateSectionMapping_gravi_plate_id_plant_qr_key" ON "GraviPlateSectionMapping"("gravi_plate_id", "plant_qr");
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
  if (currentVersion === 'v4') {
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

  console.log(`Upgrading database from ${currentVersion} to v4...`);

  const db = new Database(dbPath);

  try {
    // Enable foreign keys
    db.pragma('foreign_keys = OFF'); // Disable during schema changes

    // Create migrations table
    createMigrationsTable(db);

    // Apply migrations based on current version
    if (currentVersion === 'v1') {
      // V1 → V2 → V3 → V4
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

      console.log(
        '  Applying V3 → V4 migration (add experiment_type + GraviScan models)...'
      );
      applyV3ToV4(db);
      insertMigrationRecord(db, '20260408170411_add_experiment_type');
      insertMigrationRecord(db, '20260408170532_add_graviscan_models');
    } else if (currentVersion === 'v2') {
      // V2 → V3 → V4
      insertMigrationRecord(db, '20251028040530_init');
      insertMigrationRecord(
        db,
        '20251125180403_add_genotype_id_to_plant_mappings'
      );

      console.log('  Applying V2 → V3 migration (cleanup accession fields)...');
      applyV2ToV3(db);
      insertMigrationRecord(db, '20260211195433_cleanup_accession_fields');

      console.log(
        '  Applying V3 → V4 migration (add experiment_type + GraviScan models)...'
      );
      applyV3ToV4(db);
      insertMigrationRecord(db, '20260408170411_add_experiment_type');
      insertMigrationRecord(db, '20260408170532_add_graviscan_models');
    } else if (currentVersion === 'v3' || currentVersion === 'migrated') {
      // V3 → V4 (or migrated-v3 → V4)
      if (currentVersion === 'v3') {
        // Non-migrated v3: insert all prior migration records
        insertMigrationRecord(db, '20251028040530_init');
        insertMigrationRecord(
          db,
          '20251125180403_add_genotype_id_to_plant_mappings'
        );
        insertMigrationRecord(db, '20260211195433_cleanup_accession_fields');
      }

      console.log(
        '  Applying V3 → V4 migration (add experiment_type + GraviScan models)...'
      );
      applyV3ToV4(db);
      insertMigrationRecord(db, '20260408170411_add_experiment_type');
      insertMigrationRecord(db, '20260408170532_add_graviscan_models');
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
      toVersion: 'v4',
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
