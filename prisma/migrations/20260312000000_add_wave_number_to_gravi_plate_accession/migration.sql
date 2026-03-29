-- Add wave_number to GraviPlateAccession so metadata can be distinguished per wave
ALTER TABLE "GraviPlateAccession" ADD COLUMN "wave_number" INTEGER;
