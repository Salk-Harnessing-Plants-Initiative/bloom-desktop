-- CreateTable
CREATE TABLE "Phenotyper" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Scientist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "species" TEXT NOT NULL,
    "scientist_id" TEXT,
    "accession_id" TEXT,
    CONSTRAINT "Experiment_accession_id_fkey" FOREIGN KEY ("accession_id") REFERENCES "Accessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Experiment_scientist_id_fkey" FOREIGN KEY ("scientist_id") REFERENCES "Scientist" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Accessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PlantAccessionMappings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accession_id" TEXT NOT NULL,
    "plant_barcode" TEXT NOT NULL,
    "accession_file_id" TEXT NOT NULL,
    CONSTRAINT "PlantAccessionMappings_accession_file_id_fkey" FOREIGN KEY ("accession_file_id") REFERENCES "Accessions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Scan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experiment_id" TEXT NOT NULL,
    "phenotyper_id" TEXT NOT NULL,
    "scanner_name" TEXT NOT NULL,
    "plant_id" TEXT NOT NULL,
    "accession_id" TEXT,
    "path" TEXT NOT NULL,
    "capture_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "num_frames" INTEGER NOT NULL,
    "exposure_time" INTEGER NOT NULL,
    "gain" REAL NOT NULL,
    "brightness" REAL NOT NULL,
    "contrast" REAL NOT NULL,
    "gamma" REAL NOT NULL,
    "seconds_per_rot" REAL NOT NULL,
    "wave_number" INTEGER NOT NULL,
    "plant_age_days" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Scan_phenotyper_id_fkey" FOREIGN KEY ("phenotyper_id") REFERENCES "Phenotyper" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Scan_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "Experiment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Image" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scan_id" TEXT NOT NULL,
    "frame_number" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    CONSTRAINT "Image_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "Scan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Phenotyper_email_key" ON "Phenotyper"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Scientist_email_key" ON "Scientist"("email");

-- CreateIndex
CREATE INDEX "Scan_experiment_id_idx" ON "Scan"("experiment_id");

-- CreateIndex
CREATE INDEX "Scan_phenotyper_id_idx" ON "Scan"("phenotyper_id");

-- CreateIndex
CREATE INDEX "Scan_plant_id_idx" ON "Scan"("plant_id");

-- CreateIndex
CREATE INDEX "Scan_capture_date_idx" ON "Scan"("capture_date");

-- CreateIndex
CREATE INDEX "Image_scan_id_idx" ON "Image"("scan_id");
