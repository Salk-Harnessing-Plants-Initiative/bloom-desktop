import { useCallback, useEffect, useState } from 'react';

/**
 * Hook to fetch the configured scanner mode from the main process.
 * Returns { mode, isLoading } where mode is null until IPC resolves.
 *
 * loadError is set when ~/.bloom/.env exists but couldn't be read. That's not
 * a new station, so the app shows the error with Retry instead of first-run
 * setup (#485). retry() reads the file again, then asks for the mode again.
 */
export function useAppMode(): {
  mode: string | null;
  isLoading: boolean;
  loadError: string | null;
  retry: () => Promise<void>;
} {
  const [mode, setMode] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMode = useCallback(async (isCancelled: () => boolean) => {
    try {
      const result = await window.electron.config.getMode();
      if (isCancelled()) return;
      setMode(result.mode);
      setLoadError(result.loadError ?? null);
    } catch {
      if (isCancelled()) return;
      setMode('');
      setLoadError(null);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchMode(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [fetchMode]);

  const retry = useCallback(async () => {
    try {
      await window.electron.config.reload();
    } catch {
      // The mode request below reports what's still wrong.
    }
    await fetchMode(() => false);
  }, [fetchMode]);

  return { mode, isLoading, loadError, retry };
}
