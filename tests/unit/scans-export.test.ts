// @vitest-environment node
/**
 * Tests for `scansExport()` in `src/main/database-handlers.ts` (the
 * `db:scans:export` handler's underlying logic).
 *
 * Uses a real SQLite database via Prisma (not a mocked Prisma client),
 * matching the convention established in `tests/integration/database.test.ts`
 * and `tests/unit/graviscan/database-handlers.test.ts`. Requires a migrated
 * `prisma/dev.db` to exist (this file copies it to a private temp file
 * rather than connecting to it directly — see below) — see this repo's CI
 * config, or locally:
 *   BLOOM_DATABASE_URL="file:./dev.db" npx prisma generate
 *   BLOOM_DATABASE_URL="file:./dev.db" npx prisma migrate deploy
 *
 * The filesystem side (scan source folders, destination directory) uses
 * real temp directories via `fs.mkdtempSync`, not a mocked `fs` module, so
 * these tests exercise the actual `.tmp`-then-rename and containment-check
 * logic end to end.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { scansExport } from '../../src/main/database-handlers';

// `tests/unit/graviscan/database-handlers.test.ts` also runs real-SQLite
// tests against the migrated `prisma/dev.db`. Vitest runs test FILES in
// parallel workers by default, and this file's destructive
// `cleanDatabase()` would otherwise race that file's fixtures on the same
// SQLite file (observed as spurious foreign-key-constraint errors). Copying
// the already-migrated db to a private temp file and pointing this file's
// own `PrismaClient` at it avoids that cross-file contention entirely,
// without touching global test config or the other file.
const sourceDbPath = path.join(__dirname, '..', '..', 'prisma', 'dev.db');
const privateDbPath =
  fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-scans-export-db-')) +
  path.sep +
  'dev.db';
fs.copyFileSync(sourceDbPath, privateDbPath);

const prisma = new PrismaClient({
  datasources: { db: { url: `file:${privateDbPath}` } },
});

async function cleanDatabase() {
  await prisma.image.deleteMany();
  await prisma.scan.deleteMany();
  await prisma.plantAccessionMappings.deleteMany();
  await prisma.experiment.deleteMany();
  await prisma.accessions.deleteMany();
  await prisma.phenotyper.deleteMany();
  await prisma.scientist.deleteMany();
}

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
  fs.rmSync(path.dirname(privateDbPath), { recursive: true, force: true });
});

beforeEach(async () => {
  await cleanDatabase();
});

let scansDir: string;
let destinationDir: string;

beforeEach(() => {
  scansDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-export-scans-'));
  destinationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-export-dest-'));
});

afterAll(() => {
  // Best-effort cleanup of any leftover temp dirs from this run.
});

async function createPhenotyper() {
  return prisma.phenotyper.create({
    data: {
      name: 'Test Phenotyper',
      email: `phenotyper-${Date.now()}@salk.edu`,
    },
  });
}

async function createExperiment(name = 'Test Experiment') {
  return prisma.experiment.create({
    data: { name, species: 'Amaranthus', experiment_type: 'cylinderscan' },
  });
}

/** Creates a real scan folder on disk under `scansDir`, plus a matching `Scan` row. */
async function createScanFixture(opts: {
  experimentId: string;
  phenotyperId: string;
  relativePath: string;
  files: Record<string, string>;
  captureDate?: Date;
  deleted?: boolean;
}) {
  const absDir = path.join(scansDir, opts.relativePath);
  fs.mkdirSync(absDir, { recursive: true });
  for (const [filename, content] of Object.entries(opts.files)) {
    fs.writeFileSync(path.join(absDir, filename), content);
  }

  return prisma.scan.create({
    data: {
      experiment_id: opts.experimentId,
      phenotyper_id: opts.phenotyperId,
      scanner_name: 'Station-A',
      plant_id: 'PLANT-001',
      accession_name: 'Col-0',
      path: opts.relativePath,
      capture_date: opts.captureDate ?? new Date(),
      num_frames: 2,
      exposure_time: 10000,
      gain: 5.0,
      brightness: 0.5,
      contrast: 1.0,
      gamma: 1.0,
      seconds_per_rot: 36.0,
      wave_number: 1,
      plant_age_days: 14,
      deleted: opts.deleted ?? false,
    },
  });
}

describe('scansExport', () => {
  it('happy path: copies every file to <destinationDir>/<scan.path>/<filename>', async () => {
    const experiment = await createExperiment();
    const phenotyper = await createPhenotyper();
    const scan = await createScanFixture({
      experimentId: experiment.id,
      phenotyperId: phenotyper.id,
      relativePath: '2026-01-05/PLANT-001/scan-1',
      files: {
        'metadata.json': '{"frames":2}',
        '001.png': 'frame1',
        '002.png': 'frame2',
      },
    });

    const result = await scansExport(prisma, scansDir, {
      scanIds: [scan.id],
      destinationDir,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      exportedFiles: 3,
      exportedScans: 1,
      skippedFiles: 0,
      failedScans: [],
    });

    const destDir = path.join(destinationDir, '2026-01-05/PLANT-001/scan-1');
    expect(fs.readFileSync(path.join(destDir, 'metadata.json'), 'utf-8')).toBe(
      '{"frames":2}'
    );
    expect(fs.readFileSync(path.join(destDir, '001.png'), 'utf-8')).toBe(
      'frame1'
    );
    expect(fs.readFileSync(path.join(destDir, '002.png'), 'utf-8')).toBe(
      'frame2'
    );
  });

  it('skip-on-conflict: leaves an existing destination file untouched and counts it as skipped', async () => {
    const experiment = await createExperiment();
    const phenotyper = await createPhenotyper();
    const scan = await createScanFixture({
      experimentId: experiment.id,
      phenotyperId: phenotyper.id,
      relativePath: '2026-01-05/PLANT-001/scan-1',
      files: { 'metadata.json': '{"frames":1}', '001.png': 'frame1' },
    });

    const destDir = path.join(destinationDir, '2026-01-05/PLANT-001/scan-1');
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, '001.png'), 'PRE-EXISTING CONTENT');

    const result = await scansExport(prisma, scansDir, {
      scanIds: [scan.id],
      destinationDir,
    });

    expect(result.success).toBe(true);
    expect(result.data!.exportedFiles).toBe(1); // metadata.json only
    expect(result.data!.skippedFiles).toBe(1); // 001.png
    expect(result.data!.exportedScans).toBe(1);
    expect(fs.readFileSync(path.join(destDir, '001.png'), 'utf-8')).toBe(
      'PRE-EXISTING CONTENT'
    );
  });

  it('re-running against a destination where the scan is already fully present succeeds and counts everything as skipped', async () => {
    const experiment = await createExperiment();
    const phenotyper = await createPhenotyper();
    const scan = await createScanFixture({
      experimentId: experiment.id,
      phenotyperId: phenotyper.id,
      relativePath: '2026-01-05/PLANT-001/scan-1',
      files: { 'metadata.json': '{"frames":1}', '001.png': 'frame1' },
    });

    const first = await scansExport(prisma, scansDir, {
      scanIds: [scan.id],
      destinationDir,
    });
    expect(first.data!.exportedFiles).toBe(2);

    const second = await scansExport(prisma, scansDir, {
      scanIds: [scan.id],
      destinationDir,
    });

    expect(second.success).toBe(true);
    expect(second.data!.exportedFiles).toBe(0);
    expect(second.data!.skippedFiles).toBe(2);
    expect(second.data!.exportedScans).toBe(1);
    expect(second.data!.failedScans).toEqual([]);
  });

  it('path containment: rejects a scan whose path escapes scansDir, without writing any file, and continues the batch', async () => {
    const experiment = await createExperiment();
    const phenotyper = await createPhenotyper();
    const maliciousScan = await createScanFixture({
      experimentId: experiment.id,
      phenotyperId: phenotyper.id,
      relativePath: '2026-01-05/PLANT-001/scan-evil',
      files: { 'metadata.json': '{}' },
    });
    // Simulate a corrupted/malicious DB row after the fixture was created on disk.
    await prisma.scan.update({
      where: { id: maliciousScan.id },
      data: { path: '../../etc/passwd' },
    });

    const goodScan = await createScanFixture({
      experimentId: experiment.id,
      phenotyperId: phenotyper.id,
      relativePath: '2026-01-05/PLANT-001/scan-good',
      files: { 'metadata.json': '{}' },
    });

    const result = await scansExport(prisma, scansDir, {
      scanIds: [maliciousScan.id, goodScan.id],
      destinationDir,
    });

    expect(result.success).toBe(true);
    expect(result.data!.failedScans).toHaveLength(1);
    expect(result.data!.failedScans[0].scanId).toBe(maliciousScan.id);
    expect(result.data!.failedScans[0].experimentName).toBe(experiment.name);
    expect(result.data!.failedScans[0].reason).toMatch(/escapes/i);
    expect(result.data!.exportedScans).toBe(1); // goodScan still succeeded
    expect(
      fs.existsSync(path.join(destinationDir, '..', 'etc', 'passwd'))
    ).toBe(false);
  });

  it('path containment: rejects a scan whose path would escape the destination directory', async () => {
    const experiment = await createExperiment();
    const phenotyper = await createPhenotyper();
    const scan = await createScanFixture({
      experimentId: experiment.id,
      phenotyperId: phenotyper.id,
      relativePath: '2026-01-05/PLANT-001/scan-1',
      files: { 'metadata.json': '{}' },
    });
    await prisma.scan.update({
      where: { id: scan.id },
      data: { path: '../outside' },
    });

    const result = await scansExport(prisma, scansDir, {
      scanIds: [scan.id],
      destinationDir,
    });

    expect(result.success).toBe(true);
    expect(result.data!.failedScans).toHaveLength(1);
    expect(result.data!.failedScans[0].reason).toMatch(/escapes/i);
  });

  it('file-level atomicity: a file that fails mid-copy never appears truncated, and a stale .tmp is cleaned up on the next attempt', async () => {
    const experiment = await createExperiment();
    const phenotyper = await createPhenotyper();
    const scan = await createScanFixture({
      experimentId: experiment.id,
      phenotyperId: phenotyper.id,
      relativePath: '2026-01-05/PLANT-001/scan-1',
      files: { 'metadata.json': '{}', '001.png': 'frame1' },
    });

    const destDir = path.join(destinationDir, '2026-01-05/PLANT-001/scan-1');
    fs.mkdirSync(destDir, { recursive: true });
    // Simulate a stray .tmp left behind by a previous crashed attempt.
    fs.writeFileSync(path.join(destDir, '001.png.tmp'), 'PARTIAL GARBAGE');

    const result = await scansExport(prisma, scansDir, {
      scanIds: [scan.id],
      destinationDir,
    });

    expect(result.success).toBe(true);
    expect(result.data!.failedScans).toEqual([]);
    expect(fs.existsSync(path.join(destDir, '001.png.tmp'))).toBe(false);
    expect(fs.readFileSync(path.join(destDir, '001.png'), 'utf-8')).toBe(
      'frame1'
    );
  });

  it('metadata-first ordering: metadata.json is copied even when a frame file fails, proving metadata is not gated behind frame success', async () => {
    const experiment = await createExperiment();
    const phenotyper = await createPhenotyper();
    const scan = await createScanFixture({
      experimentId: experiment.id,
      phenotyperId: phenotyper.id,
      relativePath: '2026-01-05/PLANT-001/scan-1',
      // Deliberately named so plain alphabetical readdir order would visit
      // frames before metadata.json — proves the explicit reordering (not
      // incidental readdir order) is what puts metadata first.
      files: {
        '001.png': 'frame1',
        '002.png': 'frame2',
        'metadata.json': '{}',
      },
    });

    // Make the frame files fail to copy (EISDIR is a reliable, cross-platform
    // way to force fs.copyFileSync to throw) without touching metadata.json.
    const sourceDir = path.join(scansDir, '2026-01-05/PLANT-001/scan-1');
    fs.rmSync(path.join(sourceDir, '001.png'));
    fs.mkdirSync(path.join(sourceDir, '001.png'));
    fs.rmSync(path.join(sourceDir, '002.png'));
    fs.mkdirSync(path.join(sourceDir, '002.png'));

    const result = await scansExport(prisma, scansDir, {
      scanIds: [scan.id],
      destinationDir,
    });

    expect(result.success).toBe(true);
    // The scan as a whole is marked failed (both frames failed), but
    // metadata.json still made it to the destination — proving its copy
    // was attempted (and completed) independently of, and before, the
    // frames that failed.
    expect(result.data!.failedScans).toHaveLength(1);
    expect(result.data!.failedScans[0].scanId).toBe(scan.id);
    expect(result.data!.exportedFiles).toBe(1);

    const destDir = path.join(destinationDir, '2026-01-05/PLANT-001/scan-1');
    expect(fs.readFileSync(path.join(destDir, 'metadata.json'), 'utf-8')).toBe(
      '{}'
    );
    expect(fs.existsSync(path.join(destDir, '001.png'))).toBe(false);
    expect(fs.existsSync(path.join(destDir, '002.png'))).toBe(false);
  });

  it('mixed batch: exported/skipped/failed scans are all accounted for, and one failure does not abort the batch', async () => {
    const experiment = await createExperiment();
    const phenotyper = await createPhenotyper();

    const exportedScan = await createScanFixture({
      experimentId: experiment.id,
      phenotyperId: phenotyper.id,
      relativePath: '2026-01-05/PLANT-001/scan-a',
      files: { 'metadata.json': '{}' },
    });

    const skippedFileScan = await createScanFixture({
      experimentId: experiment.id,
      phenotyperId: phenotyper.id,
      relativePath: '2026-01-05/PLANT-001/scan-b',
      files: { 'metadata.json': '{}' },
    });
    const skippedDestDir = path.join(
      destinationDir,
      '2026-01-05/PLANT-001/scan-b'
    );
    fs.mkdirSync(skippedDestDir, { recursive: true });
    fs.writeFileSync(path.join(skippedDestDir, 'metadata.json'), '{}');

    const failedScan = await createScanFixture({
      experimentId: experiment.id,
      phenotyperId: phenotyper.id,
      relativePath: '2026-01-05/PLANT-001/scan-c',
      files: { 'metadata.json': '{}' },
    });
    await prisma.scan.update({
      where: { id: failedScan.id },
      data: { path: '../escape' },
    });

    const result = await scansExport(prisma, scansDir, {
      scanIds: [exportedScan.id, skippedFileScan.id, failedScan.id],
      destinationDir,
    });

    expect(result.success).toBe(true);
    expect(result.data!.exportedScans).toBe(2);
    expect(result.data!.exportedFiles).toBe(1);
    expect(result.data!.skippedFiles).toBe(1);
    expect(result.data!.failedScans).toHaveLength(1);
    expect(result.data!.failedScans[0].scanId).toBe(failedScan.id);
  });

  it('fatal path: an unwritable destination directory returns a batch-wide failure', async () => {
    const experiment = await createExperiment();
    const phenotyper = await createPhenotyper();
    const scan = await createScanFixture({
      experimentId: experiment.id,
      phenotyperId: phenotyper.id,
      relativePath: '2026-01-05/PLANT-001/scan-1',
      files: { 'metadata.json': '{}' },
    });

    // A file (not a directory) as the "destination" can never be mkdir'd into.
    const notADirectory = path.join(destinationDir, 'actually-a-file');
    fs.writeFileSync(notADirectory, 'x');

    const result = await scansExport(prisma, scansDir, {
      scanIds: [scan.id],
      destinationDir: notADirectory,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('excludes soft-deleted scans from the export query (regression: does not inherit the sibling db:scans:list legacy-branch bug)', async () => {
    const experiment = await createExperiment();
    const phenotyper = await createPhenotyper();
    const deletedScan = await createScanFixture({
      experimentId: experiment.id,
      phenotyperId: phenotyper.id,
      relativePath: '2026-01-05/PLANT-001/scan-deleted',
      files: { 'metadata.json': '{}' },
      deleted: true,
    });

    const result = await scansExport(prisma, scansDir, {
      scanIds: [deletedScan.id],
      destinationDir,
    });

    expect(result.success).toBe(true);
    expect(result.data!.exportedScans).toBe(0);
    expect(result.data!.exportedFiles).toBe(0);
    expect(result.data!.failedScans).toEqual([]);
    expect(
      fs.existsSync(
        path.join(destinationDir, '2026-01-05/PLANT-001/scan-deleted')
      )
    ).toBe(false);
  });

  it('progress reporting: fires once per file outcome with correct running totals', async () => {
    const experiment = await createExperiment();
    const phenotyper = await createPhenotyper();
    const scan = await createScanFixture({
      experimentId: experiment.id,
      phenotyperId: phenotyper.id,
      relativePath: '2026-01-05/PLANT-001/scan-1',
      files: {
        'metadata.json': '{}',
        '001.png': 'frame1',
        '002.png': 'frame2',
      },
    });

    const updates: Array<{
      totalFiles: number;
      completedFiles: number;
      currentScanId: string;
    }> = [];

    const result = await scansExport(
      prisma,
      scansDir,
      { scanIds: [scan.id], destinationDir },
      (progress) => updates.push(progress)
    );

    expect(result.success).toBe(true);
    expect(updates).toHaveLength(3);
    expect(updates.every((u) => u.totalFiles === 3)).toBe(true);
    expect(updates.map((u) => u.completedFiles)).toEqual([1, 2, 3]);
    expect(updates.every((u) => u.currentScanId === scan.id)).toBe(true);
  });
});
