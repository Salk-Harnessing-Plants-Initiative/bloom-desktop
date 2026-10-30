/**
 * Asks for a wave's dates on Capture Scan, the first time the wave is used (#407,
 * #428): wave-level (sowing, germination and transfer to cylinder, the germination
 * day unless changed, entered once) or plant-level (entered per plant). The plant age is computed from the germination date. A wave number that
 * skips ahead is asked about first, on its own ("Is the wave number correct?"), and
 * goes on only with a note. Then dates in the future, or a sowing date after
 * germination, are refused; and a germination date out of order with another wave's
 * asks "Are you sure…?" and proceeds only with a note. The main process checks the
 * same rules.
 */

import { useState } from 'react';
import {
  MAX_REASON_LENGTH,
  checkNewWave,
  waveNumberWarning,
  type WaveDates,
  type WaveGerminationDate,
} from '../../utils/wave-dates';
import { WaveWarnings } from './WaveWarnings';
import { DatesModeChoice } from './DatesModeChoice';
import { WaveOrderWarning } from './WaveOrderWarning';
import type { CylinderWaveCreateInput } from '../../types/cylinder-wave';
import type { DatabaseResponse } from '../../types/database';
import {
  WaveDateInputs,
  enteredDates,
  transferMissing,
} from './WaveDateInputs';

export interface WaveDatesPanelProps {
  waveNumber: number;
  /** The experiment's other waves. */
  waves: WaveGerminationDate[];
  phenotyperId: string;
  /** The chosen phenotyper's name, to say who confirmed a skipped-ahead wave. */
  phenotyperName?: string | null;
  onSave: (
    input: Omit<CylinderWaveCreateInput, 'experimentId' | 'waveNumber'>
  ) => Promise<DatabaseResponse<unknown>>;
  disabled?: boolean;
}

export function WaveDatesPanel({
  waveNumber,
  waves,
  phenotyperId,
  phenotyperName = null,
  onSave,
  disabled = false,
}: WaveDatesPanelProps) {
  const [dates, setDates] = useState<WaveDates>({
    germination: '',
    sowing: '',
    transfer: '',
  });
  const [transferSameDay, setTransferSameDay] = useState(true);
  // Do all the wave's plants share their dates? Nothing is chosen until they answer.
  const [sameForAll, setSameForAll] = useState<boolean | null>(null);
  const [note, setNote] = useState('');
  // A wave number that skips ahead is confirmed, with a note, before the date.
  const waveWarning = waveNumberWarning(waveNumber, waves);
  const [waveNote, setWaveNote] = useState('');
  const [waveConfirmed, setWaveConfirmed] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const entered = enteredDates(dates, transferSameDay);
  // Checked once a date has been entered, so an empty box isn't an error yet.
  const check =
    dates.germination || dates.sowing
      ? checkNewWave(waveNumber, entered, waves, new Date())
      : null;
  const phenotyperChosen = phenotyperId.trim() !== '';
  const canSave =
    !disabled &&
    !saving &&
    phenotyperChosen &&
    (sameForAll === false ||
      (sameForAll === true &&
        check !== null &&
        !check.error &&
        !transferMissing(dates, transferSameDay) &&
        (!check.dateWarning || note.trim() !== '')));
  // Saved as the wave's note: why the number skips ahead, then why the date is
  // out of order.
  const savedNote = [waveNote.trim(), note.trim()].filter(Boolean).join('; ');

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await onSave(
        sameForAll
          ? {
              germinationDate: entered.germination,
              sowingDate: entered.sowing,
              transferDate: entered.transfer || undefined,
              note: savedNote || undefined,
              phenotyperId,
            }
          : {
              datesPerPlant: true,
              note: waveNote.trim() || undefined,
              phenotyperId,
            }
      );
      if (!result.success)
        setSaveError(result.error ?? "Could not save the wave's dates.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  if (waveWarning && !waveConfirmed) {
    return (
      <div
        className="mt-2 bg-white border-2 border-amber-500 rounded-lg p-3 space-y-2"
        data-testid="wave-number-check"
      >
        <WaveWarnings warnings={[waveWarning]}>
          <p>Add a note to continue, or change the wave number above.</p>
          <textarea
            aria-label="Why this wave number"
            placeholder="Note (required to continue)"
            value={waveNote}
            maxLength={MAX_REASON_LENGTH / 2}
            onChange={(e) => setWaveNote(e.target.value)}
            disabled={disabled}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            data-testid="wave-number-note"
          />
        </WaveWarnings>
        <button
          type="button"
          onClick={() => setWaveConfirmed(true)}
          disabled={disabled || waveNote.trim() === ''}
          className="px-3 py-1.5 rounded-md bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
          data-testid="wave-number-confirm"
        >
          Yes, wave {waveNumber} is correct
        </button>
      </div>
    );
  }

  return (
    <div
      className="mt-2 bg-white border-2 border-green-600 rounded-lg p-3 space-y-2"
      data-testid="wave-dates-panel"
    >
      {waveConfirmed && (
        <p
          className="text-sm text-gray-600"
          data-testid="wave-number-confirmed"
        >
          Wave {waveNumber} confirmed
          {phenotyperName ? ` by ${phenotyperName}` : ''}: {waveNote.trim()}
        </p>
      )}
      <DatesModeChoice
        waveNumber={waveNumber}
        value={sameForAll === null ? null : sameForAll ? 'same' : 'perPlant'}
        onChange={(mode) => setSameForAll(mode === 'same')}
        disabled={disabled || saving}
      >
        <WaveDateInputs
          dates={dates}
          transferSameDay={transferSameDay}
          onChange={(next, sameDay) => {
            setDates(next);
            setTransferSameDay(sameDay);
          }}
          disabled={disabled || saving}
        />
        {check?.error && <p className="text-sm text-red-600">{check.error}</p>}
        {check?.dateWarning && (
          <WaveOrderWarning
            waveNumber={waveNumber}
            sowing={entered.sowing}
            germination={entered.germination}
            warning={check.dateWarning}
            otherWaves={waves}
          >
            <p>If these are right, add a note to proceed.</p>
            <textarea
              aria-label="Note"
              placeholder="Note (required to proceed)"
              value={note}
              maxLength={MAX_REASON_LENGTH / 2}
              onChange={(e) => setNote(e.target.value)}
              disabled={disabled || saving}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              data-testid="wave-dates-note"
            />
          </WaveOrderWarning>
        )}
      </DatesModeChoice>
      {!phenotyperChosen && (
        <p
          className="text-sm text-red-600"
          data-testid="wave-dates-needs-phenotyper"
        >
          Choose the phenotyper first.
        </p>
      )}
      {saveError && <p className="text-sm text-red-600">{saveError}</p>}
      <button
        type="button"
        onClick={save}
        disabled={!canSave}
        className="px-3 py-1.5 rounded-md bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
        data-testid="wave-dates-save"
      >
        {sameForAll !== true
          ? 'Continue'
          : check?.dateWarning
            ? 'Proceed with these dates'
            : 'Save dates'}
      </button>
    </div>
  );
}
