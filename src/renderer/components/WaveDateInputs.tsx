/**
 * A wave's three dates on Capture Scan (#428): sowing, germination and transfer to
 * cylinder. The plant age is computed from the germination date (its ⓘ says how).
 * The transfer date is the germination day unless "Same day as germination" is
 * unticked.
 */

import { toIsoDate, type WaveDates } from '../../utils/wave-dates';
import { GerminationDateInfo } from './GerminationDateInfo';

export interface WaveDateInputsProps {
  dates: WaveDates;
  /** The transfer date is the germination day (`dates.transfer` is then ignored). */
  transferSameDay: boolean;
  onChange: (dates: WaveDates, transferSameDay: boolean) => void;
  disabled?: boolean;
}

/** The dates to check and save: the transfer date is '' when it's the germination day. */
export function enteredDates(
  dates: WaveDates,
  transferSameDay: boolean
): WaveDates {
  return { ...dates, transfer: transferSameDay ? '' : dates.transfer };
}

/** Unticked "Same day as germination" but no transfer date entered yet. */
export function transferMissing(
  dates: WaveDates,
  transferSameDay: boolean
): boolean {
  return !transferSameDay && dates.transfer === '';
}

const INPUT_CLASS = 'w-full px-3 py-2 border border-gray-300 rounded-md';
const LABEL_CLASS = 'block text-sm font-medium text-gray-700';

export function WaveDateInputs({
  dates,
  transferSameDay,
  onChange,
  disabled = false,
}: WaveDateInputsProps) {
  const today = toIsoDate(new Date());
  const set = (patch: Partial<WaveDates>) =>
    onChange({ ...dates, ...patch }, transferSameDay);
  return (
    <div className="space-y-2" data-testid="wave-date-inputs">
      <label className={LABEL_CLASS}>
        Sowing date
        <input
          type="date"
          aria-label="Sowing date"
          value={dates.sowing}
          max={today}
          onChange={(e) => set({ sowing: e.target.value })}
          disabled={disabled}
          className={INPUT_CLASS}
          data-testid="sowing-date-input"
        />
      </label>
      <div className={LABEL_CLASS}>
        <span>
          Germination date
          <GerminationDateInfo />
        </span>
        <input
          type="date"
          aria-label="Germination date"
          value={dates.germination}
          max={today}
          onChange={(e) => set({ germination: e.target.value })}
          disabled={disabled}
          className={INPUT_CLASS}
          data-testid="germination-date-input"
        />
      </div>
      <div className={LABEL_CLASS}>
        Transfer to cylinder
        <label className="mt-1 flex items-center gap-2 font-normal">
          <input
            type="checkbox"
            checked={transferSameDay}
            onChange={(e) => onChange(dates, e.target.checked)}
            disabled={disabled}
            data-testid="transfer-same-day"
          />
          Same day as germination
        </label>
        {!transferSameDay && (
          <input
            type="date"
            aria-label="Transfer date"
            value={dates.transfer}
            max={today}
            onChange={(e) => set({ transfer: e.target.value })}
            disabled={disabled}
            className={`mt-1 ${INPUT_CLASS}`}
            data-testid="transfer-date-input"
          />
        )}
      </div>
    </div>
  );
}
