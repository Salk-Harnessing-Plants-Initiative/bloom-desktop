/**
 * Under the wave number on Capture Scan, once the wave has its dates (#407, #428): the
 * germination date the age is computed from, the sowing and transfer dates, who set
 * them and when, and Edit. Before the wave's first scan they change freely. After
 * that a change needs a reason, and the scans already saved keep the age they were
 * saved with. Every change is logged (Experiments page).
 */

import { useEffect, useState } from 'react';
import {
  MAX_REASON_LENGTH,
  checkWaveDateChange,
  formatWaveDate,
  storedWaveDates,
  type WaveDates,
  type WaveGerminationDate,
} from '../../utils/wave-dates';
import type {
  CylinderWaveDateChangeInput,
  CylinderWaveInfo,
} from '../../types/cylinder-wave';
import type { DatabaseResponse } from '../../types/database';
import { GerminationDateInfo } from './GerminationDateInfo';
import { WaveWarnings } from './WaveWarnings';
import {
  WaveDateInputs,
  enteredDates,
  transferMissing,
} from './WaveDateInputs';

export interface WaveDatesInfoProps {
  wave: CylinderWaveInfo;
  /** The experiment's waves, to check the edited date against the others. */
  waves: WaveGerminationDate[];
  onChangeDate: (
    change: Omit<CylinderWaveDateChangeInput, 'waveId' | 'phenotyperId'>
  ) => Promise<DatabaseResponse<unknown>>;
  /** A phenotyper is chosen: needed to save a change, so the log can say who. */
  phenotyperChosen: boolean;
  /** Told when the Edit box opens or closes, so Start Scan can wait for it. */
  onOpenChange?: (open: boolean) => void;
  /** Why Edit isn't offered right now (only one change per scan), if so. */
  lockedMessage?: string | null;
  disabled?: boolean;
}

function formatSetAt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function WaveDatesInfo({
  wave,
  waves,
  onChangeDate,
  phenotyperChosen,
  onOpenChange,
  lockedMessage = null,
  disabled = false,
}: WaveDatesInfoProps) {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    onOpenChange?.(editing);
  }, [editing, onOpenChange]);
  // A box that goes away (another wave or experiment) no longer holds up Start Scan.
  useEffect(() => () => onOpenChange?.(false), [onOpenChange]);
  const saved = storedWaveDates(wave);
  const [dates, setDates] = useState<WaveDates>(saved);
  const [transferSameDay, setTransferSameDay] = useState(!saved.transfer);
  const [reason, setReason] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const hasScans = wave.scanCount > 0;

  const others = waves.filter((w) => w.wave_number !== wave.wave_number);
  // The same rules the main process applies when saving.
  const entered = enteredDates(dates, transferSameDay);
  const changed =
    entered.germination !== saved.germination ||
    entered.sowing !== saved.sowing ||
    entered.transfer !== saved.transfer;
  const check =
    editing && changed
      ? checkWaveDateChange(
          {
            waveNumber: wave.wave_number,
            current: saved,
            next: entered,
            reason,
            waveHasScans: hasScans,
          },
          others,
          new Date()
        )
      : null;
  const reasonNeeded = hasScans || Boolean(check?.reasonNeeded);
  const canSave =
    !disabled &&
    !saving &&
    phenotyperChosen &&
    check !== null &&
    !check.saveError &&
    !transferMissing(dates, transferSameDay);

  const open = () => {
    setDates(saved);
    setTransferSameDay(!saved.transfer);
    setReason('');
    setSaveError(null);
    setEditing(true);
  };
  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await onChangeDate({
        germinationDate: entered.germination,
        sowingDate: entered.sowing,
        transferDate: entered.transfer || undefined,
        reason: reason.trim() || undefined,
      });
      if (result.success) setEditing(false);
      else setSaveError(result.error ?? "Could not change the wave's dates.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-1 text-sm text-gray-600" data-testid="wave-dates-info">
      <p>
        Germination date
        <GerminationDateInfo />: {formatWaveDate(wave.germination_date)}
        {wave.sowing_date && ` · sown ${formatWaveDate(wave.sowing_date)}`}
        {wave.transfer_date
          ? ` · transferred ${formatWaveDate(wave.transfer_date)}`
          : ' · transferred the same day'}
        {wave.set_by_name
          ? ` · set by ${wave.set_by_name} on ${formatSetAt(wave.set_at)}`
          : ` (set on ${formatSetAt(wave.set_at)})`}
        {!editing && !lockedMessage && (
          <>
            {' '}
            <button
              type="button"
              onClick={open}
              disabled={disabled}
              className="underline"
              data-testid="wave-dates-edit"
            >
              Edit
            </button>
          </>
        )}
      </p>
      {!editing && lockedMessage && (
        <p className="text-amber-800" data-testid="wave-dates-edit-locked">
          {lockedMessage}
        </p>
      )}

      {editing && (
        <div
          className="mt-2 bg-white border-2 border-green-600 rounded-lg p-3 space-y-2"
          data-testid="wave-dates-edit-box"
        >
          <WaveDateInputs
            dates={dates}
            transferSameDay={transferSameDay}
            onChange={(next, sameDay) => {
              setDates(next);
              setTransferSameDay(sameDay);
            }}
            disabled={saving || disabled}
          />
          {hasScans && (
            <div
              className="text-amber-800 space-y-1"
              data-testid="wave-dates-edit-scans-warning"
            >
              <p>
                {wave.scanCount === 1
                  ? `1 scan in wave ${wave.wave_number} is already saved. It keeps the age it was saved with: only new scans use the new date.`
                  : `${wave.scanCount} scans in wave ${wave.wave_number} are already saved. They keep the ages they were saved with: only new scans use the new date.`}
              </p>
              <p>
                If their ages need correcting, that has to be done in Bloom as
                well.
              </p>
            </div>
          )}
          {check?.error && <p className="text-red-600">{check.error}</p>}
          {check?.conflict && (
            <WaveWarnings warnings={[check.conflict]} otherWaves={others}>
              <p>
                If it is correct, give a reason for the change, then proceed.
              </p>
            </WaveWarnings>
          )}
          {reasonNeeded && (
            <textarea
              aria-label="Reason"
              placeholder="Reason for the change (required)"
              value={reason}
              maxLength={MAX_REASON_LENGTH}
              onChange={(e) => setReason(e.target.value)}
              disabled={saving || disabled}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          )}
          {!phenotyperChosen && (
            <p
              className="text-red-600"
              data-testid="wave-dates-needs-phenotyper"
            >
              Choose the phenotyper first.
            </p>
          )}
          {saveError && <p className="text-red-600">{saveError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              className="px-3 py-1.5 rounded-md bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50"
              data-testid="wave-dates-edit-save"
            >
              {check?.conflict ? 'Proceed with these dates' : 'Save dates'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
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
