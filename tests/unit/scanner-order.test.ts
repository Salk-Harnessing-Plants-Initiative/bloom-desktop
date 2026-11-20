// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { compareByUsbPort } from '../../src/utils/scanner-order';

describe('compareByUsbPort (shared by Detect labels and the scanner lists)', () => {
  it('orders by USB port', () => {
    const scanners = [
      { usb_port: '1-3' },
      { usb_port: '1-1' },
      { usb_port: '1-2' },
    ];
    expect([...scanners].sort(compareByUsbPort).map((s) => s.usb_port)).toEqual(
      ['1-1', '1-2', '1-3']
    );
  });

  it('treats a missing port as empty, so it sorts first', () => {
    expect(
      compareByUsbPort({ usb_port: null }, { usb_port: '1-1' })
    ).toBeLessThan(0);
    expect(compareByUsbPort({}, { usb_port: '1-1' })).toBeLessThan(0);
  });
});
