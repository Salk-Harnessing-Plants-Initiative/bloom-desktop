-- CreateTable
CREATE TABLE "ExperimentCameraSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experiment_id" TEXT NOT NULL,
    "exposure_time" INTEGER NOT NULL,
    "gain" REAL NOT NULL,
    "gamma" REAL NOT NULL,
    "note" TEXT NOT NULL,
    "set_by_phenotyper_id" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_confirmed_at" DATETIME,
    "last_confirmed_by_phenotyper_id" TEXT,
    CONSTRAINT "ExperimentCameraSettings_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "Experiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ExperimentCameraSettings_experiment_id_createdAt_idx" ON "ExperimentCameraSettings"("experiment_id", "createdAt");


-- Backfill (#483): each experiment with scans starts from its latest non-deleted scan
-- taken with real settings (deploy self-tests save 0 / 0). The latest scan is picked by
-- time in milliseconds, since scans from the pilot app may store the date as text. Rows
-- are written in milliseconds, as Prisma writes them, and left unconfirmed so the first
-- scan after the update asks for a check.
INSERT INTO "ExperimentCameraSettings" ("id", "experiment_id", "exposure_time", "gain", "gamma", "note", "createdAt")
SELECT
    lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
    "latest"."experiment_id",
    "latest"."exposure_time",
    "latest"."gain",
    "latest"."gamma",
    'Copied from latest scan (' || date("latest"."captured_ms" / 1000, 'unixepoch', 'localtime') || ')',
    CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
FROM (
    SELECT
        "experiment_id",
        "exposure_time",
        "gain",
        "gamma",
        "captured_ms",
        ROW_NUMBER() OVER (PARTITION BY "experiment_id" ORDER BY "captured_ms" DESC, "id" DESC) AS "rank"
    FROM (
        SELECT
            "id",
            "experiment_id",
            "exposure_time",
            "gain",
            "gamma",
            CASE typeof("capture_date")
                WHEN 'text' THEN CAST((julianday("capture_date") - 2440587.5) * 86400000 AS INTEGER)
                ELSE "capture_date"
            END AS "captured_ms"
        FROM "Scan"
        WHERE "deleted" = 0 AND "exposure_time" > 0
    )
) AS "latest"
WHERE "latest"."rank" = 1;
