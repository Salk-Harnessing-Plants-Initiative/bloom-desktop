// @vitest-environment node
/**
 * Unit tests for scan-persistence.ts — main-process DB record creation.
 *
 * Exercises the real module. These tests catch wiring regressions
 * (see PR #196 review: placeholder-only tests missed missing session
 * lifecycle wiring).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

import {
  setupCoordinatorPersistence,
  createGraviScanSession,
  completeGraviScanSession,
} from '../../../src/main/graviscan/scan-persistence';

// Helper: mock Prisma client
function createMockDb() {
  return {
    graviScan: { create: vi.fn().mockResolvedValue({ id: 'gs-1' }) },
    graviScanSession: {
      create: vi.fn().mockResolvedValue({ id: 'session-1' }),
      update: vi.fn().mockResolvedValue({ id: 'session-1' }),
    },
  };
}

// Helper: mock sessionFns
function createMockSessionFns(
  sessionState: Record<string, unknown> | null = null
) {
  return {
    getScanSession: vi.fn().mockReturnValue(sessionState),
    setScanSession: vi.fn(),
    markScanJobRecorded: vi.fn(),
  };
}

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

function createGridCompletePayload(overrides: Record<string, unknown> = {}) {
  return {
    cycle: 1,
    renamedFiles: [
      {
        oldPath: '/scans/plate_00_st_20260416T143000_cy1.tiff',
        newPath:
          '/scans/plate_00_st_20260416T143000_et_20260416T143115_cy1.tiff',
        scannerId: 'scanner-1',
      },
    ],
    renameErrors: [],
    gridIndex: '00',
    scanStartedAt: '2026-04-16T14:30:00.000Z',
    scanEndedAt: '2026-04-16T14:31:15.000Z',
    ...overrides,
  };
}

// Wait for all pending microtasks so async event listeners complete.
const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

describe('scan-persistence', () => {
  let db: ReturnType<typeof createMockDb>;
  let coordinator: EventEmitter;
  let sessionFns: ReturnType<typeof createMockSessionFns>;

  beforeEach(() => {
    db = createMockDb();
    coordinator = new EventEmitter();
    sessionFns = createMockSessionFns(activeSession);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('GraviScan + GraviImage record creation on grid-complete', () => {
    it('creates GraviScan record with post-rename path from renamedFiles', async () => {
      setupCoordinatorPersistence(coordinator, db, sessionFns);
      coordinator.emit('grid-complete', createGridCompletePayload());
      await flushAsync();

      expect(db.graviScan.create).toHaveBeenCalledTimes(1);
      const data = db.graviScan.create.mock.calls[0][0].data;
      expect(data.path).toBe(
        '/scans/plate_00_st_20260416T143000_et_20260416T143115_cy1.tiff'
      );
      expect(data.path).toContain('_et_');
    });

    it('uses Prisma nested create for atomicity (images created together with GraviScan)', async () => {
      setupCoordinatorPersistence(coordinator, db, sessionFns);
      coordinator.emit('grid-complete', createGridCompletePayload());
      await flushAsync();

      const data = db.graviScan.create.mock.calls[0][0].data;
      expect(data.images).toBeDefined();
      expect(data.images.create).toHaveLength(1);
      expect(data.images.create[0]).toMatchObject({
        path: expect.stringContaining('_et_'),
        status: 'pending',
        box_status: 'pending',
      });
    });

    it('snapshots plate metadata from session jobs, not from mutable PlateAssignment table', async () => {
      setupCoordinatorPersistence(coordinator, db, sessionFns);
      coordinator.emit('grid-complete', createGridCompletePayload());
      await flushAsync();

      const data = db.graviScan.create.mock.calls[0][0].data;
      expect(data.plate_barcode).toBe('PLATE-001');
      expect(data.custom_note).toBe('Test note');
      // transplant_date is coerced to Date
      expect(data.transplant_date).toBeInstanceOf(Date);
      expect((data.transplant_date as Date).toISOString()).toContain(
        '2026-04-10'
      );
    });

    it('copies scan session fields (experiment, phenotyper, session_id, wave, cycle)', async () => {
      setupCoordinatorPersistence(coordinator, db, sessionFns);
      coordinator.emit('grid-complete', createGridCompletePayload());
      await flushAsync();

      const data = db.graviScan.create.mock.calls[0][0].data;
      expect(data.experiment_id).toBe('exp-1');
      expect(data.phenotyper_id).toBe('pheno-1');
      expect(data.scanner_id).toBe('scanner-1');
      expect(data.session_id).toBe('session-1');
      expect(data.wave_number).toBe(1);
      expect(data.cycle_number).toBe(1);
    });

    it('writes scan_started_at and scan_ended_at as Date objects from payload ISO strings', async () => {
      setupCoordinatorPersistence(coordinator, db, sessionFns);
      coordinator.emit('grid-complete', createGridCompletePayload());
      await flushAsync();

      const data = db.graviScan.create.mock.calls[0][0].data;
      expect(data.scan_started_at).toBeInstanceOf(Date);
      expect(data.scan_ended_at).toBeInstanceOf(Date);
      expect((data.scan_started_at as Date).toISOString()).toBe(
        '2026-04-16T14:30:00.000Z'
      );
      expect((data.scan_ended_at as Date).toISOString()).toBe(
        '2026-04-16T14:31:15.000Z'
      );
    });

    it('skips record creation when session is null (cancel race safety)', async () => {
      sessionFns = createMockSessionFns(null);
      setupCoordinatorPersistence(coordinator, db, sessionFns);
      coordinator.emit('grid-complete', createGridCompletePayload());
      await flushAsync();

      expect(db.graviScan.create).not.toHaveBeenCalled();
    });

    it('skips record creation when no matching job exists for the scanner:grid key', async () => {
      setupCoordinatorPersistence(coordinator, db, sessionFns);
      // Payload from scanner-99 (no job for that scanner)
      coordinator.emit(
        'grid-complete',
        createGridCompletePayload({
          renamedFiles: [
            {
              oldPath: '/scans/foo.tiff',
              newPath: '/scans/foo_et_.tiff',
              scannerId: 'scanner-99',
            },
          ],
        })
      );
      await flushAsync();

      expect(db.graviScan.create).not.toHaveBeenCalled();
    });
  });

  describe('crash safety (main-process only, no renderer needed)', () => {
    it('creates records from coordinator events alone — no window.electron access', async () => {
      setupCoordinatorPersistence(coordinator, db, sessionFns);
      coordinator.emit('grid-complete', createGridCompletePayload());
      await flushAsync();

      expect(db.graviScan.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('DB write failure handling', () => {
    it('logs warning and continues on Prisma error (does not rethrow)', async () => {
      db.graviScan.create.mockRejectedValueOnce(
        new Error('Unique constraint violation')
      );
      setupCoordinatorPersistence(coordinator, db, sessionFns);

      // Should not throw — error is swallowed inside the listener
      expect(() =>
        coordinator.emit('grid-complete', createGridCompletePayload())
      ).not.toThrow();

      await flushAsync();

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('[scan-persistence]')
      );
    });
  });
});

describe('createGraviScanSession', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('creates a GraviScanSession record from session state', async () => {
    const sessionId = await createGraviScanSession(db, {
      ...activeSession,
      isContinuous: false,
      sessionId: null,
    });

    expect(sessionId).toBe('session-1');
    expect(db.graviScanSession.create).toHaveBeenCalledTimes(1);
    const data = db.graviScanSession.create.mock.calls[0][0].data;
    expect(data.experiment_id).toBe('exp-1');
    expect(data.phenotyper_id).toBe('pheno-1');
    expect(data.scan_mode).toBe('single'); // !isContinuous
  });

  it('records continuous scan parameters when isContinuous', async () => {
    await createGraviScanSession(db, {
      ...activeSession,
      isContinuous: true,
      intervalMs: 180_000,
      scanDurationMs: 3_600_000,
      totalCycles: 20,
      sessionId: null,
    });

    const data = db.graviScanSession.create.mock.calls[0][0].data;
    expect(data.scan_mode).toBe('continuous');
    expect(data.interval_seconds).toBe(180);
    expect(data.duration_seconds).toBe(3600);
    expect(data.total_cycles).toBe(20);
  });

  it('returns null and logs warning on DB failure', async () => {
    db.graviScanSession.create.mockRejectedValueOnce(new Error('DB error'));
    const sessionId = await createGraviScanSession(db, activeSession);

    expect(sessionId).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[scan-persistence]')
    );
  });
});

describe('completeGraviScanSession', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('updates completed_at and cancelled=false on natural completion', async () => {
    await completeGraviScanSession(db, 'session-1', false);

    expect(db.graviScanSession.update).toHaveBeenCalledTimes(1);
    const call = db.graviScanSession.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'session-1' });
    expect(call.data.completed_at).toBeInstanceOf(Date);
    expect(call.data.cancelled).toBe(false);
  });

  it('updates completed_at and cancelled=true on cancel', async () => {
    await completeGraviScanSession(db, 'session-1', true);

    const call = db.graviScanSession.update.mock.calls[0][0];
    expect(call.data.cancelled).toBe(true);
  });

  it('does not throw on DB failure', async () => {
    db.graviScanSession.update.mockRejectedValueOnce(new Error('DB error'));

    await expect(
      completeGraviScanSession(db, 'session-1', false)
    ).resolves.toBeUndefined();

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[scan-persistence]')
    );
  });
});
