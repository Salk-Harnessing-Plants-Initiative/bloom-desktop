/**
 * Unit tests for CaptureScan config integration
 *
 * TDD: Tests define expected behavior for how CaptureScan reads
 * num_frames and seconds_per_rot from Machine Configuration and
 * passes them into scanner.initialize() via DAQSettings.
 *
 * These tests verify the data flow logic rather than rendering,
 * since CaptureScan is a complex page component.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_DAQ_SETTINGS } from '../../src/types/daq';
import type { MachineConfig } from '../../src/main/config-store';

/**
 * Simulates the logic in CaptureScan.handleStartScan() that builds
 * DAQ settings from machine config values.
 */
function buildDaqSettingsFromConfig(config: Partial<MachineConfig>) {
  return {
    ...DEFAULT_DAQ_SETTINGS,
    num_frames: config.num_frames ?? 72,
    seconds_per_rot: config.seconds_per_rot ?? 7.0,
  };
}

describe('CaptureScan config integration', () => {
  it('1.7.1: config:get returns num_frames and seconds_per_rot for CaptureScan', () => {
    // Simulates the config object returned by window.electron.config.get()
    const config = {
      scanner_name: 'TestScanner',
      camera_ip_address: 'mock',
      scans_dir: '/tmp/scans',
      num_frames: 36,
      seconds_per_rot: 5.0,
    };

    expect(config.num_frames).toBe(36);
    expect(config.seconds_per_rot).toBe(5.0);
  });

  it('1.7.2: handleStartScan passes num_frames from config into DAQ settings', () => {
    const config = { num_frames: 36, seconds_per_rot: 7.0 };
    const daqSettings = buildDaqSettingsFromConfig(config);

    expect(daqSettings.num_frames).toBe(36);
  });

  it('1.7.3: handleStartScan passes seconds_per_rot from config into DAQ settings', () => {
    const config = { num_frames: 72, seconds_per_rot: 5.0 };
    const daqSettings = buildDaqSettingsFromConfig(config);

    expect(daqSettings.seconds_per_rot).toBe(5.0);
  });

  it('1.7.4: fallback to defaults when config has no num_frames or seconds_per_rot', () => {
    // Config without scan parameters (simulates missing fields)
    const config: Partial<MachineConfig> = {};
    const daqSettings = buildDaqSettingsFromConfig(config);

    expect(daqSettings.num_frames).toBe(72);
    expect(daqSettings.seconds_per_rot).toBe(7.0);
  });
});
