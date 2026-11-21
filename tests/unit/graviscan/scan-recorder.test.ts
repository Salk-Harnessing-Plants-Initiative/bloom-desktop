// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The main process records every finished GraviScan image: one GraviScan
 * row and one GraviImage row, whether or not the scan page is open.
 */
import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';

import { createScanRecorder } from '../../../src/main/graviscan/scan-recorder';

const DIR = path.join('/scans', 'Exp_wave2_20260809T190946');
const fileFor = (cycle: number, st = '20260809T190946') =>
  path.join(DIR, `Exp_wave2_st_${st}_et_20260809T191500_cy${cycle}_Sc1_00.tif`);

function session(extra: Record<string, unknown> = {}) {
  return {
    experimentId: 'exp-1',
    phenotyperId: 'ph-1',
    resolution: 600,
    waveNumber: 2,
    sessionId: 'sess-1',
    isTest: false,
    currentCycle: 3,
    jobs: {
      's1:00': {
        scannerId: 's1',
        plateIndex: '00',
        outputPath: path.join(DIR, 'planned.tif'),
        plantBarcode: 'PLATE_1',
        transplantDate: '2026-08-01',
        customNote: 'note',
        gridMode: '2grid',
        status: 'pending',
      },
    },
    ...extra,
  } as any;
}

function deps(s: any = session(), overrides: Record<string, unknown> = {}) {
  return {
    getSession: () => s,
    createScan: vi
      .fn()
      .mockResolvedValue({ success: true, data: { id: 'scan-1' } }),
    findImage: vi.fn().mockResolvedValue(null),
    createImage: vi.fn().mockResolvedValue({ id: 'img-1' }),
    reportError: vi.fn(),
    updateRowTimes: vi.fn().mockResolvedValue({ count: 2 }),
    logProblem: vi.fn(),
    now: () => new Date('2026-08-09T19:15:01Z'),
    ...overrides,
  } as any;
}

const event = (extra: Record<string, unknown> = {}) => ({
  scanner_id: 's1',
  plate_index: '00',
  path: fileFor(3),
  achieved_resolution: 599,
  scan_started_at: '2026-08-09T19:10:00Z',
  cycle_number: 4,
  ...extra,
});

describe('scan recorder', () => {
  it('creates the GraviScan row with every field, and its GraviImage row', async () => {
    const d = deps();
    const r = createScanRecorder(d);
    await r.record(event());

    expect(d.createScan).toHaveBeenCalledWith({
      experiment_id: 'exp-1',
      phenotyper_id: 'ph-1',
      scanner_id: 's1',
      plate_index: '00',
      wave_number: 2,
      session_id: 'sess-1',
      cycle_number: 3,
      plate_barcode: 'PLATE_1',
      transplant_date: '2026-08-01',
      custom_note: 'note',
      path: fileFor(3),
      grid_mode: '2grid',
      resolution: 599,
      format: 'tiff',
      capture_date: new Date('2026-08-09T19:15:01Z'),
      // The row's own start, from the file's `_st_`, not the event's.
      scan_started_at: '2026-08-09T19:09:46.000Z',
    });
    expect(d.createImage).toHaveBeenCalledWith({
      graviscan_id: 'scan-1',
      path: fileFor(3),
      status: 'pending',
      box_status: 'pending',
    });
    const job = d.getSession().jobs['s1:00'];
    expect(job.status).toBe('recorded');
    expect(job.imagePath).toBe(fileFor(3));
  });

  it("uses the file's own cycle, not the coordinator's current one (#503)", async () => {
    const d = deps();
    const r = createScanRecorder(d);
    await r.record(event({ path: fileFor(3), cycle_number: 4 }));
    await r.record(event({ path: fileFor(4), cycle_number: 4 }));
    expect(
      d.createScan.mock.calls.map((c: any[]) => c[0].cycle_number)
    ).toEqual([3, 4]);
  });

  it("records a late image from an earlier cycle without marking this cycle's job done", async () => {
    const d = deps(session({ currentCycle: 4 }));
    await createScanRecorder(d).record(event({ path: fileFor(3) }));
    expect(d.createScan.mock.calls[0][0].cycle_number).toBe(3);
    expect(d.getSession().jobs['s1:00'].status).toBe('pending');
  });

  it('falls back to the requested resolution when the event lacks it', async () => {
    const d = deps();
    await createScanRecorder(d).record(
      event({ achieved_resolution: undefined })
    );
    expect(d.createScan.mock.calls[0][0].resolution).toBe(600);
  });

  it('creates no second image for a repeated event', async () => {
    const d = deps();
    d.findImage.mockResolvedValueOnce(null).mockResolvedValue({ id: 'img-1' });
    const r = createScanRecorder(d);
    await r.record(event());
    await r.record(event());
    expect(d.createImage).toHaveBeenCalledTimes(1);
    expect(d.findImage).toHaveBeenLastCalledWith('scan-1', fileFor(3));
  });

  it('records repeated events one at a time, so they cannot race', async () => {
    const d = deps();
    const images = new Set<string>();
    d.findImage.mockImplementation(async (id: string, p: string) =>
      images.has(`${id}|${p}`) ? { id: 'img' } : null
    );
    d.createImage.mockImplementation(async (data: any) => {
      await new Promise((r) => setTimeout(r, 5));
      images.add(`${data.graviscan_id}|${data.path}`);
      return { id: 'img' };
    });
    const r = createScanRecorder(d);
    r.record(event());
    r.record(event());
    await r.idle();
    expect(d.createImage).toHaveBeenCalledTimes(1);
  });

  it('records a late image from the previous session under that session, while a new one runs', async () => {
    const previous = session();
    const current = session({
      sessionId: 'sess-2',
      jobs: {
        's1:00': {
          ...previous.jobs['s1:00'],
          outputPath: path.join('/scans', 'Exp_wave3_20260810T090000', 'p.tif'),
        },
      },
    });
    const d = deps(current, { getPreviousSession: () => previous });
    await createScanRecorder(d).record(event());
    expect(d.createScan.mock.calls[0][0]).toMatchObject({
      session_id: 'sess-1',
      wave_number: 2,
      path: fileFor(3),
    });
    expect(current.jobs['s1:00'].imagePath).toBeUndefined();
  });

  it('logs an image that belongs to neither the current nor the previous session, and records nothing', async () => {
    const d = deps(session(), { getPreviousSession: () => null });
    const stray = path.join('/scans', 'Old_wave1_20260801T080000', 'x_cy1.tif');
    await createScanRecorder(d).record(event({ path: stray }));
    expect(d.createScan).not.toHaveBeenCalled();
    expect(d.logProblem).toHaveBeenCalledWith(expect.stringContaining(stray));
    expect(d.reportError).not.toHaveBeenCalled();
  });

  it('ignores events when there is no session', async () => {
    const d = deps(null);
    await createScanRecorder(d).record(event());
    expect(d.createScan).not.toHaveBeenCalled();
  });

  it("keeps a test scan's real path on its job but records nothing", async () => {
    const d = deps(session({ isTest: true, sessionId: null }));
    await createScanRecorder(d).record(event());
    expect(d.createScan).not.toHaveBeenCalled();
    expect(d.getSession().jobs['s1:00'].imagePath).toBe(fileFor(3));
  });

  it('reports a file whose name has no cycle, rather than guessing one', async () => {
    const d = deps();
    const bad = path.join(DIR, 'not-a-scan-name.tif');
    await createScanRecorder(d).record(event({ path: bad }));
    expect(d.createScan).not.toHaveBeenCalled();
    expect(d.reportError).toHaveBeenCalledWith(
      's1',
      '00',
      expect.stringContaining('not-a-scan-name.tif was saved on disk')
    );
  });

  it.each([
    ['no job', { plate_index: '01' }],
    ['an inherited key', { scanner_id: '__proto__', plate_index: '' }],
    ['no path', { path: undefined }],
  ])('ignores an event for %s', async (_label, extra) => {
    const d = deps();
    await createScanRecorder(d).record(event(extra));
    expect(d.createScan).not.toHaveBeenCalled();
    expect(d.reportError).not.toHaveBeenCalled();
  });

  it('reports a failed GraviScan save for that plate, and creates no image (#479)', async () => {
    const d = deps(session(), {
      createScan: vi
        .fn()
        .mockResolvedValue({ success: false, error: 'database is locked' }),
    });
    await createScanRecorder(d).record(event());
    expect(d.createImage).not.toHaveBeenCalled();
    expect(d.reportError).toHaveBeenCalledWith(
      's1',
      '00',
      expect.stringContaining('database is locked')
    );
    expect(d.reportError.mock.calls[0][2]).toContain(
      'saved on disk but not recorded in the database'
    );
    expect(d.getSession().jobs['s1:00'].status).toBe('error');
  });

  it('reports a failed image save, and keeps going for the next event', async () => {
    const d = deps(session(), {
      createImage: vi
        .fn()
        .mockRejectedValueOnce(new Error('disk I/O error'))
        .mockResolvedValue({ id: 'img-2' }),
    });
    const r = createScanRecorder(d);
    await r.record(event());
    await r.record(event({ path: fileFor(4) }));
    expect(d.reportError).toHaveBeenCalledTimes(1);
    expect(d.reportError.mock.calls[0][2]).toContain('disk I/O error');
    expect(d.createImage).toHaveBeenCalledTimes(2);
  });

  it("gives a late image its own row's start time, not the current row's (#503)", async () => {
    const d = deps(session({ currentCycle: 4 }));
    await createScanRecorder(d).record(
      event({
        path: fileFor(3, '20260809T180000'),
        scan_started_at: '2026-08-09T19:30:00Z',
      })
    );
    expect(d.createScan.mock.calls[0][0].scan_started_at).toBe(
      '2026-08-09T18:00:00.000Z'
    );
  });
});

describe('row times (grid-complete)', () => {
  const gridComplete = {
    cycle: 3,
    gridIndex: '00',
    scanStartedAt: '2026-08-09T19:09:46.000Z',
    scanEndedAt: '2026-08-09T19:11:20.000Z',
  };

  it("writes the row's shared start and end times onto every scan of that row, after the row's images are saved", async () => {
    const d = deps();
    const order: string[] = [];
    d.createScan.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push('scan');
      return { success: true, data: { id: 'scan-1' } };
    });
    d.updateRowTimes.mockImplementation(async () => {
      order.push('times');
      return { count: 2 };
    });
    const r = createScanRecorder(d);
    void r.record(event());
    await r.recordRowTimes(gridComplete);

    expect(order).toEqual(['scan', 'times']);
    expect(d.updateRowTimes).toHaveBeenCalledWith({
      session_id: 'sess-1',
      plate_index: '00',
      cycle_number: 3,
      scan_started_at: '2026-08-09T19:09:46.000Z',
      scan_ended_at: '2026-08-09T19:11:20.000Z',
    });
  });

  it('writes nothing for a test scan, no session, or a malformed event', async () => {
    for (const s of [null, session({ isTest: true, sessionId: null })]) {
      const d = deps(s);
      await createScanRecorder(d).recordRowTimes(gridComplete);
      expect(d.updateRowTimes).not.toHaveBeenCalled();
    }
    const d = deps();
    await createScanRecorder(d).recordRowTimes({
      ...gridComplete,
      scanEndedAt: 'not a time',
    });
    await createScanRecorder(d).recordRowTimes({
      ...gridComplete,
      cycle: undefined,
    });
    expect(d.updateRowTimes).not.toHaveBeenCalled();
  });

  it('logs a failed update and keeps recording', async () => {
    const d = deps();
    d.updateRowTimes.mockRejectedValue(new Error('locked'));
    const r = createScanRecorder(d);
    await r.recordRowTimes(gridComplete);
    await r.record(event());
    expect(d.logProblem).toHaveBeenCalledWith(
      expect.stringContaining('locked')
    );
    expect(d.createScan).toHaveBeenCalled();
    expect(d.reportError).not.toHaveBeenCalled();
  });
});
