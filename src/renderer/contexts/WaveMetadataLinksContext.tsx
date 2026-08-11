import { createContext, ReactNode, useCallback, useRef, useState } from 'react';

interface WaveMetadataLink {
  wave_number: number;
  accession_id: string;
  accession: { id: string; name: string };
}

interface WaveMetadataLinksContextValue {
  linksByExperiment: Record<string, WaveMetadataLink[]>;
  errorsByExperiment: Record<string, string | null>;
  ensureFetched: (experimentId: string) => void;
  refetch: (experimentId: string) => Promise<void>;
  link: (
    experimentId: string,
    waveNumber: number,
    accessionId: string
  ) => Promise<boolean>;
  unlink: (experimentId: string, waveNumber: number) => Promise<boolean>;
}

const WaveMetadataLinksContext =
  createContext<WaveMetadataLinksContextValue | null>(null);

/**
 * Centralizes wave<->metadata-file link state per experimentId so every
 * `useWaveMetadataLinks(id)` call site for the *same* experiment shares
 * one cache. Without this, Experiments.tsx's attach panel and each row's
 * `ExperimentWaveLinks` each held their own independent state — linking a
 * wave through the attach panel never updated the row's own display,
 * since nothing told it to refetch (PR #290 / tier5-e2e-ci-mystery notes).
 */
export function WaveMetadataLinksProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [linksByExperiment, setLinksByExperiment] = useState<
    Record<string, WaveMetadataLink[]>
  >({});
  const [errorsByExperiment, setErrorsByExperiment] = useState<
    Record<string, string | null>
  >({});
  // Tracks which experimentIds have had a fetch kicked off — bookkeeping
  // only, doesn't drive rendering, so a ref (not state) is correct here.
  const fetchedIds = useRef<Set<string>>(new Set());
  // Per-experimentId version counter, bumped on every mutation (a fresh
  // refetch, or unlink()'s own optimistic update). Guards against a
  // slow, now-stale refetch — dispatched by link() before a *different*
  // component's concurrent unlink() applied — landing after that unlink
  // and silently reintroducing the wave it just removed. Only the
  // refetch that's still the most recent write for its experimentId is
  // allowed to apply.
  const versions = useRef<Record<string, number>>({});

  const bumpVersion = useCallback((experimentId: string) => {
    const next = (versions.current[experimentId] ?? 0) + 1;
    versions.current[experimentId] = next;
    return next;
  }, []);

  const refetch = useCallback(
    async (experimentId: string) => {
      const version = bumpVersion(experimentId);
      const result =
        await window.electron.database.experiments.listGraviMetadata(
          experimentId
        );
      if (versions.current[experimentId] !== version) {
        // A newer mutation (or another refetch) superseded this one while
        // it was in flight — this snapshot may predate that change (e.g.
        // it was queried before a concurrent unlink() committed
        // server-side). Refetch again rather than either applying stale
        // data or dropping this refetch's own update entirely.
        return refetch(experimentId);
      }
      if (result.success) {
        setLinksByExperiment((prev) => ({
          ...prev,
          [experimentId]: result.data ?? [],
        }));
      }
    },
    [bumpVersion]
  );

  const ensureFetched = useCallback(
    (experimentId: string) => {
      if (fetchedIds.current.has(experimentId)) return;
      fetchedIds.current.add(experimentId);
      refetch(experimentId);
    },
    [refetch]
  );

  const link = useCallback(
    async (experimentId: string, waveNumber: number, accessionId: string) => {
      const result =
        await window.electron.database.experiments.linkGraviMetadata(
          experimentId,
          waveNumber,
          accessionId
        );
      if (result.success) {
        setErrorsByExperiment((prev) => ({ ...prev, [experimentId]: null }));
        await refetch(experimentId);
        return true;
      }
      setErrorsByExperiment((prev) => ({
        ...prev,
        [experimentId]: result.error ?? 'Failed to link metadata file',
      }));
      return false;
    },
    [refetch]
  );

  const unlink = useCallback(
    async (experimentId: string, waveNumber: number) => {
      const result =
        await window.electron.database.experiments.unlinkGraviMetadata(
          experimentId,
          waveNumber
        );
      if (result.success) {
        // Invalidates any in-flight refetch (from a concurrent link() on
        // a different consumer) that started before this unlink applied —
        // its eventual result would otherwise be a stale snapshot that
        // still includes the wave just removed here.
        bumpVersion(experimentId);
        setErrorsByExperiment((prev) => ({ ...prev, [experimentId]: null }));
        setLinksByExperiment((prev) => ({
          ...prev,
          [experimentId]: (prev[experimentId] ?? []).filter(
            (l) => l.wave_number !== waveNumber
          ),
        }));
        return true;
      }
      setErrorsByExperiment((prev) => ({
        ...prev,
        [experimentId]: result.error ?? 'Failed to unlink metadata file',
      }));
      return false;
    },
    [bumpVersion]
  );

  return (
    <WaveMetadataLinksContext.Provider
      value={{
        linksByExperiment,
        errorsByExperiment,
        ensureFetched,
        refetch,
        link,
        unlink,
      }}
    >
      {children}
    </WaveMetadataLinksContext.Provider>
  );
}

export { WaveMetadataLinksContext };
