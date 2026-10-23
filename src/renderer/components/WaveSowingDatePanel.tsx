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
  formatSowingDate,
  toIsoDate,
  type WaveSowingDate,
} from '../../utils/sowing-date';
import type {
  CylinderWaveCreateInput,
  EarlierScansInfo,
} from '../../types/cylinder-wave';
import {
  agreesWithEarlierScans,
  describeEarlierScans,
  earlierScansDisagree,
} from '../../utils/sowing-date-backfill';
import type { DatabaseResponse } from '../../types/database';
import { StartDateInfo } from './StartDateInfo';

export interface WaveSowingDatePanelProps {
  waveNumber: number;
  /** The experiment's other waves. */
  waves: WaveSowingDate[];
  phenotyperId: string;
  /** What the wave's scans from before sowing dates existed point to, if any. */
  earlier?: EarlierScansInfo | null;
  onSave: (
    input: Omit<CylinderWaveCreateInput, 'experimentId' | 'waveNumber'>
  ) => Promise<DatabaseResponse<unknown>>;
  disabled?: boolean;
}

export function WaveSowingDatePanel({
  waveNumber,
  waves,
  phenotyperId,
  earlier = null,
  onSave,
  disabled = false,
}: WaveSowingDatePanelProps) {
  const [sowingDate, setSowingDate] = useState('');
  const [note, setNote] = useState('');
  const [waveConfirmed, setWaveConfirmed] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const check = sowingDate
    ? checkNewWave(
        waveNumber,
        sowingDate,
        waves,
        new Date(),
        earlier?.scannedWaveNumbers ?? []
      )
    : null;
  const hasEarlierScans = Boolean(earlier && earlier.candidates.length > 0);
  // A date far from what the wave's earlier scans point to needs a note too.
  const disagrees =
    hasEarlierScans &&
    check !== null &&
    !check.error &&
    !agreesWithEarlierScans(sowingDate, earlier!);
  const noteMessage =
    check?.noteNeeded ??
    (disagrees ? earlierScansDisagree(waveNumber, earlier!) : null);
  const phenotyperChosen = phenotyperId.trim() !== '';
  const canSave =
    !disabled &&
    !saving &&
    phenotyperChosen &&
    check !== null &&
    !check.error &&
    (!noteMessage || note.trim() !== '') &&
    (!check.waveConfirmNeeded || waveConfirmed);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await onSave({
        sowingDate,
        note: note.trim() || undefined,
        waveConfirmed,
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

  return (
    <div
      className="mt-2 bg-white border-2 border-green-600 rounded-lg p-3 space-y-2"
      data-testid="wave-sowing-date-panel"
    >
      <p className="font-medium text-green-800">
        Please set the start date for wave {waveNumber}.
        <StartDateInfo />
      </p>
      {hasEarlierScans && (
        <div
          className="text-sm text-gray-700"
          data-testid="sowing-date-earlier-scans"
        >
          <p>{describeEarlierScans(waveNumber, earlier!)}</p>
          <button
            type="button"
            onClick={() => setSowingDate(earlier!.candidates[0].date)}
            disabled={disabled || saving}
            className="underline"
            data-testid="sowing-date-use-earlier"
          >
            Use {formatSowingDate(earlier!.candidates[0].date)}
          </button>
        </div>
      )}
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
      {noteMessage && (
        <div className="space-y-1">
          <p className="text-sm text-gray-700">{noteMessage}</p>
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
        Save start date
      </button>
    </div>
  );
}
