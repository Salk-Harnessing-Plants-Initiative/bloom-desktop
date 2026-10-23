/**
 * Under the plant age on Capture Scan (#407): where the age came from, and a
 * Change age box for a plant that really is a different age. A changed age needs
 * a reason and applies to one scan; both are saved with it.
 */

import { useEffect, useState } from 'react';
import {
  MAX_REASON_LENGTH,
  formatDays,
  formatSowingDate,
} from '../../utils/sowing-date';
import { validatePlantAgeDays } from '../../utils/metadata-validation';
import type { CylinderWaveInfo } from '../../types/cylinder-wave';
import type { PlantAgeChange } from '../hooks/useWaveSowingDate';

export interface PlantAgeNoteProps {
  wave: CylinderWaveInfo;
  calculatedAge: number;
  change: PlantAgeChange | null;
  onChange: (change: PlantAgeChange | null) => void;
  /** Who is scanning, shown when they change the age. */
  phenotyperName?: string;
  /** Told when the Change age box opens or closes, so Start Scan can wait for it. */
  onOpenChange?: (open: boolean) => void;
  /** Why Change age isn't offered right now (only one change per scan), if so. */
  lockedMessage?: string | null;
  disabled?: boolean;
}

export function PlantAgeNote({
  wave,
  calculatedAge,
  change,
  onChange,
  phenotyperName,
  onOpenChange,
  lockedMessage = null,
  disabled = false,
}: PlantAgeNoteProps) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  // A box that goes away (another wave or experiment) no longer holds up Start Scan.
  useEffect(() => () => onOpenChange?.(false), [onOpenChange]);
  const [ageText, setAgeText] = useState('');
  const [reason, setReason] = useState('');

  const parsed = validatePlantAgeDays(ageText);
  const ageError = !ageText
    ? null
    : !parsed.isValid
      ? parsed.error
      : parsed.value === calculatedAge
        ? 'That is the calculated age.'
        : null;
  const canConfirm = parsed.isValid && !ageError && reason.trim() !== '';

  const openBox = () => {
    setAgeText('');
    setReason('');
    setOpen(true);
  };
  const confirm = () => {
    onChange({ age: parsed.value!, reason: reason.trim() });
    setOpen(false);
  };

  return (
    <div className="mt-1 text-sm text-gray-600" data-testid="plant-age-note">
      {change ? (
        <div
          className="mt-2 bg-amber-50 border-2 border-amber-400 rounded-lg p-3 text-amber-800"
          role="alert"
          data-testid="plant-age-changed"
        >
          <p className="flex items-center gap-2 font-medium">
            <svg
              className="h-5 w-5 text-amber-600 flex-shrink-0"
              fill="currentColor"
              viewBox="0 0 20 20"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            {phenotyperName || 'The phenotyper'} has manually updated the plant
            age.
          </p>
          <p>
            Calculated age: {formatDays(calculatedAge)}. Reason: {change.reason}
          </p>
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            className="underline"
          >
            Use calculated age
          </button>
        </div>
      ) : (
        <p>
          Calculated from wave {wave.wave_number}&apos;s start date (
          {formatSowingDate(wave.sowing_date)}).{' '}
          {lockedMessage ? (
            <span className="text-amber-800" data-testid="change-age-locked">
              {lockedMessage}
            </span>
          ) : (
            <button
              type="button"
              onClick={openBox}
              disabled={disabled}
              className="underline"
              data-testid="change-age"
            >
              Change age
            </button>
          )}
        </p>
      )}

      {open && (
        <div
          className="mt-2 bg-amber-50 border-2 border-amber-400 rounded-lg p-3 space-y-2"
          role="dialog"
          aria-label="Change plant age"
          data-testid="change-age-box"
        >
          <div className="flex items-start gap-2 font-medium text-amber-800">
            <svg
              className="h-5 w-5 text-amber-600 flex-shrink-0"
              fill="currentColor"
              viewBox="0 0 20 20"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <p>Calculated age: {formatDays(calculatedAge)}.</p>
              <p>Applies to this scan only.</p>
            </div>
          </div>
          <input
            type="text"
            inputMode="numeric"
            aria-label="Age to use"
            placeholder="Enter age here"
            value={ageText}
            onChange={(e) => setAgeText(e.target.value)}
            disabled={disabled}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
            data-testid="change-age-input"
          />
          {ageError && <p className="text-red-600">{ageError}</p>}
          <textarea
            aria-label="Reason"
            placeholder="Why is this plant a different age?"
            value={reason}
            maxLength={MAX_REASON_LENGTH}
            onChange={(e) => setReason(e.target.value)}
            disabled={disabled}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
            data-testid="change-age-reason"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirm}
              disabled={disabled || !canConfirm}
              className="px-3 py-1.5 rounded-md bg-amber-600 text-white font-medium hover:bg-amber-700 disabled:opacity-50"
              data-testid="change-age-confirm"
            >
              Use this age
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={disabled}
              className="px-3 py-1.5 rounded-md border border-gray-300 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
