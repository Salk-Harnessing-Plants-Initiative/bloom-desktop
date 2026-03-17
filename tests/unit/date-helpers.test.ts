/**
 * Unit tests for date helper utilities
 *
 * Tests the getLocalDateYYYYMMDD() function that formats dates
 * in local timezone as YYYY-MM-DD, matching pilot behavior.
 */

import { describe, it, expect } from 'vitest';
import { getLocalDateYYYYMMDD } from '../../src/utils/date-helpers';

describe('getLocalDateYYYYMMDD', () => {
  it('should format a known date as YYYY-MM-DD', () => {
    // March 4, 2026 at noon local time
    const date = new Date(2026, 2, 4, 12, 0, 0); // month is 0-indexed
    expect(getLocalDateYYYYMMDD(date)).toBe('2026-03-04');
  });

  it('should format dates with single-digit months and days with zero padding', () => {
    const date = new Date(2026, 0, 5, 12, 0, 0); // Jan 5
    expect(getLocalDateYYYYMMDD(date)).toBe('2026-01-05');
  });

  it('should format end-of-year dates correctly', () => {
    const date = new Date(2026, 11, 31, 23, 0, 0); // Dec 31
    expect(getLocalDateYYYYMMDD(date)).toBe('2026-12-31');
  });

  it('should use local timezone, not UTC', () => {
    // Create a date at 11:30 PM local time
    // The key property: getLocalDateYYYYMMDD should return the LOCAL date
    const date = new Date(2026, 2, 4, 23, 30, 0); // March 4 at 11:30 PM local
    const result = getLocalDateYYYYMMDD(date);
    // Should be March 4 in local timezone regardless of UTC date
    expect(result).toBe('2026-03-04');
  });

  it('should use current date when no argument provided', () => {
    const result = getLocalDateYYYYMMDD();
    // Should match today's date in YYYY-MM-DD format
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(result).toBe(expected);
  });

  it('should return a string matching YYYY-MM-DD pattern', () => {
    const result = getLocalDateYYYYMMDD(new Date());
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
