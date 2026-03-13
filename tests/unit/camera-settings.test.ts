/**
 * Unit tests for Camera Settings types (fix-camera-scan-params)
 *
 * TDD: These tests verify Basler acA2000-50gm compatibility changes
 * to the CameraSettings interface and DEFAULT_CAMERA_SETTINGS.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CAMERA_SETTINGS,
  CameraSettings,
} from '../../src/types/camera';

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

  it('1.3.4 compile-time: removed fields cause TS errors', () => {
    // These @ts-expect-error comments verify that assigning removed fields
    // to CameraSettings causes a compile error. If the fields still exist,
    // the @ts-expect-error itself becomes an error (unused directive).
    // This test is validated by `tsc --noEmit` in CI.

    const validSettings: CameraSettings = {
      exposure_time: 10000,
      gain: 100,
    };
    expect(validSettings.gain).toBe(100);

    // @ts-expect-error brightness is removed from CameraSettings
    const _bad1: CameraSettings = { exposure_time: 10000, gain: 100, brightness: 0.5 };
    // @ts-expect-error contrast is removed from CameraSettings
    const _bad2: CameraSettings = { exposure_time: 10000, gain: 100, contrast: 1.0 };
    // Suppress unused variable warnings
    void _bad1;
    void _bad2;
  });
});