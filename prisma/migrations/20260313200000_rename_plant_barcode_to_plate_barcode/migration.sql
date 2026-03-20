-- Rename plant_barcode to plate_barcode in GraviScan table
ALTER TABLE "GraviScan" RENAME COLUMN "plant_barcode" TO "plate_barcode";

-- Recreate index with new column name
DROP INDEX IF EXISTS "GraviScan_experiment_id_wave_number_plant_barcode_idx";
CREATE INDEX "GraviScan_experiment_id_wave_number_plate_barcode_idx" ON "GraviScan"("experiment_id", "wave_number", "plate_barcode");

-- Rename plant_barcode to plate_barcode in GraviScanPlateAssignment table
ALTER TABLE "GraviScanPlateAssignment" RENAME COLUMN "plant_barcode" TO "plate_barcode";
