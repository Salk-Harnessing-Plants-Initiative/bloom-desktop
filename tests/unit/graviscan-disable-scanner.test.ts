// @vitest-environment node
/**
 * Task 9 (#230 UI half): graviscan:disable-scanner IPC handler.
 *
 * Backs the per-row Remove button on the Configure Scanner page.
 * Sets enabled=false on the matching GraviScanner row and asks the
 * coordinator to stop the worker (if any).
 */

import { describe, it, expect, vi } from 'vitest';
import { disableScannerById } from '../../src/main/scanner-upsert';

interface MockGraviScanner {
  id: string;
  enabled: boolean;
}

function makeMockDb(rows: MockGraviScanner[]) {
  const data = [...rows];
  return {
    graviScanner: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          data.find((r) => r.id === where.id) ?? null,
      ),
      update: vi.fn(
        async ({
          where,
          data: patch,
        }: {
          where: { id: string };
          data: Partial<MockGraviScanner>;
        }) => {
          const row = data.find((r) => r.id === where.id);
          if (!row) throw new Error(`row not found: ${where.id}`);
          Object.assign(row, patch);
          return { ...row };
        },
      ),
    },
    _rows: data,
  };
}

function makeMockCoordinator(hasWorker = true) {
  return {
    hasWorker: vi.fn(() => hasWorker),
    stopScanner: vi.fn(async () => undefined),
  };
}

describe('disableScannerById (#230)', () => {
  it('sets enabled=false on the matching row', async () => {
    const db = makeMockDb([{ id: 'A', enabled: true }]);
    const coord = makeMockCoordinator(true);

    const result = await disableScannerById(db as never, coord as never, 'A');

    expect(result.ok).toBe(true);
    expect(db._rows[0].enabled).toBe(false);
  });

  it('calls coordinator.stopScanner when a worker exists', async () => {
    const db = makeMockDb([{ id: 'A', enabled: true }]);
    const coord = makeMockCoordinator(true);

    await disableScannerById(db as never, coord as never, 'A');

    expect(coord.stopScanner).toHaveBeenCalledWith('A');
  });

  it('skips coordinator.stopScanner when no worker exists', async () => {
    const db = makeMockDb([{ id: 'A', enabled: true }]);
    const coord = makeMockCoordinator(false);

    await disableScannerById(db as never, coord as never, 'A');

    expect(coord.stopScanner).not.toHaveBeenCalled();
  });

  it('returns { ok: false, error } when the row does not exist', async () => {
    const db = makeMockDb([]);
    const coord = makeMockCoordinator(false);

    const result = await disableScannerById(
      db as never,
      coord as never,
      'unknown',
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('is idempotent — disabling an already-disabled scanner returns ok=true', async () => {
    const db = makeMockDb([{ id: 'A', enabled: false }]);
    const coord = makeMockCoordinator(false);

    const result = await disableScannerById(db as never, coord as never, 'A');

    expect(result.ok).toBe(true);
    expect(db._rows[0].enabled).toBe(false);
    expect(coord.stopScanner).not.toHaveBeenCalled();
  });

  it('works with a null coordinator (graceful when uninitialized)', async () => {
    const db = makeMockDb([{ id: 'A', enabled: true }]);

    const result = await disableScannerById(db as never, null, 'A');

    expect(result.ok).toBe(true);
    expect(db._rows[0].enabled).toBe(false);
  });
});
