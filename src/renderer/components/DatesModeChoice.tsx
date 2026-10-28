/**
 * "How are wave N's dates set?" on Capture Scan (#428): the same for all plants
 * (entered once), or different for each plant (asked for as each plant is first
 * scanned). Asked for a new wave, and in a wave's Edit box.
 */

import { formatWaveDate } from '../../utils/wave-dates';
import type { CylinderPlantInfo } from '../../types/cylinder-wave';
import type { PlantDates } from '../hooks/useWaveDates';

export type DatesMode = 'same' | 'perPlant';

export interface DatesModeChoiceProps {
  waveNumber: number;
  /** Null until they choose. */
  value: DatesMode | null;
  onChange: (mode: DatesMode) => void;
  /** Why "Same for all plants" can't be chosen, when it can't. */
  sameUnavailable?: string | null;
  disabled?: boolean;
}

export function DatesModeChoice({
  waveNumber,
  value,
  onChange,
  sameUnavailable = null,
  disabled = false,
}: DatesModeChoiceProps) {
  const name = `dates-mode-${waveNumber}`;
  return (
    <fieldset
      className="text-sm text-gray-700"
      data-testid="dates-mode-question"
    >
      <legend className="font-medium text-green-800">
        How are wave {waveNumber}&apos;s dates (sowing date, germination date
        and transfer to cylinder date) set?
      </legend>
      <label className="mt-1 flex items-start gap-2">
        <input
          type="radio"
          name={name}
          checked={value === 'same'}
          onChange={() => onChange('same')}
          disabled={disabled || sameUnavailable !== null}
          className="mt-1"
          data-testid="dates-mode-same"
        />
        <span>
          <span className="font-bold text-green-800">
            Same for all plants in this wave
          </span>
          : enter them once
          {sameUnavailable && (
            <span className="block text-xs text-gray-500">
              {sameUnavailable}
            </span>
          )}
        </span>
      </label>
      <label className="flex items-start gap-2">
        <input
          type="radio"
          name={name}
          checked={value === 'perPlant'}
          onChange={() => onChange('perPlant')}
          disabled={disabled}
          className="mt-1"
          data-testid="dates-mode-per-plant"
        />
        <span>
          <span className="font-bold text-green-800">
            Different for each plant
          </span>
          : asked for as each plant (barcode) is first scanned
        </span>
      </label>
    </fieldset>
  );
}

function plantDatesText(p: PlantDates): string {
  return [
    `germinated ${formatWaveDate(p.germination_date)}`,
    p.sowing_date && `sown ${formatWaveDate(p.sowing_date)}`,
    p.transfer_date
      ? `transferred ${formatWaveDate(p.transfer_date)}`
      : 'transferred the same day',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "Different for each plant": what that means, and the plants' dates set so far. */
export function PerPlantDatesNote({
  plants,
  switching,
}: {
  plants: CylinderPlantInfo[];
  /** The wave is going from the same dates for all plants to per plant. */
  switching: boolean;
}) {
  return (
    <div className="space-y-1 text-gray-700" data-testid="dates-per-plant">
      <p>
        Each plant&apos;s dates are asked for as it&apos;s first scanned.
        {switching &&
          ' Plants already scanned keep the dates they were scanned with.'}
      </p>
      {plants.length > 0 && (
        <>
          <p className="font-medium">Dates set so far:</p>
          <ul
            className="ml-4 list-disc text-xs"
            data-testid="plants-dates-list"
          >
            {plants.map((p) => (
              <li key={p.id}>
                <span className="font-semibold">{p.plant_barcode}</span>:{' '}
                {plantDatesText(p)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
