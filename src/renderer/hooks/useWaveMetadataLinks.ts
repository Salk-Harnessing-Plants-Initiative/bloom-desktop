import { useCallback, useEffect, useState } from 'react';

interface WaveMetadataLink {
  wave_number: number;
  accession_id: string;
  accession: { id: string; name: string };
}

/**
 * Wraps experiments.{listGraviMetadata,linkGraviMetadata,unlinkGraviMetadata}
 * for a single experiment. Shared by Experiments.tsx and ExperimentDetail.tsx
 * (design.md Decision 5) so fetch/mutate/error logic lives in one place.
 */
export function useWaveMetadataLinks(experimentId: string) {
  const [links, setLinks] = useState<WaveMetadataLink[]>([]);
  const [linkError, setLinkError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const result =
      await window.electron.database.experiments.listGraviMetadata(
        experimentId
      );
    if (result.success) {
      setLinks(result.data ?? []);
    }
  }, [experimentId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const link = useCallback(
    async (waveNumber: number, accessionId: string) => {
      const result =
        await window.electron.database.experiments.linkGraviMetadata(
          experimentId,
          waveNumber,
          accessionId
        );
      if (result.success) {
        setLinkError(null);
        await refetch();
      } else {
        setLinkError(result.error ?? 'Failed to link metadata file');
      }
    },
    [experimentId, refetch]
  );

  const unlink = useCallback(
    async (waveNumber: number) => {
      const result =
        await window.electron.database.experiments.unlinkGraviMetadata(
          experimentId,
          waveNumber
        );
      if (result.success) {
        setLinks((prev) => prev.filter((l) => l.wave_number !== waveNumber));
      }
    },
    [experimentId]
  );

  const suggestedNextWave =
    links.length === 0 ? 0 : Math.max(...links.map((l) => l.wave_number)) + 1;

  return { links, linkError, link, unlink, suggestedNextWave };
}
