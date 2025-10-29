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

- **Path**: `./prisma/dev.db`
- **Created by**: `prisma migrate dev`
- **Used when**: `NODE_ENV=development`

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
  accession_id      String
  plant_barcode     String
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
  accession_id    String?
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
  plant_age_days  Int
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

## Prisma Commands

### Development Workflow

```bash
# Generate Prisma Client (run after schema changes)
npm run prisma:generate

# Create and apply migrations
npm run prisma:migrate

# Seed database with test data
npm run prisma:seed

# Open Prisma Studio (visual database browser)
npm run prisma:studio
```

### Advanced Commands

```bash
# Create migration without applying
npx prisma migrate dev --create-only

# Apply migrations in production
npx prisma migrate deploy

# Reset database (WARNING: deletes all data)
npx prisma migrate reset

# View migration status
npx prisma migrate status

# Format schema file
npx prisma format
```

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

## Future Enhancements

See [Issue #53](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/53) for planned database integrations:

- Scanner-Database Integration
- Automatic scan record creation during capture
- Image processing status tracking
- Data export functionality
- Backup and restore procedures

## Related Documentation

- [Prisma Documentation](https://www.prisma.io/docs/)
- [SQLite Documentation](https://www.sqlite.org/docs.html)
- [Bloom Desktop Pilot Schema](https://github.com/eberrigan/bloom-desktop-pilot/blob/dev/app/prisma/schema.prisma)
