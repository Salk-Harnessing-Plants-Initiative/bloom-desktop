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
