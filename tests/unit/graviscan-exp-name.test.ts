// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  sanitizeExpName,
  findFileNameMarker,
  graviscanExpNameError,
} from '../../src/utils/graviscan-exp-name';

describe('findFileNameMarker', () => {
  it.each([
    ['Plot st 2', 'st'],
    ['Plot_ST_2', 'ST'],
    ['et', 'et'],
    ['Run et', 'et'],
    ['Perceptome Wave3 Part1', 'Wave3'],
    ['Perceptome_wave3_Part2_cont', 'wave3'],
    ['Trial_cy1', 'cy1'],
    ['CY12 test', 'CY12'],
    ['Test Sc2', 'Sc2'],
    ['sc10', 'sc10'],
  ])('finds the marker in %s', (name, word) => {
    expect(findFileNameMarker(name)?.word).toBe(word);
  });

  it.each([
    'Test',
    'Sterile',
    'Waves',
    'wave',
    'cyan',
    'cy',
    'Scope',
    'Sc',
    'Perceptome_Wave_5',
    'Perceptome Screen',
    'Root-Decap-Effect-EXP1',
    'T1-mobo-2grid-2026-05-12',
    'stet',
  ])('allows %s', (name) => {
    expect(findFileNameMarker(name)).toBeNull();
  });

  it('checks the cleaned name, so a space or dash separates words', () => {
    expect(findFileNameMarker('Plot-st-2')?.word).toBe('st');
    expect(findFileNameMarker('Plot.cy3')?.word).toBe('cy3');
  });

  it('checks only the 20 characters that go into the file name', () => {
    // "ABCDEFGHIJKLMNOPQR_st_x" is cut to "ABCDEFGHIJKLMNOPQR_s": no marker.
    expect(findFileNameMarker('ABCDEFGHIJKLMNOPQR st x')).toBeNull();
    // The cut can leave a marker at the end: "ABCDEFGHIJKLMNOPQ_st".
    expect(findFileNameMarker('ABCDEFGHIJKLMNOPQ stuff')?.word).toBe('st');
  });
});

describe('graviscanExpNameError', () => {
  it('returns null for an allowed name', () => {
    expect(graviscanExpNameError('Perceptome Screen')).toBeNull();
  });

  it('names the word and what it marks', () => {
    const msg = graviscanExpNameError('Plot st 2');
    expect(msg).toContain('"st"');
    expect(msg).toContain('start time');
  });

  it('explains that the wave is set separately', () => {
    const msg = graviscanExpNameError('Perceptome Wave3');
    expect(msg).toContain('"Wave3"');
    expect(msg).toMatch(/wave/i);
  });

  it.each([
    ['Run et', 'scan end time'],
    ['Trial cy1', 'cycle'],
    ['Test Sc2', 'scanner'],
  ])('%s → mentions %s', (name, what) => {
    expect(graviscanExpNameError(name)).toContain(what);
  });
});

describe('graviscanExpNameError: 20-character limit', () => {
  it('allows a name of exactly 20 characters', () => {
    expect(graviscanExpNameError('ABCDEFGHIJKLMNOPQRST')).toBeNull();
  });

  it('refuses 21 characters and says why and how long it is', () => {
    const msg = graviscanExpNameError('Perceptome Screen Str');
    expect(msg).toContain('20 characters');
    expect(msg).toContain('21');
    expect(msg).toMatch(/file name/i);
  });

  it('does not count spaces around the name', () => {
    expect(graviscanExpNameError('  ABCDEFGHIJKLMNOPQRST  ')).toBeNull();
  });

  it('reports the length before any marker, so a cut never invents a marker', () => {
    // Cut to 20 this would read "Perceptome_Screen_St".
    const msg = graviscanExpNameError('Perceptome Screen Stress');
    expect(msg).toContain('20 characters');
    expect(msg).not.toContain('"St"');
  });

  it('still refuses a marker word in a short name', () => {
    expect(graviscanExpNameError('Plot st 2')).toContain('"st"');
  });
});

describe('sanitizeExpName (shared with file names)', () => {
  it('cleans and cuts as the rig does', () => {
    expect(sanitizeExpName('Perceptome Screen')).toBe('Perceptome_Screen');
    expect(sanitizeExpName('')).toBe('scan');
  });
});
