/**
 * A wave's Edit box on Capture Scan (#407, #428): how its dates are set (wave-level,
 * the same for all plants, or plant-level) and, for wave-level, the dates themselves,
 * filled in with the ones set before. The same rules as the main process:
 * - the wave's dates can only change before its first scan (after it they're final, and
 *   a mistake is corrected with the Bloom team);
 * - going per plant is always allowed: plants already scanned keep their dates;
 * - going back to the same dates for all plants is allowed before the wave's first
 *   scan, or after it only with the dates all its plants share.
 */

import { useState } from 'react';
import {
  MAX_REASON_LENGTH,
  checkNewWave,
  checkWaveDateChange,
  scannedWaveError,
  storedWaveDates,
  type WaveDates,
  type WaveGerminationDate,
} from '../../utils/wave-dates';
import type {
  CylinderPlantInfo,
  CylinderWaveDateChangeInput,
  CylinderWaveInfo,
  CylinderWaveSameDatesInput,
} from '../../types/cylinder-wave';
import type { DatabaseResponse } from '../../types/database';
import type { PlantDates } from '../hooks/useWaveDates';
import {
  DatesModeChoice,
  PerPlantDatesNote,
  type DatesMode,
} from './DatesModeChoice';
import { WaveOrderWarning } from './WaveOrderWarning';
import {
  WaveDateInputs,
  enteredDates,
  transferMissing,
} from './WaveDateInputs';

type DateInput = Omit<CylinderWaveDateChangeInput, 'waveId' | 'phenotyperId'>;

export interface WaveDatesEditBoxProps {
  wave: CylinderWaveInfo;
  /** The experiment's other waves, to check the germination date against. */
  otherWaves: WaveGerminationDate[];
  /** The wave's plants with rows, most recently changed first. */
  plants: CylinderPlantInfo[];
  /** A per-plant wave can go back to the same dates for all plants. */
  canUseSameDates: boolean;
  /** The dates the wave's plants share, if they do. */
  sharedPlantDates: PlantDates | null;
  onChangeDate: (change: DateInput) => Promise<DatabaseResponse<unknown>>;
  onUseSameDates: (
    input: Omit<CylinderWaveSameDatesInput, 'waveId' | 'phenotyperId'>
  ) => Promise<DatabaseResponse<unknown>>;
  onUseDatesPerPlant: (reason?: string) => Promise<DatabaseResponse<unknown>>;
  onClose: () => void;
  phenotyperChosen: boolean;
  disabled?: boolean;
}

const EMPTY: WaveDates = { germination: '', sowing: '', transfer: '' };

export function WaveDatesEditBox({
  wave,
  otherWaves,
  plants,
  canUseSameDates,
  sharedPlantDates,
  onChangeDate,
  onUseSameDates,
  onUseDatesPerPlant,
  onClose,
  phenotyperChosen,
  disabled = false,
}: WaveDatesEditBoxProps) {
  const wasPerPlant = wave.dates_per_plant;
  const saved = wasPerPlant ? EMPTY : storedWaveDates(wave);
  // Filled in with the dates set before: the wave's, or the ones its plants share,
  // or else the most recently set plant's.
  const previous = sharedPlantDates ?? plants[0] ?? null;
  const start = wasPerPlant
    ? previous
      ? storedWaveDates(previous)
      : EMPTY
    : saved;

  const [mode, setMode] = useState<DatesMode>(
    wasPerPlant ? 'perPlant' : 'same'
  );
  const [dates, setDates] = useState<WaveDates>(start);
  const [transferSameDay, setTransferSameDay] = useState(!start.transfer);
  const [reason, setReason] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const editingDates = !wasPerPlant && mode === 'same';
  const toSame = wasPerPlant && mode === 'same';
  const toPerPlant = !wasPerPlant && mode === 'perPlant';
  // After scans, a per-plant wave can only take the dates its plants share, and a
  // wave's own dates can't change.
  // Only scans taken with the wave's dates count (not ones from before they were set).
  const sameLocked = toSame && wave.datedScanCount > 0;
  const datesLocked = editingDates && wave.datedScanCount > 0;
  const entered = enteredDates(dates, transferSameDay);
  const today = new Date();

  const changeCheck =
    editingDates &&
    (entered.germination !== saved.germination ||
      entered.sowing !== saved.sowing ||
      entered.transfer !== saved.transfer)
      ? checkWaveDateChange(
          {
            waveNumber: wave.wave_number,
            current: saved,
            next: entered,
            reason,
            waveHasScans: wave.datedScanCount > 0,
          },
          otherWaves,
          today
        )
      : null;
  const sameCheck =
    toSame && (entered.germination || entered.sowing)
      ? checkNewWave(wave.wave_number, entered, otherWaves, today)
      : null;
  const error = changeCheck?.error ?? sameCheck?.error ?? null;
  const warning = changeCheck?.conflict ?? sameCheck?.dateWarning ?? null;
  const reasonNeeded = (editingDates || toSame) && warning !== null;
  const datesReady =
    !transferMissing(dates, transferSameDay) &&
    (!reasonNeeded || reason.trim() !== '');
  const canSave =
    !disabled &&
    !saving &&
    phenotyperChosen &&
    (toPerPlant ||
      (editingDates &&
        changeCheck !== null &&
        !changeCheck.saveError &&
        datesReady) ||
      (toSame && sameCheck !== null && !sameCheck.error && datesReady));

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    const input = {
      germinationDate: entered.germination,
      sowingDate: entered.sowing,
      transferDate: entered.transfer || undefined,
      reason: reason.trim() || undefined,
    };
    try {
      const result = toPerPlant
        ? await onUseDatesPerPlant(reason.trim() || undefined)
        : toSame
          ? await onUseSameDates(input)
          : await onChangeDate(input);
      if (result.success) onClose();
      else setSaveError(result.error ?? "Could not save the wave's dates.");
    } catch (thrown) {
      setSaveError(thrown instanceof Error ? thrown.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="mt-2 bg-white border-2 border-green-600 rounded-lg p-3 space-y-2"
      data-testid="wave-dates-edit-box"
    >
      <DatesModeChoice
        waveNumber={wave.wave_number}
        value={mode}
        onChange={setMode}
        sameUnavailable={
          wasPerPlant && !canUseSameDates
            ? "This wave's plants were scanned with different dates."
            : null
        }
        disabled={saving || disabled}
      >
        {sameLocked && (
          <p className="text-gray-700" data-testid="same-dates-locked">
            This wave has scans, so it can only use the dates its plants were
            scanned with.
          </p>
        )}
        <WaveDateInputs
          dates={dates}
          transferSameDay={transferSameDay}
          onChange={(next, sameDay) => {
            setDates(next);
            setTransferSameDay(sameDay);
          }}
          disabled={sameLocked || datesLocked || saving || disabled}
        />
        {datesLocked && (
          <p
            className="text-amber-800"
            data-testid="wave-dates-edit-scans-warning"
          >
            {scannedWaveError(wave.wave_number)} If they&apos;re wrong, contact
            the Bloom team.
          </p>
        )}
        {error && <p className="text-red-600">{error}</p>}
        {warning && (
          <WaveOrderWarning
            waveNumber={wave.wave_number}
            sowing={entered.sowing}
            germination={entered.germination}
            warning={warning}
            otherWaves={otherWaves}
          >
            <p>If these are right, give a reason to proceed.</p>
          </WaveOrderWarning>
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
      </DatesModeChoice>

      {mode === 'perPlant' && (
        <PerPlantDatesNote plants={plants} switching={toPerPlant} />
      )}

      {!phenotyperChosen && (
        <p className="text-red-600" data-testid="wave-dates-needs-phenotyper">
          Choose the phenotyper first.
        </p>
      )}
      {saveError && <p className="text-red-600">{saveError}</p>}
      <div className="flex gap-2">
        {!(wasPerPlant && mode === 'perPlant') && !datesLocked && (
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="px-3 py-1.5 rounded-md bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50"
            data-testid="wave-dates-edit-save"
          >
            {toPerPlant
              ? 'Switch to plant-level'
              : toSame
                ? 'Switch to wave-level'
                : warning
                  ? 'Proceed with these dates'
                  : 'Save dates'}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          disabled={disabled}
          className="px-3 py-1.5 rounded-md border border-gray-300 disabled:opacity-50"
        >
          {(wasPerPlant && mode === 'perPlant') || datesLocked
            ? 'Close'
            : 'Cancel'}
        </button>
      </div>
    </div>
  );
}
