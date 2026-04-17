// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('fs');

// Import after mocking
import {
  buildGraviMetadataObject,
  writeGraviMetadataJson,
} from '../../../src/main/graviscan/scan-metadata-json';
import type { GraviScanMetadataContext } from '../../../src/main/graviscan/scan-metadata-json';

function makeContext(
  overrides: Partial<GraviScanMetadataContext> = {}
): GraviScanMetadataContext {
  return {
    experiment_id: 'exp-001',
    phenotyper_id: 'phen-001',
    scanner_id: 'scanner-001',
    scanner_name: 'Epson V600',
    grid_mode: '2grid',
    resolution_dpi: 1200,
    format: 'tiff',
    plate_index: '00',
    plate_barcode: 'PLATE-ABC',
    transplant_date: '2026-04-10',
    custom_note: 'test note',
    wave_number: 1,
    cycle_number: 1,
    session_id: 'sess-001',
    scan_started_at: '2026-04-16T12:00:00.000Z',
    ...overrides,
  };
}

describe('buildGraviMetadataObject', () => {
  it('includes all required fields', () => {
    const ctx = makeContext();
    const result = buildGraviMetadataObject(ctx);

    expect(result).toMatchObject({
      metadata_version: 1,
      scan_type: 'graviscan',
      experiment_id: 'exp-001',
      phenotyper_id: 'phen-001',
      scanner_id: 'scanner-001',
      scanner_name: 'Epson V600',
      grid_mode: '2grid',
      resolution_dpi: 1200,
      format: 'tiff',
      plate_index: '00',
      plate_barcode: 'PLATE-ABC',
      transplant_date: '2026-04-10',
      custom_note: 'test note',
      wave_number: 1,
      cycle_number: 1,
      session_id: 'sess-001',
      scan_started_at: '2026-04-16T12:00:00.000Z',
    });
    // capture_date must be present
    expect(result).toHaveProperty('capture_date');
  });

  it('metadata_version is 1', () => {
    const result = buildGraviMetadataObject(makeContext());
    expect(result.metadata_version).toBe(1);
  });

  it('scan_type is always "graviscan"', () => {
    const result = buildGraviMetadataObject(makeContext());
    expect(result.scan_type).toBe('graviscan');
  });

  it('capture_date is ISO 8601 format', () => {
    const captureDate = new Date('2026-04-16T14:30:00.000Z');
    const result = buildGraviMetadataObject(makeContext(), captureDate);
    expect(result.capture_date).toBe('2026-04-16T14:30:00.000Z');
  });

  it('defaults capture_date to current time when not provided', () => {
    const before = new Date();
    const result = buildGraviMetadataObject(makeContext());
    const after = new Date();
    const captureDate = new Date(result.capture_date as string);
    expect(captureDate.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(captureDate.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('includes interval_seconds and duration_seconds for interval scans', () => {
    const ctx = makeContext({
      interval_seconds: 300,
      duration_seconds: 3600,
    });
    const result = buildGraviMetadataObject(ctx);
    expect(result.interval_seconds).toBe(300);
    expect(result.duration_seconds).toBe(3600);
  });

  it('omits interval_seconds and duration_seconds when null', () => {
    const ctx = makeContext({
      interval_seconds: null,
      duration_seconds: null,
    });
    const result = buildGraviMetadataObject(ctx);
    expect(result).not.toHaveProperty('interval_seconds');
    expect(result).not.toHaveProperty('duration_seconds');
  });

  it('omits interval_seconds and duration_seconds when undefined', () => {
    const ctx = makeContext();
    // Default context has no interval/duration
    const result = buildGraviMetadataObject(ctx);
    expect(result).not.toHaveProperty('interval_seconds');
    expect(result).not.toHaveProperty('duration_seconds');
  });

  it('omits plate_barcode when null', () => {
    const ctx = makeContext({ plate_barcode: null });
    const result = buildGraviMetadataObject(ctx);
    expect(result).not.toHaveProperty('plate_barcode');
  });

  it('omits transplant_date when null', () => {
    const ctx = makeContext({ transplant_date: null });
    const result = buildGraviMetadataObject(ctx);
    expect(result).not.toHaveProperty('transplant_date');
  });

  it('omits custom_note when null', () => {
    const ctx = makeContext({ custom_note: null });
    const result = buildGraviMetadataObject(ctx);
    expect(result).not.toHaveProperty('custom_note');
  });
});

describe('writeGraviMetadataJson', () => {
  const outputDir = '/tmp/test-scan-output';

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    vi.mocked(fs.renameSync).mockReturnValue(undefined);
    vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
  });

  it('writes to .tmp then renames (atomic pattern)', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const ctx = makeContext();
    writeGraviMetadataJson(outputDir, ctx);

    const tmpPath = path.join(outputDir, 'metadata.json.tmp');
    const finalPath = path.join(outputDir, 'metadata.json');

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      tmpPath,
      expect.any(String),
      'utf-8'
    );
    expect(fs.renameSync).toHaveBeenCalledWith(tmpPath, finalPath);

    // writeFileSync must be called before renameSync
    const writeOrder = vi.mocked(fs.writeFileSync).mock.invocationCallOrder[0];
    const renameOrder = vi.mocked(fs.renameSync).mock.invocationCallOrder[0];
    expect(writeOrder).toBeLessThan(renameOrder);
  });

  it('output is valid JSON with 2-space indent and trailing newline', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const ctx = makeContext();
    writeGraviMetadataJson(outputDir, ctx);

    const writtenContent = vi.mocked(fs.writeFileSync).mock
      .calls[0][1] as string;

    // Must end with newline
    expect(writtenContent).toMatch(/\n$/);

    // Must be valid JSON
    const parsed = JSON.parse(writtenContent);
    expect(parsed).toBeDefined();

    // Must use 2-space indent
    const reformatted = JSON.stringify(parsed, null, 2) + '\n';
    expect(writtenContent).toBe(reformatted);
  });

  it('cleans up stale .tmp files before writing', () => {
    // First call (existsSync for dir) returns true, second (for .tmp) returns true
    vi.mocked(fs.existsSync)
      .mockReturnValueOnce(true) // dir exists
      .mockReturnValueOnce(true); // stale .tmp exists

    const ctx = makeContext();
    writeGraviMetadataJson(outputDir, ctx);

    const tmpPath = path.join(outputDir, 'metadata.json.tmp');
    expect(fs.unlinkSync).toHaveBeenCalledWith(tmpPath);
  });

  it('does not unlink .tmp when none exists', () => {
    vi.mocked(fs.existsSync)
      .mockReturnValueOnce(true) // dir exists
      .mockReturnValueOnce(false); // no stale .tmp

    const ctx = makeContext();
    writeGraviMetadataJson(outputDir, ctx);

    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  it('creates directory if missing (mkdir -p)', () => {
    vi.mocked(fs.existsSync).mockReturnValueOnce(false); // dir does not exist

    const ctx = makeContext();
    writeGraviMetadataJson(outputDir, ctx);

    expect(fs.mkdirSync).toHaveBeenCalledWith(outputDir, { recursive: true });
  });

  it('does not create directory if it already exists', () => {
    vi.mocked(fs.existsSync)
      .mockReturnValueOnce(true) // dir exists
      .mockReturnValueOnce(false); // no stale .tmp

    const ctx = makeContext();
    writeGraviMetadataJson(outputDir, ctx);

    expect(fs.mkdirSync).not.toHaveBeenCalled();
  });

  it('write failure does not throw (logs warning and returns)', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error('disk full');
    });

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const ctx = makeContext();
    // Should not throw
    expect(() => writeGraviMetadataJson(outputDir, ctx)).not.toThrow();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('metadata.json'),
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });
});
