import { describe, it, expect } from 'vitest';
import { naturalCompare } from '../../src/utils/natural-sort';

describe('naturalCompare', () => {
  it('orders numeric suffixes numerically rather than lexicographically', () => {
    const ids = ['Plate10', 'Plate2', 'Plate1', 'Plate20', 'Plate3'];
    const sorted = [...ids].sort(naturalCompare);
    expect(sorted).toEqual([
      'Plate1',
      'Plate2',
      'Plate3',
      'Plate10',
      'Plate20',
    ]);
  });

  it('orders zero-padded codes correctly', () => {
    const ids = ['P010', 'P02', 'P01'];
    const sorted = [...ids].sort(naturalCompare);
    expect(sorted).toEqual(['P01', 'P02', 'P010']);
  });

  it('orders pure-numeric strings numerically', () => {
    const ids = ['10', '2', '1', '20', '3'];
    const sorted = [...ids].sort(naturalCompare);
    expect(sorted).toEqual(['1', '2', '3', '10', '20']);
  });

  it('respects alpha prefix ordering before numeric suffix', () => {
    const ids = ['B1', 'A10', 'A2'];
    const sorted = [...ids].sort(naturalCompare);
    expect(sorted).toEqual(['A2', 'A10', 'B1']);
  });

  it('handles ids with no numeric component', () => {
    const ids = ['gamma', 'alpha', 'beta'];
    const sorted = [...ids].sort(naturalCompare);
    expect(sorted).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('handles multiple numeric runs in one string', () => {
    const ids = ['Plate1-Section10', 'Plate1-Section2', 'Plate10-Section1'];
    const sorted = [...ids].sort(naturalCompare);
    expect(sorted).toEqual([
      'Plate1-Section2',
      'Plate1-Section10',
      'Plate10-Section1',
    ]);
  });
});
