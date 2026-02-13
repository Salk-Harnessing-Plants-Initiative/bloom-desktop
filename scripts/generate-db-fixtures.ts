/**
 * Generate Test Fixture Databases
 *
 * Creates SQLite databases for each schema version to test the upgrade script.
 * Run with: npx ts-node scripts/generate-db-fixtures.ts
 *
 * Fixtures created:
 * - v1-init.db: Schema v1 (matches init migration and pilot)
 * - v2-add-genotype.db: Schema v2 (has genotype_id column)
 * - v3-current.db: Schema v3 (current, has accession_name)
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

console.log('\nAll fixtures created successfully!');
console.log(`Location: ${FIXTURES_DIR}`);
