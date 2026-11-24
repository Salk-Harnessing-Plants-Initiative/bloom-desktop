/**
 * Unit tests: Export Scans' search (#471).
 */

import { describe, it, expect } from 'vitest';
import {
  isEmptyFilter,
  parseSearchDate,
  scanMatcher,
  type FilterableScan,
} from '../../src/utils/scan-search';

describe('parseSearchDate', () => {
  it.each([
    ['Nov 20, 2026', { month: 11, day: 20, year: 2026 }],
    ['nov 20 2026', { month: 11, day: 20, year: 2026 }],
    ['  November   20 ,2026 ', { month: 11, day: 20, year: 2026 }],
    ['Nov 20', { month: 11, day: 20 }],
    ['Nov 2026', { month: 11, year: 2026 }],
    ['Nov', { month: 11 }],
    ['NOVEMBER', { month: 11 }],
    ['sept 3', { month: 9, day: 3 }],
    ['May', { month: 5 }],
  ])('reads %j', (text, expected) => {
    expect(parseSearchDate(text)).toEqual(expected);
  });

  it.each([
    '',
    'no',
    'Soy',
    '2026-11-20',
    '11/20/2026',
    'Nov 32',
    'Nov 0',
    'Nov 20 26',
    'Nov 20, 2026 extra',
    'Nov abc',
    'STL Soy Nov',
  ])('does not read %j as a date', (text) => {
    expect(parseSearchDate(text)).toBeNull();
  });
});

const scan = (overrides: Partial<FilterableScan> = {}): FilterableScan => ({
  plant_id: 'ECQM33-005-1-10',
  capture_date: new Date(2026, 10, 20, 11, 27),
  experiment_name: '2026-11-10 STL Soy',
  phenotyper_name: 'Emily Smith',
  ...overrides,
});

describe('scanMatcher', () => {
  it('matches everything with an empty filter', () => {
    expect(scanMatcher({})(scan())).toBe(true);
    expect(isEmptyFilter({})).toBe(true);
    expect(isEmptyFilter({ search: '  ' })).toBe(true);
    expect(isEmptyFilter(undefined)).toBe(true);
    expect(isEmptyFilter({ search: 'emily' })).toBe(false);
    expect(isEmptyFilter({ dateTo: '2026-11-20' })).toBe(false);
  });

  it('searches experiment name, phenotyper name and plant barcode, any part and case', () => {
    expect(scanMatcher({ search: 'stl soy' })(scan())).toBe(true);
    expect(scanMatcher({ search: 'EMI' })(scan())).toBe(true);
    expect(scanMatcher({ search: '005-1-10' })(scan())).toBe(true);
    expect(scanMatcher({ search: '2026-11-10' })(scan())).toBe(true);
    expect(scanMatcher({ search: 'alfalfa' })(scan())).toBe(false);
  });

  it('searches the capture date in the page format, by local day', () => {
    const late = scan({ capture_date: new Date(2026, 10, 20, 23, 30) });
    expect(scanMatcher({ search: 'Nov 20, 2026' })(late)).toBe(true);
    expect(scanMatcher({ search: 'nov 20' })(late)).toBe(true);
    expect(scanMatcher({ search: 'Nov 2026' })(late)).toBe(true);
    expect(scanMatcher({ search: 'Nov 21, 2026' })(late)).toBe(false);
    expect(scanMatcher({ search: 'Nov 2025' })(late)).toBe(false);
  });

  it('filters by local days, both ends inclusive', () => {
    const on = (d: Date) => scan({ capture_date: d });
    const range = { dateFrom: '2026-11-01', dateTo: '2026-11-20' };
    expect(scanMatcher(range)(on(new Date(2026, 10, 1, 0, 1)))).toBe(true);
    expect(scanMatcher(range)(on(new Date(2026, 10, 20, 23, 59)))).toBe(true);
    expect(scanMatcher(range)(on(new Date(2026, 9, 31, 23, 59)))).toBe(false);
    expect(scanMatcher(range)(on(new Date(2026, 10, 21, 0, 0)))).toBe(false);
    expect(scanMatcher({ dateFrom: '2026-11-21' })(scan())).toBe(false);
    expect(scanMatcher({ dateTo: '2026-11-19' })(scan())).toBe(false);
  });

  it('needs both the search and the date range when both are set', () => {
    const filter = {
      search: 'soy',
      dateFrom: '2026-11-01',
      dateTo: '2026-11-30',
    };
    expect(scanMatcher(filter)(scan())).toBe(true);
    expect(scanMatcher(filter)(scan({ experiment_name: 'KCS' }))).toBe(false);
    expect(
      scanMatcher(filter)(scan({ capture_date: new Date(2026, 9, 20) }))
    ).toBe(false);
  });

  it('matches a date-like search as text as well', () => {
    const named = scan({
      experiment_name: 'Nov-drought',
      capture_date: new Date(2026, 4, 1),
    });
    expect(scanMatcher({ search: 'nov' })(named)).toBe(true);
  });
});
