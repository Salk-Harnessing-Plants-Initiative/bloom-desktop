import { useEffect, useState } from 'react';

/** The chosen phenotyper's name, for messages such as a manually changed age. */
export function usePhenotyperName(phenotyperId: string): string | null {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    setName(null);
    if (!phenotyperId) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await window.electron.database.phenotypers.list();
        if (cancelled || !result.success || !Array.isArray(result.data)) return;
        const match = result.data.find((p) => p.id === phenotyperId);
        setName(match ? match.name : null);
      } catch (error) {
        if (!cancelled)
          console.error('[usePhenotyperName] list() failed:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phenotyperId]);

  return name;
}
