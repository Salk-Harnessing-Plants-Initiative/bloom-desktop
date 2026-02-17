/*
  Warnings:

  - You are about to drop the column `accession_id` on the `PlantAccessionMappings` table. All the data in the column will be lost.
  - You are about to drop the column `genotype_id` on the `PlantAccessionMappings` table. All the data in the column will be lost.
  - You are about to drop the column `accession_id` on the `Scan` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PlantAccessionMappings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "plant_barcode" TEXT NOT NULL,
    "accession_name" TEXT,
    "accession_file_id" TEXT NOT NULL,
    CONSTRAINT "PlantAccessionMappings_accession_file_id_fkey" FOREIGN KEY ("accession_file_id") REFERENCES "Accessions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PlantAccessionMappings" ("accession_file_id", "id", "plant_barcode", "accession_name") SELECT "accession_file_id", "id", "plant_barcode", "genotype_id" FROM "PlantAccessionMappings";
DROP TABLE "PlantAccessionMappings";
ALTER TABLE "new_PlantAccessionMappings" RENAME TO "PlantAccessionMappings";
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
    CONSTRAINT "Scan_phenotyper_id_fkey" FOREIGN KEY ("phenotyper_id") REFERENCES "Phenotyper" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Scan_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "Experiment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Scan" ("brightness", "capture_date", "contrast", "deleted", "experiment_id", "exposure_time", "gain", "gamma", "id", "num_frames", "path", "phenotyper_id", "plant_age_days", "plant_id", "scanner_name", "seconds_per_rot", "wave_number", "accession_name") SELECT "brightness", "capture_date", "contrast", "deleted", "experiment_id", "exposure_time", "gain", "gamma", "id", "num_frames", "path", "phenotyper_id", "plant_age_days", "plant_id", "scanner_name", "seconds_per_rot", "wave_number", "accession_id" FROM "Scan";
DROP TABLE "Scan";
ALTER TABLE "new_Scan" RENAME TO "Scan";
CREATE INDEX "Scan_experiment_id_idx" ON "Scan"("experiment_id");
CREATE INDEX "Scan_phenotyper_id_idx" ON "Scan"("phenotyper_id");
CREATE INDEX "Scan_plant_id_idx" ON "Scan"("plant_id");
CREATE INDEX "Scan_capture_date_idx" ON "Scan"("capture_date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
