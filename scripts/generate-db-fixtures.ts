/**
 * Generate Test Fixture Databases
 *
 * Creates SQLite databases for each schema version to test the upgrade script.
 * Run with: npx ts-node scripts/generate-db-fixtures.ts
 *
 * Fixtures created:
 * - v1-init.db: Schema v1 (matches init migration and pilot)
 * - v2-add-genotype.db: Schema v2 (has genotype_id column)
 * - v3-current.db: Schema v3 (has accession_name)
 * - v4-graviscan.db: Schema v4 (current, has GraviScan tables)
 */

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

const FIXTURES_DIR = path.join(__dirname, '../tests/fixtures/databases');

// Ensure fixtures directory exists
if (!fs.existsSync(FIXTURES_DIR)) {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
}

/**
 * Schema V1 (init migration) - matches pilot
 * PlantAccessionMappings has: accession_id, plant_barcode, accession_file_id
 * Scan has: accession_id
 */
function createV1Schema(db: Database.Database): void {
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
      "accession_id" TEXT NOT NULL,
      "plant_barcode" TEXT NOT NULL,
      "accession_file_id" TEXT NOT NULL,
      CONSTRAINT "PlantAccessionMappings_accession_file_id_fkey" FOREIGN KEY ("accession_file_id") REFERENCES "Accessions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    );

    CREATE TABLE "Scan" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "experiment_id" TEXT NOT NULL,
      "phenotyper_id" TEXT NOT NULL,
      "scanner_name" TEXT NOT NULL,
      "plant_id" TEXT NOT NULL,
      "accession_id" TEXT,
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
    CREATE INDEX "Scan_experiment_id_idx" ON "Scan"("experiment_id");
    CREATE INDEX "Scan_phenotyper_id_idx" ON "Scan"("phenotyper_id");
    CREATE INDEX "Scan_plant_id_idx" ON "Scan"("plant_id");
    CREATE INDEX "Scan_capture_date_idx" ON "Scan"("capture_date");

    CREATE TABLE "Image" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "scan_id" TEXT NOT NULL,
      "frame_number" INTEGER NOT NULL,
      "path" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'pending',
      CONSTRAINT "Image_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "Scan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    );
    CREATE INDEX "Image_scan_id_idx" ON "Image"("scan_id");
  `);
}

/**
 * Schema V2 (add_genotype_id migration)
 * PlantAccessionMappings has: accession_id, plant_barcode, genotype_id, accession_file_id
 * Scan has: accession_id
 */
function createV2Schema(db: Database.Database): void {
  // Start with V1 schema
  createV1Schema(db);

  // Add genotype_id column (V2 migration)
  db.exec(`
    ALTER TABLE "PlantAccessionMappings" ADD COLUMN "genotype_id" TEXT;
  `);
}

/**
 * Schema V3 (cleanup_accession_fields migration) - CURRENT
 * PlantAccessionMappings has: plant_barcode, accession_name, accession_file_id
 * Scan has: accession_name
 */
function createV3Schema(db: Database.Database): void {
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
    CREATE INDEX "Scan_experiment_id_idx" ON "Scan"("experiment_id");
    CREATE INDEX "Scan_phenotyper_id_idx" ON "Scan"("phenotyper_id");
    CREATE INDEX "Scan_plant_id_idx" ON "Scan"("plant_id");
    CREATE INDEX "Scan_capture_date_idx" ON "Scan"("capture_date");

    CREATE TABLE "Image" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "scan_id" TEXT NOT NULL,
      "frame_number" INTEGER NOT NULL,
      "path" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'pending',
      CONSTRAINT "Image_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "Scan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    );
    CREATE INDEX "Image_scan_id_idx" ON "Image"("scan_id");
  `);
}

/**
 * Insert sample data for V1 schema
 */
function insertV1Data(db: Database.Database): void {
  // Scientists
  db.exec(`
    INSERT INTO "Scientist" (id, name, email) VALUES
      ('sci-001', 'Dr. Jane Smith', 'jane.smith@salk.edu'),
      ('sci-002', 'Dr. Bob Jones', 'bob.jones@salk.edu');
  `);

  // Phenotypers
  db.exec(`
    INSERT INTO "Phenotyper" (id, name, email) VALUES
      ('phe-001', 'John Doe', 'john.doe@salk.edu'),
      ('phe-002', 'Alice Williams', 'alice.williams@salk.edu');
  `);

  // Accessions
  db.exec(`
    INSERT INTO "Accessions" (id, name) VALUES
      ('acc-001', 'ACC-001-Amaranth-Wild'),
      ('acc-002', 'ACC-002-Amaranth-Cultivated');
  `);

  // Experiments
  db.exec(`
    INSERT INTO "Experiment" (id, name, species, scientist_id, accession_id) VALUES
      ('exp-001', 'drought-stress-2025', 'Amaranthus hypochondriacus', 'sci-001', 'acc-001'),
      ('exp-002', 'salinity-tolerance-2025', 'Amaranthus tricolor', 'sci-002', 'acc-002');
  `);

  // PlantAccessionMappings (V1 format: accession_id instead of accession_name)
  db.exec(`
    INSERT INTO "PlantAccessionMappings" (id, accession_id, plant_barcode, accession_file_id) VALUES
      ('map-001', 'Col-0', 'PLANT-001', 'acc-001'),
      ('map-002', 'Col-0', 'PLANT-002', 'acc-001'),
      ('map-003', 'Ler-0', 'PLANT-003', 'acc-002'),
      ('map-004', 'Ws-0', 'PLANT-004', 'acc-002'),
      ('map-005', 'Col-0', 'PLANT-005', 'acc-001');
  `);

  // Scans (V1 format: accession_id instead of accession_name)
  db.exec(`
    INSERT INTO "Scan" (id, experiment_id, phenotyper_id, scanner_name, plant_id, accession_id, path, num_frames, exposure_time, gain, brightness, contrast, gamma, seconds_per_rot, wave_number, plant_age_days) VALUES
      ('scan-001', 'exp-001', 'phe-001', 'Station-A', 'PLANT-001', 'Col-0', '/scans/scan-001', 72, 10000, 5.0, 0.5, 1.0, 1.0, 36.0, 1, 14),
      ('scan-002', 'exp-001', 'phe-001', 'Station-A', 'PLANT-002', 'Col-0', '/scans/scan-002', 72, 10000, 5.0, 0.5, 1.0, 1.0, 36.0, 1, 14),
      ('scan-003', 'exp-002', 'phe-002', 'Station-B', 'PLANT-003', 'Ler-0', '/scans/scan-003', 72, 10000, 5.0, 0.5, 1.0, 1.0, 36.0, 1, 21),
      ('scan-004', 'exp-002', 'phe-002', 'Station-B', 'PLANT-004', 'Ws-0', '/scans/scan-004', 72, 10000, 5.0, 0.5, 1.0, 1.0, 36.0, 1, 21),
      ('scan-005', 'exp-001', 'phe-001', 'Station-A', 'PLANT-005', 'Col-0', '/scans/scan-005', 72, 10000, 5.0, 0.5, 1.0, 1.0, 36.0, 2, 21);
  `);

  // Images (sample - 5 per scan)
  const imageInserts: string[] = [];
  for (let scanNum = 1; scanNum <= 5; scanNum++) {
    for (let frame = 0; frame < 5; frame++) {
      imageInserts.push(
        `('img-${scanNum}-${frame}', 'scan-00${scanNum}', ${frame}, '/scans/scan-00${scanNum}/frame_${frame.toString().padStart(4, '0')}.png', 'completed')`
      );
    }
  }
  db.exec(`
    INSERT INTO "Image" (id, scan_id, frame_number, path, status) VALUES
      ${imageInserts.join(',\n      ')};
  `);
}

/**
 * Insert sample data for V2 schema (includes genotype_id)
 */
function insertV2Data(db: Database.Database): void {
  // Scientists
  db.exec(`
    INSERT INTO "Scientist" (id, name, email) VALUES
      ('sci-001', 'Dr. Jane Smith', 'jane.smith@salk.edu'),
      ('sci-002', 'Dr. Bob Jones', 'bob.jones@salk.edu');
  `);

  // Phenotypers
  db.exec(`
    INSERT INTO "Phenotyper" (id, name, email) VALUES
      ('phe-001', 'John Doe', 'john.doe@salk.edu'),
      ('phe-002', 'Alice Williams', 'alice.williams@salk.edu');
  `);

  // Accessions
  db.exec(`
    INSERT INTO "Accessions" (id, name) VALUES
      ('acc-001', 'ACC-001-Amaranth-Wild'),
      ('acc-002', 'ACC-002-Amaranth-Cultivated');
  `);

  // Experiments
  db.exec(`
    INSERT INTO "Experiment" (id, name, species, scientist_id, accession_id) VALUES
      ('exp-001', 'drought-stress-2025', 'Amaranthus hypochondriacus', 'sci-001', 'acc-001'),
      ('exp-002', 'salinity-tolerance-2025', 'Amaranthus tricolor', 'sci-002', 'acc-002');
  `);

  // PlantAccessionMappings (V2 format: has both accession_id and genotype_id)
  db.exec(`
    INSERT INTO "PlantAccessionMappings" (id, accession_id, plant_barcode, genotype_id, accession_file_id) VALUES
      ('map-001', 'old-acc-id-001', 'PLANT-001', 'Col-0', 'acc-001'),
      ('map-002', 'old-acc-id-002', 'PLANT-002', 'Col-0', 'acc-001'),
      ('map-003', 'old-acc-id-003', 'PLANT-003', 'Ler-0', 'acc-002'),
      ('map-004', 'old-acc-id-004', 'PLANT-004', 'Ws-0', 'acc-002'),
      ('map-005', 'old-acc-id-005', 'PLANT-005', 'Col-0', 'acc-001');
  `);

  // Scans (V2 format: still has accession_id)
  db.exec(`
    INSERT INTO "Scan" (id, experiment_id, phenotyper_id, scanner_name, plant_id, accession_id, path, num_frames, exposure_time, gain, brightness, contrast, gamma, seconds_per_rot, wave_number, plant_age_days) VALUES
      ('scan-001', 'exp-001', 'phe-001', 'Station-A', 'PLANT-001', 'Col-0', '/scans/scan-001', 72, 10000, 5.0, 0.5, 1.0, 1.0, 36.0, 1, 14),
      ('scan-002', 'exp-001', 'phe-001', 'Station-A', 'PLANT-002', 'Col-0', '/scans/scan-002', 72, 10000, 5.0, 0.5, 1.0, 1.0, 36.0, 1, 14),
      ('scan-003', 'exp-002', 'phe-002', 'Station-B', 'PLANT-003', 'Ler-0', '/scans/scan-003', 72, 10000, 5.0, 0.5, 1.0, 1.0, 36.0, 1, 21),
      ('scan-004', 'exp-002', 'phe-002', 'Station-B', 'PLANT-004', 'Ws-0', '/scans/scan-004', 72, 10000, 5.0, 0.5, 1.0, 1.0, 36.0, 1, 21),
      ('scan-005', 'exp-001', 'phe-001', 'Station-A', 'PLANT-005', 'Col-0', '/scans/scan-005', 72, 10000, 5.0, 0.5, 1.0, 1.0, 36.0, 2, 21);
  `);

  // Images
  const imageInserts: string[] = [];
  for (let scanNum = 1; scanNum <= 5; scanNum++) {
    for (let frame = 0; frame < 5; frame++) {
      imageInserts.push(
        `('img-${scanNum}-${frame}', 'scan-00${scanNum}', ${frame}, '/scans/scan-00${scanNum}/frame_${frame.toString().padStart(4, '0')}.png', 'completed')`
      );
    }
  }
  db.exec(`
    INSERT INTO "Image" (id, scan_id, frame_number, path, status) VALUES
      ${imageInserts.join(',\n      ')};
  `);
}

/**
 * Insert sample data for V3 schema (current format)
 */
function insertV3Data(db: Database.Database): void {
  // Scientists
  db.exec(`
    INSERT INTO "Scientist" (id, name, email) VALUES
      ('sci-001', 'Dr. Jane Smith', 'jane.smith@salk.edu'),
      ('sci-002', 'Dr. Bob Jones', 'bob.jones@salk.edu');
  `);

  // Phenotypers
  db.exec(`
    INSERT INTO "Phenotyper" (id, name, email) VALUES
      ('phe-001', 'John Doe', 'john.doe@salk.edu'),
      ('phe-002', 'Alice Williams', 'alice.williams@salk.edu');
  `);

  // Accessions
  db.exec(`
    INSERT INTO "Accessions" (id, name) VALUES
      ('acc-001', 'ACC-001-Amaranth-Wild'),
      ('acc-002', 'ACC-002-Amaranth-Cultivated');
  `);

  // Experiments
  db.exec(`
    INSERT INTO "Experiment" (id, name, species, scientist_id, accession_id) VALUES
      ('exp-001', 'drought-stress-2025', 'Amaranthus hypochondriacus', 'sci-001', 'acc-001'),
      ('exp-002', 'salinity-tolerance-2025', 'Amaranthus tricolor', 'sci-002', 'acc-002');
  `);

  // PlantAccessionMappings (V3 format: accession_name, no accession_id)
  db.exec(`
    INSERT INTO "PlantAccessionMappings" (id, plant_barcode, accession_name, accession_file_id) VALUES
      ('map-001', 'PLANT-001', 'Col-0', 'acc-001'),
      ('map-002', 'PLANT-002', 'Col-0', 'acc-001'),
      ('map-003', 'PLANT-003', 'Ler-0', 'acc-002'),
      ('map-004', 'PLANT-004', 'Ws-0', 'acc-002'),
      ('map-005', 'PLANT-005', 'Col-0', 'acc-001');
  `);

  // Scans (V3 format: accession_name, no accession_id)
  db.exec(`
    INSERT INTO "Scan" (id, experiment_id, phenotyper_id, scanner_name, plant_id, accession_name, path, num_frames, exposure_time, gain, brightness, contrast, gamma, seconds_per_rot, wave_number, plant_age_days) VALUES
      ('scan-001', 'exp-001', 'phe-001', 'Station-A', 'PLANT-001', 'Col-0', '/scans/scan-001', 72, 10000, 5.0, 0.5, 1.0, 1.0, 36.0, 1, 14),
      ('scan-002', 'exp-001', 'phe-001', 'Station-A', 'PLANT-002', 'Col-0', '/scans/scan-002', 72, 10000, 5.0, 0.5, 1.0, 1.0, 36.0, 1, 14),
      ('scan-003', 'exp-002', 'phe-002', 'Station-B', 'PLANT-003', 'Ler-0', '/scans/scan-003', 72, 10000, 5.0, 0.5, 1.0, 1.0, 36.0, 1, 21),
      ('scan-004', 'exp-002', 'phe-002', 'Station-B', 'PLANT-004', 'Ws-0', '/scans/scan-004', 72, 10000, 5.0, 0.5, 1.0, 1.0, 36.0, 1, 21),
      ('scan-005', 'exp-001', 'phe-001', 'Station-A', 'PLANT-005', 'Col-0', '/scans/scan-005', 72, 10000, 5.0, 0.5, 1.0, 1.0, 36.0, 2, 21);
  `);

  // Images
  const imageInserts: string[] = [];
  for (let scanNum = 1; scanNum <= 5; scanNum++) {
    for (let frame = 0; frame < 5; frame++) {
      imageInserts.push(
        `('img-${scanNum}-${frame}', 'scan-00${scanNum}', ${frame}, '/scans/scan-00${scanNum}/frame_${frame.toString().padStart(4, '0')}.png', 'completed')`
      );
    }
  }
  db.exec(`
    INSERT INTO "Image" (id, scan_id, frame_number, path, status) VALUES
      ${imageInserts.join(',\n      ')};
  `);
}

/**
 * Schema V4 (graviscan) - CURRENT
 * Adds experiment_type to Experiment and 8 GraviScan tables
 */
function createV4Schema(db: Database.Database): void {
  // Start with V3 schema
  createV3Schema(db);

  // Add experiment_type column (via table rebuild, matching Prisma migration)
  db.exec(`
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
  `);

  // Create all 8 GraviScan tables
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
    CREATE INDEX "GraviScanSession_experiment_id_idx" ON "GraviScanSession"("experiment_id");
    CREATE INDEX "GraviScanSession_phenotyper_id_idx" ON "GraviScanSession"("phenotyper_id");

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
    CREATE INDEX "GraviScan_experiment_id_idx" ON "GraviScan"("experiment_id");
    CREATE INDEX "GraviScan_phenotyper_id_idx" ON "GraviScan"("phenotyper_id");
    CREATE INDEX "GraviScan_scanner_id_idx" ON "GraviScan"("scanner_id");
    CREATE INDEX "GraviScan_session_id_idx" ON "GraviScan"("session_id");
    CREATE INDEX "GraviScan_capture_date_idx" ON "GraviScan"("capture_date");
    CREATE INDEX "GraviScan_experiment_id_wave_number_plate_barcode_idx" ON "GraviScan"("experiment_id", "wave_number", "plate_barcode");

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
    CREATE INDEX "GraviScanPlateAssignment_experiment_id_idx" ON "GraviScanPlateAssignment"("experiment_id");
    CREATE INDEX "GraviScanPlateAssignment_scanner_id_idx" ON "GraviScanPlateAssignment"("scanner_id");
    CREATE UNIQUE INDEX "GraviScanPlateAssignment_experiment_id_scanner_id_plate_index_key" ON "GraviScanPlateAssignment"("experiment_id", "scanner_id", "plate_index");

    CREATE TABLE "GraviImage" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "graviscan_id" TEXT NOT NULL,
      "path" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "box_status" TEXT NOT NULL DEFAULT 'pending',
      CONSTRAINT "GraviImage_graviscan_id_fkey" FOREIGN KEY ("graviscan_id") REFERENCES "GraviScan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    );
    CREATE INDEX "GraviImage_graviscan_id_idx" ON "GraviImage"("graviscan_id");

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
    CREATE INDEX "GraviPlateAccession_metadata_file_id_idx" ON "GraviPlateAccession"("metadata_file_id");
    CREATE INDEX "GraviPlateAccession_plate_id_idx" ON "GraviPlateAccession"("plate_id");
    CREATE UNIQUE INDEX "GraviPlateAccession_metadata_file_id_plate_id_key" ON "GraviPlateAccession"("metadata_file_id", "plate_id");

    CREATE TABLE "GraviPlateSectionMapping" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "gravi_plate_id" TEXT NOT NULL,
      "plate_section_id" TEXT NOT NULL,
      "plant_qr" TEXT NOT NULL,
      "medium" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "GraviPlateSectionMapping_gravi_plate_id_fkey" FOREIGN KEY ("gravi_plate_id") REFERENCES "GraviPlateAccession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE INDEX "GraviPlateSectionMapping_gravi_plate_id_idx" ON "GraviPlateSectionMapping"("gravi_plate_id");
    CREATE INDEX "GraviPlateSectionMapping_plant_qr_idx" ON "GraviPlateSectionMapping"("plant_qr");
    CREATE UNIQUE INDEX "GraviPlateSectionMapping_gravi_plate_id_plant_qr_key" ON "GraviPlateSectionMapping"("gravi_plate_id", "plant_qr");
  `);
}

/**
 * Insert sample data for V4 schema (V3 data + sample GraviScan data)
 */
function insertV4Data(db: Database.Database): void {
  // Insert base V3 data
  insertV3Data(db);

  // Add sample GraviScan data
  db.exec(`
    INSERT INTO "GraviScanner" (id, name, display_name, updatedAt) VALUES
      ('gscanner-001', 'Epson V850', 'Lab Scanner 1', datetime('now'));

    INSERT INTO "GraviConfig" (id, grid_mode, resolution, format, updatedAt) VALUES
      ('gconfig-001', '2grid', 1200, 'tiff', datetime('now'));

    INSERT INTO "GraviPlateAccession" (id, metadata_file_id, plate_id, accession, createdAt) VALUES
      ('gpa-001', 'acc-001', 'plate-A1', 'Col-0', datetime('now')),
      ('gpa-002', 'acc-001', 'plate-A2', 'Ler-0', datetime('now'));

    INSERT INTO "GraviPlateSectionMapping" (id, gravi_plate_id, plate_section_id, plant_qr, medium, createdAt) VALUES
      ('gpsm-001', 'gpa-001', 'section-1', 'QR-001', 'MS', datetime('now')),
      ('gpsm-002', 'gpa-001', 'section-2', 'QR-002', 'MS', datetime('now')),
      ('gpsm-003', 'gpa-002', 'section-1', 'QR-003', 'MS+sucrose', datetime('now'));
  `);
}

/**
 * Create a fixture database
 */
function createFixture(
  filename: string,
  schemaFn: (db: Database.Database) => void,
  dataFn: (db: Database.Database) => void
): void {
  const dbPath = path.join(FIXTURES_DIR, filename);

  // Remove existing file
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }

  console.log(`Creating ${filename}...`);
  const db = new Database(dbPath);

  try {
    // Enable foreign keys
    db.pragma('foreign_keys = ON');

    // Create schema
    schemaFn(db);

    // Insert data
    dataFn(db);

    // Verify data was inserted
    const scientists = db
      .prepare('SELECT COUNT(*) as count FROM Scientist')
      .get() as { count: number };
    const scans = db.prepare('SELECT COUNT(*) as count FROM Scan').get() as {
      count: number;
    };
    const mappings = db
      .prepare('SELECT COUNT(*) as count FROM PlantAccessionMappings')
      .get() as { count: number };

    console.log(`  - Scientists: ${scientists.count}`);
    console.log(`  - Scans: ${scans.count}`);
    console.log(`  - Mappings: ${mappings.count}`);
  } finally {
    db.close();
  }

  console.log(`  Created: ${dbPath}`);
}

// Main execution
console.log('Generating database fixtures...\n');

createFixture('v1-init.db', createV1Schema, insertV1Data);
createFixture('v2-add-genotype.db', createV2Schema, insertV2Data);
createFixture('v3-current.db', createV3Schema, insertV3Data);
createFixture('v4-graviscan.db', createV4Schema, insertV4Data);

console.log('\nAll fixtures created successfully!');
console.log(`Location: ${FIXTURES_DIR}`);
