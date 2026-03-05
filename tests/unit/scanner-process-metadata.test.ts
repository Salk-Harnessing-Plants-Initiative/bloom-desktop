/**
 * Scanner Process Metadata Integration Tests
 *
 * Tests that ScannerProcess.scan() correctly writes metadata.json
 * before sending the scan command to Python. Uses a mock PythonProcess
 * to avoid needing the real Python backend.
 *
 * These are vitest-runnable "integration" tests that verify the wiring
 * between scanner-process.ts and metadata-json.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScannerProcess } from '../../src/main/scanner-process';
import type { ScannerSettings } from '../../src/types/scanner';

// Mock the database module (not needed for metadata tests)
vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => ({
    scan: {
      create: vi.fn().mockResolvedValue({ id: 'mock-scan-id' }),
    },
  })),
}));

/** Create a mock PythonProcess */
function createMockPythonProcess() {
  return {
    sendCommand: vi.fn().mockResolvedValue({
      success: true,
      frames_captured: 72,
      output_path: '',
    }),
    // PythonProcess extends EventEmitter, but we only need sendCommand
  };
}

/** Test scanner settings with metadata */
function makeTestSettings(outputPath: string): ScannerSettings {
  return {
    camera: {
      exposure_time: 10000,
      gain: 100,
      brightness: 0.5,
      contrast: 1,
      gamma: 1,
    },
    daq: {
      device_name: 'cDAQ1Mod1',
      sampling_rate: 40000,
      step_pin: 0,
      dir_pin: 1,
      steps_per_revolution: 6400,
      num_frames: 72,
      seconds_per_rot: 7,
    },
    num_frames: 72,
    output_path: outputPath,
    metadata: {
      experiment_id: 'exp-123',
      phenotyper_id: 'phen-456',
      scanner_name: 'TestScanner',
      plant_id: 'PLANT-001',
      accession_name: 'Col-0',
      plant_age_days: 14,
      wave_number: 1,
    },
  };
}

describe('ScannerProcess metadata.json integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'bloom-scanner-meta-test-')
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should write metadata.json before sending scan command', async () => {
    const mockPython = createMockPythonProcess();
    const outputPath = path.join(tmpDir, 'scan-output');

    // Track when metadata.json was written vs when sendCommand was called
    let metadataExistedBeforeScan = false;
    mockPython.sendCommand.mockImplementation(async () => {
      // Check if metadata.json exists when Python command is sent
      metadataExistedBeforeScan = fs.existsSync(
        path.join(outputPath, 'metadata.json')
      );
      return {
        success: true,
        frames_captured: 72,
        output_path: outputPath,
      };
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scanner = new ScannerProcess(mockPython as any);
    await scanner.initialize(makeTestSettings(outputPath));
    await scanner.scan();

    // metadata.json should have existed BEFORE the Python command was sent
    expect(metadataExistedBeforeScan).toBe(true);
  });

  it('should write metadata.json with correct content', async () => {
    const mockPython = createMockPythonProcess();
    const outputPath = path.join(tmpDir, 'scan-output-2');

    mockPython.sendCommand.mockResolvedValue({
      success: true,
      frames_captured: 72,
      output_path: outputPath,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scanner = new ScannerProcess(mockPython as any);
    await scanner.initialize(makeTestSettings(outputPath));
    await scanner.scan();

    const metadataPath = path.join(outputPath, 'metadata.json');
    expect(fs.existsSync(metadataPath)).toBe(true);

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));

    // Verify all fields from pilot format
    expect(metadata.id).toBeDefined();
    expect(typeof metadata.id).toBe('string');
    expect(metadata.phenotyper_id).toBe('phen-456');
    expect(metadata.experiment_id).toBe('exp-123');
    expect(metadata.scanner_name).toBe('TestScanner');
    expect(metadata.plant_id).toBe('PLANT-001');
    expect(metadata.accession_name).toBe('Col-0');
    expect(metadata.wave_number).toBe(1);
    expect(metadata.plant_age_days).toBe(14);
    expect(metadata.path).toBe(outputPath);
    expect(metadata.capture_date).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
    );
    expect(metadata.num_frames).toBe(72);
    expect(metadata.exposure_time).toBe(10000);
    expect(metadata.gain).toBe(100);
    expect(metadata.brightness).toBe(0.5);
    expect(metadata.contrast).toBe(1);
    expect(metadata.gamma).toBe(1);
    expect(metadata.seconds_per_rot).toBe(7);
  });

  it('should proceed with scan even if metadata write fails', async () => {
    const mockPython = createMockPythonProcess();
    // Use invalid path to trigger write failure
    const outputPath = '/dev/null/impossible/path';

    mockPython.sendCommand.mockResolvedValue({
      success: true,
      frames_captured: 72,
      output_path: outputPath,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scanner = new ScannerProcess(mockPython as any);
    await scanner.initialize(makeTestSettings(outputPath));

    // scan should not throw even if metadata write fails
    const result = await scanner.scan();
    expect(result.success).toBe(true);

    // Python sendCommand should still have been called
    expect(mockPython.sendCommand).toHaveBeenCalledWith({
      command: 'scanner',
      action: 'scan',
    });
  });

  it('should not write metadata.json when no metadata is provided', async () => {
    const mockPython = createMockPythonProcess();
    const outputPath = path.join(tmpDir, 'no-metadata');

    mockPython.sendCommand.mockResolvedValue({
      success: true,
      frames_captured: 72,
      output_path: outputPath,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scanner = new ScannerProcess(mockPython as any);
    // Initialize WITHOUT metadata
    await scanner.initialize({
      camera: { exposure_time: 10000, gain: 0 },
      daq: {
        device_name: 'cDAQ1Mod1',
        sampling_rate: 40000,
        step_pin: 0,
        dir_pin: 1,
        steps_per_revolution: 6400,
        num_frames: 72,
        seconds_per_rot: 7,
      },
      output_path: outputPath,
    });
    await scanner.scan();

    // metadata.json should NOT exist
    expect(
      fs.existsSync(path.join(outputPath, 'metadata.json'))
    ).toBe(false);
  });
});
