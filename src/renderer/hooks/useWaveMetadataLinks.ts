import { useCallback, useEffect, useRef, useState } from 'react';

interface WaveMetadataLink {
  wave_number: number;
  accession_id: string;
  accession: { id: string; name: string };
}

/**
 * Wraps experiments.{listGraviMetadata,linkGraviMetadata,unlinkGraviMetadata}
 * for a single experiment. Shared by Experiments.tsx and ExperimentDetail.tsx
 * (design.md Decision 5) so fetch/mutate/error logic lives in one place.
 *
 * `link`/`unlink` return a boolean so callers can distinguish success from
 * failure instead of assuming success — a caller that ignores the return
 * value and always shows a success message will surface a false positive
 * on failure.
 */
export function useWaveMetadataLinks(experimentId: string) {
  const [links, setLinks] = useState<WaveMetadataLink[]>([]);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Tracks the experimentId this hook instance is currently showing, so an
  // in-flight request for a stale experimentId (e.g. after a route param or
  // selected-experiment change) can't overwrite state with the wrong
  // experiment's data once it resolves.
  const currentExperimentId = useRef(experimentId);
  currentExperimentId.current = experimentId;

  const refetch = useCallback(async () => {
    const requestedFor = experimentId;
    const result =
      await window.electron.database.experiments.listGraviMetadata(
        experimentId
      );
    if (currentExperimentId.current !== requestedFor) return;
    if (result.success) {
      setLinks(result.data ?? []);
    }
  }, [experimentId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const link = useCallback(
    async (waveNumber: number, accessionId: string) => {
      const requestedFor = experimentId;
      const result =
        await window.electron.database.experiments.linkGraviMetadata(
          experimentId,
          waveNumber,
          accessionId
        );
      if (currentExperimentId.current !== requestedFor) return false;
      if (result.success) {
        setLinkError(null);
        await refetch();
        return true;
      }
      setLinkError(result.error ?? 'Failed to link metadata file');
      return false;
    },
    [experimentId, refetch]
  );

  const unlink = useCallback(
    async (waveNumber: number) => {
      const requestedFor = experimentId;
      const result =
        await window.electron.database.experiments.unlinkGraviMetadata(
          experimentId,
          waveNumber
        );
      if (currentExperimentId.current !== requestedFor) return false;
      if (result.success) {
        setLinkError(null);
        setLinks((prev) => prev.filter((l) => l.wave_number !== waveNumber));
        return true;
      }
      setLinkError(result.error ?? 'Failed to unlink metadata file');
      return false;
    },
    [experimentId]
  );

  const suggestedNextWave =
    links.length === 0 ? 0 : Math.max(...links.map((l) => l.wave_number)) + 1;

  return { links, linkError, link, unlink, suggestedNextWave };
}
