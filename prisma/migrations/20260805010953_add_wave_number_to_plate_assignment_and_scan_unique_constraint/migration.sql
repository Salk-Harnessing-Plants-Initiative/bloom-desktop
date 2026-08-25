-- CreateIndex
-- GraviScan already has no unique constraint (only non-unique @@index rows).
-- Adding one directly via CREATE UNIQUE INDEX does not require a table
-- rebuild in SQLite. Multiple NULLs in session_id are treated as distinct,
-- so existing one-shot/test-scan rows with session_id: NULL are unaffected.
CREATE UNIQUE INDEX "GraviScan_session_id_scanner_id_plate_index_cycle_number_key" ON "GraviScan"("session_id", "scanner_id", "plate_index", "cycle_number");

-- RedefineTables
-- Adds wave_number to GraviScanPlateAssignment and widens its unique
-- constraint to include it, following this table's own established
-- migration pattern (see 20260729193042_add_verification_status_to_plate_assignment
-- and 20260730071528_add_previous_plate_barcode_to_plate_assignment).
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GraviScanPlateAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experiment_id" TEXT NOT NULL,
    "scanner_id" TEXT NOT NULL,
    "plate_index" TEXT NOT NULL,
    "plate_barcode" TEXT,
    "transplant_date" DATETIME,
    "custom_note" TEXT,
    "selected" BOOLEAN NOT NULL DEFAULT true,
    "verification_status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "previous_plate_barcode" TEXT,
    "wave_number" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "GraviScanPlateAssignment_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "Experiment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GraviScanPlateAssignment_scanner_id_fkey" FOREIGN KEY ("scanner_id") REFERENCES "GraviScanner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_GraviScanPlateAssignment" ("id", "experiment_id", "scanner_id", "plate_index", "plate_barcode", "transplant_date", "custom_note", "selected", "verification_status", "createdAt", "updatedAt", "previous_plate_barcode") SELECT "id", "experiment_id", "scanner_id", "plate_index", "plate_barcode", "transplant_date", "custom_note", "selected", "verification_status", "createdAt", "updatedAt", "previous_plate_barcode" FROM "GraviScanPlateAssignment";
DROP TABLE "GraviScanPlateAssignment";
ALTER TABLE "new_GraviScanPlateAssignment" RENAME TO "GraviScanPlateAssignment";
CREATE INDEX "GraviScanPlateAssignment_experiment_id_idx" ON "GraviScanPlateAssignment"("experiment_id");
CREATE INDEX "GraviScanPlateAssignment_scanner_id_idx" ON "GraviScanPlateAssignment"("scanner_id");
CREATE UNIQUE INDEX "GraviScanPlateAssignment_experiment_id_scanner_id_plate_index_wave_number_key" ON "GraviScanPlateAssignment"("experiment_id", "scanner_id", "plate_index", "wave_number");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
