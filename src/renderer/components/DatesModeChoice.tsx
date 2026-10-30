/**
 * "Set wave N dates" on Capture Scan (#428): wave-level (the same dates for every
 * plant, entered once, in the fields shown under that choice) or plant-level (each
 * plant's dates entered as its barcode is first scanned). Asked for a new wave, and in
 * a wave's Edit box.
 */

import type { ReactNode } from 'react';
import { formatWaveDate } from '../../utils/wave-dates';
import type { CylinderPlantInfo } from '../../types/cylinder-wave';
import type { PlantDates } from '../hooks/useWaveDates';

export type DatesMode = 'same' | 'perPlant';

export interface DatesModeChoiceProps {
  waveNumber: number;
  /** Null until they choose. */
  value: DatesMode | null;
  onChange: (mode: DatesMode) => void;
  /** Why "Wave-level" can't be chosen, when it can't. */
  sameUnavailable?: string | null;
  /** The wave's dates, shown under "Wave-level" while it's chosen. */
  children?: ReactNode;
  disabled?: boolean;
}

export function DatesModeChoice({
  waveNumber,
  value,
  onChange,
  sameUnavailable = null,
  children,
  disabled = false,
}: DatesModeChoiceProps) {
  const name = `dates-mode-${waveNumber}`;
  return (
    <fieldset
      className="space-y-3 text-sm text-gray-700"
      data-testid="dates-mode-question"
    >
      <legend className="mb-3">
        <span className="block text-base font-semibold text-green-800">
          Set wave {waveNumber} dates
        </span>
        <span className="block text-gray-600">
          Sowing, germination, and transfer-to-cylinder
        </span>
      </legend>
      <label className="flex items-start gap-2">
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
          <span className="block font-semibold text-green-800">Wave-level</span>
          <span className="block">
            Same dates for every plant. Enter them once.
          </span>
          {sameUnavailable && (
            <span className="block text-xs text-gray-500">
              {sameUnavailable}
            </span>
          )}
        </span>
      </label>
      {value === 'same' && children && (
        <div className="ml-6 space-y-2" data-testid="wave-level-dates">
          {children}
        </div>
      )}
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
          <span className="block font-semibold text-green-800">
            Plant-level
          </span>
          <span className="block">
            Different dates per plant. Enter them when each barcode is first
            scanned.
          </span>
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

/** Plant-level: what happens to plants already scanned, and the plants' dates set so far. */
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
      {switching && (
        <p>Plants already scanned keep the dates they were scanned with.</p>
      )}
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
