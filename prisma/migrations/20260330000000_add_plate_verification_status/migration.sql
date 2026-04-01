-- Add verification_status column to GraviScanPlateAssignment
-- Values: pending, verified, swapped, unreadable, skipped
ALTER TABLE "GraviScanPlateAssignment" ADD COLUMN "verification_status" TEXT NOT NULL DEFAULT 'pending';
