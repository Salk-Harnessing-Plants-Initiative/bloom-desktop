/**
 * Mock scanner control file tests.
 *
 * Covers reading `~/.bloom/graviscan-mock.json` and turning it into the
 * DetectedScanner list that mock-mode detection returns. With no control
 * file, output must be byte-for-byte what the inline mock blocks in
 * graviscan-handlers.ts produced before the helper existed.
 */

import { describe, it, expect } from 'vitest';

import {
  MOCK_CONTROL_FILE,
  readMockControl,
  detectMockScanners,
} from '../../src/main/graviscan-mock';
import type { MockScannerRow } from '../../src/main/graviscan-mock';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<MockScannerRow> = {}): MockScannerRow {
  return {
    id: 'scanner-a',
    name: 'Perfection V600',
    vendor_id: '04b8',
    product_id: '013a',
    usb_port: '1-1',
    usb_bus: 1,
    usb_device: 1,
    ...overrides,
  };
}

function fileReader(contents: string) {
  return () => contents;
}

function missingFileReader() {
  return () => {
    const err = new Error('ENOENT: no such file') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    throw err;
  };
}

const ROW_A = makeRow({ id: 'scanner-a', name: 'A', usb_port: '1-1' });
const ROW_B = makeRow({
  id: 'scanner-b',
  name: 'B',
  usb_port: '1-2',
  usb_device: 2,
});
const ROW_C = makeRow({
  id: 'scanner-c',
  name: 'C',
  usb_port: '1-3',
  usb_device: 3,
});

// ---------------------------------------------------------------------------
// readMockControl
// ---------------------------------------------------------------------------

describe('readMockControl', () => {
  it('lives in ~/.bloom', () => {
    expect(MOCK_CONTROL_FILE).toMatch(/\.bloom[/\\]graviscan-mock\.json$/);
  });

  it('returns null when the file does not exist', () => {
    expect(readMockControl('/x.json', missingFileReader())).toBeNull();
  });

  it('parses a valid file', () => {
    const control = readMockControl(
      '/x.json',
      fileReader(JSON.stringify({ scanners: [{ port: '1-1', present: true }] }))
    );
    expect(control).toEqual({ scanners: [{ port: '1-1', present: true }] });
  });

  it('throws naming the file when JSON is invalid', () => {
    expect(() => readMockControl('/x.json', fileReader('{nope'))).toThrow(
      /\/x\.json/
    );
  });

  it('throws when scanners is not an array', () => {
    expect(() =>
      readMockControl('/x.json', fileReader('{"scanners": {}}'))
    ).toThrow(/scanners/);
  });

  it('throws when an entry has no port', () => {
    expect(() =>
      readMockControl(
        '/x.json',
        fileReader('{"scanners": [{"present": true}]}')
      )
    ).toThrow(/port/);
  });

  it('throws when present is not a boolean', () => {
    expect(() =>
      readMockControl(
        '/x.json',
        fileReader('{"scanners": [{"port": "1-1", "present": "yes"}]}')
      )
    ).toThrow(/present/);
  });

  it('throws when a port is listed twice', () => {
    expect(() =>
      readMockControl(
        '/x.json',
        fileReader(
          JSON.stringify({
            scanners: [
              { port: '1-1', present: true },
              { port: '1-1', present: false },
            ],
          })
        )
      )
    ).toThrow(/1-1/);
  });

  it('rethrows read errors other than a missing file', () => {
    const reader = () => {
      const err = new Error('EACCES') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    };
    expect(() => readMockControl('/x.json', reader)).toThrow(/EACCES/);
  });
});

// ---------------------------------------------------------------------------
// detectMockScanners — no control file (behaviour before this change)
// ---------------------------------------------------------------------------

describe('detectMockScanners without a control file, fixed-pair mode', () => {
  it('returns two scanners on ports 1-1 and 1-2', () => {
    const result = detectMockScanners([], 'fixed-pair', null);
    expect(result.map((s) => s.usb_port)).toEqual(['1-1', '1-2']);
  });

  it('invents mock ids when the database is empty', () => {
    const result = detectMockScanners([], 'fixed-pair', null);
    expect(result[1]).toEqual({
      name: 'Mock Scanner 2',
      scanner_id: 'mock-scanner-2',
      usb_bus: 1,
      usb_device: 2,
      usb_port: '1-2',
      is_available: true,
      vendor_id: '04b8',
      product_id: '013a',
      sane_name: 'epkowa:interpreter:001:002',
    });
  });

  it('pairs database rows by position', () => {
    const row = makeRow({ id: 'x', name: 'X', usb_port: '9-9' });
    const result = detectMockScanners([row], 'fixed-pair', null);
    expect(result[0]).toEqual({
      name: 'X',
      scanner_id: 'x',
      usb_bus: 1,
      usb_device: 1,
      usb_port: '1-1',
      is_available: true,
      vendor_id: '04b8',
      product_id: '013a',
      sane_name: 'epkowa:interpreter:001:001',
    });
  });

  it('still returns exactly two when the database has three rows', () => {
    const result = detectMockScanners(
      [ROW_A, ROW_B, ROW_C],
      'fixed-pair',
      null
    );
    expect(result).toHaveLength(2);
  });
});

describe('detectMockScanners without a control file, saved mode', () => {
  it('returns one scanner per saved row', () => {
    const result = detectMockScanners([ROW_A, ROW_B, ROW_C], 'saved', null);
    expect(result.map((s) => s.scanner_id)).toEqual([
      'scanner-a',
      'scanner-b',
      'scanner-c',
    ]);
  });

  it('keeps the saved port, bus and device', () => {
    const row = makeRow({ usb_port: '3-4', usb_bus: 3, usb_device: 7 });
    const [s] = detectMockScanners([row], 'saved', null);
    expect([s.usb_port, s.usb_bus, s.usb_device, s.sane_name]).toEqual([
      '3-4',
      3,
      7,
      'epkowa:interpreter:001:007',
    ]);
  });

  it('falls back to position when saved USB fields are null', () => {
    const row = makeRow({ usb_port: null, usb_bus: null, usb_device: null });
    const [, s] = detectMockScanners([ROW_A, row], 'saved', null);
    expect([s.usb_port, s.usb_bus, s.usb_device, s.sane_name]).toEqual([
      '1-2',
      1,
      2,
      'epkowa:interpreter:001:002',
    ]);
  });

  it('returns an empty list when nothing is saved', () => {
    expect(detectMockScanners([], 'saved', null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// detectMockScanners — with a control file
// ---------------------------------------------------------------------------

describe('detectMockScanners with a control file', () => {
  const threeWithThirdAbsent = {
    scanners: [
      { port: '1-1', present: true },
      { port: '1-2', present: true },
      { port: '1-3', present: false },
    ],
  };

  it('returns only present scanners', () => {
    const result = detectMockScanners(
      [ROW_A, ROW_B, ROW_C],
      'saved',
      threeWithThirdAbsent
    );
    expect(result.map((s) => s.usb_port)).toEqual(['1-1', '1-2']);
  });

  it('applies the same way in fixed-pair mode', () => {
    const result = detectMockScanners(
      [ROW_A, ROW_B, ROW_C],
      'fixed-pair',
      threeWithThirdAbsent
    );
    expect(result.map((s) => s.usb_port)).toEqual(['1-1', '1-2']);
  });

  it('returns more than two scanners when the file lists them', () => {
    const result = detectMockScanners([], 'fixed-pair', {
      scanners: [
        { port: '1-1', present: true },
        { port: '1-2', present: true },
        { port: '1-3', present: true },
      ],
    });
    expect(result).toHaveLength(3);
  });

  it('matches database rows by port, not position', () => {
    const result = detectMockScanners([ROW_B, ROW_A], 'saved', {
      scanners: [{ port: '1-1', present: true }],
    });
    expect(result[0].scanner_id).toBe('scanner-a');
  });

  it('invents a mock id for a port with no database row', () => {
    const result = detectMockScanners([ROW_A], 'saved', {
      scanners: [
        { port: '1-1', present: true },
        { port: '1-5', present: true },
      ],
    });
    expect([result[1].scanner_id, result[1].name]).toEqual([
      'mock-scanner-2',
      'Mock Scanner 2',
    ]);
  });

  it('numbers devices by position in the file', () => {
    const result = detectMockScanners([ROW_A, ROW_C], 'saved', {
      scanners: [
        { port: '1-1', present: false },
        { port: '1-3', present: true },
      ],
    });
    expect([result[0].usb_device, result[0].sane_name]).toEqual([
      2,
      'epkowa:interpreter:001:002',
    ]);
  });

  it('returns nothing when no scanner is present', () => {
    const result = detectMockScanners([ROW_A], 'saved', {
      scanners: [{ port: '1-1', present: false }],
    });
    expect(result).toEqual([]);
  });
});
