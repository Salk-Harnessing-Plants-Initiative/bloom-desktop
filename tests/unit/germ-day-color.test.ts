/**
 * The germination colour typed on Capture Scan, cleaned to camel case (#429).
 */

import { describe, it, expect } from 'vitest';
import {
  MAX_GERM_DAY_COLOR_LENGTH,
  normalizeGermDayColor,
} from '../../src/utils/germ-day-color';

describe('normalizeGermDayColor', () => {
  it.each([
    ['red', 'Red'],
    ['RED', 'Red'],
    ['  Red  ', 'Red'],
    ['arctic blue', 'ArcticBlue'],
    ['GERM RED', 'GermRed'],
    ['germ-red', 'GermRed'],
    ['germ_pink', 'GermPink'],
    ['GermRed', 'GermRed'],
    ['TriColor', 'TriColor'],
    ['Red 2', 'Red2'],
  ])('cleans %j to %j', (typed, saved) => {
    expect(normalizeGermDayColor(typed)).toBe(saved);
  });

  it.each(['', '   ', 'na', 'NA', 'N/A', 'n.a.', 'none', 'None', 'NONE', '--'])(
    'treats %j as no colour',
    (typed) => {
      expect(normalizeGermDayColor(typed)).toBe('');
    }
  );

  it('ignores anything that is not text, and caps the length', () => {
    expect(normalizeGermDayColor(undefined)).toBe('');
    expect(normalizeGermDayColor(42)).toBe('');
    expect(normalizeGermDayColor('a'.repeat(100))).toHaveLength(
      MAX_GERM_DAY_COLOR_LENGTH
    );
  });
});
