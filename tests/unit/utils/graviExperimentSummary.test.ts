import { describe, it, expect } from 'vitest';
import {
  computeDistinctValueSummary,
  computeNameList,
  computeDateRange,
  computeImageCountBreakdown,
  capForDisplay,
  formatDateRange,
} from '../../../src/renderer/utils/graviExperimentSummary';

describe('computeDistinctValueSummary', () => {
  it('returns the single value with isMixed: false when all inputs are the same', () => {
    expect(computeDistinctValueSummary([600, 600, 600])).toEqual({
      values: ['600'],
      isMixed: false,
    });
  });

  it('returns all distinct values with isMixed: true for 2 distinct values', () => {
    const result = computeDistinctValueSummary([600, 800]);
    expect(result.isMixed).toBe(true);
    expect(result.values.sort()).toEqual(['600', '800']);
  });

  it('returns all distinct values (no cap) with isMixed: true for 4+ distinct values', () => {
    const result = computeDistinctValueSummary([600, 800, 1200, 1600]);
    expect(result.isMixed).toBe(true);
    expect(result.values.sort()).toEqual(['1200', '1600', '600', '800']);
  });

  it('returns {values: [], isMixed: false} for an empty input array', () => {
    expect(computeDistinctValueSummary([])).toEqual({
      values: [],
      isMixed: false,
    });
  });

  it('works for string values (e.g. grid_mode) the same way as numbers', () => {
    const result = computeDistinctValueSummary(['2grid', '4grid']);
    expect(result.isMixed).toBe(true);
    expect(result.values.sort()).toEqual(['2grid', '4grid']);
  });
});

describe('computeNameList', () => {
  it('returns a single name unwrapped in values', () => {
    expect(computeNameList(['Alice'])).toEqual({ values: ['Alice'] });
  });

  it('returns distinct, sorted names for 2+ distinct inputs', () => {
    expect(computeNameList(['Bob', 'Alice', 'Bob'])).toEqual({
      values: ['Alice', 'Bob'],
    });
  });

  it('returns {values: []} for an empty input array', () => {
    expect(computeNameList([])).toEqual({ values: [] });
  });
});

describe('computeDateRange', () => {
  it('returns {earliest, latest} across mixed capture dates', () => {
    const result = computeDateRange([
      new Date('2026-06-20T00:00:00.000Z'),
      new Date('2026-06-15T00:00:00.000Z'),
      new Date('2026-06-18T00:00:00.000Z'),
    ]);
    expect(result?.earliest.toISOString()).toBe('2026-06-15T00:00:00.000Z');
    expect(result?.latest.toISOString()).toBe('2026-06-20T00:00:00.000Z');
  });

  it('accepts string dates and returns Date instances', () => {
    const result = computeDateRange(['2026-06-20', '2026-06-15']);
    expect(result?.earliest).toBeInstanceOf(Date);
    expect(result?.latest).toBeInstanceOf(Date);
  });

  it('returns null for an empty input array', () => {
    expect(computeDateRange([])).toBeNull();
  });
});

describe('computeImageCountBreakdown', () => {
  it('counts distinct scanners/plates/cycles when every scan has a cycle_number', () => {
    const result = computeImageCountBreakdown([
      { scanner_id: 'a', plate_index: '00', cycle_number: 1 },
      { scanner_id: 'a', plate_index: '01', cycle_number: 1 },
      { scanner_id: 'b', plate_index: '00', cycle_number: 2 },
    ]);
    expect(result).toEqual({
      scannerCount: 2,
      plateCount: 2,
      cycleCount: 2,
      scansWithoutCycle: 0,
      totalImages: 3,
    });
  });

  it('counts scans with a null cycle_number separately, not as their own distinct bucket', () => {
    const result = computeImageCountBreakdown([
      { scanner_id: 'a', plate_index: '00', cycle_number: 1 },
      { scanner_id: 'a', plate_index: '01', cycle_number: null },
    ]);
    expect(result).toEqual({
      scannerCount: 1,
      plateCount: 2,
      cycleCount: 1,
      scansWithoutCycle: 1,
      totalImages: 2,
    });
  });

  it('handles every scan having a null cycle_number', () => {
    const result = computeImageCountBreakdown([
      { scanner_id: 'a', plate_index: '00', cycle_number: null },
      { scanner_id: 'a', plate_index: '01', cycle_number: null },
    ]);
    expect(result).toEqual({
      scannerCount: 1,
      plateCount: 2,
      cycleCount: 0,
      scansWithoutCycle: 2,
      totalImages: 2,
    });
  });

  it('returns a concrete zero-value result for an empty input array', () => {
    expect(computeImageCountBreakdown([])).toEqual({
      scannerCount: 0,
      plateCount: 0,
      cycleCount: 0,
      scansWithoutCycle: 0,
      totalImages: 0,
    });
  });
});

describe('capForDisplay', () => {
  it('joins all values with no truncation when 3 or fewer', () => {
    expect(capForDisplay(['600', '800'])).toEqual({
      display: '600, 800',
      title: '600, 800',
    });
  });

  it('caps the display at the first 3 with "+N more", while title holds the full uncapped list', () => {
    const result = capForDisplay(['600', '800', '1200', '1600', '2000']);
    expect(result.display).toBe('600, 800, 1200 +2 more');
    // The whole point of `title` is to be the reveal mechanism for values
    // the capped display hides — it must be the FULL list, not just
    // contain the first hidden value.
    expect(result.title).toBe('600, 800, 1200, 1600, 2000');
  });

  it('returns empty strings for an empty input array', () => {
    expect(capForDisplay([])).toEqual({ display: '', title: '' });
  });
});

describe('formatDateRange', () => {
  it('returns a single formatted date when earliest and latest are the same day', () => {
    const d = new Date('2026-06-15T12:00:00.000Z');
    expect(formatDateRange({ earliest: d, latest: d })).toBe('Jun 15, 2026');
  });

  it('returns a "start - end" range when earliest and latest differ', () => {
    // Noon UTC, not midnight — a capture near a UTC day boundary can render
    // as the local-time-adjacent calendar day (this formatter uses the
    // system's local timezone, matching this codebase's other date
    // formatters, e.g. ExperimentDetail.tsx's formatDate — but those also
    // show the time-of-day, so the shift is visible; this date-only display
    // doesn't carry that context). A known, narrow edge case, not exercised
    // by this test.
    const result = formatDateRange({
      earliest: new Date('2026-06-15T12:00:00.000Z'),
      latest: new Date('2026-06-20T12:00:00.000Z'),
    });
    expect(result).toBe('Jun 15, 2026 - Jun 20, 2026');
  });

  it('returns an empty string for a null range', () => {
    expect(formatDateRange(null)).toBe('');
  });
});
