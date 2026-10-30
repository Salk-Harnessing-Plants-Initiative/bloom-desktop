/**
 * Browse Scans' "Upload all" (#449): which scans count as waiting, the order and
 * progress of a run, stopping, and failures.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  MAX_ERROR_LENGTH,
  MAX_LISTED_ERRORS,
  UPLOAD_ALL_DONE_CHANNEL,
  UPLOAD_ALL_PROGRESS_CHANNEL,
  WAITING_STATUSES,
  readableUploadError,
  registerScanUploadAllHandlers,
  type ScanUploadDbLike,
  type UploaderLike,
} from '../../src/main/scan-upload-all-handlers';
import { scanListWhere } from '../../src/main/scan-filters';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function setup(
  scans: { id: string; plant_id: string }[],
  uploadScan: UploaderLike['uploadScan'] = async () => ({
    success: true,
    failed: 0,
    errors: [],
  }),
  authenticate: UploaderLike['authenticate'] = async () => undefined
) {
  const handlers: Record<string, Handler> = {};
  const findMany = vi.fn(async () => scans);
  const count = vi.fn(async () => scans.length);
  const send = vi.fn();
  const uploader = {
    authenticate: vi.fn(authenticate),
    uploadScan: vi.fn(uploadScan),
  };
  const createUploader = vi.fn(() => uploader);
  registerScanUploadAllHandlers({
    ipcMain: {
      handle: (channel: string, fn: Handler) => (handlers[channel] = fn),
    } as never,
    db: { scan: { findMany, count } } as unknown as ScanUploadDbLike,
    createUploader,
    getMainWindow: () =>
      ({ isDestroyed: () => false, webContents: { send } }) as never,
  });
  const call = (channel: string, ...args: unknown[]) =>
    handlers[channel]({}, ...args) as Promise<{
      success: boolean;
      data?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
      error?: string;
    }>;
  /** Start a run and wait for it to end; returns how it ended. */
  const runToEnd = async (filters: unknown = {}) => {
    const sentBefore = send.mock.calls.length;
    const started = await call('db:scans:uploadAll', filters);
    if (!started.success) return { started };
    await vi.waitFor(() =>
      expect(
        send.mock.calls
          .slice(sentBefore)
          .some((c) => c[0] === UPLOAD_ALL_DONE_CHANNEL)
      ).toBe(true)
    );
    const done = send.mock.calls
      .slice(sentBefore)
      .filter((c) => c[0] === UPLOAD_ALL_DONE_CHANNEL)
      .at(-1)![1];
    const progress = send.mock.calls
      .slice(sentBefore)
      .filter((c) => c[0] === UPLOAD_ALL_PROGRESS_CHANNEL)
      .map((c) => c[1]);
    return { started, done, progress };
  };
  return { call, runToEnd, findMany, count, send, uploader, createUploader };
}

const scans = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `s${i + 1}`,
    plant_id: `P${i + 1}`,
  }));

describe('Upload all: which scans', () => {
  it("counts scans not deleted, within the filters, with frames 'pending' or 'failed'", async () => {
    const { call, count, findMany } = setup(scans(3));
    const response = await call('db:scans:pendingUploads', {
      experimentId: 'exp-1',
      dateFrom: '2026-10-01',
    });

    expect(response).toEqual({ success: true, data: { count: 3 } });
    // Counted in the database, without loading the rows.
    expect(findMany).not.toHaveBeenCalled();
    const { where } = count.mock.calls[0][0];
    expect(where).toMatchObject({
      deleted: false,
      experiment_id: 'exp-1',
      images: { some: { status: { in: ['pending', 'failed'] } } },
    });
    expect(where.capture_date.gte).toEqual(new Date('2026-10-01T00:00:00'));
  });

  it('uploads the same scans it counts, oldest first', async () => {
    const { runToEnd, findMany } = setup(scans(1));
    await runToEnd({ experimentId: 'exp-1' });

    const args = findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      deleted: false,
      experiment_id: 'exp-1',
      images: { some: { status: { in: ['pending', 'failed'] } } },
    });
    expect(args.orderBy).toEqual({ capture_date: 'asc' });
  });

  it("never counts the pilot's UPLOADED or CAPTURED frames as waiting (#448)", () => {
    expect(WAITING_STATUSES).not.toContain('UPLOADED');
    expect(WAITING_STATUSES).not.toContain('CAPTURED');
    expect(WAITING_STATUSES).not.toContain('uploaded');
  });

  it('refuses a malformed date', async () => {
    const { call } = setup(scans(1));
    expect(
      await call('db:scans:pendingUploads', { dateTo: '10/30/2026' })
    ).toMatchObject({
      success: false,
      error: expect.stringContaining('Invalid dateTo'),
    });
  });
});

describe('Upload all: a run', () => {
  it('starts at once, uploads each scan in order with one login, and reports progress after each', async () => {
    const { runToEnd, uploader, createUploader } = setup(scans(3));

    const { started, done, progress } = await runToEnd();

    expect(started).toEqual({ success: true, data: { total: 3 } });
    expect(done).toEqual({
      result: {
        total: 3,
        uploadedScans: 3,
        failedScans: 0,
        stopped: false,
        errors: [],
      },
    });
    expect(createUploader).toHaveBeenCalledTimes(1);
    expect(uploader.authenticate).toHaveBeenCalledTimes(1);
    expect(uploader.uploadScan.mock.calls.map((c) => c[0])).toEqual([
      's1',
      's2',
      's3',
    ]);
    expect(progress.map((p) => p.done)).toEqual([1, 2, 3]);
    expect(progress.at(-1)).toEqual({
      done: 3,
      total: 3,
      uploadedScans: 3,
      failedScans: 0,
    });
  });

  it("doesn't log in when no scan is waiting", async () => {
    const { runToEnd, createUploader } = setup([]);
    expect((await runToEnd()).done.result).toMatchObject({ total: 0 });
    expect(createUploader).not.toHaveBeenCalled();
  });

  it('counts a scan as failed when only some of its frames fail, and when it is refused', async () => {
    const { runToEnd } = setup(scans(3), async (id) =>
      id === 's1'
        ? { success: true, failed: 2, errors: ['2 frames failed'] }
        : id === 's2'
          ? {
              success: false,
              failed: 0,
              errors: ['Scan s2 is deleted; upload refused'],
            }
          : { success: true, failed: 0, errors: [] }
    );

    const { done, progress } = await runToEnd();

    expect(done.result).toMatchObject({ uploadedScans: 1, failedScans: 2 });
    expect(done.result.errors).toEqual([
      'P1: 2 frames failed',
      'P2: Scan s2 is deleted; upload refused',
    ]);
    expect(progress.map((p) => [p.uploadedScans, p.failedScans])).toEqual([
      [0, 1],
      [0, 2],
      [1, 2],
    ]);
  });

  it('carries on past a scan that throws, and lists only the first few failures', async () => {
    const { runToEnd } = setup(scans(MAX_LISTED_ERRORS + 2), async (id) => {
      if (id === 's2') throw new Error('Network down');
      return id === 's1'
        ? { success: true, failed: 0, errors: [] }
        : { success: false, failed: 3, errors: ['3 frames failed'] };
    });

    const { done } = await runToEnd();

    expect(done.result.uploadedScans).toBe(1);
    expect(done.result.failedScans).toBe(MAX_LISTED_ERRORS + 1);
    expect(done.result.errors).toHaveLength(MAX_LISTED_ERRORS);
    expect(done.result.errors[0]).toBe('P2: Network down');
  });

  it('stops after the scan in progress when asked, and the next run starts clean', async () => {
    const ref: { call?: ReturnType<typeof setup>['call'] } = {};
    let stopAt: string | null = 's2';
    const { call, runToEnd } = setup(scans(5), async (id) => {
      if (id === stopAt) await ref.call?.('db:scans:stopUploadAll');
      return { success: true, failed: 0, errors: [] };
    });
    ref.call = call;

    expect((await runToEnd()).done.result).toMatchObject({
      total: 5,
      uploadedScans: 2,
      stopped: true,
    });
    stopAt = null;
    expect((await runToEnd()).done.result).toMatchObject({
      uploadedScans: 5,
      stopped: false,
    });
  });

  it('refuses a second run while one is going, and allows one after', async () => {
    let release: (() => void) | null = null;
    let calls = 0;
    const { call, runToEnd } = setup(scans(1), () => {
      calls += 1;
      if (calls > 1)
        return Promise.resolve({ success: true, failed: 0, errors: [] });
      return new Promise((resolve) => {
        release = () => resolve({ success: true, failed: 0, errors: [] });
      });
    });

    const first = runToEnd();
    await vi.waitFor(() => expect(release).not.toBeNull());
    expect(await call('db:scans:uploadAll', {})).toEqual({
      success: false,
      error: 'An upload is already running.',
    });
    release!();
    await first;
    expect((await runToEnd()).done.result).toMatchObject({ uploadedScans: 1 });
  });

  it('reports a login failure without uploading anything, and can be tried again', async () => {
    let failLogin = true;
    const { runToEnd, uploader } = setup(scans(2), undefined, async () => {
      if (failLogin)
        throw new Error('Bloom credentials are not set up on this computer');
    });

    expect((await runToEnd()).done).toEqual({
      error: 'Bloom credentials are not set up on this computer',
    });
    expect(uploader.uploadScan).not.toHaveBeenCalled();
    failLogin = false;
    expect((await runToEnd()).done.result).toMatchObject({ uploadedScans: 2 });
  });

  it('refuses a malformed date before starting', async () => {
    const { call, createUploader } = setup(scans(1));
    expect(
      await call('db:scans:uploadAll', { dateFrom: 'x2026-10-30x' })
    ).toMatchObject({
      success: false,
      error: expect.stringContaining('Invalid dateFrom'),
    });
    expect(createUploader).not.toHaveBeenCalled();
  });
});

describe('Upload all: remembered state', () => {
  it('says a run is going, with its progress, so a reopened page can show it', async () => {
    let release: (() => void) | null = null;
    const { call, runToEnd } = setup(scans(2), (id) =>
      id === 's2'
        ? new Promise((resolve) => {
            release = () => resolve({ success: true, failed: 0, errors: [] });
          })
        : Promise.resolve({ success: true, failed: 0, errors: [] })
    );

    const run = runToEnd();
    await vi.waitFor(() => expect(release).not.toBeNull());
    expect((await call('db:scans:uploadAllStatus')).data).toEqual({
      running: true,
      progress: { done: 1, total: 2, uploadedScans: 1, failedScans: 0 },
      last: null,
    });
    release!();
    await run;
  });

  it('keeps how the last run ended until it is dismissed', async () => {
    const { call, runToEnd } = setup(scans(1));
    await runToEnd();

    expect((await call('db:scans:uploadAllStatus')).data).toEqual({
      running: false,
      progress: null,
      last: {
        result: {
          total: 1,
          uploadedScans: 1,
          failedScans: 0,
          stopped: false,
          errors: [],
        },
      },
    });
    await call('db:scans:dismissUploadAllResult');
    expect((await call('db:scans:uploadAllStatus')).data.last).toBeNull();
  });

  it("doesn't send to a closed window", async () => {
    const handlers: Record<string, Handler> = {};
    const send = vi.fn();
    registerScanUploadAllHandlers({
      ipcMain: {
        handle: (c: string, fn: Handler) => (handlers[c] = fn),
      } as never,
      db: {
        scan: { findMany: async () => scans(1) },
      } as unknown as ScanUploadDbLike,
      createUploader: () => ({
        authenticate: async () => undefined,
        uploadScan: async () => ({ success: true, failed: 0, errors: [] }),
      }),
      getMainWindow: () =>
        ({ isDestroyed: () => true, webContents: { send } }) as never,
    });
    await handlers['db:scans:uploadAll']({}, {});
    await vi.waitFor(async () =>
      expect(
        (
          (await handlers['db:scans:uploadAllStatus']({})) as {
            data: { running: boolean };
          }
        ).data.running
      ).toBe(false)
    );
    expect(send).not.toHaveBeenCalled();
  });
});

describe('readableUploadError', () => {
  it('drops the frame ID', () => {
    expect(readableUploadError('Image 1aa7-b2: Upload failed')).toBe(
      'Upload failed'
    );
  });

  it("keeps only the message of Bloom's JSON, on one line", () => {
    expect(
      readableUploadError(
        'Image 1aa7-b2: {\n  "message": "duplicate key",\n  "code": "23505"\n}'
      )
    ).toBe('duplicate key');
  });

  it('flattens other multi-line text and JSON without a message', () => {
    expect(readableUploadError('Failed\n  to connect')).toBe(
      'Failed to connect'
    );
    expect(readableUploadError('Image x: {\n  "code": 1\n}')).toBe(
      '{ "code": 1 }'
    );
  });

  it('shortens a very long reason', () => {
    const shown = readableUploadError('x'.repeat(MAX_ERROR_LENGTH + 50));
    expect(shown).toHaveLength(MAX_ERROR_LENGTH + 1);
    expect(shown.endsWith('…')).toBe(true);
  });

  it('is what the result lists, for each failed scan', async () => {
    const { runToEnd } = setup(scans(1), async () => ({
      success: true,
      failed: 72,
      errors: ['Image 1aa7-b2: {\n  "message": "duplicate key"\n}'],
    }));
    expect((await runToEnd()).done.result.errors).toEqual([
      'P1: duplicate key',
    ]);
  });
});

describe('scanListWhere', () => {
  it('counts both dates as whole local days', () => {
    const query = scanListWhere({
      dateFrom: '2026-10-01',
      dateTo: '2026-10-30',
    });
    expect(query).toEqual({
      where: {
        deleted: false,
        capture_date: {
          gte: new Date('2026-10-01T00:00:00'),
          lte: new Date('2026-10-30T23:59:59.999'),
        },
      },
    });
  });

  it('refuses dates that are not exactly YYYY-MM-DD', () => {
    expect(scanListWhere({ dateFrom: '2026-10-1' })).toHaveProperty('error');
    expect(scanListWhere({ dateTo: '2026-10-30T00:00' })).toHaveProperty(
      'error'
    );
  });

  it('leaves out filters that are not set', () => {
    expect(scanListWhere({})).toEqual({ where: { deleted: false } });
  });
});
