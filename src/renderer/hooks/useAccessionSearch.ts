/**
 * The Accessions page's plant search: after typing pauses, asks the main process which
 * files hold a plant whose barcode or accession name contains the text. File names
 * are matched by the page itself. An answer for older text is dropped.
 */

import { useEffect, useState } from 'react';

/** How long typing must pause before the plant search runs. */
export const SEARCH_WAIT_MS = 300;

interface PlantMatches {
  /** The text these matches are for. */
  text: string;
  /** File id → how many of its plants match. */
  byFile: ReadonlyMap<string, number>;
}

const NO_MATCHES: ReadonlyMap<string, number> = new Map();

export function useAccessionSearch(search: string) {
  const text = search.trim();
  const [matches, setMatches] = useState<PlantMatches | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (text === '') return;
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const result = await window.electron.database.accessions.search(text);
        if (!current) return;
        if (result.success && result.data) {
          setMatches({
            text,
            byFile: new Map(
              result.data.map((m) => [m.accession_file_id, m.matching_plants])
            ),
          });
        } else {
          setError(result.error || 'Could not search the plants');
        }
      } catch (err) {
        if (current) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      }
    }, SEARCH_WAIT_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [text]);

  return {
    /** The trimmed search text. */
    text,
    /**
     * Plant matches: for the current text once they arrive, and until then the last
     * answer's, so the list doesn't empty out on every pause in typing.
     */
    plantMatches: text !== '' && matches ? matches.byFile : NO_MATCHES,
    /** True while the plant search for the current text hasn't answered. */
    searchingPlants: text !== '' && matches?.text !== text && !error,
    error,
  };
}
