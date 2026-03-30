-- CreateTable
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

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GraviScan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experiment_id" TEXT NOT NULL,
    "phenotyper_id" TEXT NOT NULL,
    "scanner_id" TEXT NOT NULL,
    "session_id" TEXT,
    "cycle_number" INTEGER,
    "plant_barcode" TEXT,
    "path" TEXT NOT NULL,
    "capture_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grid_mode" TEXT NOT NULL,
    "plate_index" TEXT NOT NULL,
    "resolution" INTEGER NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'jpeg',
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "GraviScan_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "Experiment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GraviScan_phenotyper_id_fkey" FOREIGN KEY ("phenotyper_id") REFERENCES "Phenotyper" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GraviScan_scanner_id_fkey" FOREIGN KEY ("scanner_id") REFERENCES "GraviScanner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GraviScan_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "GraviScanSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_GraviScan" ("capture_date", "deleted", "experiment_id", "format", "grid_mode", "id", "path", "phenotyper_id", "plant_barcode", "plate_index", "resolution", "scanner_id") SELECT "capture_date", "deleted", "experiment_id", "format", "grid_mode", "id", "path", "phenotyper_id", "plant_barcode", "plate_index", "resolution", "scanner_id" FROM "GraviScan";
DROP TABLE "GraviScan";
ALTER TABLE "new_GraviScan" RENAME TO "GraviScan";
CREATE INDEX "GraviScan_experiment_id_idx" ON "GraviScan"("experiment_id");
CREATE INDEX "GraviScan_phenotyper_id_idx" ON "GraviScan"("phenotyper_id");
CREATE INDEX "GraviScan_scanner_id_idx" ON "GraviScan"("scanner_id");
CREATE INDEX "GraviScan_session_id_idx" ON "GraviScan"("session_id");
CREATE INDEX "GraviScan_capture_date_idx" ON "GraviScan"("capture_date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "GraviScanSession_experiment_id_idx" ON "GraviScanSession"("experiment_id");

-- CreateIndex
CREATE INDEX "GraviScanSession_phenotyper_id_idx" ON "GraviScanSession"("phenotyper_id");
