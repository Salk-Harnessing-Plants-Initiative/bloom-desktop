import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CAMERA_SETTINGS_FILE,
  createCameraSettingsSession,
  loadSavedCameraSettings,
  parseSavedCameraSettings,
  saveCameraSettings,
} from '../../src/main/camera-settings-store';
import { DEFAULT_CAMERA_SETTINGS } from '../../src/types/camera';

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-camera-settings-'));
  file = path.join(dir, CAMERA_SETTINGS_FILE);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function session(log = vi.fn()) {
  return createCameraSettingsSession({
    file,
    defaults: DEFAULT_CAMERA_SETTINGS,
    withCameraIp: (s) => ({ ...s, camera_ip_address: '10.0.0.45' }),
    log,
  });
}

describe('camera settings store', () => {
  it('saves exposure, gain and gamma only, and reads them back', async () => {
    await saveCameraSettings(file, {
      exposure_time: 12000,
      gain: 120,
      gamma: 1.2,
      camera_ip_address: '10.0.0.45',
      num_frames: 72,
    });

    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      exposure_time: 12000,
      gain: 120,
      gamma: 1.2,
    });
    expect(await loadSavedCameraSettings(file)).toEqual({
      exposure_time: 12000,
      gain: 120,
      gamma: 1.2,
    });
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });

  it('treats a missing file as no saved settings, without logging', async () => {
    const log = vi.fn();
    expect(await loadSavedCameraSettings(file, log)).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    ['not JSON', 'not json'],
    [
      'out of range',
      JSON.stringify({ exposure_time: 99, gain: 100, gamma: 1 }),
    ],
    ['missing gamma', JSON.stringify({ exposure_time: 10000, gain: 100 })],
  ])('ignores a file that is %s, and logs why', async (_, content) => {
    fs.writeFileSync(file, content);
    const log = vi.fn();

    expect(await loadSavedCameraSettings(file, log)).toBeNull();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('[Camera] Ignoring')
    );
  });

  it('refuses to save values outside the camera ranges', async () => {
    await expect(
      saveCameraSettings(file, { exposure_time: 10000, gain: 9999, gamma: 1 })
    ).rejects.toThrow('missing or out of range');
    expect(fs.existsSync(file)).toBe(false);
  });

  it('checks every limit', () => {
    const ok = { exposure_time: 100, gain: 36, gamma: 0.5 };
    expect(parseSavedCameraSettings(ok)).toEqual(ok);
    expect(
      parseSavedCameraSettings({ ...ok, exposure_time: 50001 })
    ).toBeNull();
    expect(parseSavedCameraSettings({ ...ok, gain: 513 })).toBeNull();
    expect(parseSavedCameraSettings({ ...ok, gamma: 2.1 })).toBeNull();
    expect(parseSavedCameraSettings({ ...ok, gain: Number.NaN })).toBeNull();
    expect(parseSavedCameraSettings(null)).toBeNull();
  });
});

describe('camera settings session', () => {
  it('has no settings on a station where none were ever applied', async () => {
    expect(await session().get()).toBeNull();
  });

  it('keeps applied settings across a restart (a new session)', async () => {
    const first = session();
    await first.applied({ exposure_time: 12000, gain: 120, gamma: 1.2 });
    expect(await first.get()).toMatchObject({
      exposure_time: 12000,
      source: 'applied',
    });

    const afterRestart = await session().get();

    expect(afterRestart).toMatchObject({
      exposure_time: 12000,
      gain: 120,
      gamma: 1.2,
      camera_ip_address: '10.0.0.45',
      source: 'saved',
    });
  });

  it('does not let a later first load replace settings applied this session', async () => {
    await saveCameraSettings(file, { exposure_time: 5000, gain: 50, gamma: 1 });
    const s = session();
    await s.applied({ exposure_time: 20000, gain: 200, gamma: 1.5 });

    expect(await s.get()).toMatchObject({
      exposure_time: 20000,
      source: 'applied',
    });
  });

  it('still records applied settings when saving fails, and logs it', async () => {
    const log = vi.fn();
    const s = createCameraSettingsSession({
      file: path.join(dir, 'missing-folder', CAMERA_SETTINGS_FILE),
      defaults: DEFAULT_CAMERA_SETTINGS,
      withCameraIp: (x) => x,
      log,
    });

    await s.applied({ exposure_time: 12000, gain: 120, gamma: 1.2 });

    expect(await s.get()).toMatchObject({
      exposure_time: 12000,
      source: 'applied',
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("[Camera] Couldn't save")
    );
  });
});
