// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The main process opens and closes a GraviScan session's row, and runs the
 * end-of-session QR check, whether or not the scan page is open.
 */
import { describe, it, expect, vi } from 'vitest';

import { createSessionRecords } from '../../../src/main/graviscan/session-records';

function deps(overrides: Record<string, unknown> = {}) {
  return {
    createSession: vi
      .fn()
      .mockResolvedValue({ success: true, data: { id: 'sess-1' } }),
    completeSession: vi.fn().mockResolvedValue({ success: true }),
    verify: vi
      .fn()
      .mockResolvedValue({ success: true, results: [], swaps: [] }),
    reportError: vi.fn(),
    ...overrides,
  } as any;
}

const info = {
  experimentId: 'exp-1',
  phenotyperId: 'ph-1',
  scanMode: 'continuous' as const,
  intervalSeconds: 300,
  durationSeconds: 3600,
  totalCycles: 12,
};

function job(key: string, extra: Record<string, unknown> = {}) {
  const [scannerId, plateIndex] = key.split(':');
  return {
    scannerId,
    plateIndex,
    outputPath: '',
    plantBarcode: 'PLATE_1',
    transplantDate: null,
    customNote: null,
    gridMode: '2grid',
    status: 'recorded',
    imagePath: `/scans/${scannerId}_${plateIndex}.tif`,
    ...extra,
  };
}

function session(extra: Record<string, unknown> = {}) {
  return {
    experimentId: 'exp-1',
    phenotyperId: 'ph-1',
    waveNumber: 2,
    sessionId: 'sess-1',
    isTest: false,
    jobs: {
      's1:00': job('s1:00'),
      's1:01': job('s1:01', { plantBarcode: null }),
      's2:00': job('s2:00', { imagePath: undefined }),
    },
    ...extra,
  } as any;
}

describe('openSessionRecord', () => {
  it('creates the session row with the session settings and returns its id', async () => {
    const d = deps();
    const r = createSessionRecords(d);
    const result = await r.hooks.openSessionRecord!(info);
    expect(result).toEqual({ ok: true, sessionId: 'sess-1' });
    expect(d.createSession).toHaveBeenCalledWith({
      experiment_id: 'exp-1',
      phenotyper_id: 'ph-1',
      scan_mode: 'continuous',
      interval_seconds: 300,
      duration_seconds: 3600,
      total_cycles: 12,
    });
  });

  it('returns the reason when the row cannot be created', async () => {
    const r = createSessionRecords(
      deps({
        createSession: vi
          .fn()
          .mockResolvedValue({ success: false, error: 'disk full' }),
      })
    );
    expect(await r.hooks.openSessionRecord!(info)).toEqual({
      ok: false,
      error: 'disk full',
    });
  });

  it('returns the reason when creating the row throws, or gives no id', async () => {
    const throwing = createSessionRecords(
      deps({ createSession: vi.fn().mockRejectedValue(new Error('locked')) })
    );
    expect(await throwing.hooks.openSessionRecord!(info)).toEqual({
      ok: false,
      error: 'locked',
    });
    const noId = createSessionRecords(
      deps({ createSession: vi.fn().mockResolvedValue({ success: true }) })
    );
    expect((await noId.hooks.openSessionRecord!(info)).ok).toBe(false);
  });
});

describe('onSessionEnd', () => {
  it('marks a completed session complete and runs the QR check on recorded plates with a barcode and path', async () => {
    const d = deps();
    const r = createSessionRecords(d);
    await r.hooks.onSessionEnd!(session(), 'completed');

    expect(d.completeSession).toHaveBeenCalledWith({
      session_id: 'sess-1',
      cancelled: false,
    });
    expect(d.verify).toHaveBeenCalledWith(
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/s1_00.tif',
          assignedPlateId: 'PLATE_1',
        },
      ],
      'exp-1',
      2
    );
  });

  it.each(['cancelled', 'failed'] as const)(
    'marks a %s session cancelled and runs no QR check',
    async (outcome) => {
      const d = deps();
      const r = createSessionRecords(d);
      await r.hooks.onSessionEnd!(session(), outcome);
      expect(d.completeSession).toHaveBeenCalledWith({
        session_id: 'sess-1',
        cancelled: true,
      });
      expect(d.verify).not.toHaveBeenCalled();
      expect(r.getLastSession()).toMatchObject({
        sessionId: 'sess-1',
        outcome,
        verification: null,
      });
    }
  );

  it('does nothing for a test scan', async () => {
    const d = deps();
    const r = createSessionRecords(d);
    await r.hooks.onSessionEnd!(
      session({ isTest: true, sessionId: null }),
      'completed'
    );
    expect(d.completeSession).not.toHaveBeenCalled();
    expect(d.verify).not.toHaveBeenCalled();
    expect(r.getLastSession()).toBeNull();
  });

  it('skips the QR check when no plate has a barcode and a path', async () => {
    const d = deps();
    const r = createSessionRecords(d);
    await r.hooks.onSessionEnd!(
      session({ jobs: { 's1:00': job('s1:00', { plantBarcode: null }) } }),
      'completed'
    );
    expect(d.verify).not.toHaveBeenCalled();
    expect(r.getLastSession()).toMatchObject({
      outcome: 'completed',
      verification: null,
    });
  });

  it('keeps the last session and its QR result for the page', async () => {
    const result = {
      success: true,
      results: [{ scannerId: 's1', plateIndex: '00', status: 'verified' }],
      swaps: [],
    };
    const r = createSessionRecords(
      deps({ verify: vi.fn().mockResolvedValue(result) })
    );
    await r.hooks.onSessionEnd!(session(), 'completed');
    expect(r.getLastSession()).toEqual({
      sessionId: 'sess-1',
      experimentId: 'exp-1',
      waveNumber: 2,
      outcome: 'completed',
      verification: result,
    });
  });

  it('reports a failure to complete the row and still runs the QR check', async () => {
    const d = deps({
      completeSession: vi
        .fn()
        .mockResolvedValue({ success: false, error: 'locked' }),
    });
    const r = createSessionRecords(d);
    await r.hooks.onSessionEnd!(session(), 'completed');
    expect(d.reportError).toHaveBeenCalledWith(
      expect.stringContaining('locked')
    );
    expect(d.verify).toHaveBeenCalled();
  });

  it('waits for images still being recorded before the QR check', async () => {
    const order: string[] = [];
    const d = deps({
      waitForRecordings: vi.fn(async () => {
        order.push('wait');
      }),
      verify: vi.fn(async () => {
        order.push('verify');
        return { success: true, results: [], swaps: [] };
      }),
    });
    await createSessionRecords(d).hooks.onSessionEnd!(session(), 'completed');
    expect(order).toEqual(['wait', 'verify']);
  });

  it('reports a QR check that throws, without throwing itself', async () => {
    const d = deps({ verify: vi.fn().mockRejectedValue(new Error('boom')) });
    const r = createSessionRecords(d);
    await expect(
      r.hooks.onSessionEnd!(session(), 'completed')
    ).resolves.toBeUndefined();
    expect(d.reportError).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(r.getLastSession()?.verification).toBeNull();
  });
});
