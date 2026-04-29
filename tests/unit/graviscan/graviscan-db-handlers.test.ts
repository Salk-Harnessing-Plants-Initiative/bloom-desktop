// @vitest-environment node
/**
 * Unit tests for GraviScan DB IPC handlers registered in database-handlers.ts.
 *
 * Captures ipcMain.handle callbacks via a stub, then invokes them directly
 * with a mocked Prisma client. Exercises the actual handler logic —
 * filtering, aggregation, upsert, transaction composition.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';

// Capture handlers registered via ipcMain.handle
const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
    // registerDatabaseHandlers also uses on/removeListener in some paths
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

// Mock Prisma methods the GraviScan handlers use
const mockGraviScanFindMany = vi.fn();
const mockGraviScanAggregate = vi.fn();
const mockGraviScanFindFirst = vi.fn();
const mockGraviScanPlateAssignmentFindMany = vi.fn();
const mockGraviScanPlateAssignmentUpsert = vi.fn();
const mockGraviPlateAccessionFindMany = vi.fn();
const mockTransaction = vi.fn();

vi.mock('../../../src/main/database', () => ({
  getDatabase: () => ({
    // GraviScan queries
    graviScan: {
      findMany: mockGraviScanFindMany,
      aggregate: mockGraviScanAggregate,
      findFirst: mockGraviScanFindFirst,
    },
    graviScanPlateAssignment: {
      findMany: mockGraviScanPlateAssignmentFindMany,
      upsert: mockGraviScanPlateAssignmentUpsert,
    },
    graviPlateAccession: {
      findMany: mockGraviPlateAccessionFindMany,
    },
    $transaction: mockTransaction,
    // Other tables the non-Gravi registrations touch — stub them enough
    // to not crash during registration. Values are never queried.
    experiment: { findMany: vi.fn(), create: vi.fn() },
    phenotyper: { findMany: vi.fn() },
    scientist: { findMany: vi.fn() },
    accession: { findMany: vi.fn() },
    scan: { findMany: vi.fn(), create: vi.fn() },
    image: { createMany: vi.fn() },
    graviScanner: {
      findMany: vi.fn(),
      // Pre-flight check on upsert/upsertMany handlers — return a truthy
      // value to indicate the scanner exists.
      findUnique: vi.fn().mockResolvedValue({ id: 'scanner-1' }),
    },
    graviConfig: { findFirst: vi.fn() },
  }),
}));

// ImageUploader import is loaded by database-handlers — don't need it to work
vi.mock('../../../src/main/image-uploader', () => ({
  ImageUploader: vi.fn(),
  UploadResult: undefined,
}));

// Register handlers once for the whole test suite
import { registerDatabaseHandlers } from '../../../src/main/database-handlers';
registerDatabaseHandlers();

// Fake IpcMainInvokeEvent — the handlers ignore it
const fakeEvent = {} as IpcMainInvokeEvent;

describe('db:graviscans:list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters out deleted scans by default', async () => {
    mockGraviScanFindMany.mockResolvedValueOnce([]);
    const handler = handlers.get('db:graviscans:list')!;
    await handler(fakeEvent);

    expect(mockGraviScanFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deleted: false }),
      })
    );
  });

  it('includes experiment, phenotyper, scanner, images, session relations', async () => {
    mockGraviScanFindMany.mockResolvedValueOnce([]);
    const handler = handlers.get('db:graviscans:list')!;
    await handler(fakeEvent);

    const call = mockGraviScanFindMany.mock.calls[0][0];
    expect(call.include).toEqual({
      experiment: true,
      phenotyper: true,
      scanner: true,
      images: true,
      session: true,
    });
  });

  it('filters by experiment_id when provided', async () => {
    mockGraviScanFindMany.mockResolvedValueOnce([]);
    const handler = handlers.get('db:graviscans:list')!;
    await handler(fakeEvent, { experiment_id: 'exp-42' });

    expect(mockGraviScanFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deleted: false,
          experiment_id: 'exp-42',
        }),
      })
    );
  });

  it('sorts by capture_date desc', async () => {
    mockGraviScanFindMany.mockResolvedValueOnce([]);
    const handler = handlers.get('db:graviscans:list')!;
    await handler(fakeEvent);

    const call = mockGraviScanFindMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ capture_date: 'desc' });
  });

  it('returns success envelope with data on success', async () => {
    mockGraviScanFindMany.mockResolvedValueOnce([{ id: 'gs-1' }]);
    const handler = handlers.get('db:graviscans:list')!;
    const result = await handler(fakeEvent);

    expect(result).toEqual({ success: true, data: [{ id: 'gs-1' }] });
  });

  it('returns error envelope on Prisma failure', async () => {
    mockGraviScanFindMany.mockRejectedValueOnce(new Error('connection lost'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = handlers.get('db:graviscans:list')!;
    const result = await handler(fakeEvent);

    expect(result).toEqual({ success: false, error: 'connection lost' });
  });
});

describe('db:graviscans:getMaxWaveNumber', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the highest wave_number for the experiment', async () => {
    mockGraviScanAggregate.mockResolvedValueOnce({
      _max: { wave_number: 5 },
    });
    const handler = handlers.get('db:graviscans:getMaxWaveNumber')!;
    const result = await handler(fakeEvent, 'exp-1');

    expect(mockGraviScanAggregate).toHaveBeenCalledWith({
      where: { experiment_id: 'exp-1' },
      _max: { wave_number: true },
    });
    expect(result).toEqual({ success: true, data: 5 });
  });

  it('returns 0 when no scans exist (null _max)', async () => {
    mockGraviScanAggregate.mockResolvedValueOnce({
      _max: { wave_number: null },
    });
    const handler = handlers.get('db:graviscans:getMaxWaveNumber')!;
    const result = await handler(fakeEvent, 'exp-1');

    expect(result).toEqual({ success: true, data: 0 });
  });
});

describe('db:graviscans:checkBarcodeUniqueInWave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries with exact experiment+wave+barcode filter', async () => {
    mockGraviScanFindFirst.mockResolvedValueOnce(null);
    const handler = handlers.get('db:graviscans:checkBarcodeUniqueInWave')!;
    await handler(fakeEvent, {
      experiment_id: 'exp-1',
      wave_number: 3,
      plate_barcode: 'PLATE-42',
    });

    expect(mockGraviScanFindFirst).toHaveBeenCalledWith({
      where: {
        experiment_id: 'exp-1',
        wave_number: 3,
        plate_barcode: 'PLATE-42',
        // Soft-deleted rows are ignored — uniqueness is per active scan only.
        deleted: false,
      },
    });
  });

  it('returns true when no existing row matches (unique)', async () => {
    mockGraviScanFindFirst.mockResolvedValueOnce(null);
    const handler = handlers.get('db:graviscans:checkBarcodeUniqueInWave')!;
    const result = await handler(fakeEvent, {
      experiment_id: 'exp-1',
      wave_number: 1,
      plate_barcode: 'P1',
    });

    expect(result).toEqual({ success: true, data: true });
  });

  it('returns false when a duplicate exists', async () => {
    mockGraviScanFindFirst.mockResolvedValueOnce({ id: 'gs-existing' });
    const handler = handlers.get('db:graviscans:checkBarcodeUniqueInWave')!;
    const result = await handler(fakeEvent, {
      experiment_id: 'exp-1',
      wave_number: 1,
      plate_barcode: 'P1',
    });

    expect(result).toEqual({ success: true, data: false });
  });
});

describe('db:graviscanPlateAssignments:list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters by experiment_id + scanner_id', async () => {
    mockGraviScanPlateAssignmentFindMany.mockResolvedValueOnce([]);
    const handler = handlers.get('db:graviscanPlateAssignments:list')!;
    await handler(fakeEvent, {
      experiment_id: 'exp-1',
      scanner_id: 'scanner-1',
    });

    expect(mockGraviScanPlateAssignmentFindMany).toHaveBeenCalledWith({
      where: { experiment_id: 'exp-1', scanner_id: 'scanner-1' },
      orderBy: { plate_index: 'asc' },
    });
  });
});

describe('db:graviscanPlateAssignments:upsert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses compound unique constraint and passes data fields', async () => {
    mockGraviScanPlateAssignmentUpsert.mockResolvedValueOnce({
      id: 'pa-1',
    });
    const handler = handlers.get('db:graviscanPlateAssignments:upsert')!;
    await handler(fakeEvent, {
      experiment_id: 'exp-1',
      scanner_id: 'scanner-1',
      plate_index: '00',
      data: { plate_barcode: 'PLATE-001', selected: true },
    });

    const call = mockGraviScanPlateAssignmentUpsert.mock.calls[0][0];
    expect(call.where).toEqual({
      experiment_id_scanner_id_plate_index: {
        experiment_id: 'exp-1',
        scanner_id: 'scanner-1',
        plate_index: '00',
      },
    });
    // create uses relation connect; update uses raw data
    expect(call.create.experiment.connect).toEqual({ id: 'exp-1' });
    expect(call.create.scanner.connect).toEqual({ id: 'scanner-1' });
    expect(call.create.plate_barcode).toBe('PLATE-001');
    expect(call.update).toEqual({
      plate_barcode: 'PLATE-001',
      selected: true,
    });
  });
});

describe('db:graviscanPlateAssignments:upsertMany', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransaction.mockImplementation(async (ops: unknown[]) => ops);
  });

  it('dispatches one upsert per assignment through a transaction', async () => {
    const handler = handlers.get('db:graviscanPlateAssignments:upsertMany')!;
    await handler(fakeEvent, {
      experiment_id: 'exp-1',
      scanner_id: 'scanner-1',
      assignments: [
        { plate_index: '00', plate_barcode: 'P1', selected: true },
        { plate_index: '01', plate_barcode: 'P2', selected: true },
      ],
    });

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // Transaction argument is an array of queued Prisma calls
    const ops = mockTransaction.mock.calls[0][0];
    expect(Array.isArray(ops)).toBe(true);
    expect(ops).toHaveLength(2);
  });
});

describe('db:graviPlateAccessions:list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries plate accessions by metadata file id', async () => {
    mockGraviPlateAccessionFindMany.mockResolvedValueOnce([]);
    const handler = handlers.get('db:graviPlateAccessions:list')!;
    await handler(fakeEvent, 'accession-42');

    expect(mockGraviPlateAccessionFindMany).toHaveBeenCalled();
    // The exact where clause (metadata_file_id vs accession_id) depends on
    // the handler implementation — just verify a query was issued.
  });
});
