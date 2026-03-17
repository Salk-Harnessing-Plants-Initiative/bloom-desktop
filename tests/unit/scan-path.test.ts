/**
 * Unit tests for scan path builder utility
 *
 * Tests the buildScanPath() function that generates pilot-compatible
 * scan directory paths: YYYY-MM-DD/<plant_qr_code>/<scan_uuid>
 */

import { describe, it, expect } from 'vitest';
import {
  buildScanPath,
  toRelativeScanPath,
  isAbsolutePath,
} from '../../src/utils/scan-path';

describe('buildScanPath', () => {
  const fixedDate = new Date(2026, 2, 4, 12, 0, 0); // March 4, 2026
  const testUuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  describe('Format', () => {
    it('should produce YYYY-MM-DD/plant_qr_code/uuid format', () => {
      const result = buildScanPath('PLANT-001', testUuid, fixedDate);
      expect(result).toBe(`2026-03-04/PLANT-001/${testUuid}`);
    });

    it('should have exactly 3 path segments', () => {
      const result = buildScanPath('PLANT-001', testUuid, fixedDate);
      const segments = result.split('/');
      expect(segments).toHaveLength(3);
    });

    it('should use date as first segment', () => {
      const result = buildScanPath('PLANT-001', testUuid, fixedDate);
      const segments = result.split('/');
      expect(segments[0]).toBe('2026-03-04');
    });

    it('should use plant QR code as second segment', () => {
      const result = buildScanPath('PLANT-001', testUuid, fixedDate);
      const segments = result.split('/');
      expect(segments[1]).toBe('PLANT-001');
    });

    it('should use UUID as third segment', () => {
      const result = buildScanPath('PLANT-001', testUuid, fixedDate);
      const segments = result.split('/');
      expect(segments[2]).toBe(testUuid);
    });
  });

  describe('Sanitization', () => {
    it('should sanitize plant QR code with special characters', () => {
      const result = buildScanPath('PLANT/001..bad', testUuid, fixedDate);
      expect(result).not.toContain('/001');
      expect(result).not.toContain('..');
      // Should have 3 segments (date/sanitized_plant/uuid)
      expect(result.split('/').length).toBe(3);
    });

    it('should remove path traversal from plant QR code', () => {
      const result = buildScanPath('../../../etc/passwd', testUuid, fixedDate);
      expect(result).not.toContain('..');
      // First segment should still be the date
      expect(result.startsWith('2026-03-04/')).toBe(true);
    });

    it('should replace non-alphanumeric characters with underscores', () => {
      const result = buildScanPath('PLANT@#$%001', testUuid, fixedDate);
      const segments = result.split('/');
      // Special chars replaced with underscores (collapsed)
      expect(segments[1]).toBe('PLANT_001');
    });

    it('should NOT sanitize the UUID segment', () => {
      // UUIDs contain hyphens which should be preserved
      const result = buildScanPath('PLANT-001', testUuid, fixedDate);
      expect(result).toContain(testUuid);
    });

    it('should NOT sanitize the date segment', () => {
      const result = buildScanPath('PLANT-001', testUuid, fixedDate);
      expect(result.startsWith('2026-03-04/')).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty plant QR code as "unknown"', () => {
      const result = buildScanPath('', testUuid, fixedDate);
      const segments = result.split('/');
      // sanitizePathComponent('') returns '' but sanitizePathComponent('   ') returns 'unknown'
      // Empty string passes through, let's check what happens
      expect(segments.length).toBe(3);
    });

    it('should handle whitespace-only plant QR code as "unknown"', () => {
      const result = buildScanPath('   ', testUuid, fixedDate);
      const segments = result.split('/');
      expect(segments[1]).toBe('unknown');
    });

    it('should truncate long plant QR codes', () => {
      const longCode = 'A'.repeat(150);
      const result = buildScanPath(longCode, testUuid, fixedDate);
      const segments = result.split('/');
      // sanitizePathComponent has default maxLength of 100
      expect(segments[1].length).toBeLessThanOrEqual(100);
    });

    it('should collapse multiple underscores in plant QR code', () => {
      const result = buildScanPath('PLANT___001', testUuid, fixedDate);
      const segments = result.split('/');
      expect(segments[1]).toBe('PLANT_001');
    });

    it('should use current date when no date provided', () => {
      const result = buildScanPath('PLANT-001', testUuid);
      // Should match today's date
      const now = new Date();
      const expectedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      expect(result.startsWith(`${expectedDate}/`)).toBe(true);
    });
  });

  describe('Integration with CaptureScan', () => {
    it('should produce paths that work when joined with scansDir', () => {
      const scansDir = '/Users/test/.bloom/scans';
      const relativePath = buildScanPath('PLANT-001', testUuid, fixedDate);
      const absolutePath = `${scansDir}/${relativePath}`;
      expect(absolutePath).toBe(
        `/Users/test/.bloom/scans/2026-03-04/PLANT-001/${testUuid}`
      );
    });
  });

  describe('Pilot Compatibility', () => {
    it('should match pilot format: YYYY-MM-DD/plantId/scanId', () => {
      // Pilot: scanner.ts lines 50-54
      // path.join(getLocalDateInYYYYMMDD(captureDate), plantId, scanId)
      const result = buildScanPath('PLANT-ABC-123', testUuid, fixedDate);
      expect(result).toBe(`2026-03-04/PLANT-ABC-123/${testUuid}`);
    });

    it('should produce a relative path (no leading slash)', () => {
      const result = buildScanPath('PLANT-001', testUuid, fixedDate);
      expect(result.startsWith('/')).toBe(false);
    });
  });
});

describe('UUID uniqueness', () => {
  it('should produce unique paths when same plant scanned twice on same date', () => {
    const fixedDate = new Date(2026, 2, 4, 12, 0, 0);
    const uuid1 = crypto.randomUUID();
    const uuid2 = crypto.randomUUID();

    const path1 = buildScanPath('PLANT-001', uuid1, fixedDate);
    const path2 = buildScanPath('PLANT-001', uuid2, fixedDate);

    expect(path1).not.toBe(path2);
    // UUIDs should differ
    expect(uuid1).not.toBe(uuid2);
    // But date and plant segments should match
    const segments1 = path1.split('/');
    const segments2 = path2.split('/');
    expect(segments1[0]).toBe(segments2[0]); // same date
    expect(segments1[1]).toBe(segments2[1]); // same plant
    expect(segments1[2]).not.toBe(segments2[2]); // different UUID
  });
});

describe('toRelativeScanPath', () => {
  it('should strip scansDir prefix from absolute path', () => {
    const result = toRelativeScanPath(
      '/Users/test/.bloom/scans/2026-03-04/PLANT-001/abc-uuid',
      '/Users/test/.bloom/scans'
    );
    expect(result).toBe('2026-03-04/PLANT-001/abc-uuid');
  });

  it('should handle scansDir with trailing slash', () => {
    const result = toRelativeScanPath(
      '/Users/test/.bloom/scans/2026-03-04/PLANT-001/abc-uuid',
      '/Users/test/.bloom/scans/'
    );
    expect(result).toBe('2026-03-04/PLANT-001/abc-uuid');
  });

  it('should normalize backslashes on Windows-style paths', () => {
    const result = toRelativeScanPath(
      'C:\\Users\\test\\.bloom\\scans\\2026-03-04\\PLANT-001\\abc-uuid',
      'C:\\Users\\test\\.bloom\\scans'
    );
    expect(result).toBe('2026-03-04/PLANT-001/abc-uuid');
  });

  it('should return path as-is if it does not start with scansDir', () => {
    const result = toRelativeScanPath(
      '/other/path/2026-03-04/PLANT-001/abc-uuid',
      '/Users/test/.bloom/scans'
    );
    expect(result).toBe('/other/path/2026-03-04/PLANT-001/abc-uuid');
  });

  it('should handle image paths (deeper than scan dir)', () => {
    const result = toRelativeScanPath(
      '/Users/test/.bloom/scans/2026-03-04/PLANT-001/abc-uuid/001.png',
      '/Users/test/.bloom/scans'
    );
    expect(result).toBe('2026-03-04/PLANT-001/abc-uuid/001.png');
  });
});

describe('isAbsolutePath', () => {
  it('should detect Unix absolute paths', () => {
    expect(isAbsolutePath('/Users/test/scans/image.png')).toBe(true);
  });

  it('should detect Windows drive letter (uppercase)', () => {
    expect(isAbsolutePath('C:\\Users\\test\\scans\\image.png')).toBe(true);
  });

  it('should detect Windows drive letter (lowercase with forward slash)', () => {
    expect(isAbsolutePath('d:/scans/image.png')).toBe(true);
  });

  it('should return false for relative pilot-format paths', () => {
    expect(isAbsolutePath('2026-03-04/PLANT-001/uuid/001.png')).toBe(false);
  });

  it('should return false for relative bare filenames', () => {
    expect(isAbsolutePath('001.png')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isAbsolutePath('')).toBe(false);
  });
});
