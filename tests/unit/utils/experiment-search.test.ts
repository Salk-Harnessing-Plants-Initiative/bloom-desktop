import { describe, it, expect } from 'vitest';
import { matchesExperimentSearch } from '../../../src/renderer/utils/experiment-search';

const stl = {
  name: '2026-11-10 STL Soy',
  species: 'Soybean',
  scientist: { name: 'Wolfgang Busch' },
  accession: { name: 'STL_soy_accessions.xlsx' },
};

describe('matchesExperimentSearch', () => {
  it('matches everything when the search is empty or spaces', () => {
    expect(matchesExperimentSearch(stl, '')).toBe(true);
    expect(matchesExperimentSearch(stl, '   ')).toBe(true);
  });

  it('matches part of the name, species, scientist or accession file, in any case', () => {
    expect(matchesExperimentSearch(stl, 'stl')).toBe(true);
    expect(matchesExperimentSearch(stl, 'SOYBEAN')).toBe(true);
    expect(matchesExperimentSearch(stl, 'busch')).toBe(true);
    expect(matchesExperimentSearch(stl, 'accessions.xlsx')).toBe(true);
    expect(matchesExperimentSearch(stl, 'canola')).toBe(false);
  });

  it('needs every word, each anywhere', () => {
    expect(matchesExperimentSearch(stl, 'busch  2026-11')).toBe(true);
    expect(matchesExperimentSearch(stl, 'busch canola')).toBe(false);
  });

  it('handles an experiment without a scientist or accession file', () => {
    const bare = {
      name: 'Pilot',
      species: 'Alfalfa',
      scientist: null,
      accession: null,
    };
    expect(matchesExperimentSearch(bare, 'pilot')).toBe(true);
    expect(matchesExperimentSearch(bare, 'busch')).toBe(false);
  });
});
