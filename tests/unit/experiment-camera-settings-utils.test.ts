import { describe, it, expect } from 'vitest';
import {
  cameraValuesError,
  referenceList,
  roundGamma,
  sameCameraValues,
  sameLocalDay,
  type ScanSettingsGroup,
} from '../../src/utils/experiment-camera-settings';

const at = (day: number, hour = 12) => new Date(2026, 9, day, hour);

const group = (
  exposure_time: number,
  scan_count: number,
  first: number,
  last: number,
  extra: Partial<ScanSettingsGroup> = {}
): ScanSettingsGroup => ({
  exposure_time,
  gain: 250,
  gamma: 1,
  scan_count,
  first_captured: at(first),
  last_captured: at(last),
  latest_image_path: `scan-${exposure_time}/1.png`,
  ...extra,
});

describe('sameCameraValues', () => {
  it('treats gamma that differs only by float noise as the same', () => {
    expect(
      sameCameraValues(
        { exposure_time: 7400, gain: 250, gamma: 1 },
        { exposure_time: 7400, gain: 250, gamma: 1.0000001 }
      )
    ).toBe(true);
  });

  it('tells apart a different exposure, gain or gamma', () => {
    const base = { exposure_time: 7400, gain: 250, gamma: 1 };
    expect(sameCameraValues(base, { ...base, exposure_time: 7300 })).toBe(
      false
    );
    expect(sameCameraValues(base, { ...base, gain: 100 })).toBe(false);
    expect(sameCameraValues(base, { ...base, gamma: 1.1 })).toBe(false);
  });

  it('rounds gamma to two decimals', () => {
    expect(roundGamma(0.899999)).toBe(0.9);
  });
});

describe('cameraValuesError', () => {
  it('accepts values inside the limits', () => {
    expect(
      cameraValuesError({ exposure_time: 7400, gain: 250, gamma: 1 })
    ).toBeNull();
  });

  it('rejects values outside the limits, naming each', () => {
    const error = cameraValuesError({
      exposure_time: 60000,
      gain: 600,
      gamma: 1,
    });
    expect(error).toMatch(/Exposure/);
    expect(error).toMatch(/Gain/);
  });

  it('rejects an exposure that is not a whole number of µs', () => {
    expect(
      cameraValuesError({ exposure_time: 7400.5, gain: 250, gamma: 1 })
    ).toMatch(/whole number/);
  });

  it('rejects missing values', () => {
    expect(cameraValuesError({ gain: 250, gamma: 1 })).not.toBeNull();
  });
});

describe('sameLocalDay', () => {
  it('is true within one calendar day on this station', () => {
    expect(sameLocalDay(at(20, 0), at(20, 23))).toBe(true);
  });

  it('is false across midnight', () => {
    expect(
      sameLocalDay(new Date(2026, 9, 20, 23, 30), new Date(2026, 9, 21, 0, 10))
    ).toBe(false);
  });
});

describe('referenceList', () => {
  it('lists each setting with its scans, most recently used first, marking the current one', () => {
    const lines = referenceList(
      [group(7000, 36, 1, 7), group(7400, 112, 20, 31), group(7300, 48, 8, 19)],
      [],
      { exposure_time: 7400, gain: 250, gamma: 1 }
    );
    expect(
      lines.map((l) => [l.exposure_time, l.scan_count, l.is_current])
    ).toEqual([
      [7400, 112, true],
      [7300, 48, false],
      [7000, 36, false],
    ]);
    expect(lines[0]).toMatchObject({
      first_captured: at(20).toISOString(),
      last_captured: at(31).toISOString(),
      latest_image_path: 'scan-7400/1.png',
    });
    // Only what the panel shows: no sort key left behind.
    expect(Object.keys(lines[0])).not.toContain('usedAt');
  });

  it('merges settings whose gamma differs only by float noise', () => {
    const lines = referenceList(
      [
        group(7400, 10, 1, 5, { gamma: 1 }),
        group(7400, 5, 3, 9, {
          gamma: 1.0000001,
          latest_image_path: 'newer/1.png',
        }),
      ],
      [],
      null
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      scan_count: 15,
      gamma: 1,
      first_captured: at(1).toISOString(),
      last_captured: at(9).toISOString(),
      latest_image_path: 'newer/1.png',
    });
  });

  it('adds saved settings no scan used yet, by when they were saved', () => {
    const lines = referenceList(
      [group(7400, 112, 20, 25)],
      [
        { exposure_time: 7900, gain: 250, gamma: 1, created_at: at(28) },
        { exposure_time: 7400, gain: 250, gamma: 1, created_at: at(20) },
      ],
      { exposure_time: 7900, gain: 250, gamma: 1 }
    );
    expect(
      lines.map((l) => [l.exposure_time, l.scan_count, l.is_current])
    ).toEqual([
      [7900, 0, true],
      [7400, 112, false],
    ]);
    expect(lines[0]).toMatchObject({
      first_captured: null,
      last_captured: null,
      latest_image_path: null,
    });
  });

  it('is empty for a new experiment', () => {
    expect(referenceList([], [], null)).toEqual([]);
  });
});
