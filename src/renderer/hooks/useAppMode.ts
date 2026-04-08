import { useEffect, useState } from 'react';

/**
 * Hook to fetch the configured scanner mode from the main process.
 * Returns { mode, isLoading } where mode is null until IPC resolves.
 */
export function useAppMode(): { mode: string | null; isLoading: boolean } {
  const [mode, setMode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    window.electron.config
      .getMode()
      .then((result) => {
        if (!cancelled) {
          setMode(result.mode);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMode('');
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { mode, isLoading };
}
