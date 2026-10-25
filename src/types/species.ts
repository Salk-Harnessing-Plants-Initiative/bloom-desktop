/**
 * The species an experiment can be created for. They come from Bloom, so an
 * experiment's species always matches a species Bloom has, which its uploads need.
 */

/** Where the list came from: Bloom just now, the copy saved last time, or the built-in list. */
export type SpeciesListSource = 'bloom' | 'saved' | 'built-in';

export interface SpeciesList {
  /** Species common names, sorted, as Bloom stores them. */
  species: string[];
  source: SpeciesListSource;
  /** When the list was last fetched from Bloom (ISO 8601), or null if never. */
  updatedAt: string | null;
}

export interface SpeciesRefreshResult {
  /** The list now in use: Bloom's, or the previous one if Bloom couldn't be reached. */
  list: SpeciesList;
  /** Why Bloom couldn't be reached, if it couldn't. */
  error?: string;
}

export interface SpeciesAPI {
  /** The list in use (fetched from Bloom when the app started, or saved, or built in). */
  list: () => Promise<SpeciesList>;
  /** Fetch the list from Bloom again, e.g. after adding a species there. */
  refresh: () => Promise<SpeciesRefreshResult>;
  /** Open Bloom's Species page in the browser, to add a species. */
  openAddPage: () => Promise<{ success: boolean; error?: string }>;
}
