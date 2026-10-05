/**
 * Unit tests for camera-ip module (#390)
 *
 * Machine Configuration's saved camera_ip_address must reach every set of
 * camera settings the main process forwards to Python, overriding whatever
 * the renderer sent.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  getDefaultConfig,
  loadEnvConfig,
  saveEnvConfig,
} from '../../src/main/config-store';
import {
  readConfiguredCameraIp,
  applyCameraIp,
  applyScannerCameraIp,
} from '../../src/main/cylinderscan/camera-ip';
import type { CameraSettings } from '../../src/types/camera';
import type { ScannerSettings } from '../../src/types/scanner';
import type { DAQSettings } from '../../src/types/daq';

const CONFIGURED_IP = '10.0.0.23';

function makeCameraSettings(
  overrides?: Partial<CameraSettings>
): CameraSettings {
  return {
    exposure_time: 10000,
    gain: 100,
    camera_ip_address: 'mock',
    gamma: 1.0,
    ...overrides,
  };
}

function makeScannerSettings(): ScannerSettings {
  const daq: DAQSettings = {
    device_name: 'cDAQ1Mod1',
    sampling_rate: 40000,
    step_pin: 0,
    dir_pin: 1,
    steps_per_revolution: 6400,
    num_frames: 72,
    seconds_per_rot: 7.0,
  };
  return {
    camera: makeCameraSettings(),
    daq,
    num_frames: 72,
    output_path: '/tmp/scans/2026-10-05/PLANT-1/uuid',
  };
}

describe('readConfiguredCameraIp', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the saved camera IP', () => {
    expect(
      readConfiguredCameraIp(() => ({ camera_ip_address: CONFIGURED_IP }))
    ).toBe(CONFIGURED_IP);
  });

  it("returns 'mock' when that is the saved value", () => {
    expect(readConfiguredCameraIp(() => ({ camera_ip_address: 'mock' }))).toBe(
      'mock'
    );
  });

  it('trims surrounding whitespace', () => {
    expect(
      readConfiguredCameraIp(() => ({ camera_ip_address: '  10.0.0.23 \n' }))
    ).toBe(CONFIGURED_IP);
  });

  it('returns null when the saved value is empty', () => {
    expect(readConfiguredCameraIp(() => ({ camera_ip_address: '' }))).toBe(
      null
    );
  });

  it('returns null when the saved value is whitespace only', () => {
    expect(readConfiguredCameraIp(() => ({ camera_ip_address: '   ' }))).toBe(
      null
    );
  });

  it('returns null when the field is missing', () => {
    expect(readConfiguredCameraIp(() => ({}))).toBe(null);
  });

  it('returns null and logs with [CameraIP] prefix when the loader throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = readConfiguredCameraIp(() => {
      throw new Error('EACCES: permission denied');
    });
    expect(result).toBe(null);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('[CameraIP]');
    expect(warn.mock.calls[0][1]).toBe('EACCES: permission denied');
  });

  it('logs "Unknown error" when the loader throws a non-Error', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    readConfiguredCameraIp(() => {
      throw 'boom';
    });
    expect(warn.mock.calls[0][1]).toBe('Unknown error');
  });
});

describe('readConfiguredCameraIp with the real config-store', () => {
  let tmpDir: string;

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function envPathIn(dir: string): string {
    return path.join(dir, '.env');
  }

  it('reads CAMERA_IP_ADDRESS saved by saveEnvConfig', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-camera-ip-'));
    const envPath = envPathIn(tmpDir);
    saveEnvConfig(
      { ...getDefaultConfig(), camera_ip_address: CONFIGURED_IP },
      envPath
    );

    expect(readConfiguredCameraIp(() => loadEnvConfig(envPath))).toBe(
      CONFIGURED_IP
    );
  });

  it("falls back to the default 'mock' when no .env exists", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-camera-ip-'));

    expect(readConfiguredCameraIp(() => loadEnvConfig(envPathIn(tmpDir)))).toBe(
      'mock'
    );
  });

  it('applies the saved IP end to end to scanner settings', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-camera-ip-'));
    const envPath = envPathIn(tmpDir);
    saveEnvConfig(
      { ...getDefaultConfig(), camera_ip_address: CONFIGURED_IP },
      envPath
    );

    const ip = readConfiguredCameraIp(() => loadEnvConfig(envPath));
    const result = applyScannerCameraIp(makeScannerSettings(), ip);

    expect(result.camera.camera_ip_address).toBe(CONFIGURED_IP);
  });
});

describe('applyCameraIp', () => {
  it("replaces the renderer's 'mock' default with the configured IP", () => {
    const result = applyCameraIp(makeCameraSettings(), CONFIGURED_IP);
    expect(result?.camera_ip_address).toBe(CONFIGURED_IP);
  });

  it('adds the configured IP when the renderer sent none', () => {
    const result = applyCameraIp(
      { exposure_time: 5000, gain: 200 },
      CONFIGURED_IP
    );
    expect(result).toEqual({
      exposure_time: 5000,
      gain: 200,
      camera_ip_address: CONFIGURED_IP,
    });
  });

  it('overrides a different IP sent by the renderer', () => {
    const result = applyCameraIp(
      makeCameraSettings({ camera_ip_address: '192.168.1.50' }),
      CONFIGURED_IP
    );
    expect(result?.camera_ip_address).toBe(CONFIGURED_IP);
  });

  it('leaves every other field unchanged', () => {
    const settings = makeCameraSettings({
      exposure_time: 12345,
      gain: 321,
      gamma: 1.4,
      num_frames: 36,
      seconds_per_rot: 5,
    });
    const result = applyCameraIp(settings, CONFIGURED_IP);
    expect(result).toEqual({ ...settings, camera_ip_address: CONFIGURED_IP });
  });

  it('works on partial settings (camera:configure payload)', () => {
    const result = applyCameraIp({ gain: 150 }, CONFIGURED_IP);
    expect(result).toEqual({ gain: 150, camera_ip_address: CONFIGURED_IP });
  });

  it('does not mutate the input object', () => {
    const settings = makeCameraSettings();
    const snapshot = { ...settings };
    applyCameraIp(settings, CONFIGURED_IP);
    expect(settings).toEqual(snapshot);
  });

  it('returns a new object when it applies the IP', () => {
    const settings = makeCameraSettings();
    expect(applyCameraIp(settings, CONFIGURED_IP)).not.toBe(settings);
  });

  it('returns undefined unchanged (no settings sent)', () => {
    expect(applyCameraIp(undefined, CONFIGURED_IP)).toBeUndefined();
  });

  it('returns the settings as sent when no IP is configured', () => {
    const settings = makeCameraSettings({ camera_ip_address: '192.168.1.50' });
    expect(applyCameraIp(settings, null)).toBe(settings);
  });

  it('returns undefined when no settings and no IP', () => {
    expect(applyCameraIp(undefined, null)).toBeUndefined();
  });
});

describe('applyScannerCameraIp', () => {
  it('applies the configured IP to settings.camera', () => {
    const result = applyScannerCameraIp(makeScannerSettings(), CONFIGURED_IP);
    expect(result.camera.camera_ip_address).toBe(CONFIGURED_IP);
  });

  it('leaves the rest of camera settings unchanged', () => {
    const settings = makeScannerSettings();
    const result = applyScannerCameraIp(settings, CONFIGURED_IP);
    expect(result.camera).toEqual({
      ...settings.camera,
      camera_ip_address: CONFIGURED_IP,
    });
  });

  it('leaves daq, num_frames, output_path and metadata unchanged', () => {
    const settings: ScannerSettings = {
      ...makeScannerSettings(),
      metadata: {
        experiment_id: 'exp-1',
        phenotyper_id: 'ph-1',
        scanner_name: 'PBIOBScanner',
        plant_id: 'PLANT-1',
        plant_age_days: 14,
        wave_number: 0,
        scan_path: '2026-10-05/PLANT-1/uuid',
      },
    };
    const result = applyScannerCameraIp(settings, CONFIGURED_IP);
    expect(result.daq).toBe(settings.daq);
    expect(result.num_frames).toBe(settings.num_frames);
    expect(result.output_path).toBe(settings.output_path);
    expect(result.metadata).toBe(settings.metadata);
  });

  it('does not mutate the input settings or its camera object', () => {
    const settings = makeScannerSettings();
    const cameraSnapshot = { ...settings.camera };
    applyScannerCameraIp(settings, CONFIGURED_IP);
    expect(settings.camera).toEqual(cameraSnapshot);
  });

  it('returns the settings as sent when no IP is configured', () => {
    const settings = makeScannerSettings();
    expect(applyScannerCameraIp(settings, null)).toBe(settings);
  });
});
