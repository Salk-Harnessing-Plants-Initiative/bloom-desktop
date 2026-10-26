/**
 * The entered plant's dates on Capture Scan, under the plant age (#428). The age is
 * computed from the plant's germination date. A plant uses its wave's dates unless it
 * has its own: "Different dates for this plant" sets them, with a reason, and they're
 * used for every later scan of the plant. In a wave whose dates are per plant, each
 * plant's are asked for before its first scan, starting from the previous plant's.
 */

import { useEffect, useState } from 'react';
import {
  MAX_REASON_LENGTH,
  formatDays,
  plantAgeDays,
  storedWaveDates,
  waveDatesError,
  type WaveDates,
} from '../../utils/wave-dates';
import type {
  CylinderPlantDatesInput,
  CylinderPlantInfo,
  CylinderWaveInfo,
} from '../../types/cylinder-wave';
import type { DatabaseResponse } from '../../types/database';
import type { PlantDates } from '../hooks/useWaveDates';
import {
  WaveDateInputs,
  enteredDates,
  transferMissing,
} from './WaveDateInputs';
import { PlantDatesSummary } from './PlantDatesSummary';

export interface PlantDatesSectionProps {
  plantBarcode: string;
  wave: CylinderWaveInfo;
  plant: CylinderPlantInfo | null;
  /** The dates the age comes from: the plant's own, or else the wave's. */
  plantDates: PlantDates | null;
  /** The previous plant's dates, to start a new plant's with (per-plant waves). */
  previousPlantDates: PlantDates | null;
  onSave: (
    input: Omit<
      CylinderPlantDatesInput,
      'waveId' | 'plantBarcode' | 'phenotyperId'
    >
  ) => Promise<DatabaseResponse<unknown>>;
  onUseWaveDates: (reason?: string) => Promise<DatabaseResponse<unknown>>;
  phenotyperChosen: boolean;
  /** Told when the editor opens or closes, so Start Scan can wait for it. */
  onOpenChange?: (open: boolean) => void;
  /** Told the germination date being entered, when the dates are valid (to preview the age). */
  onDraftGermination?: (germination: string | null) => void;
  disabled?: boolean;
}

const EMPTY: WaveDates = { germination: '', sowing: '', transfer: '' };
export function PlantDatesSection({
  plantBarcode,
  wave,
  plant,
  plantDates,
  previousPlantDates,
  onSave,
  onUseWaveDates,
  phenotyperChosen,
  onOpenChange,
  onDraftGermination,
  disabled = false,
}: PlantDatesSectionProps) {
  const perPlant = wave.dates_per_plant;
  const ownDates = plant !== null && !plant.uses_wave_dates;
  const needsDates = perPlant && plant === null;
  const start = plantDates ?? (needsDates ? previousPlantDates : null);
  const startDates = start ? storedWaveDates(start) : EMPTY;

  const [editing, setEditing] = useState(needsDates);
  const [dates, setDates] = useState<WaveDates>(startDates);
  const [transferSameDay, setTransferSameDay] = useState(!startDates.transfer);
  const [reason, setReason] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    onOpenChange?.(editing);
  }, [editing, onOpenChange]);
  useEffect(() => () => onOpenChange?.(false), [onOpenChange]);

  const entered = enteredDates(dates, transferSameDay);
  const unchanged =
    start !== null &&
    !needsDates &&
    entered.germination === startDates.germination &&
    entered.sowing === startDates.sowing &&
    entered.transfer === startDates.transfer;
  const touched = Boolean(entered.germination || entered.sowing);
  const datesError = touched ? waveDatesError(entered, new Date()) : null;
  // Differing from the wave, or changing dates the plant was scanned with, needs a reason.
  const reasonNeeded = !perPlant || (plant?.scanCount ?? 0) > 0;
  const draft =
    editing &&
    touched &&
    !datesError &&
    !transferMissing(dates, transferSameDay)
      ? entered.germination
      : null;
  useEffect(() => {
    onDraftGermination?.(draft);
  }, [draft, onDraftGermination]);
  useEffect(() => () => onDraftGermination?.(null), [onDraftGermination]);
  // The dates can be entered before the barcode, but are saved for a barcode.
  const needsBarcode = plantBarcode === '';
  const canSave =
    !disabled &&
    !saving &&
    !needsBarcode &&
    phenotyperChosen &&
    touched &&
    !datesError &&
    !unchanged &&
    !transferMissing(dates, transferSameDay) &&
    (!reasonNeeded || reason.trim() !== '');

  const open = () => {
    setDates(startDates);
    setTransferSameDay(!startDates.transfer);
    setReason('');
    setSaveError(null);
    setEditing(true);
  };
  const run = async (action: () => Promise<DatabaseResponse<unknown>>) => {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await action();
      if (result.success) setEditing(false);
      else setSaveError(result.error ?? "Could not save the plant's dates.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };
  const save = () =>
    run(() =>
      onSave({
        germinationDate: entered.germination,
        sowingDate: entered.sowing,
        transferDate: entered.transfer || undefined,
        reason: reason.trim() || undefined,
      })
    );

  return (
    <div
      className="mt-1 space-y-0.5 text-sm text-gray-600"
      data-testid="plant-dates"
    >
      {!editing && plantDates && (
        <PlantDatesSummary
          plantBarcode={plantBarcode}
          waveNumber={wave.wave_number}
          plant={plant}
          plantDates={plantDates}
          ownDates={ownDates || perPlant}
          canUseWaveDates={ownDates && !perPlant}
          onEdit={open}
          onUseWaveDates={() => run(() => onUseWaveDates())}
          disabled={disabled || saving}
        />
      )}

      {editing && (
        <div
          className={
            perPlant
              ? 'mt-4 space-y-2'
              : 'mt-2 bg-white border-2 border-green-600 rounded-lg p-3 space-y-2'
          }
          data-testid="plant-dates-box"
        >
          {/* In a per-plant wave the dates are part of the form, under the wave. */}
          {!perPlant && (
            <p className="font-medium text-green-800">
              Dates for plant {plantBarcode}
            </p>
          )}
          <WaveDateInputs
            variant={perPlant ? 'form' : 'box'}
            dates={dates}
            transferSameDay={transferSameDay}
            onChange={(next, sameDay) => {
              setDates(next);
              setTransferSameDay(sameDay);
            }}
            disabled={saving || disabled}
          />
          {datesError && <p className="text-red-600">{datesError}</p>}
          {draft && (
            <p className="text-sm text-gray-700" data-testid="plant-dates-age">
              <span className="font-semibold text-green-800">Plant age:</span>{' '}
              {formatDays(plantAgeDays(draft, new Date()))} (from the
              germination date)
            </p>
          )}
          {reasonNeeded && (
            <textarea
              aria-label="Reason"
              placeholder={
                perPlant
                  ? 'Reason for the change (required)'
                  : "Why this plant's dates differ from the wave's (required)"
              }
              value={reason}
              maxLength={MAX_REASON_LENGTH}
              onChange={(e) => setReason(e.target.value)}
              disabled={saving || disabled}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              data-testid="plant-dates-reason"
            />
          )}
          {needsBarcode && (
            <p
              className="text-gray-700"
              data-testid="plant-dates-needs-barcode"
            >
              Enter the plant barcode below, then save.
            </p>
          )}
          {!phenotyperChosen && (
            <p className="text-red-600">Choose the phenotyper first.</p>
          )}
          {saveError && <p className="text-red-600">{saveError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              className="px-3 py-1.5 rounded-md bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50"
              data-testid="plant-dates-save"
            >
              Save plant&apos;s dates
            </button>
            {!needsDates && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={disabled}
                className="px-3 py-1.5 rounded-md border border-gray-300 disabled:opacity-50"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
