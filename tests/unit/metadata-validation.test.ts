/**
 * Unit tests for scan metadata validation
 *
 * Tests validation logic for Wave Number and Plant Age fields:
 * - Must be non-negative integers (0 or greater)
 * - Must be whole numbers (no decimals)
 * - Must not be null/empty (required fields)
 */

import { describe, it, expect } from 'vitest';
import {
  validateWaveNumber,
  validatePlantAgeDays,
} from '../../src/utils/metadata-validation';

describe('validateWaveNumber', () => {
  describe('Valid values', () => {
    it('should accept 0 as valid', () => {
      const result = validateWaveNumber('0');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.value).toBe(0);
    });

    it('should accept positive integers as valid', () => {
      expect(validateWaveNumber('1').isValid).toBe(true);
      expect(validateWaveNumber('5').isValid).toBe(true);
      expect(validateWaveNumber('100').isValid).toBe(true);
    });

    it('should return parsed integer value', () => {
      expect(validateWaveNumber('42').value).toBe(42);
    });
  });

  describe('Invalid values - empty/null', () => {
    it('should reject empty string', () => {
      const result = validateWaveNumber('');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Wave number is required');
    });

    it('should reject whitespace-only string', () => {
      const result = validateWaveNumber('   ');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Wave number is required');
    });
  });

  describe('Invalid values - negative numbers', () => {
    it('should reject negative integers', () => {
      const result = validateWaveNumber('-1');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Wave number must be 0 or greater');
    });

    it('should reject negative decimals', () => {
      const result = validateWaveNumber('-1.5');
      expect(result.isValid).toBe(false);
      // Could be either "must be whole number" or "must be 0 or greater"
      // Implementation should check negative first
      expect(result.error).toBe('Wave number must be 0 or greater');
    });
  });

  describe('Invalid values - decimals', () => {
    it('should reject decimal values', () => {
      const result = validateWaveNumber('1.5');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Wave number must be a whole number');
    });

    it('should reject decimal values with trailing zeros', () => {
      const result = validateWaveNumber('2.0');
      // 2.0 is technically a whole number, but entered as decimal
      // Implementation decision: accept "2.0" as valid (equals 2)
      // OR reject because it contains a decimal point
      // Per spec: "only accept non-negative integers" - 2.0 has decimal point
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Wave number must be a whole number');
    });

    it('should reject small decimal values', () => {
      const result = validateWaveNumber('0.5');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Wave number must be a whole number');
    });
  });

  describe('Invalid values - non-numeric', () => {
    it('should reject alphabetic characters', () => {
      const result = validateWaveNumber('abc');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Wave number must be a whole number');
    });

    it('should reject mixed alphanumeric', () => {
      const result = validateWaveNumber('12a');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Wave number must be a whole number');
    });
  });
});

describe('validatePlantAgeDays', () => {
  describe('Valid values', () => {
    it('should accept 0 as valid (day of planting)', () => {
      const result = validatePlantAgeDays('0');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.value).toBe(0);
    });

    it('should accept positive integers as valid', () => {
      expect(validatePlantAgeDays('1').isValid).toBe(true);
      expect(validatePlantAgeDays('14').isValid).toBe(true);
      expect(validatePlantAgeDays('365').isValid).toBe(true);
    });

    it('should return parsed integer value', () => {
      expect(validatePlantAgeDays('14').value).toBe(14);
    });
  });

  describe('Invalid values - empty/null', () => {
    it('should reject empty string', () => {
      const result = validatePlantAgeDays('');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Plant age is required');
    });

    it('should reject whitespace-only string', () => {
      const result = validatePlantAgeDays('   ');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Plant age is required');
    });
  });

  describe('Invalid values - negative numbers', () => {
    it('should reject negative integers', () => {
      const result = validatePlantAgeDays('-1');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Plant age must be 0 or greater');
    });
  });

  describe('Invalid values - decimals', () => {
    it('should reject decimal values', () => {
      const result = validatePlantAgeDays('14.5');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Plant age must be a whole number');
    });

    it('should reject decimal values with trailing zeros', () => {
      const result = validatePlantAgeDays('7.0');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Plant age must be a whole number');
    });
  });
});
