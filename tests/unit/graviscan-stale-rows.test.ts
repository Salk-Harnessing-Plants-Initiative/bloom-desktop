// @vitest-environment node
/**
 * Task 3 (#230): stale GraviScanner rows are disabled (not deleted) on
 * detect. Both the `save-scanners-db` post-upsert phase and the
 * `validate-config` mismatch path SHALL set enabled=false for rows
 * whose usb_port is no longer in the current detection set.
 *
 * Preserves the FK chain from existing GraviScan / GraviScanPlateAssignment
 * rows (the Prisma schema has no ON DELETE CASCADE on those references).
 */

import { describe, it, expect, vi } from 'vitest';
import { disableStaleScannerRows } from '../../src/main/scanner-upsert';

interface MockGraviScanner {
  id: string;
  usb_port: string | null;
  enabled: boolean;
}

function makeMockDb(initialRows: MockGraviScanner[] = []) {
  const rows = [...initialRows];
  return {
    graviScanner: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where?: { enabled?: boolean };
        } = {}) => {
          if (where?.enabled !== undefined) {
            return rows.filter((r) => r.enabled === where.enabled);
          }
          return rows;
        },
      ),
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
      // Should never be called — leaving here so tests can assert it.
      delete: vi.fn(),
    },
    _rows: rows,
  };
}

describe('disableStaleScannerRows (#230)', () => {
  it('disables rows whose usb_port is not in the current detection set', async () => {
    const db = makeMockDb([
      { id: 'a', usb_port: '1-1', enabled: true },
      { id: 'b', usb_port: '1-2', enabled: true },
      { id: 'c', usb_port: '1-3', enabled: true },
    ]);

    const result = await disableStaleScannerRows(db as never, ['1-1', '1-2']);

    expect(result.disabled).toEqual(['c']);
    expect(db._rows.find((r) => r.id === 'c')!.enabled).toBe(false);
    // a and b unchanged
    expect(db._rows.find((r) => r.id === 'a')!.enabled).toBe(true);
    expect(db._rows.find((r) => r.id === 'b')!.enabled).toBe(true);
  });

  it('never calls delete (preserves FK chain)', async () => {
    const db = makeMockDb([
      { id: 'a', usb_port: '1-1', enabled: true },
      { id: 'b', usb_port: '1-2', enabled: true },
    ]);

    await disableStaleScannerRows(db as never, ['1-1']);

    expect(db.graviScanner.delete).not.toHaveBeenCalled();
  });

  it('is a no-op when all enabled rows are still detected', async () => {
    const db = makeMockDb([
      { id: 'a', usb_port: '1-1', enabled: true },
      { id: 'b', usb_port: '1-2', enabled: true },
    ]);

    const result = await disableStaleScannerRows(db as never, ['1-1', '1-2']);

    expect(result.disabled).toEqual([]);
    expect(db.graviScanner.update).not.toHaveBeenCalled();
  });

  it('ignores rows with null usb_port (cannot be matched against detection)', async () => {
    const db = makeMockDb([
      { id: 'a', usb_port: null, enabled: true },
      { id: 'b', usb_port: '1-2', enabled: true },
    ]);

    const result = await disableStaleScannerRows(db as never, ['1-2']);

    // Row 'a' has null usb_port; it CAN'T match anything in the
    // detection set but we also don't disable it (it's not "stale"
    // in any meaningful way — it just lacks a port assignment).
    expect(result.disabled).toEqual([]);
    expect(db._rows.find((r) => r.id === 'a')!.enabled).toBe(true);
  });

  it('does not touch rows that are already disabled', async () => {
    const db = makeMockDb([
      { id: 'a', usb_port: '1-1', enabled: true },
      { id: 'b', usb_port: '1-2', enabled: false }, // already disabled
    ]);

    const result = await disableStaleScannerRows(db as never, ['1-1']);

    // 'b' is already disabled and was filtered out at the query level
    // (where: { enabled: true }). It should NOT be re-disabled.
    expect(result.disabled).toEqual([]);
    expect(db.graviScanner.update).not.toHaveBeenCalled();
  });

  it('handles an empty current-port set by disabling all enabled rows', async () => {
    const db = makeMockDb([
      { id: 'a', usb_port: '1-1', enabled: true },
      { id: 'b', usb_port: '1-2', enabled: true },
    ]);

    const result = await disableStaleScannerRows(db as never, []);

    expect(result.disabled.sort()).toEqual(['a', 'b']);
    expect(db._rows.every((r) => r.enabled === false)).toBe(true);
  });
});
