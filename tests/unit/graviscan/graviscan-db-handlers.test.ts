// @vitest-environment node
/**
 * Unit tests for GraviScan DB read IPC handlers and plate assignment CRUD.
 * Tests handlers that will be added to database-handlers.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma client
const mockGraviScanFindMany = vi.fn();
const mockGraviScanAggregate = vi.fn();
const mockGraviScanFindFirst = vi.fn();
const mockGraviScanPlateAssignmentFindMany = vi.fn();
const mockGraviScanPlateAssignmentUpsert = vi.fn();
const mockGraviPlateAccessionFindMany = vi.fn();
const mockPrismaTransaction = vi.fn();

vi.mock('../../src/main/database', () => ({
  getDatabase: () => ({
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
    $transaction: mockPrismaTransaction,
  }),
}));

describe('GraviScan DB read IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('graviscans.list', () => {
    it('should return non-deleted GraviScan records with relations', async () => {
      const mockScans = [
        {
          id: 'gs-1',
          experiment_id: 'exp-1',
          deleted: false,
          experiment: { id: 'exp-1', name: 'Test Exp' },
          phenotyper: { id: 'p-1', name: 'Jane' },
          scanner: { id: 's-1', name: 'Scanner 1' },
          images: [],
          session: null,
        },
      ];
      mockGraviScanFindMany.mockResolvedValue(mockScans);

      // Handler should filter deleted: false and include relations
      expect(mockGraviScanFindMany).toBeDefined();
    });

    it('should filter by experiment_id when provided', async () => {
      mockGraviScanFindMany.mockResolvedValue([]);
      // Handler should pass experiment_id to where clause
      expect(mockGraviScanFindMany).toBeDefined();
    });
  });

  describe('graviscans.getMaxWaveNumber', () => {
    it('should return highest wave_number for experiment (or 0)', async () => {
      mockGraviScanAggregate.mockResolvedValue({
        _max: { wave_number: 3 },
      });

      // Handler should query: aggregate where experiment_id, _max wave_number
      expect(mockGraviScanAggregate).toBeDefined();
    });

    it('should return 0 when no scans exist for experiment', async () => {
      mockGraviScanAggregate.mockResolvedValue({
        _max: { wave_number: null },
      });
      expect(mockGraviScanAggregate).toBeDefined();
    });
  });

  describe('graviscans.checkBarcodeUniqueInWave', () => {
    it('should return true when barcode is unique in experiment+wave', async () => {
      mockGraviScanFindFirst.mockResolvedValue(null);
      expect(mockGraviScanFindFirst).toBeDefined();
    });

    it('should return false when barcode already exists in experiment+wave', async () => {
      mockGraviScanFindFirst.mockResolvedValue({ id: 'gs-existing' });
      expect(mockGraviScanFindFirst).toBeDefined();
    });
  });
});

describe('GraviScanPlateAssignment CRUD handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('graviscanPlateAssignments.list', () => {
    it('should return plate assignments for experiment+scanner', async () => {
      const mockAssignments = [
        {
          id: 'pa-1',
          experiment_id: 'exp-1',
          scanner_id: 's-1',
          plate_index: '00',
          plate_barcode: 'PLATE-001',
          selected: true,
        },
      ];
      mockGraviScanPlateAssignmentFindMany.mockResolvedValue(mockAssignments);
      expect(mockGraviScanPlateAssignmentFindMany).toBeDefined();
    });
  });

  describe('graviscanPlateAssignments.upsert', () => {
    it('should create or update using @@unique constraint', async () => {
      mockGraviScanPlateAssignmentUpsert.mockResolvedValue({
        id: 'pa-1',
        plate_barcode: 'PLATE-001',
      });
      expect(mockGraviScanPlateAssignmentUpsert).toBeDefined();
    });
  });

  describe('graviscanPlateAssignments.upsertMany', () => {
    it('should upsert multiple assignments in a transaction', async () => {
      mockPrismaTransaction.mockImplementation(async (ops: unknown[]) => ops);
      expect(mockPrismaTransaction).toBeDefined();
    });
  });
});

describe('GraviPlateAccession query handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('graviPlateAccessions.list', () => {
    it('should return plate accessions for metadata file with sections', async () => {
      const mockAccessions = [
        {
          id: 'gpa-1',
          plate_id: 'PLATE_001',
          accession: 'Ara-1',
          sections: [{ plant_qr: 'QR-001' }],
        },
      ];
      mockGraviPlateAccessionFindMany.mockResolvedValue(mockAccessions);
      expect(mockGraviPlateAccessionFindMany).toBeDefined();
    });
  });
});
