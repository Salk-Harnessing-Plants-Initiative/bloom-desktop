/**
 * What a scan needs from the station's configuration (#477): its scanner name, scans
 * folder, frame count and rotation time, all from ~/.bloom/.env. Capture Scan has no
 * values of its own to fall back on: a missing one is a problem to show, not a default.
 */

import type { MachineConfig } from '../../main/config-store';

export interface ScanStationSettings {
  scanner_name: string;
  scans_dir: string;
  num_frames: number;
  seconds_per_rot: number;
}

export type ScanStationCheck =
  | { settings: ScanStationSettings; problem: null }
  | { settings: null; problem: string };

const SET_IT = 'Set it in Machine Configuration.';

export function scanStationSettings(
  config: MachineConfig | null,
  loadError: string | null
): ScanStationCheck {
  const problem = (text: string): ScanStationCheck => ({
    settings: null,
    problem: text,
  });
  if (loadError) return problem(loadError);
  if (!config) return problem("This station's settings haven't loaded.");
  const scannerName = config.scanner_name?.trim() ?? '';
  const scansDir = config.scans_dir?.trim() ?? '';
  if (!scannerName) {
    return problem(`This station has no scanner name. ${SET_IT}`);
  }
  if (!scansDir) {
    return problem(`This station has no scans folder. ${SET_IT}`);
  }
  if (!(typeof config.num_frames === 'number' && config.num_frames > 0)) {
    return problem(`This station has no frame count. ${SET_IT}`);
  }
  if (
    !(typeof config.seconds_per_rot === 'number' && config.seconds_per_rot > 0)
  ) {
    return problem(`This station has no rotation time. ${SET_IT}`);
  }
  return {
    settings: {
      scanner_name: scannerName,
      scans_dir: scansDir,
      num_frames: config.num_frames,
      seconds_per_rot: config.seconds_per_rot,
    },
    problem: null,
  };
}
