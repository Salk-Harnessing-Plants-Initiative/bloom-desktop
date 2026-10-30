/**
 * The "Wave 2 was skipped" box on Capture Scan, when a new wave's number skips
 * ahead (#428). The phenotyper can still proceed, with a note, which the caller
 * puts inside. (A wave's dates out of order with another's use WaveOrderWarning.)
 */

import type { ReactNode } from 'react';
import type { WaveWarning } from '../../utils/wave-dates';

export interface WaveWarningsProps {
  warnings: WaveWarning[];
  /** The note field. */
  children: ReactNode;
}

export function WaveWarnings({ warnings, children }: WaveWarningsProps) {
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
        {children}
      </div>
    </div>
  );
}
