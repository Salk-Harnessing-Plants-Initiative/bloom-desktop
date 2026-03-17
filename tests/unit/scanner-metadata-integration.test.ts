/**
 * Integration test: metadata.json is written BEFORE scan command
 *
 * Verifies that ScannerProcess.scan() writes metadata.json to disk
 * before sending the scan command to the Python process.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock database module before importing ScannerProcess
vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(),
}));

import { ScannerProcess } from '../../src/main/scanner-process';

describe('ScannerProcess metadata.json integration', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'bloom-scanner-integration-')
    );
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('writes metadata.json BEFORE scan command is sent to Python process', async () => {
    const outputDir = path.join(testDir, 'scan-output');
    const callOrder: string[] = [];

    // Create a mock PythonProcess that records when sendCommand is called
    const mockPythonProcess = {
      sendCommand: vi.fn().mockImplementation(async (cmd: unknown) => {
        const command = cmd as { action: string };
        if (command.action === 'scan') {
          // At this point, metadata.json should already exist
          const metadataExists = fs.existsSync(
            path.join(outputDir, 'metadata.json')
          );
          callOrder.push(
            metadataExists ? 'scan_after_metadata' : 'scan_before_metadata'
          );
        }
        return {
          success: true,
          frames_captured: 72,
          output_path: outputDir,
        };
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scanner = new ScannerProcess(mockPythonProcess as any);

    // Initialize with settings that include metadata and output_path
    await scanner.initialize({
      camera: {
        exposure_time: 10000,
        gain: 100,
        gamma: 1.0,
      },
      daq: {
        device_name: 'cDAQ1Mod1',
        sampling_rate: 40000,
        step_pin: 0,
        dir_pin: 1,
        steps_per_revolution: 6400,
        num_frames: 72,
        seconds_per_rot: 7.0,
      },
      num_frames: 72,
      output_path: outputDir,
      metadata: {
        experiment_id: 'exp-001',
        phenotyper_id: 'user-001',
        scanner_name: 'TestScanner',
        plant_id: 'plant-001',
        plant_age_days: 14,
        wave_number: 1,
      },
    });

    // Run scan
    await scanner.scan();

    // Verify metadata.json existed before scan command was sent
    expect(callOrder).toContain('scan_after_metadata');
    expect(callOrder).not.toContain('scan_before_metadata');

    // Verify metadata.json content
    const metadataPath = path.join(outputDir, 'metadata.json');
    expect(fs.existsSync(metadataPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    expect(content.experiment_id).toBe('exp-001');
    expect(content.plant_id).toBe('plant-001');
    expect(content.capture_date).toBeDefined();
  });

  it('continues scan if metadata.json write fails', async () => {
    const outputDir = path.join(testDir, 'fail-write');

    const mockPythonProcess = {
      sendCommand: vi.fn().mockResolvedValue({
        success: true,
        frames_captured: 72,
        output_path: outputDir,
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scanner = new ScannerProcess(mockPythonProcess as any);

    await scanner.initialize({
      camera: { exposure_time: 10000, gain: 5 },
      daq: {
        device_name: 'cDAQ1Mod1',
        sampling_rate: 40000,
        step_pin: 0,
        dir_pin: 1,
        steps_per_revolution: 6400,
        num_frames: 72,
        seconds_per_rot: 7.0,
      },
      num_frames: 72,
      output_path: outputDir,
      metadata: {
        experiment_id: 'exp-001',
        phenotyper_id: 'user-001',
        scanner_name: 'TestScanner',
        plant_id: 'plant-001',
        plant_age_days: 14,
        wave_number: 1,
      },
    });

    // Mock writeMetadataJson to throw after scanner is initialized
    // (cross-platform way to simulate write failure)
    const writeMetadata = await import('../../src/main/scan-metadata-json');
    vi.spyOn(writeMetadata, 'writeMetadataJson').mockImplementation(() => {
      throw new Error('Simulated write failure');
    });

    // Scan should still succeed even if metadata write fails
    const result = await scanner.scan();
    expect(result.success).toBe(true);

    // sendCommand should still have been called (scan was not aborted)
    expect(mockPythonProcess.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'scan' })
    );
  });
});
