/**
 * A CylinderScan experiment's waves on the Experiments page (#407, #428): each wave's
 * germination date (the plant age is computed from it), sowing and transfer dates,
 * scan count, who set them and when, its note (why its number skips ahead or its
 * germination date is out of order), and a log of every set and change (each date
 * before and after, when, who and why). Read-only: the dates are set and changed on
 * Capture Scan, under the wave number.
 */

import { useCallback, useEffect, useState } from 'react';
import { formatWaveDate } from '../../utils/wave-dates';
import type {
  CylinderPlantDateChange,
  CylinderPlantInfo,
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

/** A transfer date, or "the germination day" when it's null. */
function transferText(date: string | null): string {
  return date ? formatWaveDate(date) : 'the germination day';
}

/**
 * What a log entry set or changed, e.g. "germination 9 Oct → 12 Oct; sowing 5 Oct → 6 Oct";
 * empty when no date changed (a plant keeping its wave's dates as its own).
 */
function changedDates(
  change: CylinderWaveDateChange | CylinderPlantDateChange
): string {
  if (change.new_germination_date === null) return 'dates per plant';
  if (change.old_germination_date === null) {
    return [
      `germination ${formatWaveDate(change.new_germination_date)}`,
      change.new_sowing_date &&
        `sowing ${formatWaveDate(change.new_sowing_date)}`,
      `transfer ${transferText(change.new_transfer_date)}`,
      change.new_germ_day_color && `colour ${change.new_germ_day_color}`,
    ]
      .filter(Boolean)
      .join(', ');
  }
  const parts: string[] = [];
  if (change.old_germination_date !== change.new_germination_date) {
    parts.push(
      `germination ${formatWaveDate(change.old_germination_date)} → ${formatWaveDate(change.new_germination_date ?? '')}`
    );
  }
  if (change.old_sowing_date !== change.new_sowing_date) {
    parts.push(
      `sowing ${change.old_sowing_date ? formatWaveDate(change.old_sowing_date) : 'none'} → ${change.new_sowing_date ? formatWaveDate(change.new_sowing_date) : 'none'}`
    );
  }
  if (change.old_transfer_date !== change.new_transfer_date) {
    parts.push(
      `transfer ${transferText(change.old_transfer_date)} → ${transferText(change.new_transfer_date)}`
    );
  }
  if (
    (change.old_germ_day_color ?? null) !== (change.new_germ_day_color ?? null)
  ) {
    parts.push(
      `colour ${change.old_germ_day_color ?? 'none'} → ${change.new_germ_day_color ?? 'none'}`
    );
  }
  return parts.join('; ');
}

function ChangeLogEntry({
  change,
}: {
  change: CylinderWaveDateChange | CylinderPlantDateChange;
}) {
  const dates = changedDates(change);
  return (
    <li>
      {change.old_germination_date === null
        ? `Set: ${dates}`
        : dates
          ? `Changed: ${dates}`
          : 'Kept its dates'}{' '}
      on {formatChangedAt(change.changed_at)}
      {change.changed_by_name ? ` by ${change.changed_by_name}` : ''}
      {change.reason ? `. Reason: ${change.reason}` : ''}
    </li>
  );
}

/** A wave's plants with their own dates, each with its dates, reason and history. */
function PlantsWithOwnDates({
  waveNumber,
  plants,
  perPlant,
}: {
  waveNumber: number;
  plants: CylinderPlantInfo[];
  perPlant: boolean;
}) {
  return (
    <details className="text-xs text-gray-600">
      <summary className="cursor-pointer font-semibold text-green-800">
        {perPlant ? 'Plants' : 'Plants with their own dates'} ({plants.length})
      </summary>
      <ul
        className="ml-4 mt-1 space-y-1"
        data-testid={`wave-plants-${waveNumber}`}
      >
        {[...plants]
          .sort((a, b) => a.plant_barcode.localeCompare(b.plant_barcode))
          .map((plant) => (
            <li key={plant.id}>
              <span className="font-semibold text-gray-800">
                {plant.plant_barcode}
              </span>
              : germinated {formatWaveDate(plant.germination_date)}
              {plant.sowing_date &&
                ` · sown ${formatWaveDate(plant.sowing_date)}`}
              {` · transferred ${transferText(plant.transfer_date)}`}
              {plant.germ_day_color && ` · colour ${plant.germ_day_color}`}
              {plant.reason ? `. Reason: ${plant.reason}` : ''}
              {plant.changes.length > 0 && (
                <ul className="ml-4 text-gray-500">
                  {plant.changes.map((change) => (
                    <ChangeLogEntry key={change.id} change={change} />
                  ))}
                </ul>
              )}
            </li>
          ))}
      </ul>
    </details>
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
              {wave.dates_per_plant || !wave.germination_date ? (
                'Dates set for each plant'
              ) : (
                <>
                  Germinated {formatWaveDate(wave.germination_date)}
                  <span className="text-gray-500">
                    {wave.sowing_date &&
                      ` · sown ${formatWaveDate(wave.sowing_date)}`}
                    {wave.transfer_date
                      ? ` · transferred ${formatWaveDate(wave.transfer_date)}`
                      : ' · transferred the same day'}
                    {wave.germ_day_color && ` · colour ${wave.germ_day_color}`}
                  </span>
                </>
              )}
              <span className="text-gray-500">
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
            {wave.plantsWithOwnDates.length > 0 && (
              <PlantsWithOwnDates
                waveNumber={wave.wave_number}
                plants={wave.plantsWithOwnDates}
                perPlant={wave.dates_per_plant}
              />
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
