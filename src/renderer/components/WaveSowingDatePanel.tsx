/**
 * Asks for a wave's sowing date on Capture Scan, the first time the wave is used
 * (#407). The plant age is then calculated from it. A future date is refused; a
 * date on or before an earlier wave's needs a note; a wave number that skips ahead
 * must be confirmed. The main process checks the same rules when saving.
 */

import { useState } from 'react';
import {
  MAX_REASON_LENGTH,
  checkNewWave,
  toIsoDate,
  type WaveSowingDate,
} from '../../utils/sowing-date';
import type { CylinderWaveCreateInput } from '../../types/cylinder-wave';
import type { DatabaseResponse } from '../../types/database';

export interface WaveSowingDatePanelProps {
  waveNumber: number;
  /** The experiment's other waves. */
  waves: WaveSowingDate[];
  phenotyperId: string;
  onSave: (
    input: Omit<CylinderWaveCreateInput, 'experimentId' | 'waveNumber'>
  ) => Promise<DatabaseResponse<unknown>>;
  disabled?: boolean;
}

export function WaveSowingDatePanel({
  waveNumber,
  waves,
  phenotyperId,
  onSave,
  disabled = false,
}: WaveSowingDatePanelProps) {
  const [sowingDate, setSowingDate] = useState('');
  const [note, setNote] = useState('');
  const [waveConfirmed, setWaveConfirmed] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const check = sowingDate
    ? checkNewWave(waveNumber, sowingDate, waves, new Date())
    : null;
  const canSave =
    !disabled &&
    !saving &&
    check !== null &&
    !check.error &&
    (!check.noteNeeded || note.trim() !== '') &&
    (!check.waveConfirmNeeded || waveConfirmed);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await onSave({
        sowingDate,
        note: note.trim() || undefined,
        waveConfirmed,
        phenotyperId: phenotyperId || undefined,
      });
      if (!result.success)
        setSaveError(result.error ?? 'Could not save the sowing date.');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="mt-2 bg-white border-2 border-green-600 rounded-lg p-3 space-y-2"
      data-testid="wave-sowing-date-panel"
    >
      <p className="font-medium text-green-800">
        Please set the sowing date for wave {waveNumber}.
      </p>
      <input
        type="date"
        aria-label="Sowing date"
        value={sowingDate}
        max={toIsoDate(new Date())}
        onChange={(e) => setSowingDate(e.target.value)}
        disabled={disabled || saving}
        className="w-full px-3 py-2 border border-gray-300 rounded-md"
        data-testid="sowing-date-input"
      />
      {check?.error && <p className="text-sm text-red-600">{check.error}</p>}
      {check?.noteNeeded && (
        <div className="space-y-1">
          <p className="text-sm text-gray-700">{check.noteNeeded}</p>
          <textarea
            aria-label="Note"
            value={note}
            maxLength={MAX_REASON_LENGTH}
            onChange={(e) => setNote(e.target.value)}
            disabled={disabled || saving}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            data-testid="sowing-date-note"
          />
        </div>
      )}
      {check?.waveConfirmNeeded && (
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={waveConfirmed}
            onChange={(e) => setWaveConfirmed(e.target.checked)}
            disabled={disabled || saving}
            data-testid="sowing-date-wave-confirm"
          />
          <span>
            {check.waveConfirmNeeded} Yes, this is wave {waveNumber}.
          </span>
        </label>
      )}
      {saveError && <p className="text-sm text-red-600">{saveError}</p>}
      <button
        type="button"
        onClick={save}
        disabled={!canSave}
        className="px-3 py-1.5 rounded-md bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
        data-testid="sowing-date-save"
      >
        Save sowing date
      </button>
    </div>
  );
}
