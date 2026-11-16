import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  BUILT_IN_SPECIES,
  cleanSpeciesNames,
  createSpeciesStore,
  readSavedSpecies,
  SAVED_SPECIES_FILE,
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
  it('drops empty and non-text names, de-duplicates and sorts', () => {
    expect(
      cleanSpeciesNames(['Rice', 'Arabidopsis', '', '  ', null, 'Rice', 7])
    ).toEqual(['Arabidopsis', 'Rice']);
  });

  it('keeps each name exactly as Bloom has it, since uploads match it exactly', () => {
    expect(cleanSpeciesNames(['Barley ', 'Rice'])).toEqual(['Barley ', 'Rice']);
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
      bloomConnected: () => true,
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
      bloomConnected: () => true,
      fetchFromBloom: vi.fn(),
      log: quiet,
    });
    expect((await store.current()).species).toEqual(['Sorghum']);
  });

  it("fetches Bloom's list, uses it and saves it", async () => {
    const store = createSpeciesStore({
      file,
      bloomConnected: () => true,
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
      bloomConnected: () => true,
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
      bloomConnected: () => true,
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
      bloomConnected: () => true,
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
    const store = createSpeciesStore({
      file,
      bloomConnected: () => true,
      fetchFromBloom,
      log: quiet,
    });
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

describe('species store with Bloom off', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'species-off-'));
    file = path.join(dir, SAVED_SPECIES_FILE);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('refresh returns the list in use without asking Bloom', async () => {
    const fetchFromBloom = vi.fn();
    const store = createSpeciesStore({
      file,
      bloomConnected: () => false,
      fetchFromBloom,
      log: () => {},
    });

    const result = await store.refresh();

    expect(fetchFromBloom).not.toHaveBeenCalled();
    expect(result).toEqual({ list: await store.current() });
    expect(result.list.species).toEqual([...BUILT_IN_SPECIES]);
  });
});

describe('local species list (Bloom off)', () => {
  let dir: string;
  let file: string;
  let connected: boolean;
  const make = () =>
    createSpeciesStore({
      file,
      bloomConnected: () => connected,
      fetchFromBloom: vi.fn(),
      log: () => {},
    });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'species-local-'));
    file = path.join(dir, SAVED_SPECIES_FILE);
    connected = false;
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('adds a trimmed name to the built-in list and saves the whole list', async () => {
    const store = make();

    const result = await store.add('  Lotus japonicus ');

    expect(result.error).toBeUndefined();
    expect(result.list.source).toBe('local');
    expect(result.list.species).toEqual(
      cleanSpeciesNames([...BUILT_IN_SPECIES, 'Lotus japonicus'])
    );
    expect((await readSavedSpecies(file))!.species).toEqual(
      result.list.species
    );
    expect((await make().current()).species).toContain('Lotus japonicus');
  });

  it.each(['', '   '])('refuses the empty name %j', async (name) => {
    const store = make();
    const before = await store.current();
    const result = await store.add(name);
    expect(result.error).toBe('Enter a species name');
    expect(result.list).toEqual(before);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('refuses a name already listed, ignoring case', async () => {
    const store = make();
    const result = await store.add('sorghum');
    expect(result.error).toBe('Sorghum is already in the list');
    expect(fs.existsSync(file)).toBe(false);
  });

  it('removes a species and saves the list', async () => {
    const store = make();
    const result = await store.remove('Sorghum');
    expect(result.error).toBeUndefined();
    expect(result.list.species).not.toContain('Sorghum');
    expect((await readSavedSpecies(file))!.species).not.toContain('Sorghum');
  });

  it('keeps the list in use when an edit cannot be saved', async () => {
    const store = createSpeciesStore({
      // A file inside a file can't be created.
      file: path.join(file, 'nested.json'),
      bloomConnected: () => false,
      fetchFromBloom: vi.fn(),
      log: () => {},
    });
    fs.writeFileSync(file, 'x');
    const before = await store.current();

    const added = await store.add('Lotus japonicus');
    const removed = await store.remove('Sorghum');

    expect(added.error).toMatch(/^Couldn't save the species list: /);
    expect(added.list).toEqual(before);
    expect(removed.error).toMatch(/^Couldn't save the species list: /);
    expect(removed.list).toEqual(before);
    expect(await store.current()).toEqual(before);
  });

  it('refuses to remove a species that is not listed', async () => {
    const result = await make().remove('Banana');
    expect(result.error).toBe("Banana isn't in the list");
  });

  it('refuses both while Bloom is on', async () => {
    connected = true;
    const store = make();
    expect((await store.add('Lotus')).error).toBe(
      'Species are managed in Bloom'
    );
    expect((await store.remove('Sorghum')).error).toBe(
      'Species are managed in Bloom'
    );
    expect(fs.existsSync(file)).toBe(false);
  });
});
