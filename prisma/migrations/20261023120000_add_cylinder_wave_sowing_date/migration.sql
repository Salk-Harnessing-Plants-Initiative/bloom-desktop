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
    "calculated_plant_age_days" INTEGER,
    "plant_age_change_reason" TEXT,
    CONSTRAINT "Scan_phenotyper_id_fkey" FOREIGN KEY ("phenotyper_id") REFERENCES "Phenotyper" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Scan_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "Experiment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Scan" ("id", "experiment_id", "phenotyper_id", "scanner_name", "plant_id", "accession_name", "path", "capture_date", "num_frames", "exposure_time", "gain", "brightness", "contrast", "gamma", "seconds_per_rot", "wave_number", "plant_age_days", "deleted") SELECT "id", "experiment_id", "phenotyper_id", "scanner_name", "plant_id", "accession_name", "path", "capture_date", "num_frames", "exposure_time", "gain", "brightness", "contrast", "gamma", "seconds_per_rot", "wave_number", "plant_age_days", "deleted" FROM "Scan";
DROP TABLE "Scan";
ALTER TABLE "new_Scan" RENAME TO "Scan";
CREATE INDEX "Scan_experiment_id_idx" ON "Scan"("experiment_id");
CREATE INDEX "Scan_phenotyper_id_idx" ON "Scan"("phenotyper_id");
CREATE INDEX "Scan_plant_id_idx" ON "Scan"("plant_id");
CREATE INDEX "Scan_capture_date_idx" ON "Scan"("capture_date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateTable
CREATE TABLE "CylinderWave" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experiment_id" TEXT NOT NULL,
    "wave_number" INTEGER NOT NULL,
    "sowing_date" TEXT NOT NULL,
    "start_date_basis" TEXT,
    "start_date_basis_other" TEXT,
    "note" TEXT,
    "set_by_phenotyper_id" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CylinderWave_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "Experiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CylinderWaveSowingDateChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "wave_id" TEXT NOT NULL,
    "old_sowing_date" TEXT,
    "new_sowing_date" TEXT NOT NULL,
    "start_date_basis" TEXT,
    "start_date_basis_other" TEXT,
    "reason" TEXT,
    "changed_by_phenotyper_id" TEXT,
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CylinderWaveSowingDateChange_wave_id_fkey" FOREIGN KEY ("wave_id") REFERENCES "CylinderWave" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CylinderWave_experiment_id_idx" ON "CylinderWave"("experiment_id");

-- CreateIndex
CREATE UNIQUE INDEX "CylinderWave_experiment_id_wave_number_key" ON "CylinderWave"("experiment_id", "wave_number");

-- CreateIndex
CREATE INDEX "CylinderWaveSowingDateChange_wave_id_idx" ON "CylinderWaveSowingDateChange"("wave_id");

