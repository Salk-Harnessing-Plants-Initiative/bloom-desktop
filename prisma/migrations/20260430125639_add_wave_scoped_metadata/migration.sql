-- Wave-scoped metadata link: each (experiment, wave) has at most one metadata file.
-- GraviScan-only. CylinderScan continues to use Experiment.accession_id.

CREATE TABLE "GraviExperimentWaveMetadata" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experiment_id" TEXT NOT NULL,
    "wave_number" INTEGER NOT NULL,
    "accession_id" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GraviExperimentWaveMetadata_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "Experiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GraviExperimentWaveMetadata_accession_id_fkey" FOREIGN KEY ("accession_id") REFERENCES "Accessions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "GraviExperimentWaveMetadata_experiment_id_wave_number_key" ON "GraviExperimentWaveMetadata"("experiment_id", "wave_number");
CREATE INDEX "GraviExperimentWaveMetadata_experiment_id_idx" ON "GraviExperimentWaveMetadata"("experiment_id");
CREATE INDEX "GraviExperimentWaveMetadata_accession_id_idx" ON "GraviExperimentWaveMetadata"("accession_id");

-- Migrate existing GraviScan experiments: move accession_id from Experiment to wave_number=1
INSERT INTO "GraviExperimentWaveMetadata" ("id", "experiment_id", "wave_number", "accession_id", "createdAt")
SELECT
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
    "id",
    1,
    "accession_id",
    CURRENT_TIMESTAMP
FROM "Experiment"
WHERE "experiment_type" = 'graviscan' AND "accession_id" IS NOT NULL;

-- Clear accession_id on graviscan experiments — they now use the link table only
UPDATE "Experiment" SET "accession_id" = NULL WHERE "experiment_type" = 'graviscan';
