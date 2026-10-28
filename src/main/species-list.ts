/**
 * The species list for new experiments, from Bloom.
 *
 * Bloom's uploads match an experiment's species by its common name and refuse one
 * Bloom doesn't have, so the list comes from Bloom's `species` table. It's fetched when
 * the app starts and on Refresh, and saved next to the database so the Experiments page
 * still works offline. Before the first fetch the built-in list is used.
 *
 * No Electron imports, so it's testable on its own; the Bloom fetch is passed in.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SpeciesList, SpeciesRefreshResult } from '../types/species';

/** The list the app shipped with (from the pilot), used until Bloom has been reached once. */
export const BUILT_IN_SPECIES = [
  'Alfalfa',
  'Amaranth',
  'Arabidopsis',
  'Canola',
  'Lotus',
  'Maize',
  'Medicago',
  'Pennycress',
  'Rice',
  'Sorghum',
  'Soybean',
  'Spinach',
  'Sugar_Beet',
  'Tomato',
  'Wheat',
] as const;

/** The saved copy's file name, next to the database. */
export const SAVED_SPECIES_FILE = 'species.json';

/** Bloom's Species page, where a new species is added. */
export const BLOOM_SPECIES_PAGE_URL = 'https://bloom.salk.edu/app/species';

/** Trimmed, de-duplicated and sorted, ignoring empty names. */
export function cleanSpeciesNames(names: unknown[]): string[] {
  const cleaned = names
    .filter((n): n is string => typeof n === 'string')
    .map((n) => n.trim())
    .filter((n) => n !== '');
  return [...new Set(cleaned)].sort((a, b) => a.localeCompare(b));
}

function builtIn(): SpeciesList {
  return {
    species: [...BUILT_IN_SPECIES],
    source: 'built-in',
    updatedAt: null,
  };
}

/** The saved list, or null if there's none or it can't be read. */
export async function readSavedSpecies(
  file: string
): Promise<SpeciesList | null> {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(file, 'utf-8'));
    const species = cleanSpeciesNames(
      Array.isArray(parsed?.species) ? parsed.species : []
    );
    if (species.length === 0) return null;
    return {
      species,
      source: 'saved',
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    };
  } catch {
    return null;
  }
}

/** Save the list, writing a temporary file and renaming it so a crash can't leave half a file. */
export async function saveSpecies(
  file: string,
  list: SpeciesList
): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.promises.writeFile(
    tmp,
    JSON.stringify(
      { species: list.species, updatedAt: list.updatedAt },
      null,
      2
    )
  );
  await fs.promises.rename(tmp, file);
}

export interface SpeciesStoreDeps {
  /** The saved copy's path. */
  file: string;
  /** Species common names from Bloom; throws if Bloom can't be reached. */
  fetchFromBloom: () => Promise<string[]>;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface SpeciesStore {
  /** The list in use: the saved copy, or the built-in list, until a fetch succeeds. */
  current: () => Promise<SpeciesList>;
  /** Fetch from Bloom and save; on failure keep the list in use and say why. */
  refresh: () => Promise<SpeciesRefreshResult>;
}

export function createSpeciesStore(deps: SpeciesStoreDeps): SpeciesStore {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((m: string) => console.log(m));
  let inUse: SpeciesList | null = null;
  // One fetch at a time: a Refresh during the start-up fetch waits for it.
  let fetching: Promise<SpeciesRefreshResult> | null = null;

  async function current(): Promise<SpeciesList> {
    if (!inUse) inUse = (await readSavedSpecies(deps.file)) ?? builtIn();
    return inUse;
  }

  async function fetchAndSave(): Promise<SpeciesRefreshResult> {
    try {
      const species = cleanSpeciesNames(await deps.fetchFromBloom());
      // An empty answer is a problem with the account or Bloom, not "no species".
      if (species.length === 0) throw new Error('Bloom returned no species');
      const list: SpeciesList = {
        species,
        source: 'bloom',
        updatedAt: now().toISOString(),
      };
      inUse = list;
      try {
        await saveSpecies(deps.file, list);
      } catch (error) {
        log(
          `[Species] Couldn't save the species list: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }
      log(`[Species] Fetched ${species.length} species from Bloom`);
      return { list };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log(`[Species] Couldn't fetch the species from Bloom: ${message}`);
      return { list: await current(), error: message };
    }
  }

  function refresh(): Promise<SpeciesRefreshResult> {
    if (!fetching) {
      fetching = fetchAndSave().finally(() => {
        fetching = null;
      });
    }
    return fetching;
  }

  return { current, refresh };
}
