/**
 * Unit tests for Camera Settings types (fix-camera-scan-params)
 *
 * TDD: These tests verify Basler acA2000-50gm compatibility changes
 * to the CameraSettings interface and DEFAULT_CAMERA_SETTINGS.
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_CAMERA_SETTINGS } from '../../src/types/camera';

describe('Camera Settings Types (Basler acA2000-50gm)', () => {
  it('1.3.1 DEFAULT_CAMERA_SETTINGS.gain is 100', () => {
    expect(DEFAULT_CAMERA_SETTINGS.gain).toBe(100);
  });

  it('1.3.2 DEFAULT_CAMERA_SETTINGS.gamma is 1.0', () => {
    expect(DEFAULT_CAMERA_SETTINGS.gamma).toBe(1.0);
  });

  it('1.3.3 DEFAULT_CAMERA_SETTINGS does NOT have brightness, contrast, width, or height', () => {
    expect('brightness' in DEFAULT_CAMERA_SETTINGS).toBe(false);
    expect('contrast' in DEFAULT_CAMERA_SETTINGS).toBe(false);
    expect('width' in DEFAULT_CAMERA_SETTINGS).toBe(false);
    expect('height' in DEFAULT_CAMERA_SETTINGS).toBe(false);
  });

  it('1.3.4 CameraSettings interface does not include removed fields', () => {
    // Runtime check: verify DEFAULT_CAMERA_SETTINGS keys don't include removed fields.
    // Note: tsconfig.json only includes src/**/* so @ts-expect-error in tests
    // would NOT be validated by `tsc --noEmit` in CI. Use runtime checks instead.
    const keys = Object.keys(DEFAULT_CAMERA_SETTINGS);
    expect(keys).not.toContain('brightness');
    expect(keys).not.toContain('contrast');
    expect(keys).not.toContain('width');
    expect(keys).not.toContain('height');

    // Verify the interface only has expected fields
    const expectedFields = [
      'exposure_time',
      'gain',
      'gamma',
      'camera_ip_address',
    ];
    for (const key of keys) {
      expect(expectedFields).toContain(key);
    }
  });
});
