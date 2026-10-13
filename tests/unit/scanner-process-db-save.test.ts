/**
 * Regression test for #392: a failed database save must be reported on the
 * scan result (db_saved: false) instead of looking like a normal success.
 * Exercises the real ScannerProcess.scan() -> saveScanToDatabase() path with
 * a mocked Python process and Prisma client.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ScanResult, ScannerSettings } from '../../src/types/scanner';

const mockScanCreate = vi.fn();

vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => ({
    scan: { create: mockScanCreate },
  })),
}));

import { ScannerProcess } from '../../src/main/cylinderscan/scanner-process';

const FRAMES = 72;

function buildSettings(
  outputDir: string,
  withMetadata: boolean
): ScannerSettings {
  return {
    camera: { exposure_time: 10000, gain: 100, gamma: 1.0 },
    daq: {
      device_name: 'cDAQ1Mod1',
      sampling_rate: 40000,
      step_pin: 0,
      dir_pin: 1,
      steps_per_revolution: 6400,
      num_frames: FRAMES,
      seconds_per_rot: 7.0,
    },
    num_frames: FRAMES,
    output_path: outputDir,
    metadata: withMetadata
      ? {
          experiment_id: 'exp-001',
          phenotyper_id: 'user-001',
          scanner_name: 'TestScanner',
          plant_id: 'plant-001',
          plant_age_days: 14,
          wave_number: 1,
        }
      : undefined,
  };
}

describe('ScannerProcess — database save outcome (#392)', () => {
  let testDir: string;
  let outputDir: string;
  let scanner: ScannerProcess;
  let completeEvents: ScanResult[];
  let errorEvents: string[];

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-scanner-dbsave-'));
    outputDir = path.join(testDir, 'scan-output');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, '001.png'), '');
    mockScanCreate.mockReset();

    const mockPythonProcess = {
      sendCommand: vi.fn().mockResolvedValue({
        success: true,
        frames_captured: FRAMES,
        output_path: outputDir,
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    scanner = new ScannerProcess(mockPythonProcess as any);
    completeEvents = [];
    errorEvents = [];
    scanner.onComplete((result) => completeEvents.push(result));
    scanner.onError((error) => errorEvents.push(error));
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('reports db_saved: false with the error message when the save throws', async () => {
    mockScanCreate.mockRejectedValue(new Error('database is locked'));
    await scanner.initialize(buildSettings(outputDir, true));

    const result = await scanner.scan();

    expect(result.db_saved).toBe(false);
    expect(result.db_save_error).toBe('database is locked');
    expect(result.scan_id).toBeUndefined();
    // Images are still on disk, so the capture itself is not an error
    expect(result.success).toBe(true);
    expect(result.output_path).toBe(outputDir);
    expect(fs.existsSync(path.join(outputDir, '001.png'))).toBe(true);
    expect(errorEvents).toEqual([]);
  });

  it('logs the full error object, not just the message', async () => {
    const error = new Error('database is locked');
    mockScanCreate.mockRejectedValue(error);
    await scanner.initialize(buildSettings(outputDir, true));

    await scanner.scan();

    expect(console.error).toHaveBeenCalledWith(
      '[Scanner] Failed to save scan to database:',
      error
    );
  });

  it('carries the failed save on the complete event the renderer receives', async () => {
    mockScanCreate.mockRejectedValue(new Error('no such table: Scan'));
    await scanner.initialize(buildSettings(outputDir, true));

    await scanner.scan();

    expect(completeEvents).toHaveLength(1);
    expect(completeEvents[0]).toMatchObject({
      db_saved: false,
      db_save_error: 'no such table: Scan',
      output_path: outputDir,
    });
  });

  it('uses a fallback message when a non-Error value is thrown', async () => {
    mockScanCreate.mockRejectedValue('locked');
    await scanner.initialize(buildSettings(outputDir, true));

    const result = await scanner.scan();

    expect(result.db_saved).toBe(false);
    expect(result.db_save_error).toBe('Unknown error');
  });

  it('reports db_saved: true and the scan id when the save succeeds', async () => {
    mockScanCreate.mockResolvedValue({ id: 'scan-123' });
    await scanner.initialize(buildSettings(outputDir, true));

    const result = await scanner.scan();

    expect(result.db_saved).toBe(true);
    expect(result.scan_id).toBe('scan-123');
    expect(result.db_save_error).toBeUndefined();
    expect(completeEvents[0].db_saved).toBe(true);
  });

  it('leaves db_saved undefined when no metadata was provided (no save attempted)', async () => {
    await scanner.initialize(buildSettings(outputDir, false));

    const result = await scanner.scan();

    expect(mockScanCreate).not.toHaveBeenCalled();
    expect(result.db_saved).toBeUndefined();
    expect(result.success).toBe(true);
  });
});
