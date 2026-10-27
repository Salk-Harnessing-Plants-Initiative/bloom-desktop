/**
 * Capture Scan's date fields (#407, #428): the wave's dates under the wave number, the
 * plant's dates under the plant age, the age they put in the form (days since the
 * plant's germination date), and whether Start Scan has to wait for them.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  useWaveDates,
  type PlantDates,
  type UseWaveDatesResult,
} from './useWaveDates';
import { usePhenotyperName } from './usePhenotyperName';
import { WaveDatesPanel } from '../components/WaveDatesPanel';
import { WaveDatesInfo } from '../components/WaveDatesInfo';
import {
  PlantDatesSection,
  type PlantDatesDraft,
} from '../components/PlantDatesSection';
import { WaveDatesLoadError } from '../components/WaveDatesLoadError';
import { plantAgeDays } from '../../utils/wave-dates';

export interface WaveDateFieldsInput {
  experimentId: string;
  waveNumber: string;
  plantQrCode: string;
  phenotyper: string;
}

export interface WaveDateFields {
  waveDates: UseWaveDatesResult;
  /** Start Scan has to wait: dates loading or unreadable, missing dates, an open box. */
  holdsStartScan: boolean;
  /** What to tell the operator about that hold, if anything. */
  startScanHold: string | null;
  waveNote: ReactNode;
  plantAgeNote: ReactNode;
  /**
   * Called as the scan starts: saves the plant's dates entered in a per-plant wave, and
   * gives the dates the scan's age comes from. Throws when they can't be saved.
   */
  savePlantDatesForScan: () => Promise<PlantDates | null>;
}

export function useWaveDateFields(
  metadata: WaveDateFieldsInput,
  /** Puts the age in the form; '' while the plant has no dates. */
  setPlantAgeDays: (age: string) => void,
  isScanning: boolean
): WaveDateFields {
  const waveDates = useWaveDates(
    metadata.experimentId,
    metadata.waveNumber,
    metadata.plantQrCode,
    metadata.phenotyper
  );
  const phenotyperName = usePhenotyperName(metadata.phenotyper);
  // An open box must be saved or cancelled before scanning, so what the form shows
  // is what the scan saves.
  const [waveBoxOpen, setWaveBoxOpen] = useState(false);
  const [plantBoxOpen, setPlantBoxOpen] = useState(false);
  // The germination date being entered (a new plant's, or a correction), to preview its age.
  const [draftGermination, setDraftGermination] = useState<string | null>(null);
  // A per-plant wave's plant dates as entered, saved when the scan starts.
  const [pendingDates, setPendingDates] = useState<PlantDatesDraft | null>(
    null
  );

  const setAgeRef = useRef(setPlantAgeDays);
  setAgeRef.current = setPlantAgeDays;
  const { calculatedAge, needsWaveDates, needsPlantDates } = waveDates;
  const perPlant = Boolean(waveDates.wave?.dates_per_plant);
  const previewAge = draftGermination
    ? plantAgeDays(draftGermination, new Date())
    : null;
  useEffect(() => {
    // While a plant's dates are being entered or corrected, the age they give is
    // shown (and checked for a duplicate scan), not the age from its saved dates.
    // Without the plant's dates there's no age yet (including a per-plant wave before
    // its dates are entered): don't show a previous one.
    if (previewAge !== null) setAgeRef.current(String(previewAge));
    else if (calculatedAge !== null) setAgeRef.current(String(calculatedAge));
    else if (needsWaveDates || needsPlantDates || perPlant) {
      setAgeRef.current('');
    }
  }, [calculatedAge, previewAge, needsWaveDates, needsPlantDates, perPlant]);

  const barcode = metadata.plantQrCode.trim();
  const holdsStartScan =
    waveDates.loading ||
    waveDates.loadError !== null ||
    needsWaveDates ||
    (needsPlantDates && pendingDates === null) ||
    waveBoxOpen ||
    plantBoxOpen;
  const startScanHold = waveDates.loadError
    ? 'Restart Bloom Desktop to start the scan'
    : needsWaveDates
      ? `Save wave ${waveDates.waveNumber}'s dates above to start the scan`
      : needsPlantDates && pendingDates === null
        ? `Enter plant ${barcode}'s dates above to start the scan`
        : isScanning
          ? null
          : waveBoxOpen
            ? "Save or cancel the change to the wave's dates above to start the scan"
            : plantBoxOpen && perPlant
              ? "Finish or cancel the change to the plant's dates above to start the scan"
              : plantBoxOpen
                ? "Save or cancel the plant's dates above to start the scan"
                : null;

  const { savePlantDates, plantDates } = waveDates;
  const savePlantDatesForScan = useCallback(async () => {
    if (!pendingDates) return plantDates;
    const result = await savePlantDates(pendingDates);
    if (!result.success) {
      throw new Error(result.error ?? "Could not save the plant's dates.");
    }
    return {
      germination_date: pendingDates.germinationDate,
      sowing_date: pendingDates.sowingDate,
      transfer_date: pendingDates.transferDate ?? null,
      germ_day_color: pendingDates.germDayColor ?? null,
    };
  }, [pendingDates, plantDates, savePlantDates]);

  const plantSection =
    waveDates.wave && !waveDates.loading && (barcode || perPlant) ? (
      <PlantDatesSection
        // A new plant, wave or experiment starts afresh. In a per-plant wave, a plant
        // without dates yet keeps what's been entered while its barcode is typed.
        key={[
          metadata.experimentId,
          waveDates.wave.id,
          perPlant && !waveDates.plant ? 'new plant' : barcode,
        ].join('|')}
        plantBarcode={barcode}
        wave={waveDates.wave}
        plant={waveDates.plant}
        plantDates={waveDates.plantDates}
        onSave={waveDates.savePlantDates}
        onUseWaveDates={waveDates.usePlantWaveDates}
        phenotyperChosen={metadata.phenotyper !== ''}
        onOpenChange={setPlantBoxOpen}
        onDraftGermination={setDraftGermination}
        onPendingDates={setPendingDates}
        disabled={isScanning}
      />
    ) : undefined;
  const waveNote = waveDates.loadError ? (
    <WaveDatesLoadError error={waveDates.loadError} />
  ) : needsWaveDates && waveDates.waveNumber !== null ? (
    <WaveDatesPanel
      key={`${metadata.experimentId}-${waveDates.waveNumber}`}
      waveNumber={waveDates.waveNumber}
      waves={waveDates.waves}
      phenotyperId={metadata.phenotyper}
      phenotyperName={phenotyperName}
      onSave={waveDates.saveWave}
      disabled={isScanning}
    />
  ) : waveDates.wave ? (
    <>
      <WaveDatesInfo
        key={waveDates.wave.id}
        wave={waveDates.wave}
        waves={waveDates.waves}
        onChangeDate={waveDates.changeDate}
        phenotyperChosen={metadata.phenotyper !== ''}
        onOpenChange={setWaveBoxOpen}
        plants={waveDates.plants}
        canUseSameDates={waveDates.canUseSameDates}
        sharedPlantDates={waveDates.sharedPlantDates}
        onUseSameDates={waveDates.useSameDates}
        onUseDatesPerPlant={waveDates.useDatesPerPlant}
        disabled={isScanning}
      />
      {perPlant && plantSection}
    </>
  ) : undefined;

  // In a per-plant wave the plant's dates come first, under the wave; otherwise the
  // plant's line goes under its age.
  const plantAgeNote = perPlant ? undefined : plantSection;

  return {
    waveDates,
    holdsStartScan,
    startScanHold,
    waveNote,
    plantAgeNote,
    savePlantDatesForScan,
  };
}
