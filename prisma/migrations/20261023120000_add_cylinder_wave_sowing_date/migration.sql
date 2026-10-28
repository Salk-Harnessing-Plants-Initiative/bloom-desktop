-- CreateTable
CREATE TABLE "CylinderWave" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experiment_id" TEXT NOT NULL,
    "wave_number" INTEGER NOT NULL,
    "dates_per_plant" BOOLEAN NOT NULL DEFAULT false,
    "germination_date" TEXT,
    "sowing_date" TEXT,
    "transfer_date" TEXT,
    "germ_day_color" TEXT,
    "note" TEXT,
    "set_by_phenotyper_id" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CylinderWave_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "Experiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CylinderWaveDateChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "wave_id" TEXT NOT NULL,
    "old_germination_date" TEXT,
    "new_germination_date" TEXT,
    "old_sowing_date" TEXT,
    "new_sowing_date" TEXT,
    "old_transfer_date" TEXT,
    "new_transfer_date" TEXT,
    "old_germ_day_color" TEXT,
    "new_germ_day_color" TEXT,
    "reason" TEXT,
    "changed_by_phenotyper_id" TEXT,
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CylinderWaveDateChange_wave_id_fkey" FOREIGN KEY ("wave_id") REFERENCES "CylinderWave" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CylinderWave_experiment_id_idx" ON "CylinderWave"("experiment_id");

-- CreateIndex
CREATE UNIQUE INDEX "CylinderWave_experiment_id_wave_number_key" ON "CylinderWave"("experiment_id", "wave_number");

-- CreateIndex
CREATE INDEX "CylinderWaveDateChange_wave_id_idx" ON "CylinderWaveDateChange"("wave_id");

-- CreateTable
CREATE TABLE "CylinderPlant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "wave_id" TEXT NOT NULL,
    "plant_barcode" TEXT NOT NULL,
    "germination_date" TEXT NOT NULL,
    "sowing_date" TEXT,
    "transfer_date" TEXT,
    "uses_wave_dates" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "germ_day_color" TEXT,
    "set_by_phenotyper_id" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CylinderPlant_wave_id_fkey" FOREIGN KEY ("wave_id") REFERENCES "CylinderWave" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CylinderPlantDateChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "plant_id" TEXT NOT NULL,
    "old_germination_date" TEXT,
    "new_germination_date" TEXT NOT NULL,
    "old_sowing_date" TEXT,
    "new_sowing_date" TEXT,
    "old_transfer_date" TEXT,
    "new_transfer_date" TEXT,
    "old_germ_day_color" TEXT,
    "new_germ_day_color" TEXT,
    "reason" TEXT,
    "changed_by_phenotyper_id" TEXT,
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CylinderPlantDateChange_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "CylinderPlant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CylinderPlant_wave_id_idx" ON "CylinderPlant"("wave_id");

-- CreateIndex
CREATE UNIQUE INDEX "CylinderPlant_wave_id_plant_barcode_key" ON "CylinderPlant"("wave_id", "plant_barcode");

-- CreateIndex
CREATE INDEX "CylinderPlantDateChange_plant_id_idx" ON "CylinderPlantDateChange"("plant_id");

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "cylinder_plant_id" TEXT,
    CONSTRAINT "Scan_phenotyper_id_fkey" FOREIGN KEY ("phenotyper_id") REFERENCES "Phenotyper" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Scan_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "Experiment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Scan_cylinder_plant_id_fkey" FOREIGN KEY ("cylinder_plant_id") REFERENCES "CylinderPlant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Scan" ("id", "experiment_id", "phenotyper_id", "scanner_name", "plant_id", "accession_name", "path", "capture_date", "num_frames", "exposure_time", "gain", "brightness", "contrast", "gamma", "seconds_per_rot", "wave_number", "plant_age_days", "deleted") SELECT "id", "experiment_id", "phenotyper_id", "scanner_name", "plant_id", "accession_name", "path", "capture_date", "num_frames", "exposure_time", "gain", "brightness", "contrast", "gamma", "seconds_per_rot", "wave_number", "plant_age_days", "deleted" FROM "Scan";
DROP TABLE "Scan";
ALTER TABLE "new_Scan" RENAME TO "Scan";
CREATE INDEX "Scan_experiment_id_idx" ON "Scan"("experiment_id");
CREATE INDEX "Scan_phenotyper_id_idx" ON "Scan"("phenotyper_id");
CREATE INDEX "Scan_plant_id_idx" ON "Scan"("plant_id");
CREATE INDEX "Scan_capture_date_idx" ON "Scan"("capture_date");
CREATE INDEX "Scan_cylinder_plant_id_idx" ON "Scan"("cylinder_plant_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
