// @vitest-environment node
/**
 * Task 4 (#228): LIBUSB_ENDPOINT_RECOVERY env-var plumbing in
 * ScannerSubprocess. Verifies the env-construction logic passes the
 * recovery toggle through to the subprocess environment alongside the
 * existing LD_PRELOAD + SANE_USB_FILTER.
 */

import { describe, it, expect } from 'vitest';
import { buildSubprocessEnv } from '../../src/main/scanner-subprocess';

describe('buildSubprocessEnv (Task 4 #228)', () => {
  const baseEnv = { PATH: '/usr/bin' };
  const args = {
    saneName: 'epkowa:interpreter:001:007',
    pythonExtraPath: '/repo/python',
    libusbFilterSoPath: '/repo/src/main/native/libusb-filter.so',
  };

  it('on Linux + real mode, sets LD_PRELOAD + SANE_USB_FILTER', () => {
    const env = buildSubprocessEnv({
      ...args,
      platform: 'linux',
      mock: false,
      processEnv: baseEnv,
    });
    expect(env.LD_PRELOAD).toBe('/repo/src/main/native/libusb-filter.so');
    expect(env.SANE_USB_FILTER).toBe('001:007');
  });

  it('on Linux + real mode, passes LIBUSB_ENDPOINT_RECOVERY=true by default', () => {
    const env = buildSubprocessEnv({
      ...args,
      platform: 'linux',
      mock: false,
      processEnv: baseEnv, // no LIBUSB_ENDPOINT_RECOVERY set
    });
    expect(env.LIBUSB_ENDPOINT_RECOVERY).toBe('true');
  });

  it('honors LIBUSB_ENDPOINT_RECOVERY=false when set on processEnv', () => {
    const env = buildSubprocessEnv({
      ...args,
      platform: 'linux',
      mock: false,
      processEnv: { ...baseEnv, LIBUSB_ENDPOINT_RECOVERY: 'false' },
    });
    expect(env.LIBUSB_ENDPOINT_RECOVERY).toBe('false');
  });

  it('case-insensitive: LIBUSB_ENDPOINT_RECOVERY=False → "false"', () => {
    const env = buildSubprocessEnv({
      ...args,
      platform: 'linux',
      mock: false,
      processEnv: { ...baseEnv, LIBUSB_ENDPOINT_RECOVERY: 'False' },
    });
    expect(env.LIBUSB_ENDPOINT_RECOVERY).toBe('false');
  });

  it('any non-"false" value resolves to "true" (default-on)', () => {
    const env = buildSubprocessEnv({
      ...args,
      platform: 'linux',
      mock: false,
      processEnv: { ...baseEnv, LIBUSB_ENDPOINT_RECOVERY: 'banana' },
    });
    expect(env.LIBUSB_ENDPOINT_RECOVERY).toBe('true');
  });

  it('on macOS, does NOT set LD_PRELOAD or LIBUSB_ENDPOINT_RECOVERY', () => {
    const env = buildSubprocessEnv({
      ...args,
      platform: 'darwin',
      mock: false,
      processEnv: { ...baseEnv, LIBUSB_ENDPOINT_RECOVERY: 'true' },
    });
    expect(env.LD_PRELOAD).toBeUndefined();
    expect(env.SANE_USB_FILTER).toBeUndefined();
    expect(env.LIBUSB_ENDPOINT_RECOVERY).toBeUndefined();
  });

  it('on Windows, does NOT set LD_PRELOAD or LIBUSB_ENDPOINT_RECOVERY', () => {
    const env = buildSubprocessEnv({
      ...args,
      platform: 'win32',
      mock: false,
      processEnv: { ...baseEnv, LIBUSB_ENDPOINT_RECOVERY: 'true' },
    });
    expect(env.LD_PRELOAD).toBeUndefined();
    expect(env.LIBUSB_ENDPOINT_RECOVERY).toBeUndefined();
  });

  it('in mock mode, does NOT set LD_PRELOAD or LIBUSB_ENDPOINT_RECOVERY', () => {
    const env = buildSubprocessEnv({
      ...args,
      platform: 'linux',
      mock: true,
      processEnv: { ...baseEnv, LIBUSB_ENDPOINT_RECOVERY: 'false' },
    });
    expect(env.LD_PRELOAD).toBeUndefined();
    expect(env.LIBUSB_ENDPOINT_RECOVERY).toBeUndefined();
  });

  describe('saneName validation', () => {
    it('throws when saneName has fewer than 4 colon-separated tokens', () => {
      expect(() =>
        buildSubprocessEnv({
          ...args,
          saneName: 'epkowa:interpreter:001',
          platform: 'linux',
          mock: false,
          processEnv: baseEnv,
        }),
      ).toThrow(/at least 4 colon-separated tokens/);
    });

    it('throws when USB bus is not 3-digit decimal', () => {
      expect(() =>
        buildSubprocessEnv({
          ...args,
          saneName: 'epkowa:interpreter:abc:007',
          platform: 'linux',
          mock: false,
          processEnv: baseEnv,
        }),
      ).toThrow(/3-digit decimal/);
    });

    it('throws when USB address is not 3-digit decimal', () => {
      expect(() =>
        buildSubprocessEnv({
          ...args,
          saneName: 'epkowa:interpreter:001:7',
          platform: 'linux',
          mock: false,
          processEnv: baseEnv,
        }),
      ).toThrow(/3-digit decimal/);
    });

    it('does NOT validate saneName on non-Linux (shim not loaded)', () => {
      // Should not throw even though saneName is malformed
      const env = buildSubprocessEnv({
        ...args,
        saneName: 'malformed',
        platform: 'darwin',
        mock: false,
        processEnv: baseEnv,
      });
      expect(env.LD_PRELOAD).toBeUndefined();
    });
  });

  it('preserves the input processEnv (does not mutate)', () => {
    const input = { ...baseEnv, EXISTING: 'value' };
    const env = buildSubprocessEnv({
      ...args,
      platform: 'linux',
      mock: false,
      processEnv: input,
    });
    expect(env.EXISTING).toBe('value');
    expect(input).not.toHaveProperty('LD_PRELOAD');
  });
});
