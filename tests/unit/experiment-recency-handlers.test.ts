/**
 * Unit tests: each experiment's newest scan time, for the Experiments page's order.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  listExperimentLatestScans,
  registerExperimentRecencyHandlers,
} from '../../src/main/experiment-recency-handlers';

describe('listExperimentLatestScans', () => {
  it('returns each experiment with its newest scan time as a number', async () => {
    const db = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([
        { experiment_id: 'stl', latest_ms: BigInt(1_763_600_000_000) },
        { experiment_id: 'kcs', latest_ms: 1_760_000_000_000 },
        { experiment_id: 'odd', latest_ms: null },
      ]),
    };
    expect(await listExperimentLatestScans({ db })).toEqual({
      success: true,
      data: [
        { experiment_id: 'stl', latest_ms: 1_763_600_000_000 },
        { experiment_id: 'kcs', latest_ms: 1_760_000_000_000 },
      ],
    });
    expect(db.$queryRawUnsafe.mock.calls[0][0]).toMatch(/"deleted" = 0/);
  });

  it('reports a database error', async () => {
    const db = {
      $queryRawUnsafe: vi
        .fn()
        .mockRejectedValue(new Error('database is locked')),
    };
    expect(await listExperimentLatestScans({ db })).toEqual({
      success: false,
      error: 'database is locked',
    });
  });

  it('registers db:experiments:latestScans', async () => {
    const db = { $queryRawUnsafe: vi.fn().mockResolvedValue([]) };
    const handlers = new Map<string, () => unknown>();
    registerExperimentRecencyHandlers({
      db,
      ipcMain: {
        handle: (channel: string, fn: () => unknown) => {
          handlers.set(channel, fn);
        },
      } as never,
    });
    expect(await handlers.get('db:experiments:latestScans')!()).toEqual({
      success: true,
      data: [],
    });
  });
});
