/**
 * A GraviScan experiment's wave-to-accession links on the Experiments page, each
 * with Unlink.
 */

import { useState } from 'react';
import { useWaveMetadataLinks } from '../hooks/useWaveMetadataLinks';

export function ExperimentWaveLinks({
  experimentId,
}: {
  experimentId: string;
}) {
  const { links, linkError, unlink } = useWaveMetadataLinks(experimentId);
  const [unlinkingWave, setUnlinkingWave] = useState<number | null>(null);

  const handleUnlink = async (waveNumber: number, accessionName: string) => {
    if (unlinkingWave !== null) return;
    const message =
      waveNumber === 0
        ? `Unlink wave ${waveNumber} from "${accessionName}"? This does not preserve a record of what was linked at scan time. This experiment's default accession was originally set to this same file; unlinking wave 0 does not change that default.`
        : `Unlink wave ${waveNumber} from "${accessionName}"? This does not preserve a record of what was linked at scan time.`;
    if (window.confirm(message)) {
      setUnlinkingWave(waveNumber);
      try {
        await unlink(waveNumber);
      } finally {
        setUnlinkingWave(null);
      }
    }
  };

  if (links.length === 0 && !linkError) return null;

  return (
    <>
      <ul>
        {links.map((l) => (
          <li key={l.wave_number}>
            Wave {l.wave_number}: {l.accession.name}
            <button
              onClick={() => handleUnlink(l.wave_number, l.accession.name)}
              disabled={unlinkingWave !== null}
            >
              {unlinkingWave === l.wave_number ? 'Unlinking...' : 'Unlink'}
            </button>
          </li>
        ))}
      </ul>
      {linkError && <p className="text-sm text-red-600">{linkError}</p>}
    </>
  );
}
