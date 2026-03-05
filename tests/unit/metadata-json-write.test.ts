/**
 * Metadata JSON Write Unit Tests
 *
 * TDD Phase 1 (RED): Tests for writing metadata.json alongside scan images.
 * These test the metadata assembly and file write logic that will be
 * implemented in scanner-process.ts.
 *
 * Reference: pilot scanner.ts:186-216 (captureMetadata), 277-292 (writeMetadata)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  buildScanMetadataJson,
  writeMetadataJsonAtomic,
} from '../../src/main/metadata-json';
import type { ScannerSettings } from '../../src/types/scanner';

/** Test fixture: complete scanner settings with metadata */
function makeTestSettings(
  overrides: Partial<ScannerSettings> = {}
): ScannerSettings {
  return {
    camera: {
      exposure_time: 10000,
      gain: 100,
      brightness: 0,
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
    output_path: '/tmp/test-scan-output',
    metadata: {
      experiment_id: 'exp-uuid-123',
      phenotyper_id: 'phen-uuid-456',
      scanner_name: 'TestScanner',
      plant_id: 'PLANT-001',
      accession_name: 'Col-0',
      plant_age_days: 14,
      wave_number: 1,
    },
    ...overrides,
  };
}

describe('Metadata JSON Write', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-metadata-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('buildScanMetadataJson', () => {
    it('should contain all required fields matching pilot format', () => {
      const settings = makeTestSettings();
      const scanId = 'scan-uuid-789';

      const metadata = buildScanMetadataJson(settings, scanId);

      // Metadata fields (from pilot custom.types.ts ScanMetadata)
      expect(metadata.id).toBe('scan-uuid-789');
      expect(metadata.phenotyper_id).toBe('phen-uuid-456');
      expect(metadata.experiment_id).toBe('exp-uuid-123');
      expect(metadata.scanner_name).toBe('TestScanner');
      expect(metadata.plant_id).toBe('PLANT-001');
      expect(metadata.accession_name).toBe('Col-0');
      expect(metadata.wave_number).toBe(1);
      expect(metadata.plant_age_days).toBe(14);
      expect(metadata.path).toBe('/tmp/test-scan-output');

      // capture_date should be ISO 8601
      expect(metadata.capture_date).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
      );

      // Camera settings (flat, not nested — matching pilot)
      expect(metadata.num_frames).toBe(72);
      expect(metadata.exposure_time).toBe(10000);
      expect(metadata.gain).toBe(100);
      expect(metadata.brightness).toBe(0);
      expect(metadata.contrast).toBe(1);
      expect(metadata.gamma).toBe(1);
      expect(metadata.seconds_per_rot).toBe(7);
    });

    it('should have correct types for all fields', () => {
      const settings = makeTestSettings();
      const metadata = buildScanMetadataJson(settings, 'id-1');

      expect(typeof metadata.id).toBe('string');
      expect(typeof metadata.phenotyper_id).toBe('string');
      expect(typeof metadata.experiment_id).toBe('string');
      expect(typeof metadata.scanner_name).toBe('string');
      expect(typeof metadata.plant_id).toBe('string');
      expect(typeof metadata.path).toBe('string');
      expect(typeof metadata.capture_date).toBe('string');
      expect(typeof metadata.wave_number).toBe('number');
      expect(typeof metadata.plant_age_days).toBe('number');
      expect(typeof metadata.num_frames).toBe('number');
      expect(typeof metadata.exposure_time).toBe('number');
      expect(typeof metadata.gain).toBe('number');
      expect(typeof metadata.brightness).toBe('number');
      expect(typeof metadata.contrast).toBe('number');
      expect(typeof metadata.gamma).toBe('number');
      expect(typeof metadata.seconds_per_rot).toBe('number');
    });

    it('should handle optional accession_name being undefined', () => {
      const settings = makeTestSettings({
        metadata: {
          experiment_id: 'exp-1',
          phenotyper_id: 'phen-1',
          scanner_name: 'Scanner',
          plant_id: 'PLANT',
          plant_age_days: 10,
          wave_number: 0,
          // accession_name omitted
        },
      });

      const metadata = buildScanMetadataJson(settings, 'id-1');
      // Should be null or undefined, not crash
      expect(metadata.accession_name).toBeUndefined();
    });

    it('should default brightness, contrast, gamma when not provided', () => {
      const settings = makeTestSettings({
        camera: {
          exposure_time: 5000,
          gain: 50,
          // brightness, contrast, gamma omitted
        },
      });

      const metadata = buildScanMetadataJson(settings, 'id-1');
      expect(metadata.brightness).toBe(0);
      expect(metadata.contrast).toBe(1);
      expect(metadata.gamma).toBe(1);
    });
  });

  describe('writeMetadataJsonAtomic', () => {
    it('should write metadata.json with 2-space indented JSON', () => {
      const metadata = {
        id: 'test-id',
        plant_id: 'PLANT-001',
      };

      writeMetadataJsonAtomic(metadata, tmpDir);

      const filePath = path.join(tmpDir, 'metadata.json');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      // Verify 2-space indent (matching pilot scanner.ts:283)
      expect(content).toBe(JSON.stringify(metadata, null, 2));
    });

    it('should use atomic write pattern (no temp file remains after write)', () => {
      const metadata = { id: 'test-id' };
      writeMetadataJsonAtomic(metadata, tmpDir);

      const tmpPath = path.join(tmpDir, 'metadata.json.tmp');
      const finalPath = path.join(tmpDir, 'metadata.json');

      // Final file should exist with correct content
      expect(fs.existsSync(finalPath)).toBe(true);
      expect(fs.readFileSync(finalPath, 'utf-8')).toBe(
        JSON.stringify(metadata, null, 2)
      );

      // Temp file should NOT remain (was renamed to final)
      expect(fs.existsSync(tmpPath)).toBe(false);
    });

    it('should create output directory if it does not exist', () => {
      const newDir = path.join(tmpDir, 'nested', 'scan', 'dir');
      expect(fs.existsSync(newDir)).toBe(false);

      writeMetadataJsonAtomic({ id: 'test' }, newDir);

      expect(fs.existsSync(newDir)).toBe(true);
      expect(
        fs.existsSync(path.join(newDir, 'metadata.json'))
      ).toBe(true);
    });

    it('should throw on write failure (caller handles gracefully)', () => {
      // Make directory read-only to simulate write failure
      const readOnlyDir = path.join(tmpDir, 'readonly');
      fs.mkdirSync(readOnlyDir);
      fs.chmodSync(readOnlyDir, 0o444);

      expect(() => {
        writeMetadataJsonAtomic({ id: 'test' }, readOnlyDir);
      }).toThrow();

      // Cleanup: restore permissions for afterEach cleanup
      fs.chmodSync(readOnlyDir, 0o755);
    });
  });
});
