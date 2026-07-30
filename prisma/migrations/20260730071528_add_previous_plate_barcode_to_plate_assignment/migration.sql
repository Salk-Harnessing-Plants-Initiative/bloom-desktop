-- RedefineTables
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
    CONSTRAINT "GraviScanPlateAssignment_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "Experiment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GraviScanPlateAssignment_scanner_id_fkey" FOREIGN KEY ("scanner_id") REFERENCES "GraviScanner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_GraviScanPlateAssignment" ("createdAt", "custom_note", "experiment_id", "id", "plate_barcode", "plate_index", "scanner_id", "selected", "transplant_date", "updatedAt", "verification_status") SELECT "createdAt", "custom_note", "experiment_id", "id", "plate_barcode", "plate_index", "scanner_id", "selected", "transplant_date", "updatedAt", "verification_status" FROM "GraviScanPlateAssignment";
DROP TABLE "GraviScanPlateAssignment";
ALTER TABLE "new_GraviScanPlateAssignment" RENAME TO "GraviScanPlateAssignment";
CREATE INDEX "GraviScanPlateAssignment_experiment_id_idx" ON "GraviScanPlateAssignment"("experiment_id");
CREATE INDEX "GraviScanPlateAssignment_scanner_id_idx" ON "GraviScanPlateAssignment"("scanner_id");
CREATE UNIQUE INDEX "GraviScanPlateAssignment_experiment_id_scanner_id_plate_index_key" ON "GraviScanPlateAssignment"("experiment_id", "scanner_id", "plate_index");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
