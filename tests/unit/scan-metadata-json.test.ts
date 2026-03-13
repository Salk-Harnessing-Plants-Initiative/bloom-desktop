/**
 * Unit tests for scan-metadata-json module
 *
 * TDD: Tests written first to define expected behavior of
 * writeMetadataJson and buildMetadataObject utilities.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  writeMetadataJson,
  buildMetadataObject,
} from '../../src/main/scan-metadata-json';
import type { ScannerSettings } from '../../src/types/scanner';
import type { CameraSettings } from '../../src/types/camera';
import type { DAQSettings } from '../../src/types/daq';

/** Helper to create valid ScannerSettings for tests */
function makeScannerSettings(
  overrides?: Partial<ScannerSettings>
): ScannerSettings {
  const camera: CameraSettings = {
    exposure_time: 10000,
    gain: 100,
    gamma: 1.0,
  };

  const daq: DAQSettings = {
    device_name: 'cDAQ1Mod1',
    sampling_rate: 40000,
    step_pin: 0,
    dir_pin: 1,
    steps_per_revolution: 6400,
    num_frames: 72,
    seconds_per_rot: 7.0,
  };

  return {
    camera,
    daq,
    num_frames: 72,
    output_path: '/tmp/test-scan',
    metadata: {
      experiment_id: 'exp-001',
      phenotyper_id: 'user-001',
      scanner_name: 'TestScanner',
      plant_id: 'plant-001',
      accession_name: 'Col-0',
      plant_age_days: 14,
      wave_number: 1,
    },
    ...overrides,
  };
}

describe('scan-metadata-json', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-metadata-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  // ========================================
  // buildMetadataObject tests
  // ========================================

  describe('buildMetadataObject', () => {
    it('returns correct structure from ScannerSettings', () => {
      const settings = makeScannerSettings();
      const now = new Date('2026-03-05T14:30:00.000Z');

      const metadata = buildMetadataObject(settings, now);

      expect(metadata).toEqual({
        metadata_version: 1,
        experiment_id: 'exp-001',
        phenotyper_id: 'user-001',
        scanner_name: 'TestScanner',
        plant_id: 'plant-001',
        accession_name: 'Col-0',
        plant_age_days: 14,
        wave_number: 1,
        capture_date: '2026-03-05T14:30:00.000Z',
        num_frames: 72,
        scan_path: '/tmp/test-scan',
        exposure_time: 10000,
        gain: 100,
        brightness: 0,
        contrast: 0,
        gamma: 1.0,
        seconds_per_rot: 7.0,
      });
    });

    it('uses ISO 8601 timestamp for capture_date', () => {
      const settings = makeScannerSettings();
      const now = new Date('2026-01-15T08:00:00.000Z');

      const metadata = buildMetadataObject(settings, now);

      expect(metadata.capture_date).toBe('2026-01-15T08:00:00.000Z');
      // Verify it's parseable as ISO 8601
      expect(new Date(metadata.capture_date).toISOString()).toBe(
        '2026-01-15T08:00:00.000Z'
      );
    });

    it('includes camera settings (exposure_time, gain, gamma) with identity defaults for removed fields', () => {
      const settings = makeScannerSettings();
      const metadata = buildMetadataObject(settings, new Date());

      expect(metadata.exposure_time).toBe(10000);
      expect(metadata.gain).toBe(100);
      expect(metadata.brightness).toBe(0);
      expect(metadata.contrast).toBe(0);
      expect(metadata.gamma).toBe(1.0);
    });

    it('includes DAQ settings (seconds_per_rot)', () => {
      const settings = makeScannerSettings();
      const metadata = buildMetadataObject(settings, new Date());

      expect(metadata.seconds_per_rot).toBe(7.0);
    });

    it('includes scan parameters (num_frames, scan_path)', () => {
      const settings = makeScannerSettings();
      const metadata = buildMetadataObject(settings, new Date());

      expect(metadata.num_frames).toBe(72);
      expect(metadata.scan_path).toBe('/tmp/test-scan');
    });

    it('includes optional accession_name when provided', () => {
      const settings = makeScannerSettings();
      const metadata = buildMetadataObject(settings, new Date());

      expect(metadata.accession_name).toBe('Col-0');
    });

    it('omits accession_name when not provided', () => {
      const settings = makeScannerSettings({
        metadata: {
          experiment_id: 'exp-001',
          phenotyper_id: 'user-001',
          scanner_name: 'TestScanner',
          plant_id: 'plant-001',
          plant_age_days: 14,
          wave_number: 1,
        },
      });
      const metadata = buildMetadataObject(settings, new Date());

      expect(metadata.accession_name).toBeUndefined();
    });

    it('prefers metadata.scan_path (relative) over output_path (absolute)', () => {
      const settings = makeScannerSettings({
        output_path: '/absolute/path/to/scan',
        metadata: {
          experiment_id: 'exp-001',
          phenotyper_id: 'user-001',
          scanner_name: 'TestScanner',
          plant_id: 'plant-001',
          plant_age_days: 14,
          wave_number: 1,
          scan_path: '2026-03-05/plant-001/abc123',
        },
      });
      const metadata = buildMetadataObject(settings, new Date());

      expect(metadata.scan_path).toBe('2026-03-05/plant-001/abc123');
    });

    it('falls back to output_path when metadata.scan_path is not set', () => {
      const settings = makeScannerSettings({
        output_path: '/absolute/path/to/scan',
        metadata: {
          experiment_id: 'exp-001',
          phenotyper_id: 'user-001',
          scanner_name: 'TestScanner',
          plant_id: 'plant-001',
          plant_age_days: 14,
          wave_number: 1,
          // scan_path intentionally omitted
        },
      });
      const metadata = buildMetadataObject(settings, new Date());

      expect(metadata.scan_path).toBe('/absolute/path/to/scan');
    });

    it('omits scan_path when neither metadata.scan_path nor output_path provided', () => {
      const settings = makeScannerSettings({
        output_path: undefined,
        metadata: {
          experiment_id: 'exp-001',
          phenotyper_id: 'user-001',
          scanner_name: 'TestScanner',
          plant_id: 'plant-001',
          plant_age_days: 14,
          wave_number: 1,
        },
      });
      const metadata = buildMetadataObject(settings, new Date());

      expect(metadata.scan_path).toBeUndefined();
    });

    it('defaults optional camera settings to Basler identity values when not provided', () => {
      const settings = makeScannerSettings();
      settings.camera = {
        exposure_time: 5000,
        gain: 3,
        // brightness, contrast, gamma intentionally omitted
      };
      const metadata = buildMetadataObject(settings, new Date());

      // Basler Pylon API identity values (no adjustment):
      // brightness=0, contrast=0, gamma=1
      // Matches pilot defaults: bloom-desktop-pilot/app/src/main/scanner.ts
      expect(metadata.brightness).toBe(0);
      expect(metadata.contrast).toBe(0);
      expect(metadata.gamma).toBe(1);
    });

    // fix-camera-scan-params 1.9 — verify identity defaults after field removal
    it('1.9.1 uses brightness: 0 when camera has no brightness field', () => {
      const settings = makeScannerSettings();
      // Simulate camera settings without brightness (post-removal)
      delete (settings.camera as unknown as Record<string, unknown>).brightness;
      const metadata = buildMetadataObject(settings, new Date('2026-03-13'));

      expect(metadata.brightness).toBe(0);
    });

    it('1.9.2 uses contrast: 0 when camera has no contrast field', () => {
      const settings = makeScannerSettings();
      delete (settings.camera as unknown as Record<string, unknown>).contrast;
      const metadata = buildMetadataObject(settings, new Date('2026-03-13'));

      expect(metadata.contrast).toBe(0);
    });

    it('throws descriptive error when settings.metadata is undefined', () => {
      const settings = makeScannerSettings({ metadata: undefined });

      expect(() => buildMetadataObject(settings, new Date())).toThrow(
        'settings.metadata is required for buildMetadataObject'
      );
    });

    it('includes metadata_version field set to 1', () => {
      const settings = makeScannerSettings();
      const metadata = buildMetadataObject(settings, new Date());

      expect(metadata.metadata_version).toBe(1);
    });

    it('uses top-level num_frames over daq.num_frames when both differ', () => {
      const settings = makeScannerSettings();
      settings.num_frames = 36;
      settings.daq.num_frames = 72;
      const metadata = buildMetadataObject(settings, new Date());

      expect(metadata.num_frames).toBe(36);
    });
  });

  // ========================================
  // writeMetadataJson tests
  // ========================================

  describe('writeMetadataJson', () => {
    it('creates valid JSON file with all required fields', () => {
      const outputDir = path.join(testDir, 'scan-output');
      fs.mkdirSync(outputDir, { recursive: true });
      const settings = makeScannerSettings({ output_path: outputDir });

      writeMetadataJson(outputDir, settings);

      const filePath = path.join(outputDir, 'metadata.json');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(content.experiment_id).toBe('exp-001');
      expect(content.phenotyper_id).toBe('user-001');
      expect(content.scanner_name).toBe('TestScanner');
      expect(content.plant_id).toBe('plant-001');
      expect(content.capture_date).toBeDefined();
      expect(content.num_frames).toBe(72);
      expect(content.exposure_time).toBe(10000);
      expect(content.gain).toBe(100);
      expect(content.seconds_per_rot).toBe(7.0);
    });

    it('uses atomic write (writes to .tmp, renames to final)', () => {
      const outputDir = path.join(testDir, 'scan-atomic');
      fs.mkdirSync(outputDir, { recursive: true });
      const settings = makeScannerSettings({ output_path: outputDir });

      // Verify atomic write by checking: no .tmp remains, final file exists,
      // and the "does not leave .tmp file on success" test also covers this.
      // Additionally, create a .tmp file first to prove rename overwrites it.
      const tmpPath = path.join(outputDir, 'metadata.json.tmp');
      fs.writeFileSync(tmpPath, 'stale', 'utf-8');

      writeMetadataJson(outputDir, settings);

      // .tmp should not remain (was renamed to final)
      expect(fs.existsSync(tmpPath)).toBe(false);
      // Final file should exist with valid content
      const finalPath = path.join(outputDir, 'metadata.json');
      expect(fs.existsSync(finalPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(finalPath, 'utf-8'));
      expect(content.experiment_id).toBe('exp-001');
    });

    it('creates parent directories if they do not exist', () => {
      const outputDir = path.join(testDir, 'deep', 'nested', 'scan-dir');
      const settings = makeScannerSettings({ output_path: outputDir });

      // Directory does not exist yet
      expect(fs.existsSync(outputDir)).toBe(false);

      writeMetadataJson(outputDir, settings);

      // Directory and file should now exist
      expect(fs.existsSync(outputDir)).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'metadata.json'))).toBe(true);
    });

    it('uses ISO 8601 timestamp for capture_date', () => {
      const outputDir = path.join(testDir, 'scan-iso');
      fs.mkdirSync(outputDir, { recursive: true });
      const settings = makeScannerSettings({ output_path: outputDir });

      writeMetadataJson(outputDir, settings);

      const content = JSON.parse(
        fs.readFileSync(path.join(outputDir, 'metadata.json'), 'utf-8')
      );
      // Should be valid ISO 8601
      const parsed = new Date(content.capture_date);
      expect(parsed.toISOString()).toBe(content.capture_date);
    });

    it('includes camera settings', () => {
      const outputDir = path.join(testDir, 'scan-camera');
      fs.mkdirSync(outputDir, { recursive: true });
      const settings = makeScannerSettings({ output_path: outputDir });

      writeMetadataJson(outputDir, settings);

      const content = JSON.parse(
        fs.readFileSync(path.join(outputDir, 'metadata.json'), 'utf-8')
      );
      expect(content.exposure_time).toBe(10000);
      expect(content.gain).toBe(100);
      expect(content.brightness).toBe(0);
      expect(content.contrast).toBe(0);
      expect(content.gamma).toBe(1.0);
    });

    it('includes DAQ settings', () => {
      const outputDir = path.join(testDir, 'scan-daq');
      fs.mkdirSync(outputDir, { recursive: true });
      const settings = makeScannerSettings({ output_path: outputDir });

      writeMetadataJson(outputDir, settings);

      const content = JSON.parse(
        fs.readFileSync(path.join(outputDir, 'metadata.json'), 'utf-8')
      );
      expect(content.seconds_per_rot).toBe(7.0);
    });

    it('includes scan parameters', () => {
      const outputDir = path.join(testDir, 'scan-params');
      fs.mkdirSync(outputDir, { recursive: true });
      const settings = makeScannerSettings({ output_path: outputDir });

      writeMetadataJson(outputDir, settings);

      const content = JSON.parse(
        fs.readFileSync(path.join(outputDir, 'metadata.json'), 'utf-8')
      );
      expect(content.num_frames).toBe(72);
      expect(content.scan_path).toBe(outputDir);
    });

    it('file ends with trailing newline', () => {
      const outputDir = path.join(testDir, 'scan-newline');
      fs.mkdirSync(outputDir, { recursive: true });
      const settings = makeScannerSettings({ output_path: outputDir });

      writeMetadataJson(outputDir, settings);

      const raw = fs.readFileSync(
        path.join(outputDir, 'metadata.json'),
        'utf-8'
      );
      expect(raw.endsWith('\n')).toBe(true);
    });

    it('cleans up stale .tmp file before writing', () => {
      const outputDir = path.join(testDir, 'scan-stale-tmp');
      fs.mkdirSync(outputDir, { recursive: true });
      const settings = makeScannerSettings({ output_path: outputDir });

      // Create a stale .tmp from a "previous failed write"
      const tmpPath = path.join(outputDir, 'metadata.json.tmp');
      fs.writeFileSync(tmpPath, 'stale-content', 'utf-8');
      expect(fs.existsSync(tmpPath)).toBe(true);

      writeMetadataJson(outputDir, settings);

      // Final state: no .tmp, valid metadata.json
      expect(fs.existsSync(tmpPath)).toBe(false);
      expect(fs.existsSync(path.join(outputDir, 'metadata.json'))).toBe(true);
      const content = JSON.parse(
        fs.readFileSync(path.join(outputDir, 'metadata.json'), 'utf-8')
      );
      expect(content.experiment_id).toBe('exp-001');
    });

    it('output is readable and round-trips through JSON.parse', () => {
      const outputDir = path.join(testDir, 'scan-roundtrip');
      fs.mkdirSync(outputDir, { recursive: true });
      const settings = makeScannerSettings({ output_path: outputDir });

      writeMetadataJson(outputDir, settings);

      const raw = fs.readFileSync(
        path.join(outputDir, 'metadata.json'),
        'utf-8'
      );

      // Should be valid JSON
      const parsed = JSON.parse(raw);
      expect(parsed).toBeDefined();

      // Should round-trip cleanly (file has trailing newline)
      const reStringified = JSON.stringify(parsed, null, 2) + '\n';
      expect(reStringified).toBe(raw);
    });

    it('does not leave .tmp file on success', () => {
      const outputDir = path.join(testDir, 'scan-notmp');
      fs.mkdirSync(outputDir, { recursive: true });
      const settings = makeScannerSettings({ output_path: outputDir });

      writeMetadataJson(outputDir, settings);

      expect(fs.existsSync(path.join(outputDir, 'metadata.json.tmp'))).toBe(
        false
      );
      expect(fs.existsSync(path.join(outputDir, 'metadata.json'))).toBe(true);
    });

    it('formats with 2-space indentation for human readability', () => {
      const outputDir = path.join(testDir, 'scan-indent');
      fs.mkdirSync(outputDir, { recursive: true });
      const settings = makeScannerSettings({ output_path: outputDir });

      writeMetadataJson(outputDir, settings);

      const raw = fs.readFileSync(
        path.join(outputDir, 'metadata.json'),
        'utf-8'
      );
      // 2-space indentation means lines start with "  "
      const lines = raw.split('\n');
      const indentedLines = lines.filter((l) => l.startsWith('  '));
      expect(indentedLines.length).toBeGreaterThan(0);
    });
  });
});
