-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "GraviImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "graviscan_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "box_status" TEXT NOT NULL DEFAULT 'pending',
    CONSTRAINT "GraviImage_graviscan_id_fkey" FOREIGN KEY ("graviscan_id") REFERENCES "GraviScan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "GraviConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "grid_mode" TEXT NOT NULL DEFAULT '2grid',
    "resolution" INTEGER NOT NULL DEFAULT 1200,
    "format" TEXT NOT NULL DEFAULT 'tiff',
    "usb_signature" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "GraviPlateSectionMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gravi_plate_id" TEXT NOT NULL,
    "plate_section_id" TEXT NOT NULL,
    "plant_qr" TEXT NOT NULL,
    "medium" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GraviPlateSectionMapping_gravi_plate_id_fkey" FOREIGN KEY ("gravi_plate_id") REFERENCES "GraviPlateAccession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "GraviScan_experiment_id_idx" ON "GraviScan"("experiment_id");

-- CreateIndex
CREATE INDEX "GraviScan_phenotyper_id_idx" ON "GraviScan"("phenotyper_id");

-- CreateIndex
CREATE INDEX "GraviScan_scanner_id_idx" ON "GraviScan"("scanner_id");

-- CreateIndex
CREATE INDEX "GraviScan_session_id_idx" ON "GraviScan"("session_id");

-- CreateIndex
CREATE INDEX "GraviScan_capture_date_idx" ON "GraviScan"("capture_date");

-- CreateIndex
CREATE INDEX "GraviScan_experiment_id_wave_number_plate_barcode_idx" ON "GraviScan"("experiment_id", "wave_number", "plate_barcode");

-- CreateIndex
CREATE INDEX "GraviScanSession_experiment_id_idx" ON "GraviScanSession"("experiment_id");

-- CreateIndex
CREATE INDEX "GraviScanSession_phenotyper_id_idx" ON "GraviScanSession"("phenotyper_id");

-- CreateIndex
CREATE INDEX "GraviScanPlateAssignment_experiment_id_idx" ON "GraviScanPlateAssignment"("experiment_id");

-- CreateIndex
CREATE INDEX "GraviScanPlateAssignment_scanner_id_idx" ON "GraviScanPlateAssignment"("scanner_id");

-- CreateIndex
CREATE UNIQUE INDEX "GraviScanPlateAssignment_experiment_id_scanner_id_plate_index_key" ON "GraviScanPlateAssignment"("experiment_id", "scanner_id", "plate_index");

-- CreateIndex
CREATE INDEX "GraviImage_graviscan_id_idx" ON "GraviImage"("graviscan_id");

-- CreateIndex
CREATE INDEX "GraviPlateAccession_metadata_file_id_idx" ON "GraviPlateAccession"("metadata_file_id");

-- CreateIndex
CREATE INDEX "GraviPlateAccession_plate_id_idx" ON "GraviPlateAccession"("plate_id");

-- CreateIndex
CREATE UNIQUE INDEX "GraviPlateAccession_metadata_file_id_plate_id_key" ON "GraviPlateAccession"("metadata_file_id", "plate_id");

-- CreateIndex
CREATE INDEX "GraviPlateSectionMapping_gravi_plate_id_idx" ON "GraviPlateSectionMapping"("gravi_plate_id");

-- CreateIndex
CREATE INDEX "GraviPlateSectionMapping_plant_qr_idx" ON "GraviPlateSectionMapping"("plant_qr");

-- CreateIndex
CREATE UNIQUE INDEX "GraviPlateSectionMapping_gravi_plate_id_plant_qr_key" ON "GraviPlateSectionMapping"("gravi_plate_id", "plant_qr");
