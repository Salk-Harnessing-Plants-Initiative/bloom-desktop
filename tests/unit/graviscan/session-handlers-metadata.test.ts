// @vitest-environment node
/**
 * Tests for session-handlers.ts metadata.json scanner_name resolution.
 *
 * Task 1.6 of fix-scanner-config-save-flow: ensure the scanner_name field
 * in metadata.json is populated from the GraviScanner row's display_name
 * (or name, or scanner_id as last resort), NOT the UUID fallback that
 * was previously hard-coded at session-handlers.ts:196.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startScan } from '../../../src/main/graviscan/session-handlers';

function createMockCoordinator() {
  return {
    isScanning: false,
    initialize: vi.fn().mockResolvedValue(undefined),
    scanOnce: vi.fn().mockResolvedValue(undefined),
    scanInterval: vi.fn().mockResolvedValue(undefined),
    cancelAll: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnThis(),
    setSessionContext: vi.fn(),
  };
}

function createSessionFns() {
  return {
    getScanSession: vi.fn().mockReturnValue(null),
    setScanSession: vi.fn(),
    markScanJobRecorded: vi.fn(),
  };
}

function createMockDb(
  scannerRows: Array<{ id: string; display_name: string | null; name: string }>
) {
  return {
    graviScanner: {
      findMany: vi.fn().mockImplementation(({ where }: any) => {
        if (where?.id?.in) {
          return Promise.resolve(
            scannerRows.filter((r) => where.id.in.includes(r.id))
          );
        }
        return Promise.resolve(scannerRows);
      }),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
}

const BASE_PARAMS = {
  scanners: [
    {
      scannerId: 'sc-abc',
      saneName: 'epkowa:interpreter:001:002',
      plates: [
        {
          plate_index: '00',
          grid_mode: '2grid',
          output_path: '/tmp/scan-00.tiff',
          plate_barcode: 'PLT-1',
          transplant_date: null,
          custom_note: null,
        },
      ],
    },
  ],
  metadata: {
    experimentId: 'exp-1',
    phenotyperId: 'pheno-1',
    resolution: 600,
    waveNumber: 1,
  },
};

describe('session-handlers metadata: scanner_name resolution', () => {
  let coordinator: ReturnType<typeof createMockCoordinator>;
  let sessionFns: ReturnType<typeof createSessionFns>;

  beforeEach(() => {
    coordinator = createMockCoordinator();
    sessionFns = createSessionFns();
  });

  it('populates scannerNames with display_name when GraviScanner row has one', async () => {
    const db = createMockDb([
      { id: 'sc-abc', display_name: 'Bench 3 Scanner', name: 'Epson V850' },
    ]);

    const result = await startScan(
      coordinator as any,
      BASE_PARAMS,
      sessionFns,
      undefined,
      undefined,
      db as any
    );

    expect(result.success).toBe(true);
    expect(coordinator.setSessionContext).toHaveBeenCalled();
    const ctx = coordinator.setSessionContext.mock.calls[0][0];
    expect(ctx.scannerNames).toBeInstanceOf(Map);
    expect(ctx.scannerNames.get('sc-abc')).toBe('Bench 3 Scanner');
  });

  it('falls back to name when display_name is null', async () => {
    const db = createMockDb([
      { id: 'sc-abc', display_name: null, name: 'Epson V850' },
    ]);

    await startScan(
      coordinator as any,
      BASE_PARAMS,
      sessionFns,
      undefined,
      undefined,
      db as any
    );

    const ctx = coordinator.setSessionContext.mock.calls[0][0];
    expect(ctx.scannerNames.get('sc-abc')).toBe('Epson V850');
  });

  it('falls back to scanner_id when both display_name and name are absent', async () => {
    const db = createMockDb([]); // No rows returned

    await startScan(
      coordinator as any,
      BASE_PARAMS,
      sessionFns,
      undefined,
      undefined,
      db as any
    );

    const ctx = coordinator.setSessionContext.mock.calls[0][0];
    expect(ctx.scannerNames.get('sc-abc')).toBe('sc-abc');
  });

  it('does NOT use UUID fallback when display_name is available (traceability)', async () => {
    const db = createMockDb([
      {
        id: 'f3b8c2a4-1d2e-4a9b-aaaa-bbbbcccccccc',
        display_name: 'Lab A Epson',
        name: 'Epson V850',
      },
    ]);

    await startScan(
      coordinator as any,
      {
        ...BASE_PARAMS,
        scanners: [
          {
            ...BASE_PARAMS.scanners[0],
            scannerId: 'f3b8c2a4-1d2e-4a9b-aaaa-bbbbcccccccc',
          },
        ],
      },
      sessionFns,
      undefined,
      undefined,
      db as any
    );

    const ctx = coordinator.setSessionContext.mock.calls[0][0];
    // The UUID must NOT appear in scannerNames — human-readable value required
    const resolvedName = ctx.scannerNames.get(
      'f3b8c2a4-1d2e-4a9b-aaaa-bbbbcccccccc'
    );
    expect(resolvedName).toBe('Lab A Epson');
    expect(resolvedName).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}/);
  });
});
