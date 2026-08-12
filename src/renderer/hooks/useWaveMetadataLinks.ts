import { useCallback, useContext, useEffect } from 'react';
import { WaveMetadataLinksContext } from '../contexts/WaveMetadataLinksContext';

/**
 * Wraps experiments.{listGraviMetadata,linkGraviMetadata,unlinkGraviMetadata}
 * for a single experiment. Shared by Experiments.tsx and ExperimentDetail.tsx
 * (design.md Decision 5) so fetch/mutate/error logic lives in one place.
 *
 * State itself lives in `WaveMetadataLinksProvider`, keyed by experimentId —
 * not in this hook's own useState — so every call site watching the *same*
 * experimentId (e.g. Experiments.tsx's attach panel and each row's
 * `ExperimentWaveLinks`) shares one cache. A link/unlink from any one of
 * them is immediately visible to all the others.
 *
 * `link`/`unlink` return a boolean so callers can distinguish success from
 * failure instead of assuming success — a caller that ignores the return
 * value and always shows a success message will surface a false positive
 * on failure.
 */
export function useWaveMetadataLinks(experimentId: string) {
  const ctx = useContext(WaveMetadataLinksContext);
  if (!ctx) {
    throw new Error(
      'useWaveMetadataLinks must be used within a WaveMetadataLinksProvider'
    );
  }
  const { linksByExperiment, errorsByExperiment, ensureFetched, link, unlink } =
    ctx;

  useEffect(() => {
    ensureFetched(experimentId);
  }, [experimentId, ensureFetched]);

  const links = linksByExperiment[experimentId] ?? [];
  const linkError = errorsByExperiment[experimentId] ?? null;

  const boundLink = useCallback(
    (waveNumber: number, accessionId: string) =>
      link(experimentId, waveNumber, accessionId),
    [link, experimentId]
  );

  const boundUnlink = useCallback(
    (waveNumber: number) => unlink(experimentId, waveNumber),
    [unlink, experimentId]
  );

  const suggestedNextWave =
    links.length === 0 ? 0 : Math.max(...links.map((l) => l.wave_number)) + 1;

  return {
    links,
    linkError,
    link: boundLink,
    unlink: boundUnlink,
    suggestedNextWave,
  };
}
