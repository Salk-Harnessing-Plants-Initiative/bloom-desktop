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

  const refetch = useCallback(async (experimentId: string) => {
    const result =
      await window.electron.database.experiments.listGraviMetadata(
        experimentId
      );
    if (result.success) {
      setLinksByExperiment((prev) => ({
        ...prev,
        [experimentId]: result.data ?? [],
      }));
    }
  }, []);

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
    []
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
