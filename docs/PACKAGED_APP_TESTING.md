# Packaged App Testing Guide

This guide explains how to test the packaged Electron app locally, including database integration testing.

## Table of Contents

- [Quick Start](#quick-start)
- [Building the Packaged App](#building-the-packaged-app)
- [Database Setup](#database-setup)
- [Running the Packaged App](#running-the-packaged-app)
- [Testing Database Integration](#testing-database-integration)
- [Troubleshooting](#troubleshooting)

## Quick Start

```bash
# 1. Build the package
npm run package

# 2. Set up the production database
npm run seed:production

# 3. Run the packaged app
open "out/Bloom Desktop-darwin-arm64/Bloom Desktop.app"  # macOS
# or
"out/Bloom Desktop-win32-x64/Bloom Desktop.exe"          # Windows
# or
"out/Bloom Desktop-linux-x64/bloom-desktop"              # Linux

# 4. Open Prisma Studio to view database
npm run studio:production
```

## Building the Packaged App

The packaged app is the production-ready version that users will install.

```bash
# Build Python executable + Package Electron app
npm run package
```

This creates the packaged app in the `out/` directory:
- **macOS**: `out/Bloom Desktop-darwin-arm64/Bloom Desktop.app`
- **Windows**: `out/Bloom Desktop-win32-x64/Bloom Desktop.exe`
- **Linux**: `out/Bloom Desktop-linux-x64/bloom-desktop`

**Build time**: ~1-2 minutes (includes Python executable compilation)

## Database Setup

The packaged app uses a **production database** at `~/.bloom/data/bloom.db` (different from the dev database at `prisma/dev.db`).

### First-Time Setup

1. **Apply the database schema:**

```bash
BLOOM_DATABASE_URL="file:$HOME/.bloom/data/bloom.db" npx prisma db push --skip-generate
```

2. **Seed with test data:**

```bash
npm run seed:production
```

This creates:
- ✅ Scientist: Elizabeth Berrigan
- ✅ Phenotyper: elizabeth
- ✅ Accession: Col-0
- ✅ Experiment: (with a UUID)

### Manual Database Seeding (Alternative)

If the seed script doesn't exist, you can manually seed:

```bash
BLOOM_DATABASE_URL="file:$HOME/.bloom/data/bloom.db" npx tsx -e "
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function seed() {
  const scientist = await prisma.scientist.create({
    data: { name: 'Test Scientist', email: 'scientist@test.com' }
  });

  const phenotyper = await prisma.phenotyper.create({
    data: { name: 'test-phenotyper', email: 'phenotyper@test.com' }
  });

  const accession = await prisma.accessions.create({
    data: { name: 'Test-Accession-001' }
  });

  const experiment = await prisma.experiment.create({
    data: {
      name: 'Test Experiment',
      species: 'Arabidopsis thaliana',
      scientist_id: scientist.id,
    }
  });

  console.log('✅ Database seeded!');
  console.log('Experiment ID:', experiment.id);
  console.log('Phenotyper ID:', phenotyper.id);
  console.log('Accession ID:', accession.id);
}

seed().then(() => prisma.\$disconnect());
"
```

### Viewing the Production Database

Open Prisma Studio connected to the production database:

```bash
# Option 1: Using npm script (if it exists)
npm run studio:production

# Option 2: Using environment variable
BLOOM_DATABASE_URL="file:$HOME/.bloom/data/bloom.db" npx prisma studio
```

This opens at http://localhost:5555

**Important**: Make sure no other Prisma Studio instances are running on port 5555.

## Running the Packaged App

### macOS

```bash
# Method 1: Double-click the app
open "out/Bloom Desktop-darwin-arm64/Bloom Desktop.app"

# Method 2: Run from terminal (to see logs)
"out/Bloom Desktop-darwin-arm64/Bloom Desktop.app/Contents/MacOS/Bloom Desktop"
```

### Windows

```bash
# Double-click or run from terminal
"out/Bloom Desktop-win32-x64/Bloom Desktop.exe"
```

### Linux

```bash
"out/Bloom Desktop-linux-x64/bloom-desktop"
```

### Expected Startup Logs

When the packaged app starts, you should see:

```
[Database] Production mode - resourcesPath: /path/to/Resources
[Database] Found Prisma at: /path/to/Resources/.prisma/client/index.js
[Database] Created symlink: .../node_modules/@prisma/client -> .../client
[Database] Production mode - using: /Users/you/.bloom/data/bloom.db
[Database] Initialized at: /Users/you/.bloom/data/bloom.db
[Main] Database initialized and handlers registered
```

## Testing Database Integration

### Step 1: Get Database Record IDs

Open Prisma Studio to find the UUIDs:

```bash
BLOOM_DATABASE_URL="file:$HOME/.bloom/data/bloom.db" npx prisma studio
```

Navigate to each table and copy the `id` values:
- **Experiment** → Copy the UUID (e.g., `38555968-6bd2-45de-9dad-383ab6d69179`)
- **Phenotyper** → Copy the UUID (e.g., `ddcfece0-f6ac-4c0e-a32e-8c31145785dd`)
- **Accession** → Copy the UUID (optional)

**Why UUIDs?** The database uses UUID primary keys, not human-readable IDs. Future versions will add dropdowns to make this easier.

### Step 2: Run a Scan

1. Launch the packaged app
2. Navigate to "Capture Scan"
3. Fill in the form with the UUIDs from Prisma Studio:
   - **Experiment ID**: `<paste UUID from Experiment table>`
   - **Phenotyper ID**: `<paste UUID from Phenotyper table>`
   - **Scanner Name**: Any value (e.g., `Scanner-01`)
   - **Plant ID**: Any value (e.g., `PLANT-001`)
   - **Accession ID**: `<paste UUID from Accession table>` (optional)
   - **Plant Age (days)**: Any number (e.g., `14`)
   - **Wave Number**: Any number (e.g., `1`)

4. Click "Start Scan"

### Step 3: Verify in Database

Refresh Prisma Studio and check the **Scan** table. You should see:
- ✅ New scan record with your metadata
- ✅ Linked to the Experiment and Phenotyper

**Note about Images:** In mock mode (without real hardware), the scanner may not create actual image files, so the `Image` table might be empty. This is expected. Real hardware scans will create images that get saved to the database.

### Step 4: Check Scan Files

The scan files are stored at:

```bash
ls -la ./scans/<experiment-id>/<plant-id>_<timestamp>/
```

## Troubleshooting

### Database Not Initializing

**Symptom:** App starts but no database logs appear

**Solution:**
1. Check that schema is applied: `BLOOM_DATABASE_URL="file:$HOME/.bloom/data/bloom.db" npx prisma db push`
2. Verify database file exists: `ls -la ~/.bloom/data/bloom.db`
3. Run with logs: `"out/.../Bloom Desktop" 2>&1 | grep Database`

### Foreign Key Constraint Error

**Symptom:** Error when saving scan: `Foreign key constraint violated`

**Cause:** The Experiment ID or Phenotyper ID doesn't exist in the database

**Solution:**
1. Open Prisma Studio: `BLOOM_DATABASE_URL="file:$HOME/.bloom/data/bloom.db" npx prisma studio`
2. Verify the Experiment and Phenotyper exist
3. Copy the exact UUID `id` values (not human-readable names)
4. Use those UUIDs in the Capture Scan form

### No Images Saved

**Symptom:** Scan is saved but Image table is empty

**Cause:** Mock scanner doesn't create actual image files when `num_frames = 0`

**Expected Behavior:** This is normal for mock mode. Real hardware scans will create `.png`/`.jpg`/`.tiff` files that get saved to the database.

**To Verify it Works:** Check the logs for:
```
[Scanner] Saving scan to database: { ..., frames: 0, ... }
[Scanner] Successfully saved scan to database: { scan_id: '...', image_count: 0 }
```

### Prisma Studio Shows Empty Database

**Cause:** You're viewing the dev database (`prisma/dev.db`) instead of the production database

**Solution:** Always specify the production database URL:
```bash
BLOOM_DATABASE_URL="file:$HOME/.bloom/data/bloom.db" npx prisma studio
```

### Packaged App Not Found

**Symptom:** `out/` directory doesn't exist or is empty

**Solution:** Run the packaging command:
```bash
npm run package
```

Wait 1-2 minutes for it to complete.

### Old Package (Changes Not Reflected)

**Symptom:** Code changes don't appear in the packaged app

**Solution:** Rebuild the package after every code change:
```bash
npm run package
```

The packaged app is a snapshot. Unlike `npm run dev`, it doesn't auto-reload.

## CI/CD Testing

The GitHub Actions CI automatically tests the packaged app using:

```bash
npm run test:package:database
```

This script:
1. Launches the packaged app
2. Waits for the database initialization log message
3. Verifies the app started successfully
4. Exits with success/failure

**Test script location:** `scripts/test-package-database.sh`

## Resetting the Production Database

To start fresh:

```bash
# Remove the database
rm -rf ~/.bloom/data/bloom.db

# Re-apply schema
BLOOM_DATABASE_URL="file:$HOME/.bloom/data/bloom.db" npx prisma db push --skip-generate

# Re-seed
npm run seed:production
```

## Related Documentation

- [DATABASE.md](./DATABASE.md) - Database schema and architecture
- [PACKAGING.md](./PACKAGING.md) - How Prisma packaging works
- [SCANNER_DATABASE_INTEGRATION_PLAN.md](./SCANNER_DATABASE_INTEGRATION_PLAN.md) - Integration design
