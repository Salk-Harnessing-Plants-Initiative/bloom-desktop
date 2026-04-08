-- CreateTable
CREATE TABLE "GraviScan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experiment_id" TEXT NOT NULL,
    "phenotyper_id" TEXT NOT NULL,
    "scanner_id" TEXT NOT NULL,
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
    CONSTRAINT "GraviScan_scanner_id_fkey" FOREIGN KEY ("scanner_id") REFERENCES "GraviScanner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

--createTable
CREATE TABLE "GraviScanPlateAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experiment_id" TEXT NOT NULL,
    "plate_index" TEXT NOT NULL,
    "plant_barcode" TEXT,
    "selected" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "scanner_id" TEXT NOT NULL,
    CONSTRAINT "GraviScanPlateAssignment_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "Experiment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GraviScanPlateAssignment_scanner_id_fkey" FOREIGN KEY ("scanner_id") REFERENCES "GraviScanner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GraviImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "graviscan_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    CONSTRAINT "GraviImage_graviscan_id_fkey" FOREIGN KEY ("graviscan_id") REFERENCES "GraviScan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GraviScanner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL DEFAULT '04b8',
    "product_id" TEXT NOT NULL DEFAULT '013a',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GraviConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "grid_mode" TEXT NOT NULL DEFAULT '2grid',
    "resolution" INTEGER NOT NULL DEFAULT 1200,
    "format" TEXT NOT NULL DEFAULT 'jpeg',
    "usb_signature" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Experiment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "species" TEXT NOT NULL,
    "scientist_id" TEXT,
    "accession_id" TEXT,
    "experiment_type" TEXT NOT NULL DEFAULT 'cylinder',
    CONSTRAINT "Experiment_accession_id_fkey" FOREIGN KEY ("accession_id") REFERENCES "Accessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Experiment_scientist_id_fkey" FOREIGN KEY ("scientist_id") REFERENCES "Scientist" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Experiment" ("accession_id", "id", "name", "scientist_id", "species") SELECT "accession_id", "id", "name", "scientist_id", "species" FROM "Experiment";
DROP TABLE "Experiment";
ALTER TABLE "new_Experiment" RENAME TO "Experiment";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "GraviScan_experiment_id_idx" ON "GraviScan"("experiment_id");

-- CreateIndex
CREATE INDEX "GraviScan_phenotyper_id_idx" ON "GraviScan"("phenotyper_id");

-- CreateIndex
CREATE INDEX "GraviScan_scanner_id_idx" ON "GraviScan"("scanner_id");

-- CreateIndex
CREATE INDEX "GraviScan_capture_date_idx" ON "GraviScan"("capture_date");

-- CreateIndex
CREATE INDEX "GraviImage_graviscan_id_idx" ON "GraviImage"("graviscan_id");

-- CreateIndex
CREATE UNIQUE INDEX "GraviScanPlateAssignment_experiment_id_scanner_id_plate_index_key" ON "GraviScanPlateAssignment"("experiment_id", "scanner_id", "plate_index");

-- CreateIndex
CREATE INDEX "GraviScanPlateAssignment_experiment_id_idx" ON "GraviScanPlateAssignment"("experiment_id");

-- CreateIndex
CREATE INDEX "GraviScanPlateAssignment_scanner_id_idx" ON "GraviScanPlateAssignment"("scanner_id");
