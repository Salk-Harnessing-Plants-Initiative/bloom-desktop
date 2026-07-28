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

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'child_process';
import { detectEpsonScanners } from '../../src/main/lsusb-detection';

const mockExecFileSync = vi.mocked(execFileSync);

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
