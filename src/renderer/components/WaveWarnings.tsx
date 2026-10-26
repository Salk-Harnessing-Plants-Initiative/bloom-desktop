/**
 * The "Are you sure…?" box on Capture Scan when a wave's germination date is out of order
 * with another wave's, or its number skips ahead (#428). It shows the experiment's
 * other germination dates to check against; the phenotyper can still proceed, with a note
 * (or a reason, when editing), which the caller puts inside.
 */

import type { ReactNode } from 'react';
import {
  formatWaveDate,
  type WaveGerminationDate,
  type WaveWarning,
} from '../../utils/wave-dates';

export interface WaveWarningsProps {
  warnings: WaveWarning[];
  /** The experiment's other waves, listed when a date is out of order. */
  otherWaves?: WaveGerminationDate[];
  /** The note or reason field. */
  children: ReactNode;
}

export function WaveWarnings({
  warnings,
  otherWaves = [],
  children,
}: WaveWarningsProps) {
  const sorted = [...otherWaves].sort((a, b) => a.wave_number - b.wave_number);
  return (
    <div
      className="flex gap-2 bg-amber-50 border border-amber-300 rounded-md p-2 text-sm text-gray-800"
      data-testid="wave-warnings"
    >
      <span aria-hidden="true" className="text-lg leading-5 text-amber-600">
        ⚠
      </span>
      <div className="flex-1 space-y-1">
        {warnings.map((w) => (
          <div key={w.question}>
            <p className="font-semibold">{w.question}</p>
            <p>{w.detail}</p>
            {w.confirm && (
              <p className="font-bold text-green-800">{w.confirm}</p>
            )}
          </div>
        ))}
        {sorted.length > 0 && (
          <div data-testid="wave-warnings-dates">
            <p>Germination dates of this experiment&apos;s other waves:</p>
            <ul className="ml-4 list-disc">
              {sorted.map((w) => (
                <li key={w.wave_number}>
                  Wave {w.wave_number}: {formatWaveDate(w.germination_date)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
