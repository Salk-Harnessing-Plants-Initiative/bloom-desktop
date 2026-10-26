/**
 * Asks for a wave's sowing date on Capture Scan, the first time the wave is used
 * (#407). The plant age is then calculated from it. A wave number that skips ahead
 * is asked about first, on its own ("Is the wave number correct?"), and goes on only
 * with a note. Then: what the date is (transfer, sowing, germination or other) must
 * be chosen; a future date is refused; and a date out of order with another wave's
 * asks "Are you sure…?" and proceeds only with a note. The main process checks the
 * same rules.
 */

import { useState } from 'react';
import {
  MAX_REASON_LENGTH,
  checkNewWave,
  toIsoDate,
  waveNumberWarning,
  type WaveSowingDate,
} from '../../utils/sowing-date';
import { WaveWarnings } from './WaveWarnings';
import type { CylinderWaveCreateInput } from '../../types/cylinder-wave';
import type { DatabaseResponse } from '../../types/database';
import { StartDateInfo } from './StartDateInfo';
import { StartDateBasisField } from './StartDateBasisField';
import {
  startDateBasisError,
  type StartDateBasis,
} from '../../utils/start-date-basis';

export interface WaveSowingDatePanelProps {
  waveNumber: number;
  /** The experiment's other waves. */
  waves: WaveSowingDate[];
  phenotyperId: string;
  /** The chosen phenotyper's name, to say who confirmed a skipped-ahead wave. */
  phenotyperName?: string | null;
  onSave: (
    input: Omit<CylinderWaveCreateInput, 'experimentId' | 'waveNumber'>
  ) => Promise<DatabaseResponse<unknown>>;
  disabled?: boolean;
}

export function WaveSowingDatePanel({
  waveNumber,
  waves,
  phenotyperId,
  phenotyperName = null,
  onSave,
  disabled = false,
}: WaveSowingDatePanelProps) {
  const [sowingDate, setSowingDate] = useState('');
  const [basis, setBasis] = useState<StartDateBasis | ''>('');
  const [basisOther, setBasisOther] = useState('');
  const [note, setNote] = useState('');
  // A wave number that skips ahead is confirmed, with a note, before the date.
  const waveWarning = waveNumberWarning(waveNumber, waves);
  const [waveNote, setWaveNote] = useState('');
  const [waveConfirmed, setWaveConfirmed] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const check = sowingDate
    ? checkNewWave(waveNumber, sowingDate, waves, new Date())
    : null;
  const phenotyperChosen = phenotyperId.trim() !== '';
  const canSave =
    !disabled &&
    !saving &&
    phenotyperChosen &&
    check !== null &&
    !check.error &&
    !startDateBasisError(basis, basisOther) &&
    (!check.dateWarning || note.trim() !== '');
  // Saved as the wave's note: why the number skips ahead, then why the date is
  // out of order.
  const savedNote = [waveNote.trim(), note.trim()].filter(Boolean).join('; ');

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await onSave({
        sowingDate,
        startDateBasis: basis,
        startDateBasisOther: basis === 'other' ? basisOther.trim() : undefined,
        note: savedNote || undefined,
        phenotyperId,
      });
      if (!result.success)
        setSaveError(result.error ?? 'Could not save the start date.');
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
      data-testid="wave-sowing-date-panel"
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
      <p className="font-medium text-green-800">
        Please set the start date for wave {waveNumber}. The plant age is
        computed from it.
        <StartDateInfo />
      </p>
      <input
        type="date"
        aria-label="Start date"
        value={sowingDate}
        max={toIsoDate(new Date())}
        onChange={(e) => setSowingDate(e.target.value)}
        disabled={disabled || saving}
        className="w-full px-3 py-2 border border-gray-300 rounded-md"
        data-testid="sowing-date-input"
      />
      {check?.error && <p className="text-sm text-red-600">{check.error}</p>}
      <StartDateBasisField
        basis={basis}
        other={basisOther}
        onChange={(next, other) => {
          setBasis(next);
          setBasisOther(other);
        }}
        disabled={disabled || saving}
      />
      {check?.dateWarning && (
        <WaveWarnings warnings={[check.dateWarning]} otherWaves={waves}>
          <p>If it is correct, add a note saying why, then proceed.</p>
          <textarea
            aria-label="Note"
            placeholder="Note (required to proceed)"
            value={note}
            maxLength={MAX_REASON_LENGTH / 2}
            onChange={(e) => setNote(e.target.value)}
            disabled={disabled || saving}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            data-testid="sowing-date-note"
          />
        </WaveWarnings>
      )}
      {!phenotyperChosen && (
        <p
          className="text-sm text-red-600"
          data-testid="sowing-date-needs-phenotyper"
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
        data-testid="sowing-date-save"
      >
        {check?.dateWarning
          ? 'Proceed with this start date'
          : 'Save start date'}
      </button>
    </div>
  );
}
