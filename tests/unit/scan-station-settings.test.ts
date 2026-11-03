import { describe, it, expect } from 'vitest';
import { scanStationSettings } from '../../src/renderer/utils/scan-station-settings';
import type { MachineConfig } from '../../src/main/config-store';

const config = (extra: Partial<MachineConfig> = {}) =>
  ({
    scanner_mode: 'cylinderscan',
    scanner_name: 'PBIOBScanner',
    scans_dir: '/scans',
    num_frames: 72,
    seconds_per_rot: 7,
    ...extra,
  }) as MachineConfig;

describe('scanStationSettings (#477)', () => {
  it("gives the station's scanner name, folder, frames and rotation", () => {
    expect(
      scanStationSettings(config({ scanner_name: ' PBIOBScanner ' }), null)
    ).toEqual({
      settings: {
        scanner_name: 'PBIOBScanner',
        scans_dir: '/scans',
        num_frames: 72,
        seconds_per_rot: 7,
      },
      problem: null,
    });
  });

  it('passes on why the settings could not be read', () => {
    expect(scanStationSettings(config(), 'EACCES')).toEqual({
      settings: null,
      problem: 'EACCES',
    });
  });

  it.each([
    [
      { scanner_name: '' },
      'This station has no scanner name. Set it in Machine Configuration.',
    ],
    [
      { scans_dir: '  ' },
      'This station has no scans folder. Set it in Machine Configuration.',
    ],
    [
      { num_frames: 0 },
      'This station has no frame count. Set it in Machine Configuration.',
    ],
    [
      { seconds_per_rot: undefined as unknown as number },
      'This station has no rotation time. Set it in Machine Configuration.',
    ],
  ])('names what is missing: %o', (missing, problem) => {
    expect(scanStationSettings(config(missing), null)).toEqual({
      settings: null,
      problem,
    });
  });

  it('has nothing to scan with before the settings load', () => {
    expect(scanStationSettings(null, null).settings).toBeNull();
  });
});
