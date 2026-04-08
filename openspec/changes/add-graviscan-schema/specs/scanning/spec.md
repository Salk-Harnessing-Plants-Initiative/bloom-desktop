## ADDED Requirements

### Requirement: GraviScan Database Schema

The database SHALL include 8 GraviScan models for multi-scanner flatbed phenotyping data. All models are additive — no existing CylinderScan models (Scan, Image) are modified. The Experiment model gains an `experiment_type` field to distinguish scan modes.

#### Scenario: GraviScan models exist after migration

- **GIVEN** the database has been migrated to the current schema
- **WHEN** a developer inspects the database tables
- **THEN** all 8 GraviScan tables SHALL exist: GraviScan, GraviScanSession, GraviScanner, GraviConfig, GraviImage, GraviScanPlateAssignment, GraviPlateAccession, GraviPlateSectionMapping
- **AND** all existing CylinderScan tables SHALL remain unchanged

#### Scenario: Experiment type backfill for existing data

- **GIVEN** a database with pre-existing experiments (no experiment_type field)
- **WHEN** the migration is applied
- **THEN** all existing experiments SHALL have `experiment_type = 'cylinderscan'`
- **AND** new experiments SHALL default to `'cylinderscan'` unless explicitly set

#### Scenario: Cascade delete on plate accession chain

- **GIVEN** an Accessions record with linked GraviPlateAccession and GraviPlateSectionMapping records
- **WHEN** the Accessions record is deleted
- **THEN** all linked GraviPlateAccession records SHALL be cascade-deleted
- **AND** all linked GraviPlateSectionMapping records SHALL be cascade-deleted

#### Scenario: Session delete preserves scans

- **GIVEN** a GraviScanSession with linked GraviScan records
- **WHEN** the session is deleted
- **THEN** the GraviScan records SHALL be preserved
- **AND** their `session_id` field SHALL be set to NULL

#### Scenario: Database upgrade from v3 to v4

- **GIVEN** a v3 database (current schema without GraviScan models)
- **WHEN** the upgrade script runs
- **THEN** all 8 GraviScan tables SHALL be created
- **AND** the `experiment_type` column SHALL be added to Experiment
- **AND** all existing data SHALL be preserved
- **AND** migration checksums SHALL match the migration SQL files

#### Scenario: Migration verification passes

- **GIVEN** the Prisma schema and migration SQL files
- **WHEN** `scripts/verify-migrations.sh` runs
- **THEN** the schema produced by `prisma migrate deploy` SHALL match `prisma db push`
- **AND** no column or constraint differences SHALL exist

#### Scenario: Prisma client generation succeeds

- **GIVEN** the updated `prisma/schema.prisma` with all 8 new models
- **WHEN** `npx prisma generate` runs
- **THEN** the Prisma client SHALL be generated successfully
- **AND** all new model types SHALL be available in TypeScript
