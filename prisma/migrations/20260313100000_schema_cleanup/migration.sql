-- Drop never-populated wave_number from GraviPlateAccession
ALTER TABLE "GraviPlateAccession" DROP COLUMN "wave_number";

-- Drop unused GraviScannerAssignment model (never populated)
DROP TABLE IF EXISTS "GraviScannerAssignment";
