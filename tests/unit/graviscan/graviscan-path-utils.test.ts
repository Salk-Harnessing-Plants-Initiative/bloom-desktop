// @vitest-environment node
/**
 * Tests for resolveGraviScanPath — filesystem fallback for pre-fix scans.
 * Bug #154 is primarily resolved by scan-persistence.ts creating records
 * with post-rename paths from the start. This tests the fallback for
 * scans created before that fix.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('fs');

import { resolveGraviScanPath } from '../../../src/main/graviscan-path-utils';

describe('resolveGraviScanPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('returns path as-is if file exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = resolveGraviScanPath(
      '/scans/plate_00_st_20260416T143000_cy1.tiff'
    );
    expect(result).toBe('/scans/plate_00_st_20260416T143000_cy1.tiff');
  });

  it('returns null when file not found and no _et_ match', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = resolveGraviScanPath('/scans/nonexistent.tiff');
    expect(result).toBeNull();
  });

  it('resolves stale path via _et_ fallback and logs warning', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const s = String(p);
      if (s.includes('_et_')) return false;
      return s === path.dirname('/scans/plate_00_st_20260416T143000_cy1.tiff');
    });
    vi.mocked(fs.readdirSync).mockReturnValue([
      'plate_00_st_20260416T143000_et_20260416T143115_cy1.tiff',
    ] as unknown as fs.Dirent[]);

    const result = resolveGraviScanPath(
      '/scans/plate_00_st_20260416T143000_cy1.tiff'
    );

    expect(result).toContain('_et_');
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[graviscan-path-utils] Fallback:')
    );
  });

  it('logs distinct warning for ambiguous match (multiple _et_ candidates)', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const s = String(p);
      if (s.includes('_et_')) return false;
      return s === path.dirname('/scans/plate_00_st_20260416T143000_cy1.tiff');
    });
    vi.mocked(fs.readdirSync).mockReturnValue([
      'plate_00_st_20260416T143000_et_20260416T143115_cy1.tiff',
      'plate_00_st_20260416T143000_et_20260416T143200_cy1.tiff',
    ] as unknown as fs.Dirent[]);

    const result = resolveGraviScanPath(
      '/scans/plate_00_st_20260416T143000_cy1.tiff'
    );

    expect(result).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Ambiguous match')
    );
  });
});
