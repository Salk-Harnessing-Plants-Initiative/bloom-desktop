/**
 * The species an experiment can be created for. They come from Bloom, so an
 * experiment's species always matches a species Bloom has, which its uploads need.
 */

/**
 * Where the list came from: Bloom just now, the copy saved last time, the built-in
 * list, or edited on this computer while Bloom is off.
 */
export type SpeciesListSource = 'bloom' | 'saved' | 'built-in' | 'local';

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

/** Result of adding or removing a species on this computer. */
export interface SpeciesEditResult {
  /** The list now in use (unchanged if the edit was refused). */
  list: SpeciesList;
  /** Why the edit was refused, if it was. */
  error?: string;
}

export interface SpeciesAPI {
  /** The list in use (fetched from Bloom when the app started, or saved, or built in). */
  list: () => Promise<SpeciesList>;
  /** Fetch the list from Bloom again, e.g. after adding a species there. */
  refresh: () => Promise<SpeciesRefreshResult>;
  /** Open Bloom's Species page in the browser, to add a species. */
  openAddPage: () => Promise<{ success: boolean; error?: string }>;
  /** Add a species to this computer's list (Bloom off only). */
  add: (name: string) => Promise<SpeciesEditResult>;
  /** Remove a species from this computer's list (Bloom off only). */
  remove: (name: string) => Promise<SpeciesEditResult>;
}
