/**
 * Unit tests for path sanitization utilities
 *
 * These tests verify security-critical path sanitization logic
 * that prevents path traversal attacks.
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizePathComponent,
  sanitizePath,
} from '../../src/utils/path-sanitizer';

describe('sanitizePathComponent', () => {
  describe('Path Traversal Attack Prevention', () => {
    it('should remove path traversal sequences', () => {
      expect(sanitizePathComponent('../../../etc/passwd')).toBe('etcpasswd');
      expect(sanitizePathComponent('..\\..\\windows\\system32')).toBe(
        'windowssystem32'
      );
      expect(sanitizePathComponent('normal/../traversal')).toBe(
        'normaltraversal'
      );
    });

    it('should remove directory separators', () => {
      expect(sanitizePathComponent('path/with/slashes')).toBe(
        'pathwithslashes'
      );
      expect(sanitizePathComponent('path\\with\\backslashes')).toBe(
        'pathwithbackslashes'
      );
      expect(sanitizePathComponent('mixed/path\\separators')).toBe(
        'mixedpathseparators'
      );
    });

    it('should remove null bytes', () => {
      expect(sanitizePathComponent('evil\0file')).toBe('evilfile');
      expect(sanitizePathComponent('\0\0\0')).toBe('unknown');
    });
  });

  describe('Character Whitelisting', () => {
    it('should allow alphanumeric characters', () => {
      expect(sanitizePathComponent('abc123XYZ')).toBe('abc123XYZ');
      expect(sanitizePathComponent('Test123')).toBe('Test123');
    });

    it('should allow dash, underscore, and period', () => {
      expect(sanitizePathComponent('file-name_v2.0')).toBe('file-name_v2.0');
      expect(sanitizePathComponent('experiment_2024-01-15.data')).toBe(
        'experiment_2024-01-15.data'
      );
    });

    it('should replace special characters with underscores', () => {
      // Special chars are replaced then collapsed to single underscore
      expect(sanitizePathComponent('file@#$%name')).toBe('file_name');
      expect(sanitizePathComponent('test!file?')).toBe('test_file_');
      expect(sanitizePathComponent('café')).toBe('caf_'); // non-ASCII
    });

    it('should collapse multiple underscores', () => {
      expect(sanitizePathComponent('test___file')).toBe('test_file');
      expect(sanitizePathComponent('a@@@@b')).toBe('a_b');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty strings', () => {
      // Empty string input returns empty string
      expect(sanitizePathComponent('')).toBe('');
      // Whitespace-only becomes empty after trim, then becomes 'unknown'
      expect(sanitizePathComponent('   ')).toBe('unknown');
    });

    it('should handle strings that become empty after sanitization', () => {
      expect(sanitizePathComponent('///')).toBe('unknown');
      expect(sanitizePathComponent('...')).toBe('unknown');
      expect(sanitizePathComponent('///...///')).toBe('unknown');
    });

    it('should trim whitespace', () => {
      expect(sanitizePathComponent('  test  ')).toBe('test');
      expect(sanitizePathComponent('\t\nfile\n\t')).toBe('file');
    });

    it('should remove leading/trailing periods and dashes', () => {
      expect(sanitizePathComponent('.hidden')).toBe('hidden');
      expect(sanitizePathComponent('-test-')).toBe('test');
      expect(sanitizePathComponent('..file..')).toBe('file');
    });

    it('should handle non-string inputs', () => {
      expect(sanitizePathComponent(null as unknown as string)).toBe('');
      expect(sanitizePathComponent(undefined as unknown as string)).toBe('');
      expect(sanitizePathComponent(123 as unknown as string)).toBe('');
    });
  });

  describe('Length Limits', () => {
    it('should enforce default max length of 100', () => {
      const longString = 'a'.repeat(150);
      const result = sanitizePathComponent(longString);
      expect(result.length).toBe(100);
    });

    it('should respect custom max length', () => {
      const longString = 'a'.repeat(50);
      const result = sanitizePathComponent(longString, 20);
      expect(result.length).toBe(20);
    });

    it('should not truncate short strings', () => {
      expect(sanitizePathComponent('short', 100)).toBe('short');
    });
  });

  describe('Real-world Attack Vectors', () => {
    it('should neutralize common path traversal attacks', () => {
      const attacks = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32',
        'normal/../../etc/passwd',
        './../../../etc/passwd',
        '....//....//....//etc/passwd',
        '%2e%2e%2f%2e%2e%2f',
      ];

      attacks.forEach((attack) => {
        const result = sanitizePathComponent(attack);
        expect(result).not.toContain('..');
        expect(result).not.toContain('/');
        expect(result).not.toContain('\\');
      });
    });

    it('should handle encoded traversal attempts', () => {
      // URL encoding of ../ is %2e%2e%2f - % gets replaced with _
      expect(sanitizePathComponent('%2e%2e%2f')).toBe('_2e_2e_2f');
    });
  });

  describe('Valid Use Cases', () => {
    it('should preserve valid experiment IDs', () => {
      expect(sanitizePathComponent('EXP-2024-001')).toBe('EXP-2024-001');
      expect(sanitizePathComponent('drought_study_v2')).toBe(
        'drought_study_v2'
      );
    });

    it('should preserve valid plant QR codes', () => {
      expect(sanitizePathComponent('PLANT-12345')).toBe('PLANT-12345');
      expect(sanitizePathComponent('QR_ABC123')).toBe('QR_ABC123');
    });

    it('should preserve valid accession IDs', () => {
      expect(sanitizePathComponent('ACC-2024-0001')).toBe('ACC-2024-0001');
      expect(sanitizePathComponent('CS12345')).toBe('CS12345');
    });

    it('should preserve timestamps', () => {
      expect(sanitizePathComponent('2024-01-15_143022')).toBe(
        '2024-01-15_143022'
      );
      expect(sanitizePathComponent('1704467422000')).toBe('1704467422000');
    });
  });
});

describe('sanitizePath', () => {
  it('should sanitize multiple path components', () => {
    const result = sanitizePath(['scans', '../evil', 'plant-123']);
    expect(result).toBe('scans/evil/plant-123');
  });

  it('should filter out empty components', () => {
    const result = sanitizePath(['scans', '', 'plant-123', '   ']);
    // Empty string is filtered, whitespace becomes 'unknown'
    expect(result).toBe('scans/plant-123/unknown');
  });

  it('should use custom separator', () => {
    const result = sanitizePath(['a', 'b', 'c'], '_');
    expect(result).toBe('a_b_c');
  });

  it('should handle complex real-world paths', () => {
    const result = sanitizePath([
      'scans',
      'EXP-2024/../../../etc/passwd',
      'PLANT_123',
      '1704467422000',
    ]);
    expect(result).toBe('scans/EXP-2024etcpasswd/PLANT_123/1704467422000');
  });

  it('should prevent directory traversal in multi-component paths', () => {
    const result = sanitizePath(['../..', 'system', '..\\..\\windows']);
    expect(result).not.toContain('..');
    expect(result).not.toContain('\\');
    // '../..' becomes empty after removing .., then becomes 'unknown'
    expect(result).toBe('unknown/system/windows');
  });
});

describe('Integration Test - CaptureScan Usage', () => {
  it('should safely handle malicious experiment and plant IDs', () => {
    // Simulate what CaptureScan does
    const experimentId = '../../../etc';
    const plantQrCode = 'passwd';
    const timestamp = Date.now();

    const sanitizedPath = sanitizePath([
      'scans',
      experimentId,
      `${plantQrCode}_${timestamp}`,
    ]);

    const outputPath = `./${sanitizedPath}`;

    // Verify the path stays within ./scans directory
    expect(outputPath).toMatch(/^\.\/scans\//);
    expect(outputPath).not.toContain('..');
    // After sanitization, '../../../etc' becomes 'etc' (safe within ./scans/)
    // The path will be ./scans/etc/passwd_<timestamp> which is safe
    expect(sanitizedPath).toBe(`scans/etc/passwd_${timestamp}`);
  });

  it('should create valid paths for normal inputs', () => {
    const experimentId = 'EXP-2024-001';
    const plantQrCode = 'PLANT-ABC-123';
    const timestamp = 1704467422000;

    const sanitizedPath = sanitizePath([
      'scans',
      experimentId,
      `${plantQrCode}_${timestamp}`,
    ]);

    const outputPath = `./${sanitizedPath}`;

    expect(outputPath).toBe('./scans/EXP-2024-001/PLANT-ABC-123_1704467422000');
  });
});
