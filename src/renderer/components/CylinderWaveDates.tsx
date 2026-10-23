/**
 * A CylinderScan experiment's waves on the Experiments page (#407): each wave's
 * current sowing date and scan count, and a log of every change to the date
 * (previous date, new date, when, who and why). Read-only: the date is set and
 * changed on Capture Scan, under the wave number.
 */

import { useCallback, useEffect, useState } from 'react';
import { formatSowingDate } from '../../utils/sowing-date';
import type {
  CylinderWaveDateChange,
  CylinderWaveInfo,
} from '../../types/cylinder-wave';

function formatChangedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ChangeLogEntry({ change }: { change: CylinderWaveDateChange }) {
  return (
    <li>
      Changed from {formatSowingDate(change.old_sowing_date)} to{' '}
      {formatSowingDate(change.new_sowing_date)} on{' '}
      {formatChangedAt(change.changed_at)}
      {change.changed_by_name ? ` by ${change.changed_by_name}` : ''}
      {change.reason ? `. Reason: ${change.reason}` : ''}
    </li>
  );
}

export function CylinderWaveDates({ experimentId }: { experimentId: string }) {
  const [waves, setWaves] = useState<CylinderWaveInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result =
        await window.electron.database.cylinderWaves.list(experimentId);
      if (result.success && result.data) {
        setWaves(result.data);
        setLoadError(null);
      } else {
        setLoadError(result.error ?? 'Could not load the waves.');
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unknown error');
    }
  }, [experimentId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (waves.length === 0 && !loadError) return null;

  return (
    <div
      className="ml-2 text-gray-600"
      data-testid={`wave-dates-${experimentId}`}
    >
      <ul>
        {waves.map((wave) => (
          <li key={wave.id}>
            Wave {wave.wave_number}: sown {formatSowingDate(wave.sowing_date)}
            {wave.scanCount > 0 &&
              ` (${wave.scanCount} ${wave.scanCount === 1 ? 'scan' : 'scans'})`}
            {wave.note && (
              <p className="ml-4 text-xs text-gray-500">{wave.note}</p>
            )}
            {wave.changes.length > 0 && (
              <ul
                className="ml-4 text-xs text-gray-500"
                data-testid={`wave-date-log-${wave.wave_number}`}
              >
                {wave.changes.map((change) => (
                  <ChangeLogEntry key={change.id} change={change} />
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {loadError && <p className="text-sm text-red-600">{loadError}</p>}
    </div>
  );
}
