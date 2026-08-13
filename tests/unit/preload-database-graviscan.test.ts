// @vitest-environment node
/**
 * Contract tests (task 12.3) for the four new `database.*` namespaces
 * added to the preload script's `databaseAPI` object:
 *   - database.graviscans
 *   - database.graviscanSessions
 *   - database.graviscanPlateAssignments
 *   - database.graviPlateAccessions
 *
 * These assert each namespace exposes EXACTLY the methods implemented
 * in src/main/database-handlers.ts (Sections 2-5 of tasks.md) — no
 * extra, no missing — and that each method invokes the correct
 * `db:{model}:{action}` IPC channel with its arguments. This is a
 * contract test, not a re-implementation of preload.ts's logic.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvoke = vi.fn().mockResolvedValue({ success: true });
let exposedAPI: any = null;

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn((_name: string, api: any) => {
      exposedAPI = api;
    }),
  },
  ipcRenderer: {
    invoke: mockInvoke,
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

describe('preload database API — graviscan namespaces', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    exposedAPI = null;
    vi.resetModules();
    await import('../../src/main/preload');
  });

  function methodNames(namespace: Record<string, unknown>): string[] {
    return Object.keys(namespace).sort();
  }

  describe('database.graviscans', () => {
    it('exposes exactly create/getMaxWaveNumber/checkBarcodeUniqueInWave/updateGridTimestamps/browseByExperiment/experimentDetail', () => {
      expect(methodNames(exposedAPI.database.graviscans)).toEqual(
        [
          'browseByExperiment',
          'checkBarcodeUniqueInWave',
          'create',
          'experimentDetail',
          'getMaxWaveNumber',
          'updateGridTimestamps',
        ].sort()
      );
    });

    it('create invokes db:graviscans:create with the payload', async () => {
      const payload = { experiment_id: 'e1' };
      await exposedAPI.database.graviscans.create(payload);
      expect(mockInvoke).toHaveBeenCalledWith('db:graviscans:create', payload);
    });

    it('getMaxWaveNumber invokes db:graviscans:getMaxWaveNumber with the experimentId', async () => {
      await exposedAPI.database.graviscans.getMaxWaveNumber('e1');
      expect(mockInvoke).toHaveBeenCalledWith(
        'db:graviscans:getMaxWaveNumber',
        'e1'
      );
    });

    it('checkBarcodeUniqueInWave invokes db:graviscans:checkBarcodeUniqueInWave with args', async () => {
      const args = {
        experiment_id: 'e1',
        wave_number: 2,
        plate_barcode: 'ABC',
      };
      await exposedAPI.database.graviscans.checkBarcodeUniqueInWave(args);
      expect(mockInvoke).toHaveBeenCalledWith(
        'db:graviscans:checkBarcodeUniqueInWave',
        args
      );
    });

    it('updateGridTimestamps invokes db:graviscans:updateGridTimestamps with args', async () => {
      const args = { experiment_id: 'e1', ids: ['a', 'b'] };
      await exposedAPI.database.graviscans.updateGridTimestamps(args);
      expect(mockInvoke).toHaveBeenCalledWith(
        'db:graviscans:updateGridTimestamps',
        args
      );
    });

    it('browseByExperiment invokes db:graviscans:browseByExperiment with args', async () => {
      const args = { offset: 0, limit: 10 };
      await exposedAPI.database.graviscans.browseByExperiment(args);
      expect(mockInvoke).toHaveBeenCalledWith(
        'db:graviscans:browseByExperiment',
        args
      );
    });

    it('experimentDetail invokes db:graviscans:experimentDetail with the experimentId', async () => {
      await exposedAPI.database.graviscans.experimentDetail('e1');
      expect(mockInvoke).toHaveBeenCalledWith(
        'db:graviscans:experimentDetail',
        'e1'
      );
    });
  });

  describe('database.graviscanSessions', () => {
    it('exposes exactly create/complete', () => {
      expect(methodNames(exposedAPI.database.graviscanSessions)).toEqual(
        ['complete', 'create'].sort()
      );
    });

    it('create invokes db:graviscanSessions:create with the payload', async () => {
      const payload = {
        experiment_id: 'e1',
        phenotyper_id: 'p1',
        scan_mode: 'single',
      };
      await exposedAPI.database.graviscanSessions.create(payload);
      expect(mockInvoke).toHaveBeenCalledWith(
        'db:graviscanSessions:create',
        payload
      );
    });

    it('complete invokes db:graviscanSessions:complete with args', async () => {
      const args = { session_id: 's1', cancelled: true };
      await exposedAPI.database.graviscanSessions.complete(args);
      expect(mockInvoke).toHaveBeenCalledWith(
        'db:graviscanSessions:complete',
        args
      );
    });
  });

  describe('database.graviscanPlateAssignments', () => {
    it('exposes exactly list/upsertMany', () => {
      expect(
        methodNames(exposedAPI.database.graviscanPlateAssignments)
      ).toEqual(['list', 'upsertMany'].sort());
    });

    it('list invokes db:graviscanPlateAssignments:list with experimentId/scannerId', async () => {
      await exposedAPI.database.graviscanPlateAssignments.list('e1', 's1');
      expect(mockInvoke).toHaveBeenCalledWith(
        'db:graviscanPlateAssignments:list',
        'e1',
        's1',
        undefined
      );
    });

    it('list forwards an explicit waveNumber', async () => {
      await exposedAPI.database.graviscanPlateAssignments.list('e1', 's1', 3);
      expect(mockInvoke).toHaveBeenCalledWith(
        'db:graviscanPlateAssignments:list',
        'e1',
        's1',
        3
      );
    });

    it('upsertMany invokes db:graviscanPlateAssignments:upsertMany with experimentId/scannerId/assignments', async () => {
      const assignments = [{ plate_index: '00' }];
      await exposedAPI.database.graviscanPlateAssignments.upsertMany(
        'e1',
        's1',
        assignments
      );
      expect(mockInvoke).toHaveBeenCalledWith(
        'db:graviscanPlateAssignments:upsertMany',
        'e1',
        's1',
        assignments,
        undefined
      );
    });

    it('upsertMany forwards an explicit waveNumber', async () => {
      const assignments = [{ plate_index: '00' }];
      await exposedAPI.database.graviscanPlateAssignments.upsertMany(
        'e1',
        's1',
        assignments,
        3
      );
      expect(mockInvoke).toHaveBeenCalledWith(
        'db:graviscanPlateAssignments:upsertMany',
        'e1',
        's1',
        assignments,
        3
      );
    });
  });

  describe('database.graviPlateAccessions', () => {
    it('exposes exactly createWithSections/list/listFiles/delete', () => {
      expect(methodNames(exposedAPI.database.graviPlateAccessions)).toEqual(
        ['createWithSections', 'delete', 'list', 'listFiles'].sort()
      );
    });

    it('createWithSections invokes db:graviPlateAccessions:createWithSections with accessionData/plates', async () => {
      const accessionData = { name: 'Metadata File' };
      const plates = [{ plate_id: 'P1', accession: 'Col-0', sections: [] }];
      await exposedAPI.database.graviPlateAccessions.createWithSections(
        accessionData,
        plates
      );
      expect(mockInvoke).toHaveBeenCalledWith(
        'db:graviPlateAccessions:createWithSections',
        accessionData,
        plates
      );
    });

    it('list invokes db:graviPlateAccessions:list with the metadataFileId', async () => {
      await exposedAPI.database.graviPlateAccessions.list('m1');
      expect(mockInvoke).toHaveBeenCalledWith(
        'db:graviPlateAccessions:list',
        'm1'
      );
    });

    it('listFiles invokes db:graviPlateAccessions:listFiles with no arguments', async () => {
      await exposedAPI.database.graviPlateAccessions.listFiles();
      expect(mockInvoke).toHaveBeenCalledWith(
        'db:graviPlateAccessions:listFiles'
      );
    });

    it('delete invokes db:graviPlateAccessions:delete with the metadataFileId', async () => {
      await exposedAPI.database.graviPlateAccessions.delete('m1');
      expect(mockInvoke).toHaveBeenCalledWith(
        'db:graviPlateAccessions:delete',
        'm1'
      );
    });
  });
});
