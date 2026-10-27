# Database Documentation

This document describes the Prisma database setup, schema, API, and testing procedures for Bloom Desktop.

## Overview

Bloom Desktop uses **Prisma ORM** with **SQLite** as the database engine for storing:

- Experimental metadata (experiments, scientists, phenotypers)
- Plant accessions and mappings
- Scan records and images
- Camera and DAQ parameters

The database schema is **100% compatible** with the [bloom-desktop-pilot schema](https://github.com/eberrigan/bloom-desktop-pilot/blob/dev/app/prisma/schema.prisma) to ensure data migration compatibility.

## Architecture

```
┌─────────────────┐
│  React Frontend │
│  (Renderer)     │
└────────┬────────┘
         │ IPC
         ▼
┌─────────────────┐
│ Database        │
│ Handlers        │
│ (Main Process)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Prisma Client   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ SQLite Database │
│ (dev.db or      │
│  ~/.bloom/)     │
└─────────────────┘
```

## Database Locations

### Development

- **Path**: `~/.bloom/dev.db`
- **Created by**: `prisma migrate deploy` or `npm run prisma:reset`
- **Used when**: `NODE_ENV=development`
- **Rationale**: Database stored outside project directory to persist across branches and avoid accidental Git commits

### Production

- **Path**: `~/.bloom/data/bloom.db`
- **Created by**: App automatically creates directory on first run
- **Used when**: Packaged application
- **Platform-specific**:
  - macOS: `/Users/<username>/.bloom/data/bloom.db`
  - Linux: `/home/<username>/.bloom/data/bloom.db`
  - Windows: `C:\Users\<username>\.bloom\data\bloom.db`

## Database Schema

### Models

The database includes 7 models with the following relationships:

```
Scientist ──┐
            ├─> Experiment ──┐
Accessions ─┘                │
                             ├─> Scan ──> Image
Phenotyper ──────────────────┘

PlantAccessionMappings ──> Accessions
```

#### Phenotyper

```prisma
model Phenotyper {
  id    String @id @default(uuid())
  name  String
  email String @unique
  scans Scan[]
}
```

#### Scientist

```prisma
model Scientist {
  id          String       @id @default(uuid())
  name        String
  email       String       @unique
  experiments Experiment[]
}
```

#### Experiment

```prisma
model Experiment {
  id           String      @id @default(uuid())
  name         String
  species      String
  scientist_id String?
  accession_id String?
  accession    Accessions? @relation("AccessionToExperiment", fields: [accession_id], references: [id])
  scientist    Scientist?  @relation(fields: [scientist_id], references: [id])
  scans        Scan[]
}
```

#### Accessions

```prisma
model Accessions {
  id          String                   @id @default(uuid())
  name        String
  createdAt   DateTime                 @default(now())
  experiments Experiment[]             @relation("AccessionToExperiment")
  mappings    PlantAccessionMappings[]
}
```

#### PlantAccessionMappings

Many-to-many relationship between plants and accessions.

```prisma
model PlantAccessionMappings {
  id                String     @id @default(uuid())
  plant_barcode     String
  accession_name    String?    // Renamed from genotype_id in v3 migration
  accession_file_id String
  accession         Accessions @relation(fields: [accession_file_id], references: [id])
}
```

#### Scan

```prisma
model Scan {
  id              String     @id @default(uuid())
  experiment_id   String
  phenotyper_id   String
  scanner_name    String
  plant_id        String
  accession_name  String?    // Renamed from accession_id in v3 migration
  path            String
  capture_date    DateTime   @default(now())
  num_frames      Int
  exposure_time   Int
  gain            Float
  brightness      Float
  contrast        Float
  gamma           Float
  seconds_per_rot Float
  wave_number     Int
  plant_age_days  Int        // Days since the plant's germination date (CylinderPlant)
  cylinder_plant_id String?  // The plant whose dates the age came from (null for older scans)
  deleted         Boolean    @default(false)
  images          Image[]
  phenotyper      Phenotyper @relation(fields: [phenotyper_id], references: [id])
  experiment      Experiment @relation(fields: [experiment_id], references: [id])

  @@index([experiment_id])
  @@index([phenotyper_id])
  @@index([plant_id])
  @@index([capture_date])
}
```

#### Image

```prisma
model Image {
  id           String @id @default(uuid())
  scan_id      String
  frame_number Int
  path         String
  status       String @default("pending")
  scan         Scan   @relation(fields: [scan_id], references: [id])

  @@index([scan_id])
}
```

#### CylinderWave, CylinderPlant and their change logs

Every plant in a CylinderScan wave has a sowing, germination and transfer-to-cylinder date, local calendar dates stored as `"YYYY-MM-DD"`. Capture Scan computes the plant age from the plant's **germination date**, always: the calendar days from it to the scan date (days after germination, which is what the processing pipeline expects). A plant is its wave plus its barcode, since barcodes are reused across waves.

- **The wave** (`CylinderWave`): the first time a wave is used, Capture Scan asks whether all its plants share their dates. If they do, the three dates are entered once on the wave. If not (`dates_per_plant`), the wave has no dates and each plant's are asked for before its first scan. The wave's Edit switches between the two: a wave can go per plant at any time (plants on the wave's dates keep them as their own), and back to one set of dates for all its plants before its first scan, or after it only with the dates all its plants share.
- **The plant** (`CylinderPlant`): created at the plant's first scan from its wave's dates (`uses_wave_dates`), or when its own dates are set ("Different dates for this plant", with a reason, or a plant in a per-plant wave, whose dates are saved as its first scan starts). A correction to the wave's dates reaches the plants still on them; plants with their own dates aren't touched. Each plant's history (`CylinderPlantDateChange`) records everything that happened to its dates, including through its wave: the row created from the wave's dates at its first scan, a wave correction passed on to it, and the wave going per plant (it keeps the wave's dates as its own). On upload, Bloom's `germ_day` is the days from the plant's sowing to its germination and `germ_day_color` its colour (`none` when it has none); scans with no plant send 0 and `none`, as before.
- **Rules**, the same for both: germination and sowing can't be in the future, sowing is before germination (not the same day), and a transfer date (null for the germination day) is on or after germination. A sowing or germination date out of order with another wave's (on or before an earlier wave's, or on or after a later one's), or a wave number that skips ahead, needs a `note`. Once a wave or plant has scans, its dates only change with a reason.
- **Logs:** every set and change is recorded with each date before and after (`CylinderWaveDateChange`, `CylinderPlantDateChange`). Saved scans keep their age. An entry with no phenotyper was written by the backfill, and is shown as set by admin.
- **Scanning:** before a scan starts, the main process checks the age is the days since the plant's germination date; the scan is then saved under the plant (`Scan.cylinder_plant_id`), in one transaction with the plant's row.

```prisma
model CylinderWave {
  id                   String   @id @default(uuid())
  experiment_id        String
  wave_number          Int
  dates_per_plant      Boolean  @default(false)
  germination_date     String?  // null when the dates are per plant
  sowing_date          String?
  transfer_date        String?  // null: the germination day
  note                 String?
  set_by_phenotyper_id String?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  @@unique([experiment_id, wave_number])
}

model CylinderPlant {
  id                   String   @id @default(uuid())
  wave_id              String
  plant_barcode        String
  germination_date     String   // the plant age is computed from this
  sowing_date          String?
  transfer_date        String?  // null: the germination day
  uses_wave_dates      Boolean  @default(true)
  reason               String?  // why this plant's dates differ from its wave's
  germ_day_color       String?  // the lab's germination colour, camel case (#429); null for none
  set_by_phenotyper_id String?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  @@unique([wave_id, plant_barcode])
}

// CylinderWaveDateChange and CylinderPlantDateChange: old_/new_germination_date,
// old_/new_sowing_date, old_/new_transfer_date, reason, changed_by_phenotyper_id, changedAt
```

## Prisma Commands

**Important**: Most Prisma CLI commands require the `BLOOM_DATABASE_URL` environment variable:

```bash
# Set for your shell session
export BLOOM_DATABASE_URL="file:$HOME/.bloom/dev.db"
```

The database path is intentionally not hardcoded in npm scripts to allow flexibility for Machine Configuration.

### Development Workflow

```bash
# Generate Prisma Client (run after schema changes) - no env var needed
npm run prisma:generate

# Create and apply migrations
BLOOM_DATABASE_URL="file:$HOME/.bloom/dev.db" npm run prisma:migrate

# Seed database with test data
BLOOM_DATABASE_URL="file:$HOME/.bloom/dev.db" npm run prisma:seed

# Open Prisma Studio (visual database browser)
BLOOM_DATABASE_URL="file:$HOME/.bloom/dev.db" npm run prisma:studio
```

### After Git Pull: Applying New Migrations

When you pull code that includes new Prisma migrations (new files in `prisma/migrations/`), your local development database will be out of date. The app will crash with errors like:

```
The column `main.Experiment.experiment_type` does not exist in the current database.
```

**To fix**, apply pending migrations to your dev database:

```bash
# Apply pending migrations (preserves existing data)
BLOOM_DATABASE_URL="file:$HOME/.bloom/dev.db" npx prisma migrate deploy

# Then restart the app
npm run dev
```

If you want a completely fresh database instead:

```bash
# Delete and recreate from scratch (loses all dev data)
BLOOM_DATABASE_URL="file:$HOME/.bloom/dev.db" npm run prisma:reset
```

**Note**: The app does NOT auto-apply Prisma migrations on startup. This is by design — Prisma's migration engine is a separate binary from the query engine, and bundling it inside the Electron ASAR package adds significant size and complexity (see [PACKAGING.md](PACKAGING.md) for the ASAR/Prisma constraints). Instead, the app uses a custom upgrade script (`scripts/upgrade-database.ts`) that handles schema version detection and applies raw SQL upgrades for production databases. For development, migrations must be applied manually after pulling new code.

### Advanced Commands

```bash
# Create migration without applying
BLOOM_DATABASE_URL="file:$HOME/.bloom/dev.db" npx prisma migrate dev --create-only

# Apply migrations in production
BLOOM_DATABASE_URL="file:$HOME/.bloom/dev.db" npx prisma migrate deploy

# View migration status
BLOOM_DATABASE_URL="file:$HOME/.bloom/dev.db" npx prisma migrate status

# Format schema file (no env var needed)
npx prisma format
```

## Database Upgrade Workflow

Use this workflow when you have an existing database with data that needs to be upgraded to the current schema version.

### When to Use Upgrade

- You have a database created with `prisma db push` (no `_prisma_migrations` table)
- You have a database from bloom-desktop-pilot
- Your database is missing recent schema changes but has valuable data you want to preserve

### How It Works

The upgrade script:

1. Creates a backup of your database before any modifications
2. Detects the current schema version by inspecting table columns
3. Creates the `_prisma_migrations` table with appropriate records
4. Applies any necessary schema migrations while preserving data

### Usage

```bash
# Upgrade development database (~/.bloom/dev.db)
npm run db:upgrade

# Upgrade a specific database file
npx ts-node scripts/upgrade-database.ts /path/to/database.db
```

### Schema Versions

The upgrade script handles these schema versions:

| Version      | Description           | Key Characteristics                                                        |
| ------------ | --------------------- | -------------------------------------------------------------------------- |
| v1 (init)    | Original/pilot schema | `PlantAccessionMappings` has `accession_id`                                |
| v2           | Add genotype          | `PlantAccessionMappings` has `genotype_id`                                 |
| v3 (current) | Cleanup fields        | `PlantAccessionMappings` has `accession_name`, `Scan` has `accession_name` |

### Upgrade Paths

- **v1 → v3**: Copies `accession_id` to `accession_name`, removes old columns
- **v2 → v3**: Copies `genotype_id` to `accession_name`, removes old columns
- **Pilot → v3**: Same as v1 → v3 (pilot uses v1 schema)

### Backup and Recovery

The upgrade script always creates a backup at `<database>.backup` before modifications:

```bash
# If upgrade fails, restore from backup
cp ~/.bloom/dev.db.backup ~/.bloom/dev.db
```

## Database Reset Workflow

Use this workflow when you want a fresh database (data loss is acceptable).

### When to Use Reset

- Setting up a new development environment
- Your database has irrecoverable schema issues
- You want to start with a clean slate

### Usage

Prisma CLI commands require the `BLOOM_DATABASE_URL` environment variable:

```bash
# Set for current session
export BLOOM_DATABASE_URL="file:$HOME/.bloom/dev.db"

# Reset database and apply migrations
npm run prisma:reset

# Reset database and seed with test data
npm run prisma:reset:seed

# Or prefix individual commands
BLOOM_DATABASE_URL="file:$HOME/.bloom/dev.db" npm run prisma:reset
```

**⚠️ WARNING**: Reset deletes all local data. Use `npm run db:upgrade` if you need to preserve data.

**Note**: The database path is not hardcoded in npm scripts to allow flexibility for Machine Configuration. The app sets this path dynamically at runtime.

### How It Works

The reset script:

1. Deletes the development database at `~/.bloom/dev.db`
2. Runs `prisma migrate deploy` to create a fresh database with all migrations

## IPC API Reference

The database is accessed from the renderer process via IPC handlers. All handlers return a `DatabaseResponse`:

```typescript
interface DatabaseResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
```

### Experiments

```typescript
// List all experiments with relations
window.electron.database.experiments.list()
// Returns: DatabaseResponse<ExperimentWithRelations[]>

// Get single experiment by ID
window.electron.database.experiments.get(id: string)
// Returns: DatabaseResponse<ExperimentWithRelations>

// Create new experiment
window.electron.database.experiments.create(data: ExperimentCreateData)
// Returns: DatabaseResponse<Experiment>

// Update experiment
window.electron.database.experiments.update(id: string, data: ExperimentUpdateData)
// Returns: DatabaseResponse<Experiment>

// Delete experiment
window.electron.database.experiments.delete(id: string)
// Returns: DatabaseResponse
```

### Scans

```typescript
// List all scans (optionally filtered)
window.electron.database.scans.list(filters?: {
  experiment_id?: string
  phenotyper_id?: string
  plant_id?: string
})
// Returns: DatabaseResponse<ScanWithRelations[]>

// Get single scan by ID
window.electron.database.scans.get(id: string)
// Returns: DatabaseResponse<ScanWithRelations>

// Create new scan
window.electron.database.scans.create(data: ScanCreateData)
// Returns: DatabaseResponse<Scan>

// Get recent scans (today only, for CaptureScan page)
window.electron.database.scans.getRecent(options?: {
  limit?: number          // Default: 10
  experimentId?: string   // Optional filter by experiment
})
// Returns: DatabaseResponse<ScanWithRelations[]>
// Note: Returns scans from today, sorted by capture_date (most recent first)

// Check for a duplicate scan at the same plant/experiment/wave/age
window.electron.database.scans.checkDuplicate(plantId: string, experimentId: string, waveNumber: number, plantAgeDays: number)
// Returns: DatabaseResponse<boolean>
// Note: Used for duplicate scan prevention (excludes soft-deleted scans)
```

### CylinderScan waves

```typescript
// An experiment's waves with their dates, change log and scan counts
window.electron.database.cylinderWaves.list(experimentId: string)
// Returns: DatabaseResponse<CylinderWaveInfo[]>

// Set a wave's dates (the first time the wave is used on Capture Scan)
window.electron.database.cylinderWaves.create({ experimentId, waveNumber, germinationDate?, sowingDate?, transferDate?, datesPerPlant?, note?, phenotyperId })
// Returns: DatabaseResponse<CylinderWaveInfo>; refused with the reason when a rule isn't met.
// phenotyperId is required (and must exist) for create and changeDates, so the log always says who.

// Change a wave's dates from Capture Scan (reason required once the wave has scans);
// the change is logged and listed with the wave (CylinderWaveInfo.changes)
window.electron.database.cylinderWaves.changeDates({ waveId, germinationDate, sowingDate, transferDate?, reason?, phenotyperId })
// Returns: DatabaseResponse<CylinderWaveInfo>

// A wave's plants and their dates, most recently changed first
window.electron.database.cylinderPlants.list(waveId: string)
// Returns: DatabaseResponse<CylinderPlantInfo[]>

// Set a plant's own dates (reason required unless it's a per-plant wave's first entry)
window.electron.database.cylinderPlants.setDates({ waveId, plantBarcode, germinationDate, sowingDate, transferDate?, reason?, phenotyperId })
// Returns: DatabaseResponse<CylinderPlantInfo>

// Give a per-plant wave one set of dates for all its plants (before its first scan,
// or the dates all its plants already share)
window.electron.database.cylinderWaves.useSameDates({ waveId, germinationDate, sowingDate, transferDate?, reason?, phenotyperId })
// Returns: DatabaseResponse<null>

// Make a wave's dates per plant (plants on the wave's dates keep them as their own)
window.electron.database.cylinderWaves.useDatesPerPlant({ waveId, reason?, phenotyperId })
// Returns: DatabaseResponse<null>

// Put a plant back on its wave's dates (reason required once it has scans)
window.electron.database.cylinderPlants.useWaveDates({ waveId, plantBarcode, reason?, phenotyperId })
// Returns: DatabaseResponse<CylinderPlantInfo>
```

### Phenotypers

```typescript
// List all phenotypers
window.electron.database.phenotypers.list()
// Returns: DatabaseResponse<Phenotyper[]>

// Create new phenotyper
window.electron.database.phenotypers.create(data: {
  name: string
  email: string
})
// Returns: DatabaseResponse<Phenotyper>
```

### Scientists

```typescript
// List all scientists
window.electron.database.scientists.list()
// Returns: DatabaseResponse<Scientist[]>

// Create new scientist
window.electron.database.scientists.create(data: {
  name: string
  email: string
})
// Returns: DatabaseResponse<Scientist>
```

### Accessions

```typescript
// List all accessions
window.electron.database.accessions.list()
// Returns: DatabaseResponse<Accessions[]>

// Create new accession
window.electron.database.accessions.create(data: {
  name: string
})
// Returns: DatabaseResponse<Accessions>

// Get plant barcodes for an accession
window.electron.database.accessions.getPlantBarcodes(accessionId: string)
// Returns: DatabaseResponse<string[]>
// Note: Returns all plant_barcode values from PlantAccessionMappings

// Get accession name (genotype ID) for a barcode in an experiment
window.electron.database.accessions.getAccessionNameByBarcode(barcode: string, experimentId: string)
// Returns: DatabaseResponse<string | null>
// Note: Looks up via experiment → accession → PlantAccessionMappings
```

### Images

```typescript
// Bulk create images (for scan completion)
window.electron.database.images.create(data: Array<{
  scan_id: string
  frame_number: number
  path: string
  status?: string
}>)
// Returns: DatabaseResponse
```

## Testing the Database

### 1. Unit Tests

Run the database unit tests (20 tests covering all models):

```bash
npm run test:unit
```

Tests verify:

- ✅ Create, read, update, delete operations
- ✅ Foreign key relationships
- ✅ Unique constraints
- ✅ Default values
- ✅ Soft delete functionality

### 2. Prisma Studio (Visual Browser)

Open Prisma Studio to visually browse and edit data:

```bash
npm run prisma:studio
```

This opens http://localhost:5555 with a GUI for:

- Viewing all tables
- Creating/editing/deleting records
- Exploring relationships
- Running queries

### 3. DevTools Console Testing

When the app is running (`npm run dev`), you can test database operations via the browser DevTools console:

#### Example: Create and List Scientists

```javascript
// Open DevTools (View > Toggle Developer Tools)

// Create a scientist
await window.electron.database.scientists.create({
  name: 'Dr. Jane Smith',
  email: 'jane@example.com',
});

// List all scientists
await window.electron.database.scientists.list();
// Expected: { success: true, data: [{ id: '...', name: 'Dr. Jane Smith', ... }] }
```

#### Example: Create Experiment with Relations

```javascript
// Create scientist first
const scientist = await window.electron.database.scientists.create({
  name: 'Dr. John Doe',
  email: 'john@example.com',
});

// Create accession
const accession = await window.electron.database.accessions.create({
  name: 'ACC001',
});

// Create experiment with relations
const experiment = await window.electron.database.experiments.create({
  name: 'Growth Study 2025',
  species: 'Arabidopsis thaliana',
  scientist_id: scientist.data.id,
  accession_id: accession.data.id,
});

// List experiments with relations
await window.electron.database.experiments.list();
```

#### Example: Create Scan with Images

```javascript
// Create phenotyper
const phenotyper = await window.electron.database.phenotypers.create({
  name: 'Lab Tech 1',
  email: 'tech1@example.com',
});

// Create scan
const scan = await window.electron.database.scans.create({
  experiment_id: experiment.data.id,
  phenotyper_id: phenotyper.data.id,
  scanner_name: 'Scanner-01',
  plant_id: 'PLANT-001',
  path: '/scans/2025-01-15/scan001',
  num_frames: 36,
  exposure_time: 10000,
  gain: 0,
  brightness: 0.5,
  contrast: 1,
  gamma: 1,
  seconds_per_rot: 60,
  wave_number: 1,
  plant_age_days: 14,
});

// Create images for the scan
await window.electron.database.images.create([
  {
    scan_id: scan.data.id,
    frame_number: 1,
    path: '/scans/2025-01-15/scan001/frame001.tiff',
  },
  {
    scan_id: scan.data.id,
    frame_number: 2,
    path: '/scans/2025-01-15/scan001/frame002.tiff',
  },
  // ... more frames
]);

// List scans with images
await window.electron.database.scans.list();
```

#### Example: Filter Scans

```javascript
// Get all scans for a specific experiment
await window.electron.database.scans.list({
  experiment_id: experiment.data.id,
});

// Get all scans by a specific phenotyper
await window.electron.database.scans.list({
  phenotyper_id: phenotyper.data.id,
});

// Get all scans for a specific plant
await window.electron.database.scans.list({
  plant_id: 'PLANT-001',
});
```

## Troubleshooting

### Error: "Prisma Client could not locate the Query Engine"

**Cause**: Webpack isn't bundling Prisma's native query engine correctly.

**Solution**: The webpack configuration should include:

```typescript
// webpack.plugins.ts
new CopyWebpackPlugin({
  patterns: [{ from: './node_modules/.prisma/client' }],
})

// webpack.main.config.ts
externals: {
  '.prisma/client': 'commonjs .prisma/client',
  '@prisma/client': 'commonjs @prisma/client',
}
```

### Error: "table does not exist"

**Cause**: Migrations haven't been applied.

**Solution**:

```bash
npm run prisma:migrate
```

### Error: "Foreign key constraint failed"

**Cause**: Trying to create a record that references a non-existent parent.

**Solution**: Ensure parent records exist before creating children:

1. Create Scientists, Phenotypers, Accessions first
2. Then create Experiments (referencing Scientists/Accessions)
3. Then create Scans (referencing Experiments/Phenotypers)
4. Finally create Images (referencing Scans)

### Error: "Unique constraint failed"

**Cause**: Trying to create a record with a duplicate unique field (e.g., email).

**Solution**: Check existing records or use a different value:

```javascript
// List existing scientists to check emails
await window.electron.database.scientists.list();
```

### Database is locked

**Cause**: Multiple processes trying to access SQLite database simultaneously.

**Solution**:

1. Close any open Prisma Studio instances
2. Stop running dev servers
3. Check for orphaned processes: `ps aux | grep prisma`

## Production Packaging

Prisma requires special configuration for Electron packaging. The query engine binaries cannot be bundled inside the app.asar archive because:

1. Binary engines cannot execute from read-only archives
2. Node.js `require()` cannot resolve dynamic paths in ASAR
3. Prisma's internal path resolution breaks when bundled

**Solution**: The app uses dynamic module loading to load Prisma from different locations in development vs production:

- **Development**: Loads from `node_modules/.prisma/client/`
- **Production**: Loads from `process.resourcesPath/.prisma/client/` (outside ASAR)

The packaging configuration in `forge.config.ts` uses `extraResource` to copy Prisma files to the `Resources/` directory where they can be accessed at runtime.

**See [PACKAGING.md](PACKAGING.md)** for complete packaging documentation including:

- Detailed explanation of the ASAR/Prisma conflict
- Dynamic module loading implementation
- Webpack and Forge configuration
- Path resolution and fallbacks
- Troubleshooting packaged apps
- Platform-specific considerations

## Migration from Pilot

The schema is 100% compatible with the pilot. To migrate data:

1. Export data from pilot database (Prisma Studio or SQL)
2. Import into new database using same structure
3. No schema changes required

**Additions in this version** (backward compatible):

- `@default(now())` on `Scan.capture_date` and `Accessions.createdAt`
- Indexes on frequently queried columns
- Type-safe IPC handlers

## Performance Considerations

### Indexes

The following indexes are automatically created for common queries:

- `Scan.experiment_id` - For filtering scans by experiment
- `Scan.phenotyper_id` - For filtering scans by phenotyper
- `Scan.plant_id` - For filtering scans by plant
- `Scan.capture_date` - For sorting scans chronologically
- `Image.scan_id` - For fetching images for a scan

### Query Optimization

```javascript
// ❌ Bad: Fetches all scans then filters in JavaScript
const allScans = await window.electron.database.scans.list();
const filtered = allScans.data.filter((s) => s.experiment_id === expId);

// ✅ Good: Filters in database
const scans = await window.electron.database.scans.list({
  experiment_id: expId,
});
```

## Scanner-Database Integration

The scanner automatically persists scan metadata and captured images to the database when metadata is provided during initialization.

### How It Works

1. **Initialize scanner with metadata** - Pass `metadata` object in scanner settings
2. **Perform scan** - Scanner captures frames and collects progress events
3. **Automatic save** - On completion, scanner saves to database using atomic nested create
4. **Get scan ID** - Scan result includes `scan_id` for database reference

### Metadata Interface

```typescript
interface ScanMetadata {
  experiment_id: string; // Required: Experiment this scan belongs to
  phenotyper_id: string; // Required: Person performing the scan
  scanner_name: string; // Required: Scanner hardware identifier
  plant_id: string; // Required: Plant identifier (barcode, QR, etc.)
  accession_id?: string; // Optional: Accession if known
  plant_age_days: number; // Required: Plant age in days
  wave_number: number; // Required: Time point (1-4 typically)
}
```

### Example Usage

```typescript
// Initialize scanner with metadata for automatic database persistence
await window.electron.scanner.initialize({
  camera: cameraSettings,
  daq: daqSettings,
  num_frames: 72,
  output_path: './scans/2025-01-15',
  metadata: {
    experiment_id: experimentId,
    phenotyper_id: phenotyperId,
    scanner_name: 'Scanner-01',
    plant_id: 'PLANT-001',
    plant_age_days: 14,
    wave_number: 1,
  },
});

// Perform scan - automatically saves to database on completion
const result = await window.electron.scanner.scan();

if (result.success && result.scan_id) {
  console.log('Scan saved to database:', result.scan_id);

  // Retrieve scan with images from database
  const scan = await window.electron.database.scans.get(result.scan_id);
  console.log(`Scan has ${scan.data.images.length} images`);
}
```

### Scan without Database

If you don't provide metadata, the scan will work normally but won't be saved to the database:

```typescript
// Initialize without metadata
await window.electron.scanner.initialize({
  camera: cameraSettings,
  daq: daqSettings,
  num_frames: 72,
  output_path: './scans/test',
  // No metadata field - won't save to database
});

const result = await window.electron.scanner.scan();
// result.scan_id will be undefined
```

### Implementation Details

**Atomic Nested Create Pattern** (from pilot):

The scanner uses Prisma's nested create pattern to atomically create the scan and all images in a single database transaction:

```typescript
await prisma.scan.create({
  data: {
    // Scan metadata and parameters...
    images: {
      create: [
        { frame_number: 1, path: '/path/frame000.tiff', status: 'CAPTURED' },
        { frame_number: 2, path: '/path/frame001.tiff', status: 'CAPTURED' },
        // ... more images (frame_number is 1-indexed, pilot compatible)
      ],
    },
  },
});
```

**Benefits:**

- ✅ Atomic transaction (all-or-nothing)
- ✅ No orphaned images if scan save fails
- ✅ Pilot-compatible approach
- ✅ Automatic foreign key handling

**Frame Number Indexing:**

- Scanner progress events use **0-indexed** frame numbers internally (0-71 for 72 frames)
- Database stores frame numbers as **1-indexed** (1-72 for 72 frames) - **pilot compatible**
- Automatic conversion: `frame_number + 1` when saving to database
- This maintains backwards compatibility with pilot database

### Testing Scanner-Database Integration

Run the integration test:

```bash
npm run test:scanner-database
```

**Test Coverage:**

- ✅ Initialize database with test records
- ✅ Perform scan with metadata
- ✅ Verify scan saved to database
- ✅ Verify nested create (atomic transaction)
- ✅ Verify 1-indexed frame_numbers (pilot compatible)
- ✅ Verify CAPTURED status on all images
- ✅ Verify scan without metadata doesn't save

### Prerequisites for Database Persistence

Before scanning with database persistence:

1. **Create Scientist** - The person responsible for the experiment
2. **Create Phenotyper** - The person performing the scan
3. **Create Experiment** - Links scientist, species, and accession

```typescript
// 1. Create scientist
const scientist = await window.electron.database.scientists.create({
  name: 'Dr. Jane Smith',
  email: 'jane@example.com',
});

// 2. Create phenotyper
const phenotyper = await window.electron.database.phenotypers.create({
  name: 'Lab Tech 1',
  email: 'tech1@example.com',
});

// 3. Create experiment
const experiment = await window.electron.database.experiments.create({
  name: 'Growth Study 2025',
  species: 'Arabidopsis thaliana',
  scientist_id: scientist.data.id,
});

// 4. Now you can scan with these IDs
await window.electron.scanner.initialize({
  camera: cameraSettings,
  daq: daqSettings,
  metadata: {
    experiment_id: experiment.data.id,
    phenotyper_id: phenotyper.data.id,
    scanner_name: 'Scanner-01',
    plant_id: 'PLANT-001',
    plant_age_days: 14,
    wave_number: 1,
  },
});
```

## Future Enhancements

See [Issue #53](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/53) for additional planned enhancements:

- Image processing status tracking
- Data export functionality
- Backup and restore procedures

## Related Documentation

- [Prisma Documentation](https://www.prisma.io/docs/)
- [SQLite Documentation](https://www.sqlite.org/docs.html)
- [Bloom Desktop Pilot Schema](https://github.com/eberrigan/bloom-desktop-pilot/blob/dev/app/prisma/schema.prisma)
