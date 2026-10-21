// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests for `scanner-usb-refresh` — re-resolving a scanner's volatile
 * USB address from its stable `usb_port` (issue #182).
 *
 * Detection is **always injected** here. No test may reach the real
 * `detectEpsonScanners()`: unmocked it spawns a real subprocess and the
 * outcome differs by platform (on Windows/macOS `lsusb` is absent so it
 * throws ENOENT → `detection-failed`; on `ubuntu-latest` `lsusb` exists but
 * finds no Epson → `not-detected`), so such a test would pass locally and
 * fail in CI or vice versa.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  matchDetectedByPort,
  refreshScannerUsbAddress,
} from '../../../src/main/graviscan/scanner-usb-refresh';
import type { ScannerUsbRefreshRow } from '../../../src/main/graviscan/scanner-usb-refresh';
import type { DetectedScanner } from '../../../src/types/graviscan';

/**
 * A detected-scanner shape audited wholesale against the real
 * `DetectedScanner` interface (`src/types/graviscan.ts:26-36`) rather than
 * field-by-field as a test happens to need — five defects on PR #365 were
 * "the test passed only because the mock was more forgiving than
 * production".
 */
function detected(over: Partial<DetectedScanner> = {}): DetectedScanner {
  return {
    name: 'Perfection V600 Photo',
    scanner_id: 'detected-1',
    usb_bus: 1,
    usb_device: 8,
    usb_port: '1-2.3',
    is_available: true,
    vendor_id: '04b8',
    product_id: '013a',
    sane_name: 'epkowa:interpreter:001:008',
    ...over,
  };
}

/**
 * A row shape audited wholesale against `prisma/schema.prisma`'s
 * `GraviScanner` model.
 */
function row(over: Partial<ScannerUsbRefreshRow> = {}): ScannerUsbRefreshRow {
  return {
    id: 'sc-1',
    usb_bus: 1,
    usb_device: 7,
    usb_port: '1-2.3',
    display_name: 'Scanner A',
    name: 'Perfection V600 Photo',
    enabled: true,
    ...over,
  };
}

function createDb(r: ScannerUsbRefreshRow | null) {
  return {
    graviScanner: {
      findUnique: vi.fn().mockResolvedValue(r),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

/** Detection that succeeds, reporting the given scanners. */
function detectOk(scanners: DetectedScanner[]) {
  return vi.fn().mockResolvedValue({
    success: true,
    scanners,
    count: scanners.length,
  });
}

/** Detection that reports a failed lsusb invocation. */
function detectFail(error = 'lsusb not available') {
  return vi.fn().mockResolvedValue({
    success: false,
    scanners: [],
    count: 0,
    error,
  });
}

/** Never sleeps, so backoff does not slow the suite. */
const noSleep = () => Promise.resolve();

describe('matchDetectedByPort', () => {
  it('matches the detected scanner occupying the row port', () => {
    const target = detected({ scanner_id: 'want', usb_port: '1-2.3' });
    const result = matchDetectedByPort('1-2.3', [
      detected({ scanner_id: 'other', usb_port: '1-4' }),
      target,
    ]);

    expect(result).toBe(target);
  });

  it('never matches a null port, even against a detected empty port', () => {
    expect(
      matchDetectedByPort(null, [detected({ usb_port: '' })])
    ).toBeUndefined();
  });

  it('never matches an undefined port', () => {
    expect(
      matchDetectedByPort(undefined, [detected({ usb_port: '1-2.3' })])
    ).toBeUndefined();
  });

  it('never matches an empty-string port against a detected empty-string port', () => {
    // `buildUsbPort` returns '' when `lsusb -t` fails, so two unrelated
    // scanners can both carry ''. Treating that as a match would bind an
    // address to the wrong physical device.
    expect(
      matchDetectedByPort('', [detected({ usb_port: '' })])
    ).toBeUndefined();
  });

  it('returns no match when nothing occupies the port', () => {
    expect(
      matchDetectedByPort('1-9', [detected({ usb_port: '1-2.3' })])
    ).toBeUndefined();
  });

  it('resolves duplicate detected ports to the first in list order', () => {
    const first = detected({ scanner_id: 'first', usb_device: 8 });
    const second = detected({ scanner_id: 'second', usb_device: 9 });

    expect(matchDetectedByPort('1-2.3', [first, second])).toBe(first);
  });

  it('does not mutate the input list or its elements', () => {
    const list = [detected({ usb_port: '1-4' }), detected()];
    const snapshot = JSON.parse(JSON.stringify(list));

    matchDetectedByPort('1-2.3', list);

    expect(list).toEqual(snapshot);
    expect(list).toHaveLength(2);
  });
});

describe('refreshScannerUsbAddress', () => {
  const originalMock = process.env.GRAVISCAN_MOCK;

  beforeEach(() => {
    delete process.env.GRAVISCAN_MOCK;
  });

  afterEach(() => {
    if (originalMock === undefined) delete process.env.GRAVISCAN_MOCK;
    else process.env.GRAVISCAN_MOCK = originalMock;
    vi.restoreAllMocks();
  });

  it('refreshes a scanner whose device number moved, writing only the two address columns', async () => {
    const db = createDb(row({ usb_bus: 1, usb_device: 7 }));
    const detect = detectOk([detected({ usb_bus: 1, usb_device: 8 })]);

    const outcome = await refreshScannerUsbAddress(db as any, 'sc-1', {
      detect,
      sleep: noSleep,
    });

    expect(outcome).toMatchObject({
      status: 'refreshed',
      changed: true,
      usbBus: 1,
      usbDevice: 8,
      previousUsbBus: 1,
      previousUsbDevice: 7,
    });
    // Exact payload shape, so "writes only those two columns" is genuinely
    // pinned rather than merely intended.
    expect(db.graviScanner.update).toHaveBeenCalledWith({
      where: { id: 'sc-1' },
      data: { usb_bus: 1, usb_device: 8 },
    });
  });

  it('performs no write when the address has not moved', async () => {
    const db = createDb(row({ usb_bus: 1, usb_device: 8 }));
    const detect = detectOk([detected({ usb_bus: 1, usb_device: 8 })]);

    const outcome = await refreshScannerUsbAddress(db as any, 'sc-1', {
      detect,
      sleep: noSleep,
    });

    expect(outcome).toMatchObject({
      status: 'refreshed',
      changed: false,
      usbBus: 1,
      usbDevice: 8,
    });
    expect(db.graviScanner.update).not.toHaveBeenCalled();
  });

  it('recovers an address the database does not hold at all', async () => {
    // Decision 6: null columns stop being fatal once a usable port can
    // recover them.
    const db = createDb(row({ usb_bus: null, usb_device: null }));
    const detect = detectOk([detected({ usb_bus: 1, usb_device: 8 })]);

    const outcome = await refreshScannerUsbAddress(db as any, 'sc-1', {
      detect,
      sleep: noSleep,
    });

    expect(outcome).toMatchObject({
      status: 'refreshed',
      changed: true,
      usbBus: 1,
      usbDevice: 8,
      previousUsbBus: null,
      previousUsbDevice: null,
    });
    expect(db.graviScanner.update).toHaveBeenCalledWith({
      where: { id: 'sc-1' },
      data: { usb_bus: 1, usb_device: 8 },
    });
  });

  it('reports not-detected carrying the port, when nothing occupies it', async () => {
    const db = createDb(row({ usb_port: '1-2.3' }));
    const detect = detectOk([detected({ usb_port: '1-9' })]);

    const outcome = await refreshScannerUsbAddress(db as any, 'sc-1', {
      detect,
      sleep: noSleep,
    });

    // The operator message is built from `usbPort`, so it must be carried
    // out of the outcome rather than re-read by the caller.
    expect(outcome).toEqual({ status: 'not-detected', usbPort: '1-2.3' });
    expect(db.graviScanner.update).not.toHaveBeenCalled();
  });

  it('reports no-stable-port for a null usb_port', async () => {
    const db = createDb(row({ usb_port: null }));
    const detect = detectOk([detected()]);

    const outcome = await refreshScannerUsbAddress(db as any, 'sc-1', {
      detect,
      sleep: noSleep,
    });

    expect(outcome).toEqual({ status: 'no-stable-port' });
  });

  it('reports no-stable-port for an empty-string usb_port', async () => {
    const db = createDb(row({ usb_port: '' }));
    const detect = detectOk([detected({ usb_port: '' })]);

    const outcome = await refreshScannerUsbAddress(db as any, 'sc-1', {
      detect,
      sleep: noSleep,
    });

    expect(outcome).toEqual({ status: 'no-stable-port' });
  });

  it('reports row-missing distinctly, without attempting detection', async () => {
    const db = createDb(null);
    const detect = detectOk([detected()]);

    const outcome = await refreshScannerUsbAddress(db as any, 'sc-1', {
      detect,
      sleep: noSleep,
    });

    expect(outcome).toEqual({ status: 'row-missing' });
    expect(detect).not.toHaveBeenCalled();
  });

  it('reports unusable-address rather than returning a non-integer address', async () => {
    // Mock mode short-circuits to the row's stored values, and `resetUsb`
    // leaves those null between clearing and repopulating them. Without
    // this guard `buildSaneName(null, null)` yields
    // 'epkowa:interpreter:null:null', which mock-mode spawning does not
    // validate — so a mock retry would report success on a nonsense device.
    process.env.GRAVISCAN_MOCK = 'true';
    const db = createDb(row({ usb_bus: null, usb_device: null }));
    const detect = detectOk([detected()]);

    const outcome = await refreshScannerUsbAddress(db as any, 'sc-1', {
      detect,
      sleep: noSleep,
    });

    expect(outcome).toMatchObject({ status: 'unusable-address' });
    // No address a caller could format into a name containing 'null'.
    expect(outcome).not.toHaveProperty('usbBus');
    expect(outcome).not.toHaveProperty('usbDevice');
    expect(detect).not.toHaveBeenCalled();
  });

  it('reports detection-failed only after three attempts', async () => {
    const db = createDb(row());
    const detect = detectFail();
    const sleep = vi.fn().mockResolvedValue(undefined);

    const outcome = await refreshScannerUsbAddress(db as any, 'sc-1', {
      detect,
      sleep,
    });

    expect(outcome).toMatchObject({ status: 'detection-failed', attempts: 3 });
    expect(detect).toHaveBeenCalledTimes(3);
    // Backoff between attempts, not after the last one.
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('recovers from a transient detection failure, attempting detection exactly twice', async () => {
    // A wedge creates exactly the bus contention that makes a 5s-timeout
    // execFile flake, so refusing on one failure would cost a run's
    // remaining timepoints for a reason unrelated to the scanner.
    const db = createDb(row({ usb_bus: 1, usb_device: 7 }));
    const detect = vi
      .fn()
      .mockResolvedValueOnce({
        success: false,
        scanners: [],
        count: 0,
        error: 'lsusb detection failed: timeout',
      })
      .mockResolvedValueOnce({
        success: true,
        scanners: [detected({ usb_bus: 1, usb_device: 8 })],
        count: 1,
      });

    const outcome = await refreshScannerUsbAddress(db as any, 'sc-1', {
      detect,
      sleep: noSleep,
    });

    expect(outcome).toMatchObject({ status: 'refreshed', usbDevice: 8 });
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it('does not retry a successful detection that simply found nothing', async () => {
    // `not-detected` is a conclusion, not a flake: retrying it would spend
    // ~15s confirming an absent scanner is still absent.
    const db = createDb(row({ usb_port: '1-2.3' }));
    const detect = detectOk([]);

    const outcome = await refreshScannerUsbAddress(db as any, 'sc-1', {
      detect,
      sleep: noSleep,
    });

    expect(outcome).toEqual({ status: 'not-detected', usbPort: '1-2.3' });
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it('short-circuits in mock mode without invoking detection', async () => {
    process.env.GRAVISCAN_MOCK = 'true';
    const db = createDb(row({ usb_bus: 1, usb_device: 2 }));
    const detect = detectOk([detected()]);

    const outcome = await refreshScannerUsbAddress(db as any, 'sc-1', {
      detect,
      sleep: noSleep,
    });

    expect(outcome).toMatchObject({
      status: 'refreshed',
      changed: false,
      usbBus: 1,
      usbDevice: 2,
    });
    expect(detect).not.toHaveBeenCalled();
    expect(db.graviScanner.update).not.toHaveBeenCalled();
  });

  it('shares one detection pass between concurrent refreshes', async () => {
    // N scanners retried at one cycle boundary each register their own
    // cycle-complete listener and are not serialized, so without sharing
    // this is 2N `lsusb` invocations on a bus that already has a wedged
    // device on it.
    const dbA = createDb(row({ id: 'sc-1', usb_port: '1-2.3' }));
    const dbB = createDb(row({ id: 'sc-2', usb_port: '1-4' }));
    let resolveDetection: (v: unknown) => void = () => {};
    const detect = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDetection = resolve;
        })
    );

    const a = refreshScannerUsbAddress(dbA as any, 'sc-1', {
      detect,
      sleep: noSleep,
    });
    const b = refreshScannerUsbAddress(dbB as any, 'sc-2', {
      detect,
      sleep: noSleep,
    });
    await new Promise((r) => setImmediate(r));

    resolveDetection({
      success: true,
      count: 2,
      scanners: [
        detected({ usb_port: '1-2.3', usb_device: 8 }),
        detected({ usb_port: '1-4', usb_device: 9 }),
      ],
    });
    const [outcomeA, outcomeB] = await Promise.all([a, b]);

    expect(detect).toHaveBeenCalledTimes(1);
    expect(outcomeA).toMatchObject({ status: 'refreshed', usbDevice: 8 });
    expect(outcomeB).toMatchObject({ status: 'refreshed', usbDevice: 9 });
  });

  it('does not reuse a settled detection for a later refresh', async () => {
    // The inverse of the test above, and the reason sharing is scoped to
    // work still in flight rather than to a time window: a *completed*
    // detection goes stale the instant the device re-enumerates, which is
    // the very defect this module exists to fix. A resolver must never be
    // handed a result captured before the power-cycle it is recovering from.
    const db = createDb(row({ usb_port: '1-2.3' }));
    const detect = detectOk([detected({ usb_device: 8 })]);

    await refreshScannerUsbAddress(db as any, 'sc-1', {
      detect,
      sleep: noSleep,
    });
    await refreshScannerUsbAddress(db as any, 'sc-1', {
      detect,
      sleep: noSleep,
    });

    expect(detect).toHaveBeenCalledTimes(2);
  });

  it('performs detection through a non-blocking interface', async () => {
    // Decision 4: the synchronous `detectEpsonScanners()` blocks the main
    // process for up to ~10s, which during an active session delays
    // `scanInterval` and pushes other scanners' rows toward
    // SCAN_ROW_TIMEOUT_MS — #371's entry condition. Proving the event loop
    // still turns while detection is outstanding is what pins that.
    const db = createDb(row());
    let detectionSettled = false;
    const detect = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            detectionSettled = true;
            resolve({
              success: true,
              scanners: [detected({ usb_bus: 1, usb_device: 8 })],
              count: 1,
            });
          }, 10);
        })
    );

    let ranWhileOutstanding = false;
    const pending = refreshScannerUsbAddress(db as any, 'sc-1', {
      detect,
      sleep: noSleep,
    });
    setImmediate(() => {
      ranWhileOutstanding = !detectionSettled;
    });

    await pending;

    expect(ranWhileOutstanding).toBe(true);
  });
});
