/**
 * window.electron.database.experimentCameraSettings for Capture Scan tests (#483):
 * by default the experiment's camera settings were checked today by this phenotyper,
 * so Capture Scan scans as it did before the per-experiment check.
 */

import { vi } from 'vitest';
import type { ExperimentCameraSettingsStatus } from '../../../src/types/experiment-camera-settings';

export const CHECKED_TODAY_STATUS: ExperimentCameraSettingsStatus = {
  current: {
    id: 'cam-1',
    exposure_time: 10000,
    gain: 100,
    gamma: 1,
    note: 'Initial settings',
    set_by_name: 'Demo Phenotyper',
    copied_from_scans: false,
    created_at: new Date().toISOString(),
    last_confirmed_at: new Date().toISOString(),
    last_confirmed_by_name: 'Demo Phenotyper',
  },
  confirmedToday: true,
  changedToday: null,
};

export function experimentCameraSettingsMock(
  status: ExperimentCameraSettingsStatus = CHECKED_TODAY_STATUS
) {
  return {
    status: vi.fn().mockResolvedValue({ success: true, data: status }),
    history: vi.fn().mockResolvedValue({ success: true, data: [] }),
    reference: vi.fn().mockResolvedValue({ success: true, data: [] }),
    confirm: vi.fn().mockResolvedValue({
      success: true,
      data: CHECKED_TODAY_STATUS,
    }),
  };
}
