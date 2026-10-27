/**
 * A plant's dates on Capture Scan when they aren't being edited (#428): whether it uses
 * its wave's dates or its own, the dates and reason, and the actions (Different dates
 * for this plant, Edit, Use the wave's dates), offered only before the plant's first
 * scan: after it, its dates are final.
 */

import { formatWaveDate } from '../../utils/wave-dates';
import type { CylinderPlantInfo } from '../../types/cylinder-wave';
import type { PlantDates } from '../hooks/useWaveDates';

const LABEL = 'font-semibold text-green-800';
const ACTION = 'font-semibold text-green-800 underline';

function DateLines({ dates }: { dates: PlantDates }) {
  return (
    <>
      <p>
        <span className={LABEL}>Germination date:</span>{' '}
        <span className="font-medium text-gray-900">
          {formatWaveDate(dates.germination_date)}
        </span>
      </p>
      {dates.sowing_date && (
        <p>
          <span className={LABEL}>Sown:</span>{' '}
          {formatWaveDate(dates.sowing_date)}
        </p>
      )}
      <p>
        <span className={LABEL}>Transferred:</span>{' '}
        {dates.transfer_date
          ? formatWaveDate(dates.transfer_date)
          : 'the same day as germination'}
      </p>
    </>
  );
}

export function PlantDatesSummary({
  plantBarcode,
  waveNumber,
  plant,
  plantDates,
  ownDates,
  canUseWaveDates,
  locked,
  onEdit,
  onUseWaveDates,
  disabled = false,
}: {
  plantBarcode: string;
  waveNumber: number;
  plant: CylinderPlantInfo | null;
  plantDates: PlantDates;
  /** The plant has its own dates (or its wave's are per plant). */
  ownDates: boolean;
  /** It can go back to its wave's dates. */
  canUseWaveDates: boolean;
  /** The plant has scans: its dates can't change, so no actions are offered. */
  locked: boolean;
  onEdit: () => void;
  onUseWaveDates: () => void;
  disabled?: boolean;
}) {
  return (
    <>
      <p data-testid="plant-dates-source">
        {ownDates
          ? `Plant ${plantBarcode}'s own dates`
          : `Plant ${plantBarcode} uses wave ${waveNumber}'s dates`}
        {!ownDates && !locked && (
          <>
            {' · '}
            <button
              type="button"
              onClick={onEdit}
              disabled={disabled}
              className={ACTION}
              data-testid="plant-dates-different"
            >
              Different dates for this plant
            </button>
          </>
        )}
      </p>
      {ownDates && (
        <>
          <DateLines dates={plantDates} />
          {plant?.reason && (
            <p>
              <span className={LABEL}>Reason:</span> {plant.reason}
            </p>
          )}
          <p className="text-xs text-gray-500">
            {plant?.set_by_name ? `Set by ${plant.set_by_name}` : ''}
            {!locked && (
              <>
                {plant?.set_by_name ? ' · ' : ''}
                <button
                  type="button"
                  onClick={onEdit}
                  disabled={disabled}
                  className={ACTION}
                  data-testid="plant-dates-edit"
                >
                  Edit
                </button>
              </>
            )}
            {canUseWaveDates && !locked && (
              <>
                {' · '}
                <button
                  type="button"
                  onClick={onUseWaveDates}
                  disabled={disabled}
                  className={ACTION}
                  data-testid="plant-dates-use-wave"
                >
                  Use the wave&apos;s dates
                </button>
              </>
            )}
          </p>
        </>
      )}
    </>
  );
}
