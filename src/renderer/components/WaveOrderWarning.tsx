/**
 * "Are you sure about wave N's dates?" on Capture Scan (#428), when its sowing or
 * germination date is out of order with another wave's (a later wave is sown and
 * germinates after an earlier one). The waves' dates are shown side by side, with the
 * dates that clash highlighted; the caller puts the note or reason field inside.
 */

import type { ReactNode } from 'react';
import {
  formatWaveDate,
  type WaveGerminationDate,
  type WaveWarning,
} from '../../utils/wave-dates';

export interface WaveOrderWarningProps {
  waveNumber: number;
  /** This wave's dates as entered. */
  sowing: string;
  germination: string;
  warning: WaveWarning;
  otherWaves: WaveGerminationDate[];
  children?: ReactNode;
}

const CELL = 'px-2 py-0.5 text-left';
const CLASH = 'font-bold text-red-700';

/** A wave's date, or a dash when it has none (dates per plant, or not recorded). */
function dateText(date: string | null | undefined): string {
  return date ? formatWaveDate(date) : '—';
}

export function WaveOrderWarning({
  waveNumber,
  sowing,
  germination,
  warning,
  otherWaves,
  children,
}: WaveOrderWarningProps) {
  const conflicts = warning.conflicts ?? [];
  const clashes = (field: 'sowing' | 'germination', wave?: number) =>
    conflicts.some(
      (c) => c.field === field && (wave === undefined || c.waveNumber === wave)
    );
  const rows = [
    ...otherWaves.map((w) => ({
      wave: w.wave_number,
      sowing: w.sowing_date,
      germination: w.germination_date,
      current: false,
    })),
    { wave: waveNumber, sowing, germination, current: true },
  ].sort((a, b) => a.wave - b.wave);

  return (
    <div
      className="flex gap-2 bg-amber-50 border border-amber-300 rounded-md p-2 text-sm text-gray-800"
      data-testid="wave-order-warning"
    >
      <span aria-hidden="true" className="text-lg leading-5 text-amber-600">
        ⚠
      </span>
      <div className="flex-1 space-y-1 min-w-0">
        <p className="font-semibold">{warning.question}</p>
        <div className="overflow-x-auto">
          <table className="text-sm" data-testid="wave-order-table">
            <thead className="text-gray-600">
              <tr>
                <th className={CELL}>Wave</th>
                <th className={CELL}>Sowing</th>
                <th className={CELL}>Germination</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const clashSowing = r.current
                  ? clashes('sowing')
                  : clashes('sowing', r.wave);
                const clashGermination = r.current
                  ? clashes('germination')
                  : clashes('germination', r.wave);
                return (
                  <tr
                    key={r.wave}
                    className={r.current ? 'bg-amber-100' : undefined}
                  >
                    <td className={`${CELL} font-semibold`}>
                      {r.wave}
                      {r.current && ' (this one)'}
                    </td>
                    <td className={`${CELL} ${clashSowing ? CLASH : ''}`}>
                      {dateText(r.sowing)}
                    </td>
                    <td className={`${CELL} ${clashGermination ? CLASH : ''}`}>
                      {dateText(r.germination)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {children}
      </div>
    </div>
  );
}
