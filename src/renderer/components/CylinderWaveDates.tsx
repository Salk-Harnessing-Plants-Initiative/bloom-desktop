/**
 * A CylinderScan experiment's waves on the Experiments page (#407): each wave's
 * current start date, what it is (transfer, sowing, …), who set it and when, its
 * scan count and note (why its number skips ahead or its date is out of order), and a log
 * of every change to them (previous date, new date and what it is, when, who and
 * why). Read-only: the date is set and
 * changed on Capture Scan, under the wave number.
 */

import { useCallback, useEffect, useState } from 'react';
import { formatSowingDate } from '../../utils/sowing-date';
import { describeStartDateBasis } from '../../utils/start-date-basis';
import type {
  CylinderWaveDateChange,
  CylinderWaveInfo,
} from '../../types/cylinder-wave';

function formatSetOn(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatChangedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** " · Transfer to cylinder", or nothing when it wasn't recorded. */
function basisLabel(basis: string | null, other: string | null): string {
  const described = describeStartDateBasis(basis, other);
  return described
    ? ` · ${described[0].toUpperCase()}${described.slice(1)}`
    : '';
}

/** " (transfer to cylinder)", or nothing when it wasn't recorded. */
function basisNote(basis: string | null, other: string | null): string {
  const described = describeStartDateBasis(basis, other);
  return described ? ` (${described})` : '';
}

function ChangeLogEntry({ change }: { change: CylinderWaveDateChange }) {
  const basis = basisNote(
    change.start_date_basis,
    change.start_date_basis_other
  );
  const newDate = formatSowingDate(change.new_sowing_date);
  return (
    <li>
      {change.old_sowing_date === null ? (
        <>
          Set to {newDate}
          {basis} on{' '}
        </>
      ) : change.old_sowing_date === change.new_sowing_date ? (
        <>
          {newDate} marked as{' '}
          {describeStartDateBasis(
            change.start_date_basis,
            change.start_date_basis_other
          ) ?? 'not recorded'}{' '}
          on{' '}
        </>
      ) : (
        <>
          Changed from {formatSowingDate(change.old_sowing_date)} to {newDate}
          {basis} on{' '}
        </>
      )}
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

  // Shown outside the collapsed section, so it can't be missed.
  if (loadError) {
    return <p className="ml-2 text-sm text-red-600">{loadError}</p>;
  }

  return (
    <details
      className="ml-2 mt-1 text-sm text-gray-700"
      data-testid={`wave-dates-${experimentId}`}
    >
      <summary className="cursor-pointer font-semibold text-green-800">
        {waves.length === 1 ? '1 wave' : `${waves.length} waves`}
      </summary>
      <ul className="mt-1 ml-4 space-y-2">
        {waves.map((wave) => (
          <li key={wave.id} data-testid={`wave-${wave.wave_number}`}>
            <p>
              <span className="font-bold text-green-800">
                Wave {wave.wave_number}
              </span>
              {'  '}
              {formatSowingDate(wave.sowing_date)}
              <span className="text-gray-500">
                {basisLabel(wave.start_date_basis, wave.start_date_basis_other)}
                {wave.scanCount > 0 &&
                  ` · ${wave.scanCount} ${wave.scanCount === 1 ? 'scan' : 'scans'}`}
              </span>
            </p>
            {wave.set_by_name && (
              <p className="text-xs text-gray-500">
                Set by {wave.set_by_name} on {formatSetOn(wave.set_at)}
              </p>
            )}
            {wave.note && (
              <p data-testid={`wave-note-${wave.wave_number}`}>
                <span className="font-semibold text-green-800">Note:</span>{' '}
                {wave.note}
              </p>
            )}
            {wave.changes.length > 0 && (
              <details className="text-xs text-gray-500">
                <summary className="cursor-pointer font-semibold text-green-800">
                  History ({wave.changes.length})
                </summary>
                <ul
                  className="ml-4 mt-1 space-y-0.5"
                  data-testid={`wave-date-log-${wave.wave_number}`}
                >
                  {wave.changes.map((change) => (
                    <ChangeLogEntry key={change.id} change={change} />
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
