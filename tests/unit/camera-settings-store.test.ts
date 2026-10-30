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
  saveErrorCode,
} from '../../src/main/camera-settings-store';
import {
  DEFAULT_CAMERA_SETTINGS,
  formatCameraSetting,
  withoutSource,
} from '../../src/types/camera';

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
    expect(fs.readdirSync(dir)).toEqual([CAMERA_SETTINGS_FILE]);
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
    ).rejects.toMatchObject({ code: 'CAM-SAVE-01' });
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

  it('still records applied settings when saving fails, and says why with a code', async () => {
    const log = vi.fn();
    // A file where the folder should be: the folder can't be created.
    const blocker = path.join(dir, 'not-a-folder');
    fs.writeFileSync(blocker, '');
    const s = createCameraSettingsSession({
      file: path.join(blocker, CAMERA_SETTINGS_FILE),
      defaults: DEFAULT_CAMERA_SETTINGS,
      withCameraIp: (x) => x,
      log,
    });

    const result = await s.applied({
      exposure_time: 12000,
      gain: 120,
      gamma: 1.2,
    });

    expect(result.saved).toBe(false);
    expect(result.saveError?.code).toMatch(/^CAM-SAVE-/);
    // Still applied this session, and the reason is kept for when the page reopens.
    expect(await s.get()).toMatchObject({
      exposure_time: 12000,
      source: 'applied-unsaved',
      saveError: result.saveError,
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        "[Camera] Couldn't save the camera settings (CAM-SAVE-"
      )
    );
  });

  it('reports values the camera took but the file refuses as CAM-SAVE-01', async () => {
    const result = await session().applied({
      exposure_time: 60000,
      gain: 100,
      gamma: 1,
    });

    expect(result).toMatchObject({
      saved: false,
      saveError: { code: 'CAM-SAVE-01' },
    });
    expect(fs.existsSync(file)).toBe(false);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'reports a read-only folder as CAM-SAVE-02',
    async () => {
      fs.chmodSync(dir, 0o500);
      try {
        const result = await session().applied({
          exposure_time: 12000,
          gain: 120,
          gamma: 1.2,
        });
        expect(result.saveError?.code).toBe('CAM-SAVE-02');
      } finally {
        fs.chmodSync(dir, 0o700);
      }
    }
  );

  it('clears the saved-error once a later Apply is saved', async () => {
    const s = session();
    await s.applied({ exposure_time: 60000, gain: 100, gamma: 1 });
    await s.applied({ exposure_time: 12000, gain: 120, gamma: 1.2 });

    const current = await s.get();
    expect(current).toMatchObject({ source: 'applied' });
    expect(current).not.toHaveProperty('saveError');
  });

  it('keeps settings applied while the first load is still reading the file', async () => {
    await saveCameraSettings(file, { exposure_time: 5000, gain: 50, gamma: 1 });
    const s = session();

    const loading = s.get();
    await s.applied({ exposure_time: 20000, gain: 200, gamma: 1.5 });
    await loading;

    expect(await s.get()).toMatchObject({
      exposure_time: 20000,
      source: 'applied',
    });
  });

  it('reports a successful save', async () => {
    const result = await session().applied({
      exposure_time: 12000,
      gain: 120,
      gamma: 1.2,
    });
    expect(result.saved).toBe(true);
    expect(result.saveError).toBeUndefined();
  });

  it('creates the .bloom folder if it is missing', async () => {
    const nested = path.join(dir, 'new-home', '.bloom', CAMERA_SETTINGS_FILE);
    await saveCameraSettings(nested, {
      exposure_time: 12000,
      gain: 120,
      gamma: 1.2,
    });
    expect(await loadSavedCameraSettings(nested)).toMatchObject({ gain: 120 });
  });

  it('replaces an existing file when saving again', async () => {
    await saveCameraSettings(file, {
      exposure_time: 12000,
      gain: 120,
      gamma: 1.2,
    });
    await saveCameraSettings(file, {
      exposure_time: 15000,
      gain: 150,
      gamma: 1.4,
    });
    expect(await loadSavedCameraSettings(file)).toEqual({
      exposure_time: 15000,
      gain: 150,
      gamma: 1.4,
    });
    expect(fs.readdirSync(dir)).toEqual([CAMERA_SETTINGS_FILE]);
  });

  it('saves two Applies at once without their temp files colliding', async () => {
    await Promise.all([
      saveCameraSettings(file, { exposure_time: 12000, gain: 120, gamma: 1.2 }),
      saveCameraSettings(file, { exposure_time: 15000, gain: 150, gamma: 1.4 }),
    ]);

    expect(fs.readdirSync(dir)).toEqual([CAMERA_SETTINGS_FILE]);
    expect(await loadSavedCameraSettings(file)).not.toBeNull();
  });

  it('leaves the old file intact when the new one cannot be written', async () => {
    await saveCameraSettings(file, {
      exposure_time: 12000,
      gain: 120,
      gamma: 1.2,
    });
    const writeFile = vi
      .spyOn(fs.promises, 'writeFile')
      .mockRejectedValueOnce(
        Object.assign(new Error('ENOSPC: no space left'), { code: 'ENOSPC' })
      );
    try {
      await expect(
        saveCameraSettings(file, {
          exposure_time: 15000,
          gain: 150,
          gamma: 1.4,
        })
      ).rejects.toMatchObject({ code: 'CAM-SAVE-03' });
    } finally {
      writeFile.mockRestore();
    }

    expect(await loadSavedCameraSettings(file)).toEqual({
      exposure_time: 12000,
      gain: 120,
      gamma: 1.2,
    });
    expect(fs.readdirSync(dir)).toEqual([CAMERA_SETTINGS_FILE]);
  });

  it('gives callers that arrive during the first load the saved settings too', async () => {
    await saveCameraSettings(file, {
      exposure_time: 12000,
      gain: 120,
      gamma: 1.2,
    });
    const s = session();

    const [first, second] = await Promise.all([s.get(), s.get()]);

    expect(first).toMatchObject({ exposure_time: 12000, source: 'saved' });
    expect(second).toMatchObject({ exposure_time: 12000, source: 'saved' });
  });
});

describe('save error codes', () => {
  it.each([
    ['EACCES', 'CAM-SAVE-02'],
    ['EPERM', 'CAM-SAVE-02'],
    ['EROFS', 'CAM-SAVE-02'],
    ['ENOSPC', 'CAM-SAVE-03'],
    ['EBUSY', 'CAM-SAVE-04'],
    ['EIO', 'CAM-SAVE-99'],
  ])('maps %s to %s', (errno, code) => {
    expect(
      saveErrorCode(Object.assign(new Error(errno), { code: errno }))
    ).toBe(code);
  });
});

describe('withoutSource', () => {
  it('drops where the settings came from and keeps the camera values', () => {
    expect(
      withoutSource({
        exposure_time: 12000,
        gain: 120,
        gamma: 1.2,
        source: 'saved',
      })
    ).toEqual({ exposure_time: 12000, gain: 120, gamma: 1.2 });
  });

  it('drops a save error too', () => {
    expect(
      withoutSource({
        exposure_time: 12000,
        gain: 120,
        source: 'applied-unsaved',
        saveError: { code: 'CAM-SAVE-02', message: 'EPERM' },
      })
    ).toEqual({ exposure_time: 12000, gain: 120 });
  });
});

describe('formatCameraSetting', () => {
  it('shows gamma with one decimal and other values with thousands separators', () => {
    expect(formatCameraSetting('gamma', 2)).toBe('2.0');
    expect(formatCameraSetting('gamma', 0.8)).toBe('0.8');
    expect(formatCameraSetting('exposure_time', 12000)).toBe('12,000');
    expect(formatCameraSetting('gain', 120)).toBe('120');
  });
});
