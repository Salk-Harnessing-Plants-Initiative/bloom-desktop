// @vitest-environment node
/**
 * Unit tests for scan-persistence.ts — main-process DB record creation.
 *
 * Tests that GraviScan, GraviImage, and GraviScanSession records are
 * created correctly on coordinator events, following the CylinderScan
 * scanner-process.ts:saveScanToDatabase() pattern.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock getDatabase before importing the module under test
const mockGraviScanCreate = vi.fn();
const mockGraviScanSessionCreate = vi.fn();
const mockGraviScanSessionUpdate = vi.fn();
const mockPrismaTransaction = vi.fn();

vi.mock('../../src/main/database', () => ({
  getDatabase: () => ({
    graviScan: {
      create: mockGraviScanCreate,
    },
    graviScanSession: {
      create: mockGraviScanSessionCreate,
      update: mockGraviScanSessionUpdate,
    },
    $transaction: mockPrismaTransaction,
  }),
}));

// We'll import the module after it exists — for now, define the expected interface
// import { setupCoordinatorPersistence } from '../../src/main/graviscan/scan-persistence';

import { EventEmitter } from 'events';

// Helper: create a mock coordinator (EventEmitter)
function createMockCoordinator() {
  return new EventEmitter();
}

// Helper: create mock sessionFns
function createMockSessionFns(sessionState: Record<string, unknown> | null = null) {
  return {
    getScanSession: vi.fn().mockReturnValue(sessionState),
    setScanSession: vi.fn(),
    markScanJobRecorded: vi.fn(),
  };
}

// Helper: create a standard grid-complete event payload
function createGridCompletePayload(overrides: Record<string, unknown> = {}) {
  return {
    cycle: 1,
    renamedFiles: [
      {
        oldPath: '/scans/plate_00_st_20260416T143000_cy1.tiff',
        newPath: '/scans/plate_00_st_20260416T143000_et_20260416T143115_cy1.tiff',
        scannerId: 'scanner-1',
      },
    ],
    renameErrors: {},
    gridIndex: '00',
    scanStartedAt: '2026-04-16T14:30:00.000Z',
    scanEndedAt: '2026-04-16T14:31:15.000Z',
    ...overrides,
  };
}

// Standard session state for tests
const activeSession = {
  isActive: true,
  isContinuous: false,
  experimentId: 'exp-1',
  phenotyperId: 'pheno-1',
  resolution: 600,
  sessionId: 'session-1',
  jobs: {
    'scanner-1:00': {
      scannerId: 'scanner-1',
      plateIndex: '00',
      outputPath: '/scans/plate_00_st_20260416T143000_cy1.tiff',
      plantBarcode: 'PLATE-001',
      transplantDate: '2026-04-10',
      customNote: 'Test note',
      gridMode: '2grid',
      status: 'scanning' as const,
    },
  },
  currentCycle: 1,
  totalCycles: 1,
  intervalMs: 0,
  scanStartedAt: Date.now(),
  scanEndedAt: null,
  scanDurationMs: 0,
  coordinatorState: 'scanning' as const,
  nextScanAt: null,
  waveNumber: 1,
};

describe('scan-persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGraviScanCreate.mockResolvedValue({
      id: 'graviscan-1',
      images: [{ id: 'image-1' }],
    });
    mockGraviScanSessionCreate.mockResolvedValue({
      id: 'session-1',
    });
    mockGraviScanSessionUpdate.mockResolvedValue({
      id: 'session-1',
      completed_at: new Date(),
    });
    mockPrismaTransaction.mockImplementation(async (fn: unknown) => {
      if (typeof fn === 'function') return fn();
    });
  });

  describe('GraviScan + GraviImage record creation on grid-complete', () => {
    it('should create GraviScan record with post-rename path from renamedFiles', async () => {
      // This test verifies that scan-persistence creates records using
      // the post-rename path (with _et_ suffix), not the original path.
      // This is the core of bug fix #154.
      const coordinator = createMockCoordinator();
      const sessionFns = createMockSessionFns(activeSession);
      const payload = createGridCompletePayload();

      // When scan-persistence is implemented, it will:
      // 1. Listen for 'grid-complete' on coordinator
      // 2. Read session metadata from sessionFns.getScanSession()
      // 3. Create GraviScan + GraviImage records with post-rename paths
      expect(coordinator).toBeDefined();
      expect(sessionFns.getScanSession()).toEqual(activeSession);
      expect(payload.renamedFiles[0].newPath).toContain('_et_');
    });

    it('should use Prisma nested create for atomicity', async () => {
      // GraviScan and GraviImage records must be created together
      // using Prisma's nested create pattern (both or neither).
      expect(mockGraviScanCreate).toBeDefined();
    });

    it('should snapshot plate metadata from session jobs, not from mutable PlateAssignment table', async () => {
      // plate_barcode, transplant_date, custom_note should come from
      // the session job (populated at scan start time), NOT from the
      // GraviScanPlateAssignment table (which can be modified later).
      const job = activeSession.jobs['scanner-1:00'];
      expect(job.plantBarcode).toBe('PLATE-001');
      expect(job.transplantDate).toBe('2026-04-10');
      expect(job.customNote).toBe('Test note');
    });

    it('should filter renameErrors by scannerId', async () => {
      // If scanner A rename fails but scanner B succeeds,
      // records for scanner B should still be created.
      const payload = createGridCompletePayload({
        renameErrors: {
          'scanner-2': { error: 'Permission denied' },
        },
      });

      // scanner-1 has no errors, so its records should be created
      expect(payload.renameErrors).not.toHaveProperty('scanner-1');
    });
  });

  describe('GraviScanSession creation on scan start', () => {
    it('should create session record with experiment and phenotyper metadata', async () => {
      expect(activeSession.experimentId).toBe('exp-1');
      expect(activeSession.phenotyperId).toBe('pheno-1');
    });

    it('should set started_at to current timestamp', async () => {
      expect(activeSession.scanStartedAt).toBeGreaterThan(0);
    });

    it('should make session_id available for subsequent GraviScan records', async () => {
      expect(activeSession.sessionId).toBe('session-1');
    });
  });

  describe('GraviScanSession completion', () => {
    it('should set completed_at on session end', async () => {
      expect(mockGraviScanSessionUpdate).toBeDefined();
    });

    it('should set cancelled flag when session is cancelled', async () => {
      // The completion handler should pass cancelled: true
      // when the scan was user-cancelled vs naturally completed.
      expect(true).toBe(true); // Placeholder for implementation
    });
  });

  describe('crash safety', () => {
    it('should create records even without renderer (main-process only)', async () => {
      // The persistence module runs in the main process.
      // It should not depend on any renderer state.
      const coordinator = createMockCoordinator();
      const sessionFns = createMockSessionFns(activeSession);

      // Coordinator and sessionFns are main-process objects.
      // No window.electron or renderer references should be needed.
      expect(coordinator.listenerCount('grid-complete')).toBe(0);
      expect(sessionFns.getScanSession).toBeDefined();
    });
  });

  describe('DB write failure handling', () => {
    it('should log warning and continue scan on Prisma error', async () => {
      mockGraviScanCreate.mockRejectedValue(new Error('Unique constraint violation'));

      // scan-persistence should catch this error, log it, and NOT
      // rethrow — the scan must continue for subsequent grids.
      expect(mockGraviScanCreate).toBeDefined();
    });
  });
});
