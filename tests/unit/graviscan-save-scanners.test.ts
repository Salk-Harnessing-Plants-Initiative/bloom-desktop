// @vitest-environment node
/**
 * Task 2 (#231): grid_mode UPDATE/CREATE in save-scanners-db.
 *
 * The previous handler dropped scanner.grid_mode silently on both
 * UPDATE and CREATE Prisma calls. After this task, the handler
 * persists grid_mode in both code paths.
 *
 * Tests target the extracted `upsertScannerRow` helper directly,
 * which the IPC handler delegates to. Pattern matches
 * tests/unit/reset-usb.test.ts (re-implementing handler logic
 * against a mock Prisma client).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { upsertScannerRow } from '../../src/main/scanner-upsert';

interface MockGraviScanner {
  id: string;
  name: string;
  display_name: string | null;
  vendor_id: string;
  product_id: string;
  usb_port: string | null;
  usb_bus: number | null;
  usb_device: number | null;
  grid_mode: string;
  enabled: boolean;
}

interface UpsertPayload {
  name: string;
  display_name?: string | null;
  vendor_id: string;
  product_id: string;
  usb_port?: string;
  usb_bus?: number;
  usb_device?: number;
  grid_mode?: string;
}

function makeRow(overrides: Partial<MockGraviScanner> = {}): MockGraviScanner {
  return {
    id: 'row-1',
    name: 'Scanner 1',
    display_name: null,
    vendor_id: '04b8',
    product_id: '013c',
    usb_port: '1-1',
    usb_bus: 1,
    usb_device: 7,
    grid_mode: '4grid',
    enabled: true,
    ...overrides,
  };
}

function makeMockDb(initialRows: MockGraviScanner[] = []) {
  const rows = [...initialRows];
  return {
    graviScanner: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return (
          rows.find((r) => {
            if (
              where.usb_bus !== undefined &&
              where.usb_device !== undefined &&
              r.usb_bus === where.usb_bus &&
              r.usb_device === where.usb_device
            ) {
              return true;
            }
            if (where.usb_port !== undefined && r.usb_port === where.usb_port) {
              return true;
            }
            return false;
          }) ?? null
        );
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<MockGraviScanner>;
        }) => {
          const row = rows.find((r) => r.id === where.id);
          if (!row) throw new Error(`row not found: ${where.id}`);
          Object.assign(row, data);
          return { ...row };
        },
      ),
      create: vi.fn(
        async ({ data }: { data: Partial<MockGraviScanner> }) => {
          const newRow: MockGraviScanner = {
            ...makeRow({
              id: `row-${rows.length + 1}`,
              ...(data as Partial<MockGraviScanner>),
            }),
          } as MockGraviScanner;
          rows.push(newRow);
          return { ...newRow };
        },
      ),
    },
    _rows: rows,
  };
}

describe('upsertScannerRow — grid_mode persistence (#231)', () => {
  describe('UPDATE path', () => {
    it('persists payload grid_mode when row exists', async () => {
      const db = makeMockDb([makeRow({ grid_mode: '4grid' })]);
      const payload: UpsertPayload = {
        name: 'Scanner 1',
        vendor_id: '04b8',
        product_id: '013c',
        usb_port: '1-1',
        usb_bus: 1,
        usb_device: 7,
        grid_mode: '2grid',
      };

      const saved = await upsertScannerRow(db as never, payload);

      expect(saved.grid_mode).toBe('2grid');
      expect(db._rows[0].grid_mode).toBe('2grid');
    });

    it('preserves existing grid_mode when payload omits it', async () => {
      const db = makeMockDb([makeRow({ grid_mode: '2grid' })]);
      const payload: UpsertPayload = {
        name: 'Scanner 1',
        vendor_id: '04b8',
        product_id: '013c',
        usb_port: '1-1',
        usb_bus: 1,
        usb_device: 7,
        // no grid_mode
      };

      const saved = await upsertScannerRow(db as never, payload);
      expect(saved.grid_mode).toBe('2grid');
    });

    it('passes grid_mode through Prisma update data block', async () => {
      const db = makeMockDb([makeRow({ grid_mode: '4grid' })]);
      const payload: UpsertPayload = {
        name: 'Scanner 1',
        vendor_id: '04b8',
        product_id: '013c',
        usb_port: '1-1',
        usb_bus: 1,
        usb_device: 7,
        grid_mode: '2grid',
      };

      await upsertScannerRow(db as never, payload);

      expect(db.graviScanner.update).toHaveBeenCalledTimes(1);
      const updateCall = db.graviScanner.update.mock.calls[0][0];
      expect(updateCall.data).toHaveProperty('grid_mode', '2grid');
    });
  });

  describe('CREATE path', () => {
    it('persists payload grid_mode when no existing row', async () => {
      const db = makeMockDb([]);
      const payload: UpsertPayload = {
        name: 'Scanner 1',
        vendor_id: '04b8',
        product_id: '013c',
        usb_port: '17-2',
        usb_bus: 17,
        usb_device: 21,
        grid_mode: '2grid',
      };

      const saved = await upsertScannerRow(db as never, payload);

      expect(saved.grid_mode).toBe('2grid');
    });

    it('falls back to "4grid" default when payload omits grid_mode', async () => {
      const db = makeMockDb([]);
      const payload: UpsertPayload = {
        name: 'Scanner 1',
        vendor_id: '04b8',
        product_id: '013c',
        usb_port: '17-1',
        usb_bus: 17,
        usb_device: 22,
        // no grid_mode
      };

      const saved = await upsertScannerRow(db as never, payload);
      expect(saved.grid_mode).toBe('4grid');
    });

    it('passes grid_mode through Prisma create data block', async () => {
      const db = makeMockDb([]);
      const payload: UpsertPayload = {
        name: 'Scanner 1',
        vendor_id: '04b8',
        product_id: '013c',
        usb_port: '17-2',
        usb_bus: 17,
        usb_device: 21,
        grid_mode: '2grid',
      };

      await upsertScannerRow(db as never, payload);

      expect(db.graviScanner.create).toHaveBeenCalledTimes(1);
      const createCall = db.graviScanner.create.mock.calls[0][0];
      expect(createCall.data).toHaveProperty('grid_mode', '2grid');
    });

    it('omitted grid_mode in create call uses default "4grid"', async () => {
      const db = makeMockDb([]);
      const payload: UpsertPayload = {
        name: 'Scanner 1',
        vendor_id: '04b8',
        product_id: '013c',
        usb_port: '17-1',
        usb_bus: 17,
        usb_device: 22,
      };

      await upsertScannerRow(db as never, payload);

      const createCall = db.graviScanner.create.mock.calls[0][0];
      expect(createCall.data).toHaveProperty('grid_mode', '4grid');
    });
  });
});
