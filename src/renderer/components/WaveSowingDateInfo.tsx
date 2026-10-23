/**
 * Under the wave number on Capture Scan, once the wave has a sowing date (#407):
 * the date, who set it and when. Until the wave's first scan the date can be
 * edited here; after that it can only be corrected, with a reason, on the
 * Experiments page.
 */

import { useState } from 'react';
import {
  MAX_REASON_LENGTH,
  checkNewWave,
  formatSowingDate,
  toIsoDate,
  type WaveSowingDate,
} from '../../utils/sowing-date';
import type { CylinderWaveInfo } from '../../types/cylinder-wave';
import type { DatabaseResponse } from '../../types/database';

export interface WaveSowingDateInfoProps {
  wave: CylinderWaveInfo;
  /** The experiment's waves, to check the edited date against the others. */
  waves: WaveSowingDate[];
  onChangeDate: (
    sowingDate: string,
    reason?: string
  ) => Promise<DatabaseResponse<unknown>>;
  disabled?: boolean;
}

function formatSetAt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function WaveSowingDateInfo({
  wave,
  waves,
  onChangeDate,
  disabled = false,
}: WaveSowingDateInfoProps) {
  const [editing, setEditing] = useState(false);
  const [sowingDate, setSowingDate] = useState(wave.sowing_date);
  const [note, setNote] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canEdit = wave.scanCount === 0;

  const others = waves.filter((w) => w.wave_number !== wave.wave_number);
  const check =
    editing && sowingDate !== wave.sowing_date
      ? checkNewWave(wave.wave_number, sowingDate, others, new Date())
      : null;
  const canSave =
    !saving &&
    check !== null &&
    !check.error &&
    (!check.noteNeeded || note.trim() !== '');

  const open = () => {
    setSowingDate(wave.sowing_date);
    setNote('');
    setSaveError(null);
    setEditing(true);
  };
  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await onChangeDate(sowingDate, note.trim() || undefined);
      if (result.success) setEditing(false);
      else setSaveError(result.error ?? 'Could not change the sowing date.');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="mt-1 text-sm text-gray-600"
      data-testid="wave-sowing-date-info"
    >
      <p>
        Sowing date: {formatSowingDate(wave.sowing_date)}
        {wave.set_by_name ? ` · set by ${wave.set_by_name}` : ''} on{' '}
        {formatSetAt(wave.set_at)}
        {canEdit && !editing && (
          <>
            {' '}
            <button
              type="button"
              onClick={open}
              disabled={disabled}
              className="underline"
              data-testid="sowing-date-edit"
            >
              Edit
            </button>
          </>
        )}
      </p>

      {editing && (
        <div
          className="mt-2 bg-white border-2 border-green-600 rounded-lg p-3 space-y-2"
          data-testid="sowing-date-edit-box"
        >
          <input
            type="date"
            aria-label="Sowing date"
            value={sowingDate}
            max={toIsoDate(new Date())}
            onChange={(e) => setSowingDate(e.target.value)}
            disabled={saving}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          />
          {check?.error && <p className="text-red-600">{check.error}</p>}
          {check?.noteNeeded && (
            <div className="space-y-1">
              <p className="text-gray-700">{check.noteNeeded}</p>
              <textarea
                aria-label="Note"
                value={note}
                maxLength={MAX_REASON_LENGTH}
                onChange={(e) => setNote(e.target.value)}
                disabled={saving}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
          )}
          {saveError && <p className="text-red-600">{saveError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              className="px-3 py-1.5 rounded-md bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50"
              data-testid="sowing-date-edit-save"
            >
              Save sowing date
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-3 py-1.5 rounded-md border border-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
