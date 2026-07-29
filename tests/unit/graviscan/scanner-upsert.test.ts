// @vitest-environment node
/**
 * Increment 9 (stage 3): scanner-upsert.ts helpers.
 *
 * Covers, in the order they were ported from the reference branch:
 *  - upsertScannerRow            (grid_mode persistence fix's refactor —
 *                                 see report for why grid_mode itself is
 *                                 out of scope on this schema)
 *  - disableStaleScannerRows     (#230: disable-not-delete stale rows)
 *  - disableScannerById          (#230 UI half / #234: per-row disable)
 *  - stopWorkersForDisabledScanners (Copilot #20: stop orphan workers)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi } from 'vitest';
import {
  upsertScannerRow,
  disableStaleScannerRows,
  disableScannerById,
  stopWorkersForDisabledScanners,
} from '../../../src/main/graviscan/scanner-upsert';

interface MockGraviScanner {
  id: string;
  name: string;
  display_name: string | null;
  vendor_id: string;
  product_id: string;
  usb_port: string | null;
  usb_bus: number | null;
  usb_device: number | null;
  enabled: boolean;
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
    enabled: true,
    ...overrides,
  };
}

function makeMockDb(initialRows: MockGraviScanner[] = []) {
  const rows = [...initialRows];
  return {
    graviScanner: {
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) => {
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
              if (
                where.usb_port !== undefined &&
                r.usb_port === where.usb_port
              ) {
                return true;
              }
              return false;
            }) ?? null
          );
        }
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          rows.find((r) => r.id === where.id) ?? null
      ),
      findMany: vi.fn(
        async ({ where }: { where?: { enabled?: boolean } } = {}) => {
          if (where?.enabled !== undefined) {
            return rows.filter((r) => r.enabled === where.enabled);
          }
          return rows;
        }
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
        }
      ),
      create: vi.fn(async ({ data }: { data: Partial<MockGraviScanner> }) => {
        const newRow: MockGraviScanner = {
          ...makeRow({ id: `row-${rows.length + 1}`, ...data }),
        } as MockGraviScanner;
        rows.push(newRow);
        return { ...newRow };
      }),
      delete: vi.fn(),
    },
    _rows: rows,
  };
}

function makeMockCoordinator(scannersWithWorkers: string[] = []) {
  return {
    hasWorker: vi.fn((id: string) => scannersWithWorkers.includes(id)),
    stopScanner: vi.fn(async () => undefined),
  };
}

describe('upsertScannerRow', () => {
  it('creates a new row when no existing scanner matches', async () => {
    const db = makeMockDb([]);

    const saved = await upsertScannerRow(db as never, {
      name: 'Scanner 1',
      vendor_id: '04b8',
      product_id: '013c',
      usb_port: '1-1',
      usb_bus: 1,
      usb_device: 7,
    });

    expect(saved.enabled).toBe(true);
    expect(db.graviScanner.create).toHaveBeenCalledTimes(1);
  });

  it('updates the existing row when matched by usb_bus + usb_device', async () => {
    const db = makeMockDb([makeRow({ name: 'Old Name' })]);

    const saved = await upsertScannerRow(db as never, {
      name: 'New Name',
      vendor_id: '04b8',
      product_id: '013c',
      usb_port: '1-1',
      usb_bus: 1,
      usb_device: 7,
    });

    expect(saved.id).toBe('row-1');
    expect(saved.name).toBe('New Name');
    expect(db.graviScanner.update).toHaveBeenCalledTimes(1);
    expect(db.graviScanner.create).not.toHaveBeenCalled();
  });

  it('falls back to matching by usb_port when bus/device do not match', async () => {
    const db = makeMockDb([
      makeRow({ usb_bus: null, usb_device: null, usb_port: '1-1' }),
    ]);

    const saved = await upsertScannerRow(db as never, {
      name: 'Scanner 1',
      vendor_id: '04b8',
      product_id: '013c',
      usb_port: '1-1',
      usb_bus: 3,
      usb_device: 9,
    });

    expect(saved.id).toBe('row-1');
    expect(db.graviScanner.update).toHaveBeenCalledTimes(1);
  });

  it('matches and re-enables a previously-disabled row (re-detect path)', async () => {
    const db = makeMockDb([makeRow({ enabled: false })]);

    const saved = await upsertScannerRow(db as never, {
      name: 'Scanner 1',
      vendor_id: '04b8',
      product_id: '013c',
      usb_port: '1-1',
      usb_bus: 1,
      usb_device: 7,
    });

    // upsertScannerRow itself doesn't flip `enabled` — that isn't part of
    // its data block — but it must match the disabled row rather than
    // creating a duplicate.
    expect(saved.id).toBe('row-1');
    expect(db.graviScanner.create).not.toHaveBeenCalled();
  });

  it('preserves existing display_name when payload omits it', async () => {
    const db = makeMockDb([makeRow({ display_name: 'Bench 3' })]);

    const saved = await upsertScannerRow(db as never, {
      name: 'Scanner 1',
      vendor_id: '04b8',
      product_id: '013c',
      usb_port: '1-1',
      usb_bus: 1,
      usb_device: 7,
    });

    expect(saved.display_name).toBe('Bench 3');
  });
});

describe('disableStaleScannerRows (#230)', () => {
  it('disables rows whose usb_port is not in the current detection set', async () => {
    const db = makeMockDb([
      makeRow({ id: 'a', usb_port: '1-1' }),
      makeRow({ id: 'b', usb_port: '1-2' }),
      makeRow({ id: 'c', usb_port: '1-3' }),
    ]);

    const result = await disableStaleScannerRows(db as never, ['1-1', '1-2']);

    expect(result.disabled).toEqual(['c']);
    expect(db._rows.find((r) => r.id === 'c')!.enabled).toBe(false);
    expect(db._rows.find((r) => r.id === 'a')!.enabled).toBe(true);
  });

  it('never calls delete (preserves FK chain)', async () => {
    const db = makeMockDb([makeRow({ id: 'a', usb_port: '1-1' })]);

    await disableStaleScannerRows(db as never, []);

    expect(db.graviScanner.delete).not.toHaveBeenCalled();
  });

  it('is a no-op when all enabled rows are still detected', async () => {
    const db = makeMockDb([
      makeRow({ id: 'a', usb_port: '1-1' }),
      makeRow({ id: 'b', usb_port: '1-2' }),
    ]);

    const result = await disableStaleScannerRows(db as never, ['1-1', '1-2']);

    expect(result.disabled).toEqual([]);
    expect(db.graviScanner.update).not.toHaveBeenCalled();
  });

  it('ignores rows with a null usb_port', async () => {
    const db = makeMockDb([
      makeRow({ id: 'a', usb_port: null }),
      makeRow({ id: 'b', usb_port: '1-2' }),
    ]);

    const result = await disableStaleScannerRows(db as never, ['1-2']);

    expect(result.disabled).toEqual([]);
    expect(db._rows.find((r) => r.id === 'a')!.enabled).toBe(true);
  });

  it('does not touch rows that are already disabled', async () => {
    const db = makeMockDb([
      makeRow({ id: 'a', usb_port: '1-1' }),
      makeRow({ id: 'b', usb_port: '1-2', enabled: false }),
    ]);

    const result = await disableStaleScannerRows(db as never, ['1-1']);

    expect(result.disabled).toEqual([]);
    expect(db.graviScanner.update).not.toHaveBeenCalled();
  });

  it('handles an empty current-port set by disabling all enabled rows', async () => {
    const db = makeMockDb([
      makeRow({ id: 'a', usb_port: '1-1' }),
      makeRow({ id: 'b', usb_port: '1-2' }),
    ]);

    const result = await disableStaleScannerRows(db as never, []);

    expect(result.disabled.sort()).toEqual(['a', 'b']);
    expect(db._rows.every((r) => r.enabled === false)).toBe(true);
  });
});

describe('disableScannerById (#230 UI half / #234)', () => {
  it('sets enabled=false on the matching row', async () => {
    const db = makeMockDb([makeRow({ id: 'A' })]);
    const coord = makeMockCoordinator(['A']);

    const result = await disableScannerById(db as never, coord as never, 'A');

    expect(result.ok).toBe(true);
    expect(db._rows[0].enabled).toBe(false);
  });

  it('calls coordinator.stopScanner when a worker exists', async () => {
    const db = makeMockDb([makeRow({ id: 'A' })]);
    const coord = makeMockCoordinator(['A']);

    await disableScannerById(db as never, coord as never, 'A');

    expect(coord.stopScanner).toHaveBeenCalledWith('A');
  });

  it('skips coordinator.stopScanner when no worker exists', async () => {
    const db = makeMockDb([makeRow({ id: 'A' })]);
    const coord = makeMockCoordinator([]);

    await disableScannerById(db as never, coord as never, 'A');

    expect(coord.stopScanner).not.toHaveBeenCalled();
  });

  it('returns { ok: false, error } when the row does not exist', async () => {
    const db = makeMockDb([]);
    const coord = makeMockCoordinator([]);

    const result = await disableScannerById(
      db as never,
      coord as never,
      'unknown'
    );

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(
      /not found/i
    );
  });

  it('is idempotent — disabling an already-disabled scanner returns ok=true without re-updating', async () => {
    const db = makeMockDb([makeRow({ id: 'A', enabled: false })]);
    const coord = makeMockCoordinator([]);

    const result = await disableScannerById(db as never, coord as never, 'A');

    expect(result.ok).toBe(true);
    expect(db.graviScanner.update).not.toHaveBeenCalled();
    expect(coord.stopScanner).not.toHaveBeenCalled();
  });

  it('works with a null coordinator (graceful when uninitialized)', async () => {
    const db = makeMockDb([makeRow({ id: 'A' })]);

    const result = await disableScannerById(db as never, null, 'A');

    expect(result.ok).toBe(true);
    expect(db._rows[0].enabled).toBe(false);
  });
});

describe('stopWorkersForDisabledScanners (Copilot #20)', () => {
  it('stops the worker for a disabled scanner that has one running', async () => {
    const coordinator = makeMockCoordinator(['scanner-a']);
    await stopWorkersForDisabledScanners(coordinator as never, ['scanner-a']);
    expect(coordinator.stopScanner).toHaveBeenCalledTimes(1);
    expect(coordinator.stopScanner).toHaveBeenCalledWith('scanner-a');
  });

  it('does not call stopScanner for a disabled scanner with no running worker', async () => {
    const coordinator = makeMockCoordinator([]);
    await stopWorkersForDisabledScanners(coordinator as never, ['scanner-b']);
    expect(coordinator.stopScanner).not.toHaveBeenCalled();
  });

  it('stops only those scanners that have workers, skipping the rest', async () => {
    const coordinator = makeMockCoordinator(['scanner-a', 'scanner-c']);
    await stopWorkersForDisabledScanners(coordinator as never, [
      'scanner-a',
      'scanner-b',
      'scanner-c',
    ]);
    expect(coordinator.stopScanner).toHaveBeenCalledTimes(2);
    expect(coordinator.stopScanner).toHaveBeenCalledWith('scanner-a');
    expect(coordinator.stopScanner).toHaveBeenCalledWith('scanner-c');
    expect(coordinator.stopScanner).not.toHaveBeenCalledWith('scanner-b');
  });

  it('does not throw when stopScanner rejects — one stuck worker should not block the rest', async () => {
    const coordinator = makeMockCoordinator(['scanner-a', 'scanner-b']);
    coordinator.stopScanner.mockImplementation(async (id: string) => {
      if (id === 'scanner-a') throw new Error('worker stuck');
    });

    await expect(
      stopWorkersForDisabledScanners(coordinator as never, [
        'scanner-a',
        'scanner-b',
      ])
    ).resolves.not.toThrow();
    expect(coordinator.stopScanner).toHaveBeenCalledTimes(2);
  });

  it('handles an empty disabled list without any coordinator interaction', async () => {
    const coordinator = makeMockCoordinator(['scanner-a']);
    await stopWorkersForDisabledScanners(coordinator as never, []);
    expect(coordinator.stopScanner).not.toHaveBeenCalled();
    expect(coordinator.hasWorker).not.toHaveBeenCalled();
  });
});
