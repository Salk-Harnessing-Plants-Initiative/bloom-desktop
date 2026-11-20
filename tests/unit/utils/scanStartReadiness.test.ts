import { describe, it, expect } from 'vitest';
import { startBlockedReason } from '../../../src/renderer/utils/scanStartReadiness';

const plates = (selected: boolean) => [
  {
    plateIndex: '00',
    plantBarcode: null,
    transplantDate: null,
    customNote: null,
    selected,
  },
];

const scanner = (
  scannerId: string,
  connectionStatus: 'ready' | 'starting' | 'error' | 'dead' | 'disconnected'
) => ({ scannerId, name: `Scanner ${scannerId}`, connectionStatus });

describe('startBlockedReason (#159)', () => {
  it('allows the start when every scanner with plates is ready', () => {
    expect(
      startBlockedReason([scanner('1', 'ready'), scanner('2', 'ready')], {
        '1': plates(true),
        '2': plates(true),
      })
    ).toBeNull();
  });

  it('names a scanner with plates that is still connecting', () => {
    expect(
      startBlockedReason([scanner('1', 'ready'), scanner('2', 'starting')], {
        '1': plates(true),
        '2': plates(true),
      })
    ).toBe(
      "Scanner 2 is still connecting. Start Scan will be available when it's ready."
    );
  });

  it.each(['error', 'dead'] as const)(
    'names a scanner with plates in %s',
    (status) => {
      expect(
        startBlockedReason([scanner('1', status)], { '1': plates(true) })
      ).toBe(
        `Scanner 1 isn't ready (${status}). Reset USB or re-detect the scanners.`
      );
    }
  );

  it("doesn't block on a scanner with no plates selected", () => {
    expect(
      startBlockedReason([scanner('1', 'ready'), scanner('2', 'starting')], {
        '1': plates(true),
        '2': plates(false),
      })
    ).toBeNull();
  });

  it("doesn't block on a scanner whose worker Start Scan will start", () => {
    expect(
      startBlockedReason([scanner('1', 'disconnected')], { '1': plates(true) })
    ).toBeNull();
  });
});
