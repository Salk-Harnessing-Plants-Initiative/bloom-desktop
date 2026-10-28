import { describe, it, expect, vi, beforeEach } from 'vitest';

const signIn = vi.fn();
const signOut = vi.fn();
const query = { select: vi.fn(), is: vi.fn() };
const from = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { signInWithPassword: signIn, signOut },
    from,
  })),
}));

import { createClient } from '@supabase/supabase-js';
import {
  fetchBloomSpecies,
  registerSpeciesHandlers,
} from '../../src/main/species-handlers';
import type { SpeciesStore } from '../../src/main/species-list';

const CONFIG = {
  bloom_api_url: 'https://api.bloom.salk.edu/proxy',
  bloom_anon_key: 'anon',
  bloom_scanner_username: 'scanner@example.org',
  bloom_scanner_password: 'secret',
};

beforeEach(() => {
  vi.clearAllMocks();
  signIn.mockResolvedValue({ error: null });
  from.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.is.mockResolvedValue({
    data: [{ common_name: 'Sorghum' }, { common_name: 'Rice' }],
    error: null,
  });
});

describe('fetchBloomSpecies', () => {
  it("signs in as the scanner, reads the species that haven't been removed, and doesn't sign out", async () => {
    expect(await fetchBloomSpecies(CONFIG)).toEqual(['Sorghum', 'Rice']);
    expect(createClient).toHaveBeenCalledWith(
      'https://api.bloom.salk.edu/proxy',
      'anon',
      {
        auth: { persistSession: false },
      }
    );
    expect(signIn).toHaveBeenCalledWith({
      email: 'scanner@example.org',
      password: 'secret',
    });
    expect(from).toHaveBeenCalledWith('species');
    expect(query.select).toHaveBeenCalledWith('common_name');
    expect(query.is).toHaveBeenCalledWith('deleted_at', null);
    expect(signOut).not.toHaveBeenCalled();
  });

  it('refuses without credentials, before contacting Bloom', async () => {
    await expect(
      fetchBloomSpecies({ ...CONFIG, bloom_scanner_password: '' })
    ).rejects.toThrow('Bloom credentials are not set up on this computer');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('says when the sign-in fails', async () => {
    signIn.mockResolvedValue({
      error: { message: 'Invalid login credentials' },
    });
    await expect(fetchBloomSpecies(CONFIG)).rejects.toThrow(
      "Couldn't sign in to Bloom: Invalid login credentials"
    );
  });

  it('passes on a query error', async () => {
    query.is.mockResolvedValue({
      data: null,
      error: { message: 'permission denied' },
    });
    await expect(fetchBloomSpecies(CONFIG)).rejects.toThrow(
      'permission denied'
    );
  });
});

describe('registerSpeciesHandlers', () => {
  function setUp() {
    const handle = vi.fn();
    const store: SpeciesStore = {
      current: vi.fn().mockResolvedValue({
        species: ['Rice'],
        source: 'saved',
        updatedAt: null,
      }),
      refresh: vi.fn().mockResolvedValue({
        list: { species: ['Rice'], source: 'bloom', updatedAt: 'now' },
      }),
    };
    const openExternal = vi.fn().mockResolvedValue(undefined);
    registerSpeciesHandlers({
      ipcMain: { handle },
      store,
      openExternal,
    });
    const handler = (channel: string) =>
      handle.mock.calls.find((c) => c[0] === channel)![1];
    return { handle, store, openExternal, handler };
  }

  it('answers species:list and species:refresh from the store', async () => {
    const { handle, store, handler } = setUp();
    expect(handle.mock.calls.map((c) => c[0])).toEqual([
      'species:list',
      'species:refresh',
      'species:openAddPage',
    ]);
    expect((await handler('species:list')()).species).toEqual(['Rice']);
    await handler('species:refresh')();
    expect(store.refresh).toHaveBeenCalled();
  });

  it("opens Bloom's Species page", async () => {
    const { handler, openExternal } = setUp();
    expect(await handler('species:openAddPage')()).toEqual({ success: true });
    expect(openExternal).toHaveBeenCalledWith(
      'https://bloom.salk.edu/app/species'
    );
  });

  it('returns the error when the browser cannot be opened', async () => {
    const { handler, openExternal } = setUp();
    openExternal.mockRejectedValue(new Error('no browser'));
    expect(await handler('species:openAddPage')()).toEqual({
      success: false,
      error: 'no browser',
    });
  });
});
