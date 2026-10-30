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
const db = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => db.current),
}));

import { ScannerProcess } from '../../src/main/cylinderscan/scanner-process';
import { fakeScannerDb } from './helpers/fake-scanner-db';

// Wave 1 of exp-001 germinated 14 days ago, so plant-001 is 14 days old today.
beforeEach(() => {
  db.current = fakeScannerDb(mockScanCreate, 14);
});

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
      on: vi.fn(),
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

  it("saves the scan under the plant's row, created from its wave's dates at its first scan (#428)", async () => {
    mockScanCreate.mockResolvedValue({ id: 'scan-124' });
    await scanner.initialize(buildSettings(outputDir, true));

    await scanner.scan();

    const fake = db.current as ReturnType<typeof fakeScannerDb>;
    expect(fake.$transaction).toHaveBeenCalled();
    expect(fake.tx.cylinderPlant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        wave_id: 'wave-1',
        plant_barcode: 'plant-001',
        uses_wave_dates: true,
      }),
    });
    expect(mockScanCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        phenotyper_id: 'user-001',
        plant_age_days: 14,
        cylinder_plant_id: 'plant-1',
      }),
    });
    // The new row's history starts with the wave's dates, in the same transaction.
    expect(fake.saved.plantChanges).toEqual([
      expect.objectContaining({
        plant_id: 'plant-1',
        old_germination_date: null,
        reason: "From wave 1's dates, at the plant's first scan",
        changed_by_phenotyper_id: 'user-001',
      }),
    ]);
  });

  it("doesn't keep the plant's new row when the scan can't be saved (#428)", async () => {
    mockScanCreate.mockRejectedValue(new Error('database is locked'));
    await scanner.initialize(buildSettings(outputDir, true));

    const result = await scanner.scan();

    const fake = db.current as ReturnType<typeof fakeScannerDb>;
    expect(result.db_saved).toBe(false);
    // The plant row was written in the same transaction, so it went with the scan.
    expect(fake.tx.cylinderPlant.create).toHaveBeenCalled();
    expect(fake.saved.plants).toEqual([]);
    expect(fake.saved.plantChanges).toEqual([]);
  });

  it('leaves db_saved undefined when no metadata was provided (no save attempted)', async () => {
    await scanner.initialize(buildSettings(outputDir, false));

    const result = await scanner.scan();

    expect(mockScanCreate).not.toHaveBeenCalled();
    expect(result.db_saved).toBeUndefined();
    expect(result.success).toBe(true);
  });
});

describe('ScannerProcess — the plant age is checked before scanning (#407, #428)', () => {
  it("refuses an age that isn't the days since the plant's germination date, without starting the scanner", async () => {
    const sendCommand = vi.fn().mockResolvedValue({ success: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scanner = new ScannerProcess({ sendCommand, on: vi.fn() } as any);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const settings = buildSettings(os.tmpdir(), true);
    settings.metadata = { ...settings.metadata!, plant_age_days: 13 };
    expect(await scanner.initialize(settings)).toEqual({
      success: false,
      initialized: false,
      error:
        "The plant age (13) isn't the days since this plant's germination date (14).",
    });
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("refuses a wave whose dates aren't set", async () => {
    const sendCommand = vi.fn().mockResolvedValue({ success: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scanner = new ScannerProcess({ sendCommand, on: vi.fn() } as any);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const settings = buildSettings(os.tmpdir(), true);
    settings.metadata = { ...settings.metadata!, wave_number: 2 };
    expect((await scanner.initialize(settings)).error).toBe(
      "Set wave 2's dates first."
    );
  });

  it("doesn't keep the previous plant's settings after a refusal", async () => {
    const sendCommand = vi.fn().mockResolvedValue({ success: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scanner = new ScannerProcess({ sendCommand, on: vi.fn() } as any);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await scanner.initialize(buildSettings(os.tmpdir(), true));
    const bad = buildSettings(os.tmpdir(), true);
    bad.metadata = {
      ...bad.metadata!,
      plant_id: 'plant-002',
      plant_age_days: 3,
    };
    expect((await scanner.initialize(bad)).success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((scanner as any).currentSettings).toBeNull();
  });
});
