-- AlterTable
ALTER TABLE "GraviScanner" ADD COLUMN "usb_bus" INTEGER;
ALTER TABLE "GraviScanner" ADD COLUMN "usb_device" INTEGER;
ALTER TABLE "GraviScanner" ADD COLUMN "usb_port" TEXT;

-- CreateTable
CREATE TABLE "GraviScannerAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slot_index" INTEGER NOT NULL,
    "slot_name" TEXT NOT NULL,
    "scanner_id" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GraviScannerAssignment_scanner_id_fkey" FOREIGN KEY ("scanner_id") REFERENCES "GraviScanner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GraviPlateAccession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "metadata_file_id" TEXT NOT NULL,
    "plate_id" TEXT NOT NULL,
    "accession" TEXT NOT NULL,
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
CREATE UNIQUE INDEX "GraviScannerAssignment_slot_index_key" ON "GraviScannerAssignment"("slot_index");

-- CreateIndex
CREATE UNIQUE INDEX "GraviScannerAssignment_scanner_id_key" ON "GraviScannerAssignment"("scanner_id");

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
CREATE UNIQUE INDEX "GraviPlateSectionMapping_gravi_plate_id_plate_section_id_key" ON "GraviPlateSectionMapping"("gravi_plate_id", "plate_section_id");
