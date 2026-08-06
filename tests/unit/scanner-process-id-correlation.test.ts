/**
 * Regression test: the IPC request/response correlation id added to every
 * sendCommand() response (#47) must never leak into a persisted Scan
 * record. Exercises the real ScannerProcess.scan() -> saveScanToDatabase()
 * path with a mocked Prisma client, rather than testing an isolated
 * function — a test that doesn't go through the real Prisma call site
 * wouldn't catch a future regression if that call site is ever
 * "simplified" to spread the raw IPC response.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const mockScanCreate = vi.fn().mockResolvedValue({ id: 'new-scan-id' });

vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => ({
    scan: { create: mockScanCreate },
  })),
}));

import { ScannerProcess } from '../../src/main/cylinderscan/scanner-process';

describe('ScannerProcess — IPC response id does not leak into the DB', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-scanner-id-'));
    mockScanCreate.mockClear();
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('does not include the sendCommand response id in the Prisma create data', async () => {
    const outputDir = path.join(testDir, 'scan-output');
    fs.mkdirSync(outputDir, { recursive: true });

    // Simulate the new correlation-tagged IPC response shape (#47) — every
    // sendCommand() response now carries an `id` field.
    const mockPythonProcess = {
      sendCommand: vi.fn().mockResolvedValue({
        success: true,
        frames_captured: 72,
        output_path: outputDir,
        id: 999,
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scanner = new ScannerProcess(mockPythonProcess as any);

    await scanner.initialize({
      camera: { exposure_time: 10000, gain: 100, gamma: 1.0 },
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

    await scanner.scan();

    expect(mockScanCreate).toHaveBeenCalledTimes(1);
    const createArg = mockScanCreate.mock.calls[0][0];
    expect(createArg.data).not.toHaveProperty('id');
    expect(JSON.stringify(createArg.data)).not.toContain('999');
  });
});
