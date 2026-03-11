/**
 * Unit tests for Camera Settings types
 *
 * TDD: These tests define expected behavior for the CameraSettings
 * interface and DEFAULT_CAMERA_SETTINGS after Basler acA2000-50gm fixes.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_CAMERA_SETTINGS } from '../../src/types/camera';
import type { CameraSettings } from '../../src/types/camera';

describe('Camera Settings Types', () => {
  describe('DEFAULT_CAMERA_SETTINGS', () => {
    it('1.3.1: gain default is 100', () => {
      expect(DEFAULT_CAMERA_SETTINGS.gain).toBe(100);
    });

    it('1.3.2: gamma default is 1.0', () => {
      expect(DEFAULT_CAMERA_SETTINGS.gamma).toBe(1.0);
    });

    it('1.3.3: does NOT have brightness, contrast, width, or height', () => {
      // After implementation, these fields are removed from the interface entirely
      expect(DEFAULT_CAMERA_SETTINGS).not.toHaveProperty('brightness');
      expect(DEFAULT_CAMERA_SETTINGS).not.toHaveProperty('contrast');
      expect(DEFAULT_CAMERA_SETTINGS).not.toHaveProperty('width');
      expect(DEFAULT_CAMERA_SETTINGS).not.toHaveProperty('height');
    });
  });

  describe('CameraSettings interface', () => {
    it('1.3.4: compile-time check - removed fields cause TS errors', () => {
      // This test validates at compile time (tsc --noEmit) that removed
      // fields are not assignable. The @ts-expect-error directives will
      // cause a TS error if the fields still exist (test fails at compile time).
      const validSettings: CameraSettings = {
        exposure_time: 10000,
        gain: 100,
        gamma: 1.0,
      };
      expect(validSettings.gain).toBe(100);

      // These should cause TS errors after implementation (validated by tsc --noEmit)
      // @ts-expect-error brightness removed from CameraSettings
      const _withBrightness: CameraSettings = {
        exposure_time: 10000,
        gain: 100,
        brightness: 0.5,
      };
      // @ts-expect-error contrast removed from CameraSettings
      const _withContrast: CameraSettings = {
        exposure_time: 10000,
        gain: 100,
        contrast: 1.0,
      };
      // @ts-expect-error width removed from CameraSettings
      const _withWidth: CameraSettings = {
        exposure_time: 10000,
        gain: 100,
        width: 640,
      };
      // @ts-expect-error height removed from CameraSettings
      const _withHeight: CameraSettings = {
        exposure_time: 10000,
        gain: 100,
        height: 480,
      };

      // Suppress unused variable warnings
      void _withBrightness;
      void _withContrast;
      void _withWidth;
      void _withHeight;
    });
  });
});
