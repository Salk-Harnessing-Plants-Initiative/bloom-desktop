/**
 * Unit Tests: CaptureScan — Scan Parameter Usage
 *
 * Tests that scan initialization uses cameraSettings.num_frames and
 * seconds_per_rot instead of hardcoded values.
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_DAQ_SETTINGS } from '../../../src/types/daq';
import {
  DEFAULT_CAMERA_SETTINGS,
  type CameraSettings,
} from '../../../src/types/camera';

/**
 * Extracts the scanner initialization logic from CaptureScan.
 * This mirrors the exact logic in handleStartScan.
 */
function buildScannerInitArgs(cameraSettings: CameraSettings) {
  return {
    camera: cameraSettings,
    daq: {
      ...DEFAULT_DAQ_SETTINGS,
      seconds_per_rot:
        cameraSettings.seconds_per_rot ?? DEFAULT_DAQ_SETTINGS.seconds_per_rot,
      num_frames: cameraSettings.num_frames ?? DEFAULT_DAQ_SETTINGS.num_frames,
    },
    num_frames: cameraSettings.num_frames ?? 72,
  };
}

describe('CaptureScan — Scan Parameter Usage', () => {
  it('uses cameraSettings.num_frames (not hardcoded 72) when initializing scanner', () => {
    const settings: CameraSettings = {
      ...DEFAULT_CAMERA_SETTINGS,
      num_frames: 48,
    };

    const args = buildScannerInitArgs(settings);

    // Should use 48 from camera settings, NOT the hardcoded 72
    expect(args.num_frames).toBe(48);
  });

  it('passes seconds_per_rot from cameraSettings to DAQ settings', () => {
    const settings: CameraSettings = {
      ...DEFAULT_CAMERA_SETTINGS,
      seconds_per_rot: 5.5,
      num_frames: 48,
    };

    const args = buildScannerInitArgs(settings);

    // DAQ settings should use seconds_per_rot from camera settings (5.5)
    expect(args.daq.seconds_per_rot).toBe(5.5);
    // DAQ settings should also use num_frames from camera settings
    expect(args.daq.num_frames).toBe(48);
  });

  it('falls back to DEFAULT_DAQ_SETTINGS when cameraSettings fields are undefined', () => {
    const settings: CameraSettings = {
      exposure_time: 10000,
      gain: 0,
      // num_frames and seconds_per_rot not set
    };

    const args = buildScannerInitArgs(settings);

    // Should fall back to DAQ defaults
    expect(args.num_frames).toBe(72);
    expect(args.daq.seconds_per_rot).toBe(DEFAULT_DAQ_SETTINGS.seconds_per_rot);
    expect(args.daq.num_frames).toBe(DEFAULT_DAQ_SETTINGS.num_frames);
  });

  it('preserves other DAQ settings when overriding scan params', () => {
    const settings: CameraSettings = {
      ...DEFAULT_CAMERA_SETTINGS,
      seconds_per_rot: 4.0,
      num_frames: 36,
    };

    const args = buildScannerInitArgs(settings);

    // Overridden values
    expect(args.daq.seconds_per_rot).toBe(4.0);
    expect(args.daq.num_frames).toBe(36);

    // Preserved DAQ defaults
    expect(args.daq.device_name).toBe(DEFAULT_DAQ_SETTINGS.device_name);
    expect(args.daq.sampling_rate).toBe(DEFAULT_DAQ_SETTINGS.sampling_rate);
    expect(args.daq.steps_per_revolution).toBe(
      DEFAULT_DAQ_SETTINGS.steps_per_revolution
    );
  });

  it('CaptureScan.tsx no longer contains hardcoded num_frames: 72 in scanner init', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../src/renderer/CaptureScan.tsx'),
      'utf-8'
    );

    // Should NOT have the old hardcoded pattern
    expect(source).not.toMatch(/num_frames:\s*72,\s*\n\s*output_path/);

    // Should have the new pattern using cameraSettings
    expect(source).toContain('cameraSettings.num_frames');
    expect(source).toContain('cameraSettings.seconds_per_rot');
  });
});
