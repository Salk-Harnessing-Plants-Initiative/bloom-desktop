import { useCallback, useEffect, useState } from 'react';
import type { SpeciesList } from '../../types/species';

export interface UseSpeciesList {
  /** Species common names, sorted; empty until loaded. */
  species: string[];
  /** Where the list came from, once loaded. */
  source: SpeciesList['source'] | null;
  loading: boolean;
  refreshing: boolean;
  /** What the last Refresh or Bloom link did, to show under the list. */
  message: string | null;
  /** Fetch the list from Bloom again. */
  refresh: () => Promise<void>;
  /** Open Bloom's Species page in the browser. */
  openAddPage: () => Promise<void>;
}

/** The species list for new experiments, from Bloom (fetched by the main process). */
export function useSpeciesList(): UseSpeciesList {
  const [list, setList] = useState<SpeciesList | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.electron.species
      .list()
      .then((result) => {
        if (!cancelled) setList(result);
      })
      .catch((error: unknown) => {
        console.error('[useSpeciesList] list() failed:', error);
        if (!cancelled)
          setMessage(
            "Couldn't load the species list. Close Bloom Desktop and open it again."
          );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setMessage(null);
    try {
      const result = await window.electron.species.refresh();
      setList(result.list);
      setMessage(
        result.error
          ? `Couldn't reach Bloom, so the list may be out of date. (${result.error})`
          : `Updated from Bloom: ${result.list.species.length} species.`
      );
    } catch (error) {
      setMessage(
        `Couldn't refresh the list: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  const openAddPage = useCallback(async () => {
    try {
      const result = await window.electron.species.openAddPage();
      setMessage(
        result.success
          ? "Bloom's Species page is open in your browser. Add the species there, then click Refresh list."
          : `Couldn't open Bloom: ${result.error ?? 'Unknown error'}`
      );
    } catch (error) {
      setMessage(
        `Couldn't open Bloom: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }, []);

  return {
    species: list?.species ?? [],
    source: list?.source ?? null,
    loading: list === null,
    refreshing,
    message,
    refresh,
    openAddPage,
  };
}
