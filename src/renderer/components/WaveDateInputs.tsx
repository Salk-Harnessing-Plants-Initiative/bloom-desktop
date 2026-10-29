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
  /** "form": laid out like the rest of Capture Scan's form (a per-plant wave's plant). */
  variant?: 'box' | 'form';
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

const STYLES = {
  box: {
    group: 'space-y-2',
    label: 'block text-sm font-medium text-gray-700',
    input: 'w-full px-3 py-2 border border-gray-300 rounded-md',
    required: false,
  },
  // The same as MetadataForm's fields.
  form: {
    group: 'space-y-4',
    label: 'block text-sm font-medium text-gray-700 mb-1',
    input:
      'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-lime-500 disabled:bg-gray-100 disabled:cursor-not-allowed',
    required: true,
  },
};

function Required({ shown }: { shown: boolean }) {
  return shown ? <span className="text-red-500"> *</span> : null;
}

export function WaveDateInputs({
  dates,
  transferSameDay,
  onChange,
  disabled = false,
  variant = 'box',
}: WaveDateInputsProps) {
  const style = STYLES[variant];
  const isForm = variant === 'form';
  const today = toIsoDate(new Date());
  const set = (patch: Partial<WaveDates>) =>
    onChange({ ...dates, ...patch }, transferSameDay);
  return (
    <div className={style.group} data-testid="wave-date-inputs">
      <label className="block">
        <span className={style.label}>
          {isForm ? 'Sowing Date' : 'Sowing date'}
          <Required shown={style.required} />
        </span>
        <input
          type="date"
          aria-label="Sowing date"
          value={dates.sowing}
          max={today}
          onChange={(e) => set({ sowing: e.target.value })}
          disabled={disabled}
          className={style.input}
          data-testid="sowing-date-input"
        />
      </label>
      <div>
        <span className={style.label}>
          {isForm ? 'Germination Date' : 'Germination date'}
          <Required shown={style.required} />
          <GerminationDateInfo />
        </span>
        <input
          type="date"
          aria-label="Germination date"
          value={dates.germination}
          max={today}
          onChange={(e) => set({ germination: e.target.value })}
          disabled={disabled}
          className={style.input}
          data-testid="germination-date-input"
        />
      </div>
      <div>
        <span className={style.label}>
          {isForm ? 'Transfer to Cylinder' : 'Transfer to cylinder'}
        </span>
        <label className="flex items-center gap-2 text-sm text-gray-700">
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
            className={`mt-1 ${style.input}`}
            data-testid="transfer-date-input"
          />
        )}
      </div>
    </div>
  );
}
