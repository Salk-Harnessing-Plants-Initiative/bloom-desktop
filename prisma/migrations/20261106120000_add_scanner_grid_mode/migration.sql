-- Per-scanner grid mode, so 2-grid and 4-grid scanners can run in one session.
-- Same column, type and default as the GraviScan rig build, whose databases
-- already have it: on those, mark this migration applied instead of running it.
ALTER TABLE "GraviScanner" ADD COLUMN "grid_mode" TEXT NOT NULL DEFAULT '4grid';
