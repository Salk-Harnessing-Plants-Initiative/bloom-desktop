// @vitest-environment node
/**
 * Tests for the new GraviScan `database.*` IPC handler groups added to
 * `src/main/database-handlers.ts`:
 *   - graviscans.*
 *   - graviscanSessions.*
 *   - graviscanPlateAssignments.*
 *   - graviPlateAccessions.*
 *
 * Per tasks.md Section 1 ("Shared test scaffolding"): these tests use a
 * real SQLite database via Prisma (not a mocked Prisma client), matching
 * the convention established in `tests/integration/database.test.ts`.
 * `BLOOM_DATABASE_URL` must point at a migrated test database — CI sets
 * this to `file:./dev.db` before `npm run test:unit` (see
 * `.github/workflows/*.yml`); locally, run:
 *   BLOOM_DATABASE_URL="file:./dev.db" npx prisma generate
 *   BLOOM_DATABASE_URL="file:./dev.db" npx prisma migrate deploy
 * first.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  graviscansCreate,
  graviscansGetMaxWaveNumber,
  graviscansCheckBarcodeUniqueInWave,
  graviscansUpdateGridTimestamps,
  graviscansBrowseByExperiment,
  graviscansExperimentDetail,
  graviscanSessionsCreate,
  graviscanSessionsComplete,
  graviscanPlateAssignmentsList,
  graviscanPlateAssignmentsUpsertMany,
  graviPlateAccessionsCreateWithSections,
  graviPlateAccessionsList,
  graviPlateAccessionsListFiles,
  graviPlateAccessionsDelete,
} from '../../../src/main/database-handlers';

const prisma = new PrismaClient();

/**
 * Clean every table this test file touches, in FK-safe order (deepest
 * children first). Mirrors `tests/integration/database.test.ts`'s
 * `cleanDatabase()` convention, extended for the GraviScan models.
 */
async function cleanDatabase() {
  await prisma.graviImage.deleteMany();
  await prisma.graviScan.deleteMany();
  await prisma.graviScanPlateAssignment.deleteMany();
  await prisma.graviScanSession.deleteMany();
  await prisma.graviPlateSectionMapping.deleteMany();
  await prisma.graviPlateAccession.deleteMany();
  await prisma.graviScanner.deleteMany();
  await prisma.plantAccessionMappings.deleteMany();
  await prisma.scan.deleteMany();
  await prisma.image.deleteMany();
  await prisma.experiment.deleteMany();
  await prisma.accessions.deleteMany();
  await prisma.phenotyper.deleteMany();
  await prisma.scientist.deleteMany();
}

/**
 * Shared fixture (task 1.2): two distinct Experiment rows, two
 * GraviScanner rows, a Phenotyper, and helpers for seeding
 * GraviScanSession/GraviScan rows across both experiments — needed by
 * every cross-experiment-scoping test below.
 */
async function seedBaseFixture() {
  const phenotyper = await prisma.phenotyper.create({
    data: {
      name: 'Test Phenotyper',
      email: `phenotyper-${Date.now()}@salk.edu`,
    },
  });
  const experimentA = await prisma.experiment.create({
    data: { name: 'Experiment A', species: 'Amaranthus' },
  });
  const experimentB = await prisma.experiment.create({
    data: { name: 'Experiment B', species: 'Amaranthus' },
  });
  const scannerX = await prisma.graviScanner.create({
    data: { name: 'scanner-x', display_name: 'Scanner X' },
  });
  const scannerY = await prisma.graviScanner.create({
    data: { name: 'scanner-y', display_name: 'Scanner Y' },
  });
  return { phenotyper, experimentA, experimentB, scannerX, scannerY };
}

async function createGraviScan(overrides: {
  experiment_id: string;
  phenotyper_id: string;
  scanner_id: string;
  wave_number?: number;
  plate_barcode?: string | null;
  plate_index?: string;
  capture_date?: Date;
  deleted?: boolean;
  cycle_number?: number;
  session_id?: string | null;
}) {
  return prisma.graviScan.create({
    data: {
      experiment_id: overrides.experiment_id,
      phenotyper_id: overrides.phenotyper_id,
      scanner_id: overrides.scanner_id,
      wave_number: overrides.wave_number ?? 0,
      plate_barcode: overrides.plate_barcode ?? null,
      path: '/scans/test.tif',
      grid_mode: '2grid',
      plate_index: overrides.plate_index ?? '00',
      resolution: 600,
      capture_date: overrides.capture_date,
      deleted: overrides.deleted ?? false,
      cycle_number: overrides.cycle_number,
      session_id: overrides.session_id ?? null,
    },
  });
}

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await cleanDatabase();
});

describe('database.graviscans.*', () => {
  describe('create', () => {
    it('rejects non-string experiment_id/phenotyper_id/scanner_id', async () => {
      const fx = await seedBaseFixture();

      const badPayloads = [
        {
          experiment_id: 123,
          phenotyper_id: fx.phenotyper.id,
          scanner_id: fx.scannerX.id,
        },
        {
          experiment_id: fx.experimentA.id,
          phenotyper_id: {},
          scanner_id: fx.scannerX.id,
        },
        {
          experiment_id: fx.experimentA.id,
          phenotyper_id: fx.phenotyper.id,
          scanner_id: ['a'],
        },
      ];

      for (const payload of badPayloads) {
        const result = await graviscansCreate(prisma, {
          ...payload,
          path: '/scans/x.tif',
          grid_mode: '2grid',
          plate_index: '00',
          resolution: 600,
        } as never);
        expect(result.success).toBe(false);
      }

      const count = await prisma.graviScan.count();
      expect(count).toBe(0);
    });

    it('persists all fields and defaults format to tiff and wave_number to 0 when omitted', async () => {
      const fx = await seedBaseFixture();
      const session = await prisma.graviScanSession.create({
        data: {
          experiment_id: fx.experimentA.id,
          phenotyper_id: fx.phenotyper.id,
        },
      });

      const startedAt = new Date('2026-04-01T10:00:00Z');
      const endedAt = new Date('2026-04-01T10:05:00Z');

      const result = await graviscansCreate(prisma, {
        experiment_id: fx.experimentA.id,
        phenotyper_id: fx.phenotyper.id,
        scanner_id: fx.scannerX.id,
        session_id: session.id,
        cycle_number: 2,
        scan_started_at: startedAt.toISOString(),
        scan_ended_at: endedAt.toISOString(),
        path: '/scans/full.tif',
        grid_mode: '4grid',
        plate_index: '01',
        resolution: 1200,
      });

      expect(result.success).toBe(true);
      const created = result.data as {
        id: string;
        format: string;
        wave_number: number;
        session_id: string | null;
        cycle_number: number | null;
      };
      expect(created.format).toBe('tiff');
      expect(created.wave_number).toBe(0);
      expect(created.session_id).toBe(session.id);
      expect(created.cycle_number).toBe(2);

      const row = await prisma.graviScan.findUnique({
        where: { id: created.id },
      });
      expect(row?.scan_started_at?.toISOString()).toBe(startedAt.toISOString());
      expect(row?.scan_ended_at?.toISOString()).toBe(endedAt.toISOString());
    });
  });

  describe('getMaxWaveNumber', () => {
    it('returns -1 for an experiment with zero non-deleted GraviScan rows, ignoring deleted rows', async () => {
      const fx = await seedBaseFixture();
      await createGraviScan({
        experiment_id: fx.experimentA.id,
        phenotyper_id: fx.phenotyper.id,
        scanner_id: fx.scannerX.id,
        wave_number: 5,
        deleted: true,
      });

      const result = await graviscansGetMaxWaveNumber(
        prisma,
        fx.experimentA.id
      );
      expect(result.success).toBe(true);
      expect(result.data).toBe(-1);
    });

    it('is scoped to the given experimentId only', async () => {
      const fx = await seedBaseFixture();
      await createGraviScan({
        experiment_id: fx.experimentA.id,
        phenotyper_id: fx.phenotyper.id,
        scanner_id: fx.scannerX.id,
        wave_number: 1,
      });
      await createGraviScan({
        experiment_id: fx.experimentB.id,
        phenotyper_id: fx.phenotyper.id,
        scanner_id: fx.scannerX.id,
        wave_number: 9,
      });

      const result = await graviscansGetMaxWaveNumber(
        prisma,
        fx.experimentA.id
      );
      expect(result.success).toBe(true);
      expect(result.data).toBe(1);
    });
  });

  describe('checkBarcodeUniqueInWave', () => {
    it('reports isDuplicate true for an exact match in the same (experiment, wave)', async () => {
      const fx = await seedBaseFixture();
      await createGraviScan({
        experiment_id: fx.experimentA.id,
        phenotyper_id: fx.phenotyper.id,
        scanner_id: fx.scannerX.id,
        wave_number: 2,
        plate_barcode: 'ABC123',
      });

      const result = await graviscansCheckBarcodeUniqueInWave(prisma, {
        experiment_id: fx.experimentA.id,
        wave_number: 2,
        plate_barcode: 'ABC123',
      });
      expect(result.success).toBe(true);
      expect(result.data?.isDuplicate).toBe(true);
    });

    it('is case-insensitive and trims whitespace', async () => {
      const fx = await seedBaseFixture();
      await createGraviScan({
        experiment_id: fx.experimentA.id,
        phenotyper_id: fx.phenotyper.id,
        scanner_id: fx.scannerX.id,
        wave_number: 2,
        plate_barcode: 'ABC123',
      });

      const lowercase = await graviscansCheckBarcodeUniqueInWave(prisma, {
        experiment_id: fx.experimentA.id,
        wave_number: 2,
        plate_barcode: 'abc123',
      });
      expect(lowercase.data?.isDuplicate).toBe(true);

      const whitespace = await graviscansCheckBarcodeUniqueInWave(prisma, {
        experiment_id: fx.experimentA.id,
        wave_number: 2,
        plate_barcode: ' ABC123 ',
      });
      expect(whitespace.data?.isDuplicate).toBe(true);
    });

    it('does NOT flag a duplicate in a different experiment or a different wave_number', async () => {
      const fx = await seedBaseFixture();
      await createGraviScan({
        experiment_id: fx.experimentA.id,
        phenotyper_id: fx.phenotyper.id,
        scanner_id: fx.scannerX.id,
        wave_number: 2,
        plate_barcode: 'ABC123',
      });

      const differentExperiment = await graviscansCheckBarcodeUniqueInWave(
        prisma,
        {
          experiment_id: fx.experimentB.id,
          wave_number: 2,
          plate_barcode: 'ABC123',
        }
      );
      expect(differentExperiment.data?.isDuplicate).toBe(false);

      const differentWave = await graviscansCheckBarcodeUniqueInWave(prisma, {
        experiment_id: fx.experimentA.id,
        wave_number: 3,
        plate_barcode: 'ABC123',
      });
      expect(differentWave.data?.isDuplicate).toBe(false);
    });

    it('ignores rows where deleted is true', async () => {
      const fx = await seedBaseFixture();
      await createGraviScan({
        experiment_id: fx.experimentA.id,
        phenotyper_id: fx.phenotyper.id,
        scanner_id: fx.scannerX.id,
        wave_number: 2,
        plate_barcode: 'ABC123',
        deleted: true,
      });

      const result = await graviscansCheckBarcodeUniqueInWave(prisma, {
        experiment_id: fx.experimentA.id,
        wave_number: 2,
        plate_barcode: 'ABC123',
      });
      expect(result.data?.isDuplicate).toBe(false);
    });
  });

  describe('updateGridTimestamps', () => {
    it('updates scan_started_at/scan_ended_at for ids belonging to the given experiment', async () => {
      const fx = await seedBaseFixture();
      const scan = await createGraviScan({
        experiment_id: fx.experimentA.id,
        phenotyper_id: fx.phenotyper.id,
        scanner_id: fx.scannerX.id,
      });

      const startedAt = new Date('2026-05-01T00:00:00Z');
      const endedAt = new Date('2026-05-01T00:10:00Z');
      const result = await graviscansUpdateGridTimestamps(prisma, {
        experiment_id: fx.experimentA.id,
        ids: [scan.id],
        scan_started_at: startedAt.toISOString(),
        scan_ended_at: endedAt.toISOString(),
      });

      expect(result.success).toBe(true);
      const row = await prisma.graviScan.findUnique({ where: { id: scan.id } });
      expect(row?.scan_started_at?.toISOString()).toBe(startedAt.toISOString());
      expect(row?.scan_ended_at?.toISOString()).toBe(endedAt.toISOString());
    });

    it('does NOT update a row whose experiment_id does not match the passed experiment_id', async () => {
      const fx = await seedBaseFixture();
      const foreignScan = await createGraviScan({
        experiment_id: fx.experimentB.id,
        phenotyper_id: fx.phenotyper.id,
        scanner_id: fx.scannerX.id,
      });

      const result = await graviscansUpdateGridTimestamps(prisma, {
        experiment_id: fx.experimentA.id,
        ids: [foreignScan.id],
        scan_started_at: new Date().toISOString(),
        scan_ended_at: new Date().toISOString(),
      });

      expect(result.success).toBe(true);
      const row = await prisma.graviScan.findUnique({
        where: { id: foreignScan.id },
      });
      expect(row?.scan_started_at).toBeNull();
      expect(row?.scan_ended_at).toBeNull();
    });

    it('returns the count of rows actually updated, not ids.length', async () => {
      const fx = await seedBaseFixture();
      const ownScan = await createGraviScan({
        experiment_id: fx.experimentA.id,
        phenotyper_id: fx.phenotyper.id,
        scanner_id: fx.scannerX.id,
      });
      const foreignScan = await createGraviScan({
        experiment_id: fx.experimentB.id,
        phenotyper_id: fx.phenotyper.id,
        scanner_id: fx.scannerX.id,
      });

      const result = await graviscansUpdateGridTimestamps(prisma, {
        experiment_id: fx.experimentA.id,
        ids: [ownScan.id, foreignScan.id],
        scan_started_at: new Date().toISOString(),
        scan_ended_at: new Date().toISOString(),
      });

      expect(result.data?.updatedCount).toBe(1);
    });
  });

  describe('browseByExperiment', () => {
    it('paginates by offset/limit and includes non-deleted scans and hasNeedsReview', async () => {
      const fx = await seedBaseFixture();
      await createGraviScan({
        experiment_id: fx.experimentA.id,
        phenotyper_id: fx.phenotyper.id,
        scanner_id: fx.scannerX.id,
      });
      await createGraviScan({
        experiment_id: fx.experimentA.id,
        phenotyper_id: fx.phenotyper.id,
        scanner_id: fx.scannerX.id,
        deleted: true,
      });
      await prisma.graviScanPlateAssignment.create({
        data: {
          experiment_id: fx.experimentA.id,
          scanner_id: fx.scannerX.id,
          plate_index: '00',
          verification_status: 'needs_review',
        },
      });

      const result = await graviscansBrowseByExperiment(prisma, {
        offset: 0,
        limit: 10,
      });
      expect(result.success).toBe(true);
      const experiments = result.data?.experiments ?? [];
      expect(experiments.length).toBeLessThanOrEqual(10);
      const expA = experiments.find((e) => e.id === fx.experimentA.id);
      expect(expA).toBeDefined();
      expect(expA?.graviScans).toHaveLength(1);
      expect(expA?.hasNeedsReview).toBe(true);
    });

    it('filters by dateFrom/dateTo inclusively across the whole calendar day', async () => {
      const fx = await seedBaseFixture();
      await createGraviScan({
        experiment_id: fx.experimentA.id,
        phenotyper_id: fx.phenotyper.id,
        scanner_id: fx.scannerX.id,
        capture_date: new Date('2026-06-15T23:30:00.000Z'),
      });
      await createGraviScan({
        experiment_id: fx.experimentB.id,
        phenotyper_id: fx.phenotyper.id,
        scanner_id: fx.scannerX.id,
        capture_date: new Date('2026-06-20T00:00:00.000Z'),
      });

      const result = await graviscansBrowseByExperiment(prisma, {
        offset: 0,
        limit: 10,
        filters: { dateFrom: '2026-06-15', dateTo: '2026-06-15' },
      });
      const ids = (result.data?.experiments ?? []).map((e) => e.id);
      expect(ids).toContain(fx.experimentA.id);
      expect(ids).not.toContain(fx.experimentB.id);
    });

    it('filters experimentName by substring', async () => {
      const fx = await seedBaseFixture();
      await createGraviScan({
        experiment_id: fx.experimentA.id,
        phenotyper_id: fx.phenotyper.id,
        scanner_id: fx.scannerX.id,
      });
      await createGraviScan({
        experiment_id: fx.experimentB.id,
        phenotyper_id: fx.phenotyper.id,
        scanner_id: fx.scannerX.id,
      });

      const result = await graviscansBrowseByExperiment(prisma, {
        offset: 0,
        limit: 10,
        filters: { experimentName: 'Experiment A' },
      });
      const ids = (result.data?.experiments ?? []).map((e) => e.id);
      expect(ids).toEqual([fx.experimentA.id]);
    });

    it('filters accession by substring against the linked Accessions.name', async () => {
      const fx = await seedBaseFixture();
      const accession = await prisma.accessions.create({
        data: { name: 'Col-0-special' },
      });
      await prisma.experiment.update({
        where: { id: fx.experimentA.id },
        data: { accession_id: accession.id },
      });
      await createGraviScan({
        experiment_id: fx.experimentA.id,
        phenotyper_id: fx.phenotyper.id,
        scanner_id: fx.scannerX.id,
      });
      await createGraviScan({
        experiment_id: fx.experimentB.id,
        phenotyper_id: fx.phenotyper.id,
        scanner_id: fx.scannerX.id,
      });

      const result = await graviscansBrowseByExperiment(prisma, {
        offset: 0,
        limit: 10,
        filters: { accession: 'special' },
      });
      const ids = (result.data?.experiments ?? []).map((e) => e.id);
      expect(ids).toEqual([fx.experimentA.id]);
    });

    it('evaluates uploadStatus as an in-memory post-filter over aggregated GraviImage.status', async () => {
      const fx = await seedBaseFixture();
      const scanUploaded = await createGraviScan({
        experiment_id: fx.experimentA.id,
        phenotyper_id: fx.phenotyper.id,
        scanner_id: fx.scannerX.id,
      });
      await prisma.graviImage.create({
        data: {
          graviscan_id: scanUploaded.id,
          path: '/img1.tif',
          status: 'uploaded',
        },
      });

      const scanPending = await createGraviScan({
        experiment_id: fx.experimentB.id,
        phenotyper_id: fx.phenotyper.id,
        scanner_id: fx.scannerX.id,
      });
      await prisma.graviImage.create({
        data: {
          graviscan_id: scanPending.id,
          path: '/img2.tif',
          status: 'pending',
        },
      });

      const uploadedResult = await graviscansBrowseByExperiment(prisma, {
        offset: 0,
        limit: 10,
        filters: { uploadStatus: 'uploaded' },
      });
      const uploadedIds = (uploadedResult.data?.experiments ?? []).map(
        (e) => e.id
      );
      expect(uploadedIds).toContain(fx.experimentA.id);
      expect(uploadedIds).not.toContain(fx.experimentB.id);

      const pendingResult = await graviscansBrowseByExperiment(prisma, {
        offset: 0,
        limit: 10,
        filters: { uploadStatus: 'pending' },
      });
      const pendingIds = (pendingResult.data?.experiments ?? []).map(
        (e) => e.id
      );
      expect(pendingIds).toContain(fx.experimentB.id);
      expect(pendingIds).not.toContain(fx.experimentA.id);
    });
  });

  describe('experimentDetail', () => {
    it('returns {success:false} for a nonexistent experiment id', async () => {
      const result = await graviscansExperimentDetail(prisma, 'nonexistent-id');
      expect(result.success).toBe(false);
    });

    it('returns scans ordered by (cycle_number, scanner_id, plate_index) and a verificationStatusMap', async () => {
      const fx = await seedBaseFixture();
      await createGraviScan({
        experiment_id: fx.experimentA.id,
        phenotyper_id: fx.phenotyper.id,
        scanner_id: fx.scannerX.id,
        cycle_number: 2,
        plate_index: '00',
      });
      await createGraviScan({
        experiment_id: fx.experimentA.id,
        phenotyper_id: fx.phenotyper.id,
        scanner_id: fx.scannerX.id,
        cycle_number: 1,
        plate_index: '00',
      });
      await prisma.graviScanPlateAssignment.create({
        data: {
          experiment_id: fx.experimentA.id,
          scanner_id: fx.scannerX.id,
          plate_index: '00',
          verification_status: 'verified',
        },
      });

      const result = await graviscansExperimentDetail(
        prisma,
        fx.experimentA.id
      );
      expect(result.success).toBe(true);
      const scans = result.data?.scans ?? [];
      expect(scans[0].cycle_number).toBe(1);
      expect(scans[1].cycle_number).toBe(2);
      expect(result.data?.verificationStatusMap[`${fx.scannerX.id}:00`]).toBe(
        'verified'
      );
    });

    it('never includes scans or plate assignments belonging to a different experiment sharing the same scanner', async () => {
      const fx = await seedBaseFixture();
      await createGraviScan({
        experiment_id: fx.experimentA.id,
        phenotyper_id: fx.phenotyper.id,
        scanner_id: fx.scannerX.id,
      });
      await createGraviScan({
        experiment_id: fx.experimentB.id,
        phenotyper_id: fx.phenotyper.id,
        scanner_id: fx.scannerX.id,
      });
      await prisma.graviScanPlateAssignment.create({
        data: {
          experiment_id: fx.experimentB.id,
          scanner_id: fx.scannerX.id,
          plate_index: '00',
          verification_status: 'needs_review',
        },
      });

      const result = await graviscansExperimentDetail(
        prisma,
        fx.experimentA.id
      );
      expect(result.data?.scans).toHaveLength(1);
      expect(result.data?.scans[0].experiment_id).toBe(fx.experimentA.id);
      expect(
        Object.keys(result.data?.verificationStatusMap ?? {})
      ).toHaveLength(0);
    });
  });
});

describe('database.graviscanSessions.*', () => {
  describe('create', () => {
    it('persists experiment_id/phenotyper_id/scan_mode and defaults interval/duration/total_cycles to null', async () => {
      const fx = await seedBaseFixture();

      const result = await graviscanSessionsCreate(prisma, {
        experiment_id: fx.experimentA.id,
        phenotyper_id: fx.phenotyper.id,
        scan_mode: 'interval',
      });

      expect(result.success).toBe(true);
      const created = result.data as {
        interval_seconds: number | null;
        duration_seconds: number | null;
        total_cycles: number | null;
      };
      expect(created.interval_seconds).toBeNull();
      expect(created.duration_seconds).toBeNull();
      expect(created.total_cycles).toBeNull();
    });

    it('rejects non-string experiment_id/phenotyper_id', async () => {
      const fx = await seedBaseFixture();
      const result = await graviscanSessionsCreate(prisma, {
        experiment_id: 42 as unknown as string,
        phenotyper_id: fx.phenotyper.id,
        scan_mode: 'single',
      });
      expect(result.success).toBe(false);

      const result2 = await graviscanSessionsCreate(prisma, {
        experiment_id: fx.experimentA.id,
        phenotyper_id: {} as unknown as string,
        scan_mode: 'single',
      });
      expect(result2.success).toBe(false);

      const count = await prisma.graviScanSession.count();
      expect(count).toBe(0);
    });
  });

  describe('complete', () => {
    it('sets completed_at and cancelled for the given session_id', async () => {
      const fx = await seedBaseFixture();
      const session = await prisma.graviScanSession.create({
        data: {
          experiment_id: fx.experimentA.id,
          phenotyper_id: fx.phenotyper.id,
        },
      });

      const result = await graviscanSessionsComplete(prisma, {
        session_id: session.id,
      });
      expect(result.success).toBe(true);
      const row = await prisma.graviScanSession.findUnique({
        where: { id: session.id },
      });
      expect(row?.completed_at).not.toBeNull();
      expect(row?.cancelled).toBe(false);

      const session2 = await prisma.graviScanSession.create({
        data: {
          experiment_id: fx.experimentA.id,
          phenotyper_id: fx.phenotyper.id,
        },
      });
      await graviscanSessionsComplete(prisma, {
        session_id: session2.id,
        cancelled: true,
      });
      const row2 = await prisma.graviScanSession.findUnique({
        where: { id: session2.id },
      });
      expect(row2?.cancelled).toBe(true);
    });

    it('returns {success:false} for a nonexistent session_id rather than throwing', async () => {
      await expect(
        graviscanSessionsComplete(prisma, { session_id: 'nonexistent' })
      ).resolves.toMatchObject({ success: false });
    });

    it('rejects a non-string session_id', async () => {
      const result = await graviscanSessionsComplete(prisma, {
        session_id: 123 as unknown as string,
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('database.graviscanPlateAssignments.*', () => {
  describe('list', () => {
    it('is scoped to experiment and scanner together, ordered by plate_index', async () => {
      const fx = await seedBaseFixture();
      await prisma.graviScanPlateAssignment.create({
        data: {
          experiment_id: fx.experimentA.id,
          scanner_id: fx.scannerX.id,
          plate_index: '01',
        },
      });
      await prisma.graviScanPlateAssignment.create({
        data: {
          experiment_id: fx.experimentA.id,
          scanner_id: fx.scannerX.id,
          plate_index: '00',
        },
      });
      await prisma.graviScanPlateAssignment.create({
        data: {
          experiment_id: fx.experimentB.id,
          scanner_id: fx.scannerX.id,
          plate_index: '00',
        },
      });

      const result = await graviscanPlateAssignmentsList(
        prisma,
        fx.experimentA.id,
        fx.scannerX.id
      );
      expect(result.success).toBe(true);
      const rows = result.data ?? [];
      expect(rows).toHaveLength(2);
      expect(rows[0].plate_index).toBe('00');
      expect(rows[1].plate_index).toBe('01');
    });
  });

  describe('upsertMany', () => {
    it('creates new rows and updates existing ones inside a single transaction', async () => {
      const fx = await seedBaseFixture();
      await prisma.graviScanPlateAssignment.create({
        data: {
          experiment_id: fx.experimentA.id,
          scanner_id: fx.scannerX.id,
          plate_index: '00',
          plate_barcode: 'OLD',
        },
      });

      const result = await graviscanPlateAssignmentsUpsertMany(
        prisma,
        fx.experimentA.id,
        fx.scannerX.id,
        [
          { plate_index: '00', plate_barcode: 'NEW' },
          { plate_index: '01', plate_barcode: 'FRESH' },
        ]
      );

      expect(result.success).toBe(true);
      const rows = await prisma.graviScanPlateAssignment.findMany({
        where: { experiment_id: fx.experimentA.id, scanner_id: fx.scannerX.id },
        orderBy: { plate_index: 'asc' },
      });
      expect(rows).toHaveLength(2);
      expect(rows[0].plate_barcode).toBe('NEW');
      expect(rows[1].plate_barcode).toBe('FRESH');
    });

    it('rejects non-string experimentId/scannerId', async () => {
      const result = await graviscanPlateAssignmentsUpsertMany(
        prisma,
        123 as unknown as string,
        'scanner-1',
        []
      );
      expect(result.success).toBe(false);
    });

    it('is atomic — a failing entry rolls back the whole batch', async () => {
      const fx = await seedBaseFixture();

      const result = await graviscanPlateAssignmentsUpsertMany(
        prisma,
        fx.experimentA.id,
        fx.scannerX.id,
        [
          { plate_index: '00', plate_barcode: 'SHOULD-NOT-PERSIST' },
          // Missing required plate_index — forces a Prisma validation
          // error mid-transaction so the whole batch must roll back.
          { plate_barcode: 'INVALID' } as unknown as { plate_index: string },
        ]
      );

      expect(result.success).toBe(false);
      const rows = await prisma.graviScanPlateAssignment.findMany({
        where: { experiment_id: fx.experimentA.id, scanner_id: fx.scannerX.id },
      });
      expect(rows).toHaveLength(0);
    });
  });
});

describe('database.graviPlateAccessions.*', () => {
  describe('createWithSections', () => {
    it('creates one Accessions row, one GraviPlateAccession per plate, one GraviPlateSectionMapping per section, atomically', async () => {
      const result = await graviPlateAccessionsCreateWithSections(
        prisma,
        { name: 'Metadata File 1' },
        [
          {
            plate_id: 'P1',
            accession: 'Col-0',
            sections: [
              { plate_section_id: 'S1', plant_qr: 'QR1' },
              { plate_section_id: 'S2', plant_qr: 'QR2' },
            ],
          },
          {
            plate_id: 'P2',
            accession: 'Col-0',
            sections: [{ plate_section_id: 'S1', plant_qr: 'QR3' }],
          },
        ]
      );

      expect(result.success).toBe(true);
      expect(result.data?.totalPlates).toBe(2);
      expect(result.data?.totalSections).toBe(3);

      const plateCount = await prisma.graviPlateAccession.count();
      const sectionCount = await prisma.graviPlateSectionMapping.count();
      expect(plateCount).toBe(2);
      expect(sectionCount).toBe(3);
    });

    it('rolls back entirely (including the parent Accessions row) when a section violates uniqueness', async () => {
      const result = await graviPlateAccessionsCreateWithSections(
        prisma,
        { name: 'Metadata File Bad' },
        [
          {
            plate_id: 'P1',
            accession: 'Col-0',
            sections: [
              { plate_section_id: 'S1', plant_qr: 'DUPLICATE' },
              { plate_section_id: 'S2', plant_qr: 'DUPLICATE' },
            ],
          },
        ]
      );

      expect(result.success).toBe(false);
      const accessionCount = await prisma.accessions.count();
      const plateCount = await prisma.graviPlateAccession.count();
      const sectionCount = await prisma.graviPlateSectionMapping.count();
      expect(accessionCount).toBe(0);
      expect(plateCount).toBe(0);
      expect(sectionCount).toBe(0);
    });
  });

  describe('list', () => {
    it('returns plates naturally sorted by plate_id with sections naturally sorted by plate_section_id', async () => {
      const created = await graviPlateAccessionsCreateWithSections(
        prisma,
        { name: 'Natural Sort File' },
        [
          {
            plate_id: 'P10',
            accession: 'Col-0',
            sections: [
              { plate_section_id: 'S10', plant_qr: 'A' },
              { plate_section_id: 'S2', plant_qr: 'B' },
            ],
          },
          {
            plate_id: 'P2',
            accession: 'Col-0',
            sections: [{ plate_section_id: 'S1', plant_qr: 'C' }],
          },
        ]
      );
      const metadataFileId = created.data!.metadataFileId;

      const result = await graviPlateAccessionsList(prisma, metadataFileId);
      expect(result.success).toBe(true);
      const plates = result.data ?? [];
      expect(plates.map((p) => p.plate_id)).toEqual(['P2', 'P10']);
      const p10 = plates.find((p) => p.plate_id === 'P10');
      expect(p10.sections.map((s) => s.plate_section_id)).toEqual([
        'S2',
        'S10',
      ]);
    });

    it('returns an empty list (not an error) for a metadataFileId with zero plates', async () => {
      const accession = await prisma.accessions.create({
        data: { name: 'Empty File' },
      });
      const result = await graviPlateAccessionsList(prisma, accession.id);
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('rejects a non-string metadataFileId', async () => {
      const result = await graviPlateAccessionsList(
        prisma,
        123 as unknown as string
      );
      expect(result.success).toBe(false);
    });
  });

  describe('listFiles', () => {
    it('returns only Accessions rows with at least one linked GraviPlateAccession, annotated with experiment names and plate count', async () => {
      const fx = await seedBaseFixture();
      const linked = await graviPlateAccessionsCreateWithSections(
        prisma,
        { name: 'Linked File' },
        [
          {
            plate_id: 'P1',
            accession: 'Col-0',
            sections: [{ plate_section_id: 'S1', plant_qr: 'Q1' }],
          },
        ]
      );
      await prisma.experiment.update({
        where: { id: fx.experimentA.id },
        data: { accession_id: linked.data!.metadataFileId },
      });
      await prisma.accessions.create({ data: { name: 'Unlinked File' } });

      const result = await graviPlateAccessionsListFiles(prisma);
      expect(result.success).toBe(true);
      const files = result.data ?? [];
      const names = files.map((f) => f.name);
      expect(names).toContain('Linked File');
      expect(names).not.toContain('Unlinked File');
      const linkedFile = files.find((f) => f.name === 'Linked File');
      expect(linkedFile?.plateCount).toBe(1);
      expect(linkedFile?.experimentNames).toContain('Experiment A');
    });
  });

  describe('delete', () => {
    it('is blocked when linked to an Experiment.accession_id', async () => {
      const fx = await seedBaseFixture();
      const created = await graviPlateAccessionsCreateWithSections(
        prisma,
        { name: 'Linked For Delete' },
        [
          {
            plate_id: 'P1',
            accession: 'Col-0',
            sections: [{ plate_section_id: 'S1', plant_qr: 'Q1' }],
          },
        ]
      );
      const metadataFileId = created.data!.metadataFileId;
      await prisma.experiment.update({
        where: { id: fx.experimentA.id },
        data: { accession_id: metadataFileId },
      });

      const result = await graviPlateAccessionsDelete(prisma, metadataFileId);
      expect(result.success).toBe(false);
      const stillExists = await prisma.accessions.findUnique({
        where: { id: metadataFileId },
      });
      expect(stillExists).not.toBeNull();
    });

    it('rejects a non-string metadataFileId', async () => {
      const result = await graviPlateAccessionsDelete(
        prisma,
        123 as unknown as string
      );
      expect(result.success).toBe(false);
    });

    it('cascades its own children when unlinked, leaving zero orphaned section rows', async () => {
      const created = await graviPlateAccessionsCreateWithSections(
        prisma,
        { name: 'Unlinked For Delete' },
        [
          {
            plate_id: 'P1',
            accession: 'Col-0',
            sections: [{ plate_section_id: 'S1', plant_qr: 'Q1' }],
          },
        ]
      );
      const metadataFileId = created.data!.metadataFileId;

      const result = await graviPlateAccessionsDelete(prisma, metadataFileId);
      expect(result.success).toBe(true);

      const accession = await prisma.accessions.findUnique({
        where: { id: metadataFileId },
      });
      const orphanedSections = await prisma.graviPlateSectionMapping.count();
      const orphanedPlates = await prisma.graviPlateAccession.count();
      expect(accession).toBeNull();
      expect(orphanedSections).toBe(0);
      expect(orphanedPlates).toBe(0);
    });
  });
});
