/**
 * Browse Scans' "Upload all" (#449): which scans count as waiting, the order and
 * progress of a run, stopping, and failures.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  MAX_LISTED_ERRORS,
  UPLOAD_ALL_PROGRESS_CHANNEL,
  WAITING_STATUSES,
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
    db: { scan: { findMany } } as unknown as ScanUploadDbLike,
    createUploader,
    getMainWindow: () => ({ webContents: { send } }) as never,
  });
  const call = (channel: string, ...args: unknown[]) =>
    handlers[channel]({}, ...args) as Promise<{
      success: boolean;
      data?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
      error?: string;
    }>;
  return { call, findMany, send, uploader, createUploader };
}

const scans = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `s${i + 1}`,
    plant_id: `P${i + 1}`,
  }));

describe('Upload all: which scans', () => {
  it("counts scans not deleted, within the filters, with frames 'pending' or 'failed'", async () => {
    const { call, findMany } = setup(scans(3));
    const response = await call('db:scans:pendingUploads', {
      experimentId: 'exp-1',
      dateFrom: '2026-10-01',
    });

    expect(response).toEqual({ success: true, data: { count: 3 } });
    const args = findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      deleted: false,
      experiment_id: 'exp-1',
      images: { some: { status: { in: ['pending', 'failed'] } } },
    });
    expect(args.where.capture_date.gte).toEqual(
      new Date('2026-10-01T00:00:00')
    );
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
  it('uploads each scan in order with one login, and reports progress after each', async () => {
    const { call, uploader, send, createUploader } = setup(scans(3));

    const response = await call('db:scans:uploadAll', {});

    expect(response.data).toEqual({
      total: 3,
      uploadedScans: 3,
      failedScans: 0,
      stopped: false,
      errors: [],
    });
    expect(createUploader).toHaveBeenCalledTimes(1);
    expect(uploader.authenticate).toHaveBeenCalledTimes(1);
    expect(uploader.uploadScan.mock.calls.map((c) => c[0])).toEqual([
      's1',
      's2',
      's3',
    ]);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenLastCalledWith(UPLOAD_ALL_PROGRESS_CHANNEL, {
      done: 3,
      total: 3,
      uploadedScans: 3,
      failedScans: 0,
    });
  });

  it("does nothing, and doesn't log in, when no scan is waiting", async () => {
    const { call, createUploader } = setup([]);
    expect((await call('db:scans:uploadAll', {})).data).toMatchObject({
      total: 0,
    });
    expect(createUploader).not.toHaveBeenCalled();
  });

  it('carries on past a failed scan, and lists the first few failures by plant', async () => {
    const { call } = setup(scans(MAX_LISTED_ERRORS + 2), async (id) => {
      if (id === 's2') throw new Error('Network down');
      return id === 's1'
        ? { success: true, failed: 0, errors: [] }
        : { success: false, failed: 3, errors: ['3 frames failed'] };
    });

    const { data } = await call('db:scans:uploadAll', {});

    expect(data.uploadedScans).toBe(1);
    expect(data.failedScans).toBe(MAX_LISTED_ERRORS + 1);
    expect(data.errors).toHaveLength(MAX_LISTED_ERRORS);
    expect(data.errors[0]).toBe('P2: Network down');
    expect(data.errors[1]).toBe('P3: 3 frames failed');
  });

  it('stops after the scan in progress when asked', async () => {
    const ref: { call?: ReturnType<typeof setup>['call'] } = {};
    const { call } = setup(scans(5), async (id) => {
      if (id === 's2') await ref.call?.('db:scans:stopUploadAll');
      return { success: true, failed: 0, errors: [] };
    });
    ref.call = call;

    const { data } = await call('db:scans:uploadAll', {});

    expect(data).toMatchObject({ total: 5, uploadedScans: 2, stopped: true });
  });

  it('refuses a second run while one is going, and allows one after', async () => {
    let release: (() => void) | null = null;
    let calls = 0;
    const { call } = setup(scans(1), () => {
      calls += 1;
      if (calls > 1)
        return Promise.resolve({ success: true, failed: 0, errors: [] });
      return new Promise((resolve) => {
        release = () => resolve({ success: true, failed: 0, errors: [] });
      });
    });

    const first = call('db:scans:uploadAll', {});
    await vi.waitFor(() => expect(release).not.toBeNull());
    expect(await call('db:scans:uploadAll', {})).toEqual({
      success: false,
      error: 'An upload is already running.',
    });
    release!();
    expect((await first).success).toBe(true);
    expect((await call('db:scans:uploadAll', {})).success).toBe(true);
  });

  it('reports a login failure without uploading anything', async () => {
    const { call, uploader } = setup(scans(2), undefined, async () => {
      throw new Error('Bloom credentials are not set up on this computer');
    });

    expect(await call('db:scans:uploadAll', {})).toEqual({
      success: false,
      error: 'Bloom credentials are not set up on this computer',
    });
    expect(uploader.uploadScan).not.toHaveBeenCalled();
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

  it('leaves out filters that are not set', () => {
    expect(scanListWhere({})).toEqual({ where: { deleted: false } });
  });
});
