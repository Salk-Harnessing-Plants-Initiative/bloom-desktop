-- AlterTable
ALTER TABLE "GraviScan" ADD COLUMN "custom_note" TEXT;
ALTER TABLE "GraviScan" ADD COLUMN "transplant_date" DATETIME;

-- AlterTable
ALTER TABLE "GraviScanPlateAssignment" ADD COLUMN "custom_note" TEXT;
ALTER TABLE "GraviScanPlateAssignment" ADD COLUMN "transplant_date" DATETIME;
