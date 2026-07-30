// @vitest-environment node
/**
 * QR Reader Unit Tests
 *
 * `src/main/qr-reader.ts` decodes QR codes by shelling out to the bundled
 * Python executable's `--decode-qr-batch` mode (OpenCV `cv2.QRCodeDetector`),
 * rather than decoding in-process with sharp + `@undecaf/zbar-wasm`. See
 * docs/superpowers/specs/2026-07-29-verify-plates-qr-decode-design.md.
 *
 * These tests mock `child_process.spawn` and exercise the Node side of that
 * wire protocol — the same convention
 * `tests/unit/graviscan/scanner-subprocess.test.ts` uses for the scan-worker
 * subprocess. The decoding itself (real images, real QR codes, real TIFFs) is
 * covered on the Python side by `python/tests/test_qr_reader.py`, which
 * additionally carries the fixture-gated tests against the real ~61MB
 * GraviScan TIFF captures that used to live in this file.
 *
 * Run: npx vitest run tests/unit/qr-reader.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

class MockProc extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { write: vi.fn(), end: vi.fn() };
  kill = vi.fn();
}

let mockProc: MockProc | null = null;

vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    mockProc = new MockProc();
    return mockProc;
  }),
}));

vi.mock('../../src/main/python-paths', () => ({
  getPythonExecutablePath: vi.fn(() => '/mock/dist/bloom-hardware'),
}));

import { spawn } from 'child_process';
import { readQrCodes, readQrCodesBatch } from '../../src/main/qr-reader';
import { getPythonExecutablePath } from '../../src/main/python-paths';

/** Wait until the module under test has actually spawned the subprocess. */
function waitForSpawn(): Promise<MockProc> {
  return new Promise((resolve) => {
    const check = () => {
      if (mockProc) resolve(mockProc);
      else setImmediate(check);
    };
    check();
  });
}

/** Emit a stdout payload and close the subprocess. */
async function respond(payload: string, exitCode = 0): Promise<void> {
  const proc = await waitForSpawn();
  proc.stdout.emit('data', Buffer.from(payload));
  proc.emit('close', exitCode);
}

describe('qr-reader (Python --decode-qr-batch subprocess)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProc = null;
    vi.mocked(getPythonExecutablePath).mockReturnValue(
      '/mock/dist/bloom-hardware'
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('readQrCodesBatch', () => {
    it('spawns the bundled Python executable in --decode-qr-batch mode', async () => {
      const promise = readQrCodesBatch(['/scans/a.tif']);
      const proc = await waitForSpawn();

      expect(spawn).toHaveBeenCalledWith(
        '/mock/dist/bloom-hardware',
        ['--decode-qr-batch'],
        expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] })
      );

      proc.stdout.emit(
        'data',
        Buffer.from(JSON.stringify([{ path: '/scans/a.tif', codes: [] }]))
      );
      proc.emit('close', 0);
      await promise;
    });

    it('writes the image paths to stdin as a JSON array and closes stdin', async () => {
      const paths = ['/scans/a.tif', '/scans/b.tif'];
      const promise = readQrCodesBatch(paths);
      const proc = await waitForSpawn();

      expect(proc.stdin.write).toHaveBeenCalledWith(JSON.stringify(paths));
      expect(proc.stdin.end).toHaveBeenCalled();

      proc.stdout.emit('data', Buffer.from(JSON.stringify([])));
      proc.emit('close', 0);
      await promise;
    });

    it('parses the JSON response into per-path results', async () => {
      const promise = readQrCodesBatch(['/scans/a.tif', '/scans/b.tif']);
      await respond(
        JSON.stringify([
          { path: '/scans/a.tif', codes: ['Plate_13_S1', 'Plate_13_S2'] },
          { path: '/scans/b.tif', codes: [] },
        ])
      );

      expect(await promise).toEqual([
        { path: '/scans/a.tif', codes: ['Plate_13_S1', 'Plate_13_S2'] },
        { path: '/scans/b.tif', codes: [] },
      ]);
    });

    it('reassembles a response split across multiple stdout chunks', async () => {
      const promise = readQrCodesBatch(['/scans/a.tif']);
      const proc = await waitForSpawn();

      const payload = JSON.stringify([
        { path: '/scans/a.tif', codes: ['Plate_13_S1'] },
      ]);
      proc.stdout.emit('data', Buffer.from(payload.slice(0, 10)));
      proc.stdout.emit('data', Buffer.from(payload.slice(10)));
      proc.emit('close', 0);

      expect(await promise).toEqual([
        { path: '/scans/a.tif', codes: ['Plate_13_S1'] },
      ]);
    });

    it('returns an empty result set without spawning for an empty batch', async () => {
      expect(await readQrCodesBatch([])).toEqual([]);
      expect(spawn).not.toHaveBeenCalled();
    });

    it('fills in empty codes for any path the subprocess omitted', async () => {
      const promise = readQrCodesBatch(['/scans/a.tif', '/scans/b.tif']);
      await respond(
        JSON.stringify([{ path: '/scans/a.tif', codes: ['Plate_13_S1'] }])
      );

      expect(await promise).toEqual([
        { path: '/scans/a.tif', codes: ['Plate_13_S1'] },
        { path: '/scans/b.tif', codes: [] },
      ]);
    });

    it('returns empty codes for every path when the batch and all individual retries exit non-zero', async () => {
      const promise = readQrCodesBatch(['/scans/a.tif', '/scans/b.tif']);
      const proc = await waitForSpawn();
      mockProc = null;
      proc.stderr.emit('data', Buffer.from('boom'));
      proc.emit('close', 3);

      // Crash isolation retries each image on its own; here both fail too.
      for (let i = 0; i < 2; i++) {
        const retry = await waitForSpawn();
        mockProc = null;
        retry.emit('close', 3);
      }

      expect(await promise).toEqual([
        { path: '/scans/a.tif', codes: [] },
        { path: '/scans/b.tif', codes: [] },
      ]);
      expect(console.error).toHaveBeenCalled();
    });

    it('isolates a native decoder crash by retrying each image individually', async () => {
      // A corrupt/hostile image can segfault OpenCV and take the whole
      // subprocess with it. Without isolation every plate in the session
      // would be silently reported as having no QR codes.
      const promise = readQrCodesBatch([
        '/scans/good.tif',
        '/scans/hostile.tif',
      ]);

      const batchProc = await waitForSpawn();
      mockProc = null;
      batchProc.stderr.emit('data', Buffer.from('Segmentation fault'));
      batchProc.emit('close', 139);

      // Retry #1: the healthy image still decodes on its own.
      const retry1 = await waitForSpawn();
      mockProc = null;
      retry1.stdout.emit(
        'data',
        Buffer.from(
          JSON.stringify([{ path: '/scans/good.tif', codes: ['Plate_13_S1'] }])
        )
      );
      retry1.emit('close', 0);

      // Retry #2: the hostile image crashes again, alone this time.
      const retry2 = await waitForSpawn();
      mockProc = null;
      retry2.emit('close', 139);

      expect(await promise).toEqual([
        { path: '/scans/good.tif', codes: ['Plate_13_S1'] },
        { path: '/scans/hostile.tif', codes: [] },
      ]);
      // One batch attempt + one retry per image.
      expect(spawn).toHaveBeenCalledTimes(3);
    });

    it('does not retry a single-image batch that exits non-zero', async () => {
      const promise = readQrCodesBatch(['/scans/a.tif']);
      const proc = await waitForSpawn();
      mockProc = null;
      proc.emit('close', 139);

      expect(await promise).toEqual([{ path: '/scans/a.tif', codes: [] }]);
      expect(spawn).toHaveBeenCalledTimes(1);
    });

    it('does not retry individually when the subprocess exits 0 with malformed output', async () => {
      // Exit 0 + unparseable stdout is a protocol bug, not a native crash —
      // re-running each image would just fail the same way N more times.
      const promise = readQrCodesBatch(['/scans/a.tif', '/scans/b.tif']);
      await respond('Traceback (most recent call last): ...');

      expect(await promise).toEqual([
        { path: '/scans/a.tif', codes: [] },
        { path: '/scans/b.tif', codes: [] },
      ]);
      expect(spawn).toHaveBeenCalledTimes(1);
    });

    it('returns empty codes for every path when stdout is not valid JSON', async () => {
      const promise = readQrCodesBatch(['/scans/a.tif']);
      await respond('Traceback (most recent call last): ...');

      expect(await promise).toEqual([{ path: '/scans/a.tif', codes: [] }]);
      expect(console.error).toHaveBeenCalled();
    });

    it('returns empty codes for every path when the subprocess cannot be spawned', async () => {
      const promise = readQrCodesBatch(['/scans/a.tif']);
      const proc = await waitForSpawn();
      proc.emit('error', new Error('spawn ENOENT'));

      expect(await promise).toEqual([{ path: '/scans/a.tif', codes: [] }]);
      expect(console.error).toHaveBeenCalled();
    });

    it('never rejects — a subprocess failure resolves with empty codes', async () => {
      const promise = readQrCodesBatch(['/scans/a.tif']);
      const proc = await waitForSpawn();
      proc.emit('error', new Error('spawn EACCES'));

      await expect(promise).resolves.toBeDefined();
    });

    it('serializes concurrent batches into one subprocess at a time', async () => {
      const first = readQrCodesBatch(['/scans/a.tif']);
      const second = readQrCodesBatch(['/scans/b.tif']);

      // Only the first batch has spawned so far.
      const proc1 = await waitForSpawn();
      expect(spawn).toHaveBeenCalledTimes(1);

      mockProc = null;
      proc1.stdout.emit(
        'data',
        Buffer.from(JSON.stringify([{ path: '/scans/a.tif', codes: ['A'] }]))
      );
      proc1.emit('close', 0);
      expect(await first).toEqual([{ path: '/scans/a.tif', codes: ['A'] }]);

      // The second batch spawns only after the first has finished.
      const proc2 = await waitForSpawn();
      expect(spawn).toHaveBeenCalledTimes(2);
      proc2.stdout.emit(
        'data',
        Buffer.from(JSON.stringify([{ path: '/scans/b.tif', codes: ['B'] }]))
      );
      proc2.emit('close', 0);
      expect(await second).toEqual([{ path: '/scans/b.tif', codes: ['B'] }]);
    });

    it('runs a later batch even after an earlier one failed', async () => {
      const first = readQrCodesBatch(['/scans/a.tif']);
      const second = readQrCodesBatch(['/scans/b.tif']);

      const proc1 = await waitForSpawn();
      mockProc = null;
      proc1.emit('error', new Error('spawn ENOENT'));
      await first;

      const proc2 = await waitForSpawn();
      proc2.stdout.emit(
        'data',
        Buffer.from(JSON.stringify([{ path: '/scans/b.tif', codes: ['B'] }]))
      );
      proc2.emit('close', 0);

      expect(await second).toEqual([{ path: '/scans/b.tif', codes: ['B'] }]);
    });
  });

  describe('readQrCodes (single image convenience wrapper)', () => {
    it('returns the decoded codes for the requested image', async () => {
      const promise = readQrCodes('/scans/a.tif');
      await respond(
        JSON.stringify([
          { path: '/scans/a.tif', codes: ['Plate_13_S1', 'Plate_13_S2'] },
        ])
      );

      expect(await promise).toEqual(['Plate_13_S1', 'Plate_13_S2']);
    });

    it('returns an empty array when the subprocess reports no codes', async () => {
      const promise = readQrCodes('/scans/missing.tif');
      await respond(
        JSON.stringify([{ path: '/scans/missing.tif', codes: [] }])
      );

      expect(await promise).toEqual([]);
    });

    it('returns an empty array without throwing when the subprocess fails', async () => {
      const promise = readQrCodes('/scans/a.tif');
      const proc = await waitForSpawn();
      proc.emit('error', new Error('spawn ENOENT'));

      expect(await promise).toEqual([]);
    });
  });
});
