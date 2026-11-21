// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A GraviScan session's database records are written by the main process
 * (record-graviscan-scans-in-main-process): the session row is opened
 * through a hook before scanning starts, and the session ends exactly once
 * (completed, cancelled or failed), whether or not the scan page is open.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/main/graviscan/scan-logger', () => ({
  scanLog: vi.fn(),
}));

import {
  startScan,
  cancelScan,
  getScanStatus,
} from '../../../src/main/graviscan/session-handlers';
import {
  advanceSessionCycle,
  type StartScanHooks,
} from '../../../src/main/graviscan/session-lifecycle';

function sessionStore() {
  let session: any = null;
  return {
    getScanSession: vi.fn(() => session),
    setScanSession: vi.fn((s: any) => {
      session = s;
    }),
    markScanJobRecorded: vi.fn(),
  };
}

function coordinator(scan: () => Promise<void> = () => Promise.resolve()) {
  return {
    isScanning: false,
    initialize: vi.fn().mockResolvedValue(undefined),
    startNewSession: vi.fn(),
    scanOnce: vi.fn(scan),
    scanInterval: vi.fn(scan),
    cancelAll: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnThis(),
    hasWorker: vi.fn().mockReturnValue(true),
    addScanner: vi.fn(),
    stopScanner: vi.fn(),
    getScannerStatuses: vi.fn(() => []),
  } as any;
}

const plate = {
  plate_index: '00',
  grid_mode: '2grid' as const,
  resolution: 600,
  output_dir: '/scans/Exp_wave1_20260809T190946',
  exp_name: 'Exp',
  wave_number: 1,
  st_timestamp: '20260809T190946',
  cycle: 1,
  system_prefix: '',
  scanner_tag: 'Sc1',
  plate_barcode: 'PLATE_002',
  transplant_date: '2026-08-01',
  custom_note: 'low germination',
};

const sessionParams = {
  scanners: [{ scannerId: 's1', saneName: 'mock', plates: [plate] }],
  metadata: {
    experimentId: 'exp-1',
    phenotyperId: 'ph-1',
    resolution: 600,
    waveNumber: 1,
  },
};

function hooks(
  open: StartScanHooks['openSessionRecord'] = vi
    .fn()
    .mockResolvedValue({ ok: true, sessionId: 'sess-1' })
): StartScanHooks & { onSessionEnd: ReturnType<typeof vi.fn> } {
  return { openSessionRecord: open, onSessionEnd: vi.fn() };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('startScan with session hooks', () => {
  let fns: ReturnType<typeof sessionStore>;
  beforeEach(() => {
    fns = sessionStore();
  });

  it('opens the session row after the scanners are up and before scanning, and keeps its id', async () => {
    const order: string[] = [];
    const c = coordinator(async () => {
      order.push('scan');
    });
    c.initialize.mockImplementation(async () => {
      order.push('initialize');
    });
    const open = vi.fn(async (info: any) => {
      order.push('open');
      expect(info).toEqual({
        experimentId: 'exp-1',
        phenotyperId: 'ph-1',
        scanMode: 'single',
        intervalSeconds: null,
        durationSeconds: null,
        totalCycles: 1,
      });
      return { ok: true as const, sessionId: 'sess-1' };
    });
    const h = hooks(open);

    const result = await startScan(c, sessionParams, fns, vi.fn(), h);

    expect(result).toEqual({ success: true, sessionId: 'sess-1' });
    expect(order).toEqual(['initialize', 'open', 'scan']);
  });

  it("keeps each plate's barcode, transplant date and note on its job", async () => {
    const c = coordinator(() => new Promise(() => {}));
    await startScan(c, sessionParams, fns, vi.fn(), hooks());
    expect(fns.getScanSession().jobs['s1:00']).toMatchObject({
      plantBarcode: 'PLATE_002',
      transplantDate: '2026-08-01',
      customNote: 'low germination',
    });
    expect(fns.getScanSession().sessionId).toBe('sess-1');
    expect(fns.getScanSession().isTest).toBe(false);
  });

  it("doesn't scan, and says so, when the session row can't be saved", async () => {
    const c = coordinator();
    const h = hooks(
      vi.fn().mockResolvedValue({ ok: false, error: 'disk full' })
    );

    const result = await startScan(c, sessionParams, fns, vi.fn(), h);

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "The scan didn't start: the session couldn't be saved to the database (disk full). Nothing was scanned. Try again; if it keeps happening, restart the app."
    );
    expect(c.scanOnce).not.toHaveBeenCalled();
    expect(fns.getScanSession()).toBeNull();
    expect(h.onSessionEnd).not.toHaveBeenCalled();
  });

  it('opens no session row for a test scan, and marks the session as a test', async () => {
    const c = coordinator(() => new Promise(() => {}));
    const h = hooks();
    await startScan(
      c,
      { test: true, scanners: sessionParams.scanners },
      fns,
      vi.fn(),
      h
    );
    expect(h.openSessionRecord).not.toHaveBeenCalled();
    expect(fns.getScanSession().isTest).toBe(true);
  });

  it('closes the session row as failed when starting the scan throws after the row was opened', async () => {
    const c = coordinator();
    c.startNewSession.mockImplementation(() => {
      throw new Error('coordinator not ready');
    });
    const h = hooks();

    const result = await startScan(c, sessionParams, fns, vi.fn(), h);

    expect(result).toEqual({ success: false, error: 'coordinator not ready' });
    expect(h.onSessionEnd).toHaveBeenCalledTimes(1);
    expect(h.onSessionEnd.mock.calls[0][0].sessionId).toBe('sess-1');
    expect(h.onSessionEnd.mock.calls[0][1]).toBe('failed');
    expect(fns.getScanSession()).toBeNull();
  });

  it('ends the session once as completed when the scan finishes', async () => {
    const h = hooks();
    await startScan(coordinator(), sessionParams, fns, vi.fn(), h);
    await flush();
    expect(h.onSessionEnd).toHaveBeenCalledTimes(1);
    expect(h.onSessionEnd.mock.calls[0][1]).toBe('completed');
    expect(h.onSessionEnd.mock.calls[0][0].sessionId).toBe('sess-1');
    expect(fns.getScanSession()).toBeNull();
  });

  it('ends the session once as failed when the scan fails, and reports the error', async () => {
    const onError = vi.fn();
    const h = hooks();
    await startScan(
      coordinator(() => Promise.reject(new Error('worker died'))),
      sessionParams,
      fns,
      onError,
      h
    );
    await flush();
    expect(h.onSessionEnd).toHaveBeenCalledTimes(1);
    expect(h.onSessionEnd.mock.calls[0][1]).toBe('failed');
    expect(onError).toHaveBeenCalledWith('worker died');
  });

  it('ends the session once as cancelled, even when the scan then finishes', async () => {
    let finish!: () => void;
    const c = coordinator(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const h = hooks();
    await startScan(c, sessionParams, fns, vi.fn(), h);

    await cancelScan(c, fns, h);
    finish();
    await flush();

    expect(h.onSessionEnd).toHaveBeenCalledTimes(1);
    expect(h.onSessionEnd.mock.calls[0][1]).toBe('cancelled');
    expect(fns.getScanSession()).toBeNull();
  });
});

describe('getScanStatus after a session', () => {
  const last = {
    sessionId: 'sess-1',
    experimentId: 'exp-1',
    waveNumber: 1,
    outcome: 'completed' as const,
    verification: null,
  };

  it('includes the last session while no session is active', () => {
    expect(getScanStatus(sessionStore(), last)).toEqual({
      isActive: false,
      lastSession: last,
    });
  });

  it('leaves it out while a session is running', () => {
    const fns = sessionStore();
    fns.setScanSession({ isActive: true, jobs: {} });
    expect(getScanStatus(fns, last).lastSession).toBeUndefined();
  });
});

describe('advanceSessionCycle (#314)', () => {
  const sessionAt = (currentCycle: number) =>
    ({
      currentCycle,
      jobs: {
        's1:00': { status: 'recorded' },
        's1:01': { status: 'error', error: 'x' },
      },
    }) as any;

  it('puts every job back to pending for the next cycle', () => {
    const s = sessionAt(1);
    advanceSessionCycle(s, 2);
    expect(s.currentCycle).toBe(2);
    expect(s.jobs['s1:00'].status).toBe('pending');
    expect(s.jobs['s1:01']).toEqual({ status: 'pending' });
  });

  it('ignores the same or an earlier cycle, and a missing one', () => {
    const s = sessionAt(2);
    advanceSessionCycle(s, 2);
    advanceSessionCycle(s, 1);
    advanceSessionCycle(s, undefined);
    advanceSessionCycle(null, 3);
    expect(s.currentCycle).toBe(2);
    expect(s.jobs['s1:00'].status).toBe('recorded');
  });
});
