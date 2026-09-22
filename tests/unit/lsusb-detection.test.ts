// @vitest-environment node
/**
 * Tests for lsusb-based scanner detection, in particular the hierarchical
 * USB port-path fix: `parseLsusbTree()` used to map each device to a flat
 * port *number*, which collides when a scanner is connected through a USB
 * hub (a hub-attached device's port number can coincide with a
 * directly-connected device's port number on the same bus). The fix builds
 * a hierarchical port path (e.g. "2.3" = port 3 of a hub plugged into port
 * 2) using indentation depth in `lsusb -t` output to track hub nesting.
 *
 * The helpers (`parseLsusb`, `parseLsusbTree`, `buildUsbPort`, ...) are
 * private/unexported, so we test through the public `detectEpsonScanners()`
 * entry point by mocking `child_process`'s `execFileSync`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// This is a COMPLETE-REPLACEMENT factory: anything `lsusb-detection.ts`
// imports from `child_process` must be exported here or the module fails at
// import. `execFile` is mocked in Node **callback form** specifically so
// `promisify()` can wrap it — the async detection shell does
// `promisify(execFile)` at module scope, and against a bare `vi.fn()`
// `promisify` throws at import time, which would kill every test in this
// file rather than failing one assertion.
vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
  execFile: vi.fn(),
}));

import { execFileSync, execFile } from 'child_process';
import {
  detectEpsonScanners,
  detectEpsonScannersAsync,
} from '../../src/main/lsusb-detection';

const mockExecFileSync = vi.mocked(execFileSync);
const mockExecFile = vi.mocked(execFile);

/**
 * Drive the callback-form `execFile` mock from the same
 * "what would lsusb print" function the sync tests use, so both shells are
 * exercised against identical input.
 */
function wireAsyncExecFile(outputFor: (args: string[]) => string) {
  mockExecFile.mockImplementation(((
    _cmd: string,
    args: string[],
    _opts: unknown,
    cb: (e: Error | null, stdout: string, stderr: string) => void
  ) => {
    // promisify's callback contract: (err, stdout, stderr). The promisified
    // form resolves to { stdout, stderr }.
    cb(null, outputFor(args ?? []), '');
    return undefined;
  }) as any);
}

// A single Epson V600 (vendor 04b8, product 013a) on bus 1, device 7.
const LSUSB_ONE_DEVICE = `Bus 001 Device 007: ID 04b8:013a EPSON EPSON Scanner
Bus 001 Device 001: ID 1d6b:0002 Linux Foundation 2.0 root hub`;

// Two Epson V600s on bus 1: device 7 and device 12.
const LSUSB_TWO_DEVICES = `Bus 001 Device 007: ID 04b8:013a EPSON EPSON Scanner
Bus 001 Device 012: ID 04b8:013a EPSON EPSON Scanner
Bus 001 Device 001: ID 1d6b:0002 Linux Foundation 2.0 root hub`;

describe('detectEpsonScanners', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it('(a) scanner directly on a bus port gets usb_port like "1-3" (regression guard)', () => {
    const treeOutput = `/:  Bus 001.Port 001: Dev 001, Class=root_hub, Driver=xhci_hcd/1p, 480M
    |__ Port 003: Dev 007, If 0, Class=Vendor Specific Class, Driver=usbfs, 480M`;

    mockExecFileSync.mockImplementation((_cmd, args) => {
      if (Array.isArray(args) && args.includes('-t')) {
        return treeOutput;
      }
      return LSUSB_ONE_DEVICE;
    });

    const result = detectEpsonScanners();

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.scanners[0].usb_port).toBe('1-3');
    expect(result.scanners[0].usb_bus).toBe(1);
    expect(result.scanners[0].usb_device).toBe(7);
  });

  it('(b) scanner behind a hub gets a hierarchical usb_port like "1-2.3" (new behavior)', () => {
    // Hub is Dev 002 at depth 1 (port 2), scanner Dev 007 is nested at
    // depth 2 (port 3) beneath the hub — matches the file's own docstring
    // example indentation pattern (4 spaces per depth level).
    const treeOutput = `/:  Bus 001.Port 001: Dev 001, Class=root_hub, Driver=xhci_hcd/1p, 480M
    |__ Port 002: Dev 002, If 0, Class=Hub, Driver=hub/4p, 480M
        |__ Port 003: Dev 007, If 0, Class=Vendor Specific Class, Driver=usbfs, 480M`;

    mockExecFileSync.mockImplementation((_cmd, args) => {
      if (Array.isArray(args) && args.includes('-t')) {
        return treeOutput;
      }
      return LSUSB_ONE_DEVICE;
    });

    const result = detectEpsonScanners();

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.scanners[0].usb_port).toBe('1-2.3');
  });

  it('(c) two scanners with the same raw port number but different hub parents get distinct usb_port values', () => {
    // Dev 007 is directly on bus port 3 (no hub).
    // Dev 012 is on port 3 of a hub (Dev 002) plugged into bus port 5.
    // Both have raw port number "3" but must be disambiguated by hub
    // parentage — this is the actual bug the fix addresses: before the
    // fix, both would flatten to usb_port "1-3" and collide.
    const treeOutput = `/:  Bus 001.Port 001: Dev 001, Class=root_hub, Driver=xhci_hcd/1p, 480M
    |__ Port 003: Dev 007, If 0, Class=Vendor Specific Class, Driver=usbfs, 480M
    |__ Port 005: Dev 002, If 0, Class=Hub, Driver=hub/4p, 480M
        |__ Port 003: Dev 012, If 0, Class=Vendor Specific Class, Driver=usbfs, 480M`;

    mockExecFileSync.mockImplementation((_cmd, args) => {
      if (Array.isArray(args) && args.includes('-t')) {
        return treeOutput;
      }
      return LSUSB_TWO_DEVICES;
    });

    const result = detectEpsonScanners();

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);

    const byDevice = new Map(result.scanners.map((s) => [s.usb_device, s]));
    expect(byDevice.get(7)?.usb_port).toBe('1-3');
    expect(byDevice.get(12)?.usb_port).toBe('1-5.3');
    expect(byDevice.get(7)?.usb_port).not.toBe(byDevice.get(12)?.usb_port);
  });
});

/**
 * The dedupe block already executes in all three tests above, so "it has
 * zero coverage" would be wrong — but two of its branches are never
 * exercised: the port-less early push and the device-number comparison.
 * Both matter now that `scanner-usb-refresh`'s matcher does a linear scan
 * over this function's output, because the block *reorders* results.
 */
describe('detectEpsonScanners — port deduplication', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it('keeps the highest device number when one port reports two enumerations', () => {
    // USB re-enumeration leaves a ghost: the same physical port appears
    // under both the old and the new device number. The newer one wins.
    const treeOutput = `/:  Bus 001.Port 001: Dev 001, Class=root_hub, Driver=xhci_hcd/1p, 480M
    |__ Port 003: Dev 007, If 0, Class=Vendor Specific Class, Driver=usbfs, 480M
    |__ Port 003: Dev 012, If 0, Class=Vendor Specific Class, Driver=usbfs, 480M`;

    mockExecFileSync.mockImplementation((_cmd, args) => {
      if (Array.isArray(args) && args.includes('-t')) return treeOutput;
      return LSUSB_TWO_DEVICES;
    });

    const result = detectEpsonScanners();

    // Pin the surviving ENTRY, not an array index — the block pushes
    // port-less entries first and then `byPort.values()`, so index-based
    // assertions would silently pass on a reordering bug.
    expect(result.scanners).toHaveLength(1);
    expect(result.scanners[0].usb_device).toBe(12);
    expect(result.scanners[0].usb_port).toBe('1-3');
  });

  it('includes port-less entries as-is rather than deduplicating them', () => {
    // `lsusb -t` failing leaves usb_port '' for every device. Those cannot
    // be deduplicated by port, so they must survive individually — merging
    // them would silently drop a real scanner.
    mockExecFileSync.mockImplementation((_cmd, args) => {
      if (Array.isArray(args) && args.includes('-t')) {
        throw new Error('lsusb -t failed');
      }
      return LSUSB_TWO_DEVICES;
    });

    const result = detectEpsonScanners();

    expect(result.scanners).toHaveLength(2);
    expect(result.scanners.map((s) => s.usb_device).sort((a, b) => a - b)).toEqual([7, 12]);
    expect(result.scanners.every((s) => s.usb_port === '')).toBe(true);
  });
});

/**
 * The async shell (design.md Decision 4). `detectEpsonScanners()` is
 * `execFileSync` twice with a 5s timeout each — up to ~10s with the
 * main-process event loop fully blocked, which during an active session
 * delays `scanInterval` and can push a healthy scanner's row past
 * SCAN_ROW_TIMEOUT_MS, the entry condition for #371's permanent false
 * MISSING.
 */
describe('detectEpsonScannersAsync', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockExecFile.mockReset();
  });

  function outputFor(args: string[]) {
    return args.includes('-t')
      ? `/:  Bus 001.Port 001: Dev 001, Class=root_hub, Driver=xhci_hcd/1p, 480M
    |__ Port 002: Dev 002, If 0, Class=Hub, Driver=hub/4p, 480M
        |__ Port 003: Dev 007, If 0, Class=Vendor Specific Class, Driver=usbfs, 480M`
      : LSUSB_ONE_DEVICE;
  }

  it('detects a hub-attached scanner with the same hierarchical port as the sync shell', async () => {
    wireAsyncExecFile(outputFor);

    const result = await detectEpsonScannersAsync();

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.scanners[0].usb_port).toBe('1-2.3');
    expect(result.scanners[0].usb_bus).toBe(1);
    expect(result.scanners[0].usb_device).toBe(7);
  });

  it('returns the identical result to the sync shell for identical input', async () => {
    // The two shells share one pure parse-and-dedupe core. Task-level "same
    // parsing, same shape" is not a guarantee, and the dedupe block carries
    // an unfixed device-number-wrap hazard — so this pins that they really
    // are the same code, not merely two implementations that agree today.
    mockExecFileSync.mockImplementation((_cmd, args) =>
      outputFor(Array.isArray(args) ? (args as string[]) : [])
    );
    wireAsyncExecFile(outputFor);

    const syncResult = detectEpsonScanners();
    const asyncResult = await detectEpsonScannersAsync();

    expect(asyncResult).toEqual(syncResult);
  });

  it('reports lsusb being unavailable without throwing', async () => {
    mockExecFile.mockImplementation(((
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (e: Error | null, stdout: string, stderr: string) => void
    ) => {
      cb(new Error('spawn lsusb ENOENT'), '', '');
      return undefined;
    }) as any);

    const result = await detectEpsonScannersAsync();

    expect(result.success).toBe(false);
    expect(result.scanners).toEqual([]);
    expect(result.error).toBeDefined();
  });

  it('does not block the event loop while detection is outstanding', async () => {
    let detectionSettled = false;
    mockExecFile.mockImplementation(((
      _cmd: string,
      args: string[],
      _opts: unknown,
      cb: (e: Error | null, stdout: string, stderr: string) => void
    ) => {
      setTimeout(() => {
        detectionSettled = true;
        cb(null, outputFor(args ?? []), '');
      }, 5);
      return undefined;
    }) as any);

    let ranWhileOutstanding = false;
    const pending = detectEpsonScannersAsync();
    setImmediate(() => {
      ranWhileOutstanding = !detectionSettled;
    });

    await pending;

    expect(ranWhileOutstanding).toBe(true);
  });
});
