// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getScannerStatus } from '../../../src/main/graviscan/scanner-handlers';

function createMockDb() {
  return {
    graviScanner: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    graviConfig: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  } as any;
}

function createMockCoordinator() {
  return {
    getScannerStatuses: vi.fn().mockReturnValue([]),
  } as any;
}

const SAVED_SCANNER_1 = {
  id: 's1',
  name: 'Scanner 1',
  display_name: null,
  usb_port: '1-2',
  enabled: true,
  createdAt: new Date('2026-01-01'),
};

const SAVED_SCANNER_2 = {
  id: 's2',
  name: 'Scanner 2',
  display_name: 'Bottom Right',
  usb_port: '1-3',
  enabled: true,
  createdAt: new Date('2026-01-02'),
};

describe('getScannerStatus', () => {
  let db: ReturnType<typeof createMockDb>;
  let coordinator: ReturnType<typeof createMockCoordinator>;

  beforeEach(() => {
    db = createMockDb();
    coordinator = createMockCoordinator();
  });

  it('merges live coordinator status onto saved DB scanner rows', async () => {
    db.graviScanner.findMany.mockResolvedValue([SAVED_SCANNER_1]);
    coordinator.getScannerStatuses.mockReturnValue([
      { scannerId: 's1', status: 'ready' },
    ]);

    const result = await getScannerStatus(coordinator, db);

    expect(result.success).toBe(true);
    expect(result.scanners).toEqual([
      expect.objectContaining({ scannerId: 's1', status: 'ready' }),
    ]);
  });

  it("reports 'disconnected' for a saved scanner with no matching subprocess status", async () => {
    db.graviScanner.findMany.mockResolvedValue([SAVED_SCANNER_1]);
    coordinator.getScannerStatuses.mockReturnValue([]);

    const result = await getScannerStatus(coordinator, db);

    expect(result.scanners).toEqual([
      expect.objectContaining({ scannerId: 's1', status: 'disconnected' }),
    ]);
  });

  it('treats a null coordinator (not yet created) as all-disconnected', async () => {
    db.graviScanner.findMany.mockResolvedValue([SAVED_SCANNER_1]);

    const result = await getScannerStatus(null, db);

    expect(result.success).toBe(true);
    expect(result.scanners).toEqual([
      expect.objectContaining({ scannerId: 's1', status: 'disconnected' }),
    ]);
  });

  it('falls back to name when display_name is not set', async () => {
    db.graviScanner.findMany.mockResolvedValue([SAVED_SCANNER_1]);

    const result = await getScannerStatus(coordinator, db);

    expect(result.scanners[0].displayName).toBe('Scanner 1');
  });

  it('uses display_name when set', async () => {
    db.graviScanner.findMany.mockResolvedValue([SAVED_SCANNER_2]);

    const result = await getScannerStatus(coordinator, db);

    expect(result.scanners[0].displayName).toBe('Bottom Right');
  });

  it('includes usbPort from the saved row', async () => {
    db.graviScanner.findMany.mockResolvedValue([SAVED_SCANNER_1]);

    const result = await getScannerStatus(coordinator, db);

    expect(result.scanners[0].usbPort).toBe('1-2');
  });

  it('propagates the error message when the coordinator reports an error status', async () => {
    db.graviScanner.findMany.mockResolvedValue([SAVED_SCANNER_1]);
    coordinator.getScannerStatuses.mockReturnValue([
      { scannerId: 's1', status: 'error', error: 'SANE device not found' },
    ]);

    const result = await getScannerStatus(coordinator, db);

    expect(result.scanners[0]).toEqual(
      expect.objectContaining({
        scannerId: 's1',
        status: 'error',
        error: 'SANE device not found',
      })
    );
  });

  describe("gridMode — each scanner row's own grid_mode (#491)", () => {
    it('returns a different grid mode per scanner', async () => {
      db.graviScanner.findMany.mockResolvedValue([
        { ...SAVED_SCANNER_1, grid_mode: '2grid' },
        { ...SAVED_SCANNER_2, grid_mode: '4grid' },
      ]);

      const result = await getScannerStatus(coordinator, db);

      expect(
        result.scanners.map((s: any) => [s.scannerId, s.gridMode])
      ).toEqual([
        ['s1', '2grid'],
        ['s2', '4grid'],
      ]);
    });

    it('ignores the GraviConfig grid mode', async () => {
      db.graviScanner.findMany.mockResolvedValue([
        { ...SAVED_SCANNER_1, grid_mode: '4grid' },
      ]);
      db.graviConfig.findFirst.mockResolvedValue({
        id: 'cfg-1',
        grid_mode: '2grid',
        resolution: 1200,
      });

      const result = await getScannerStatus(coordinator, db);

      expect(result.scanners[0].gridMode).toBe('4grid');
      expect(db.graviConfig.findFirst).not.toHaveBeenCalled();
    });

    it.each([undefined, null, '', '3grid'])(
      "falls back to '4grid' for a stored value of %s",
      async (stored) => {
        db.graviScanner.findMany.mockResolvedValue([
          { ...SAVED_SCANNER_1, grid_mode: stored },
        ]);

        const result = await getScannerStatus(coordinator, db);

        expect(result.scanners[0].gridMode).toBe('4grid');
      }
    );
  });

  it('returns { success: false, error } when the DB query throws', async () => {
    db.graviScanner.findMany.mockRejectedValue(new Error('DB unavailable'));

    const result = await getScannerStatus(coordinator, db);

    expect(result).toEqual({
      success: false,
      scanners: [],
      error: 'DB unavailable',
    });
  });

  it('orders results by createdAt ascending (matches production query)', async () => {
    db.graviScanner.findMany.mockResolvedValue([SAVED_SCANNER_1]);

    await getScannerStatus(coordinator, db);

    expect(db.graviScanner.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { enabled: true },
        orderBy: { createdAt: 'asc' },
      })
    );
  });
});
