-- Add per-scanner grid_mode column to GraviScanner
-- Defaults to "4grid" for existing scanners (matches GraviConfig global default)
ALTER TABLE "GraviScanner" ADD COLUMN "grid_mode" TEXT NOT NULL DEFAULT '4grid';
