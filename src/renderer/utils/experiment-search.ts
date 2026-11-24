/**
 * The Experiments page's search: an experiment matches when every word typed appears,
 * in any case, in its name, species, scientist or accession file name.
 */

export interface SearchableExperiment {
  name: string;
  species: string;
  scientist?: { name: string } | null;
  accession?: { name: string } | null;
}

export function matchesExperimentSearch(
  experiment: SearchableExperiment,
  search: string
): boolean {
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = [
    experiment.name,
    experiment.species,
    experiment.scientist?.name ?? '',
    experiment.accession?.name ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return words.every((word) => text.includes(word));
}
