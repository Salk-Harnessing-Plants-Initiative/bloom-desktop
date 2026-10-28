/**
 * Under the wave number on Capture Scan, once the wave is set up (#407, #428): its
 * germination, sowing and transfer dates (or that they're set for each plant), who set
 * them and when, and Edit, which changes the dates or how they're set. Every change is
 * logged (Experiments page), and scans already saved keep the age they were saved with.
 */

import { useEffect, useState } from 'react';
import {
  formatWaveDate,
  type WaveGerminationDate,
} from '../../utils/wave-dates';
import type {
  CylinderPlantInfo,
  CylinderWaveDateChangeInput,
  CylinderWaveInfo,
  CylinderWaveSameDatesInput,
} from '../../types/cylinder-wave';
import type { DatabaseResponse } from '../../types/database';
import type { PlantDates } from '../hooks/useWaveDates';
import { GerminationDateInfo } from './GerminationDateInfo';
import { WaveDatesEditBox } from './WaveDatesEditBox';

export interface WaveDatesInfoProps {
  wave: CylinderWaveInfo;
  /** The experiment's waves, to check an edited germination date against the others. */
  waves: WaveGerminationDate[];
  onChangeDate: (
    change: Omit<CylinderWaveDateChangeInput, 'waveId' | 'phenotyperId'>
  ) => Promise<DatabaseResponse<unknown>>;
  /** A phenotyper is chosen: needed to save a change, so the log can say who. */
  phenotyperChosen: boolean;
  /** Told when the Edit box opens or closes, so Start Scan can wait for it. */
  onOpenChange?: (open: boolean) => void;
  /** The wave's plants with rows, most recently changed first. */
  plants?: CylinderPlantInfo[];
  /** A per-plant wave can go back to the same dates for all plants. */
  canUseSameDates?: boolean;
  /** The dates the wave's plants share, if they do. */
  sharedPlantDates?: PlantDates | null;
  onUseSameDates?: (
    input: Omit<CylinderWaveSameDatesInput, 'waveId' | 'phenotyperId'>
  ) => Promise<DatabaseResponse<unknown>>;
  onUseDatesPerPlant?: (reason?: string) => Promise<DatabaseResponse<unknown>>;
  disabled?: boolean;
}

const NOT_AVAILABLE = async () => ({
  success: false,
  error: 'Not available here.',
});

function formatSetAt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const LABEL = 'font-semibold text-green-800';

export function WaveDatesInfo({
  wave,
  waves,
  onChangeDate,
  phenotyperChosen,
  onOpenChange,
  plants = [],
  canUseSameDates = false,
  sharedPlantDates = null,
  onUseSameDates = NOT_AVAILABLE,
  onUseDatesPerPlant = NOT_AVAILABLE,
  disabled = false,
}: WaveDatesInfoProps) {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    onOpenChange?.(editing);
  }, [editing, onOpenChange]);
  // A box that goes away (another wave or experiment) no longer holds up Start Scan.
  useEffect(() => () => onOpenChange?.(false), [onOpenChange]);
  const others = waves.filter((w) => w.wave_number !== wave.wave_number);
  const setBy = wave.dates_per_plant ? 'Set up' : 'Dates updated';

  return (
    <div className="mt-1 text-sm text-gray-600" data-testid="wave-dates-info">
      <div className="space-y-0.5" data-testid="wave-dates-summary">
        {wave.dates_per_plant ? (
          <>
            <p>
              <span className={LABEL}>
                Wave {wave.wave_number}&apos;s dates are set for each plant
              </span>
              <GerminationDateInfo />
            </p>
            {plants.length > 0 && (
              <p className="text-gray-900">
                {plants.length === 1
                  ? '1 plant set so far'
                  : `${plants.length} plants set so far`}
              </p>
            )}
          </>
        ) : (
          <>
            <p>
              <span className={LABEL}>Germination date</span>
              <GerminationDateInfo />:{' '}
              <span className="font-medium text-gray-900">
                {formatWaveDate(wave.germination_date ?? '')}
              </span>
            </p>
            {wave.sowing_date && (
              <p>
                <span className={LABEL}>Sown:</span>{' '}
                <span className="text-gray-900">
                  {formatWaveDate(wave.sowing_date)}
                </span>
              </p>
            )}
            <p>
              <span className={LABEL}>Transferred:</span>{' '}
              <span className="text-gray-900">
                {wave.transfer_date
                  ? formatWaveDate(wave.transfer_date)
                  : 'the same day as germination'}
              </span>
            </p>
          </>
        )}
        <p className="text-xs text-gray-500">
          {wave.set_by_name
            ? `${setBy} by ${wave.set_by_name} on ${formatSetAt(wave.set_at)}`
            : `${setBy} on ${formatSetAt(wave.set_at)}`}
          {!editing && (
            <>
              {' · '}
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={disabled}
                className="font-semibold text-green-800 underline"
                data-testid="wave-dates-edit"
              >
                Edit
              </button>
            </>
          )}
        </p>
      </div>

      {editing && (
        <WaveDatesEditBox
          wave={wave}
          otherWaves={others}
          plants={plants}
          canUseSameDates={canUseSameDates}
          sharedPlantDates={sharedPlantDates}
          onChangeDate={onChangeDate}
          onUseSameDates={onUseSameDates}
          onUseDatesPerPlant={onUseDatesPerPlant}
          onClose={() => setEditing(false)}
          phenotyperChosen={phenotyperChosen}
          disabled={disabled}
        />
      )}
    </div>
  );
}
