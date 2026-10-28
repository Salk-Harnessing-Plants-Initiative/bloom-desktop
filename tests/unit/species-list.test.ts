import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  BUILT_IN_SPECIES,
  cleanSpeciesNames,
  createSpeciesStore,
  readSavedSpecies,
  saveSpecies,
} from '../../src/main/species-list';

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-species-'));
  file = path.join(dir, 'species.json');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const now = () => new Date('2026-10-24T10:00:00.000Z');
const quiet = () => {};

describe('cleanSpeciesNames', () => {
  it('trims, drops empty and non-text names, de-duplicates and sorts', () => {
    expect(
      cleanSpeciesNames([' Rice ', 'Arabidopsis', '', null, 'Rice', 7])
    ).toEqual(['Arabidopsis', 'Rice']);
  });
});

describe('the saved list', () => {
  it('reads back what was saved, and leaves no temporary file', async () => {
    await saveSpecies(file, {
      species: ['Rice', 'Sorghum'],
      source: 'bloom',
      updatedAt: '2026-10-24T10:00:00.000Z',
    });
    expect(await readSavedSpecies(file)).toEqual({
      species: ['Rice', 'Sorghum'],
      source: 'saved',
      updatedAt: '2026-10-24T10:00:00.000Z',
    });
    expect(fs.readdirSync(dir)).toEqual(['species.json']);
  });

  it('is null when missing, unreadable or empty', async () => {
    expect(await readSavedSpecies(file)).toBeNull();
    fs.writeFileSync(file, '{ not json');
    expect(await readSavedSpecies(file)).toBeNull();
    fs.writeFileSync(file, JSON.stringify({ species: [] }));
    expect(await readSavedSpecies(file)).toBeNull();
  });
});

describe('createSpeciesStore', () => {
  it('uses the built-in list before Bloom has ever been reached', async () => {
    const store = createSpeciesStore({
      file,
      fetchFromBloom: vi.fn(),
      log: quiet,
    });
    expect(await store.current()).toEqual({
      species: [...BUILT_IN_SPECIES],
      source: 'built-in',
      updatedAt: null,
    });
  });

  it('uses the saved list when there is one', async () => {
    fs.writeFileSync(
      file,
      JSON.stringify({ species: ['Sorghum'], updatedAt: 'then' })
    );
    const store = createSpeciesStore({
      file,
      fetchFromBloom: vi.fn(),
      log: quiet,
    });
    expect((await store.current()).species).toEqual(['Sorghum']);
  });

  it("fetches Bloom's list, uses it and saves it", async () => {
    const store = createSpeciesStore({
      file,
      fetchFromBloom: async () => ['Sorghum', 'Arabidopsis', 'Pennycress'],
      now,
      log: quiet,
    });
    const result = await store.refresh();
    expect(result).toEqual({
      list: {
        species: ['Arabidopsis', 'Pennycress', 'Sorghum'],
        source: 'bloom',
        updatedAt: '2026-10-24T10:00:00.000Z',
      },
    });
    expect((await store.current()).source).toBe('bloom');
    expect((await readSavedSpecies(file))?.species).toEqual([
      'Arabidopsis',
      'Pennycress',
      'Sorghum',
    ]);
  });

  it("keeps the list in use and says why when Bloom can't be reached", async () => {
    fs.writeFileSync(
      file,
      JSON.stringify({ species: ['Sorghum'], updatedAt: 'then' })
    );
    const log = vi.fn();
    const store = createSpeciesStore({
      file,
      fetchFromBloom: async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      },
      log,
    });
    const result = await store.refresh();
    expect(result.error).toBe('getaddrinfo ENOTFOUND');
    expect(result.list).toEqual({
      species: ['Sorghum'],
      source: 'saved',
      updatedAt: 'then',
    });
    expect(log).toHaveBeenCalledWith(
      "[Species] Couldn't fetch the species from Bloom: getaddrinfo ENOTFOUND"
    );
  });

  it('treats an empty answer as a problem, not as "no species"', async () => {
    const store = createSpeciesStore({
      file,
      fetchFromBloom: async () => [],
      log: quiet,
    });
    const result = await store.refresh();
    expect(result.error).toBe('Bloom returned no species');
    expect(result.list.source).toBe('built-in');
    expect(fs.existsSync(file)).toBe(false);
  });

  it('uses the fetched list even if it cannot be saved', async () => {
    const log = vi.fn();
    const store = createSpeciesStore({
      // A file inside a file can't be created.
      file: path.join(file, 'nested.json'),
      fetchFromBloom: async () => ['Rice'],
      log,
    });
    fs.writeFileSync(file, 'x');
    const result = await store.refresh();
    expect(result.list.species).toEqual(['Rice']);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^\[Species\] Couldn't save the species list: /)
    );
  });

  it('runs one fetch at a time: a refresh during the start-up fetch waits for it', async () => {
    let finish: (names: string[]) => void = () => {};
    const fetchFromBloom = vi.fn(
      () => new Promise<string[]>((resolve) => (finish = resolve))
    );
    const store = createSpeciesStore({ file, fetchFromBloom, log: quiet });
    const startUp = store.refresh();
    const clicked = store.refresh();
    finish(['Rice']);
    expect((await startUp).list.species).toEqual(['Rice']);
    expect((await clicked).list.species).toEqual(['Rice']);
    expect(fetchFromBloom).toHaveBeenCalledTimes(1);
    // A later refresh fetches again.
    const later = store.refresh();
    finish(['Rice', 'Wheat']);
    expect((await later).list.species).toEqual(['Rice', 'Wheat']);
    expect(fetchFromBloom).toHaveBeenCalledTimes(2);
  });
});
