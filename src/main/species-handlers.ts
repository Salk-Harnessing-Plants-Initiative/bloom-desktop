/**
 * IPC for the species list (species:list, species:refresh, species:openAddPage) and the
 * Bloom fetch behind it. The fetch signs in with the scanner account, as uploads do;
 * Bloom lets that account read species that haven't been removed.
 */

import type { IpcMain } from 'electron';
import type { MachineConfig } from './config-store';
import { BLOOM_SPECIES_PAGE_URL, type SpeciesStore } from './species-list';

/** The parts of the machine config the fetch and the Species page link need. */
export type BloomSpeciesConfig = Pick<
  MachineConfig,
  | 'bloom_api_url'
  | 'bloom_anon_key'
  | 'bloom_scanner_username'
  | 'bloom_scanner_password'
>;

/** Species common names from Bloom. Throws when Bloom can't be reached or the sign-in fails. */
export async function fetchBloomSpecies(
  config: BloomSpeciesConfig
): Promise<string[]> {
  if (
    !config.bloom_scanner_username ||
    !config.bloom_scanner_password ||
    !config.bloom_anon_key
  ) {
    throw new Error('Bloom credentials are not set up on this computer');
  }
  // Loaded on first use, as the uploader does, to keep app start-up light.
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(config.bloom_api_url, config.bloom_anon_key, {
    auth: { persistSession: false },
  });
  const { error: authError } = await supabase.auth.signInWithPassword({
    email: config.bloom_scanner_username,
    password: config.bloom_scanner_password,
  });
  if (authError)
    throw new Error(`Couldn't sign in to Bloom: ${authError.message}`);
  try {
    const { data, error } = await supabase
      .from('species')
      .select('common_name')
      .is('deleted_at', null);
    if (error) throw new Error(error.message);
    return (data ?? []).map(
      (row: { common_name: string | null }) => row.common_name ?? ''
    );
  } finally {
    await supabase.auth.signOut().catch((): undefined => undefined);
  }
}

export interface SpeciesHandlerDeps {
  ipcMain: Pick<IpcMain, 'handle'>;
  store: SpeciesStore;
  openExternal: (url: string) => Promise<void>;
}

export function registerSpeciesHandlers(deps: SpeciesHandlerDeps): void {
  deps.ipcMain.handle('species:list', () => deps.store.current());
  deps.ipcMain.handle('species:refresh', () => deps.store.refresh());
  deps.ipcMain.handle('species:openAddPage', async () => {
    try {
      await deps.openExternal(BLOOM_SPECIES_PAGE_URL);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
