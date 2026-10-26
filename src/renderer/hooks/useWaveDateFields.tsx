/**
 * Capture Scan's germination-date fields (#407): the box under the wave number, the
 * note under the plant age, the age they put in the form, and whether Start Scan
 * has to wait for them.
 *
 * For each scan either the wave's germination date (entered wrongly) or the plant's age
 * (accessions sown on different dates) can be changed, not both.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useWaveDates, type UseWaveDatesResult } from './useWaveDates';
import { usePhenotyperName } from './usePhenotyperName';
import { WaveDatesPanel } from '../components/WaveDatesPanel';
import { WaveDatesInfo } from '../components/WaveDatesInfo';
import { PlantAgeNote } from '../components/PlantAgeNote';
import { WaveDatesLoadError } from '../components/WaveDatesLoadError';

const ONE_CHANGE_AGE_CHANGED =
  "The age was changed for this scan. To edit the wave's dates instead, click Use calculated age.";
const FINISH_AGE_CHANGE = 'Finish or cancel the age change first.';
const ONE_CHANGE_DATE_CHANGED =
  "The wave's dates were changed, so the age was recalculated. The age can be changed on the next scan.";
const FINISH_DATE_CHANGE =
  "Finish or cancel the change to the wave's dates first.";

export interface WaveDateFieldsInput {
  experimentId: string;
  waveNumber: string;
  plantQrCode: string;
  phenotyper: string;
}

export interface WaveDateFields {
  waveDates: UseWaveDatesResult;
  /** Start Scan has to wait: dates loading or unreadable, a missing date, an open box. */
  holdsStartScan: boolean;
  /** What to tell the operator about that hold, if anything. */
  startScanHold: string | null;
  waveNote: ReactNode;
  plantAgeNote: ReactNode;
}

export function useWaveDateFields(
  metadata: WaveDateFieldsInput,
  /** Puts the age to use in the form; '' for a wave without a germination date. */
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
  // An open Change age or Edit box must be finished or cancelled before scanning,
  // so what the form shows is what the scan saves.
  const [ageBoxOpen, setAgeBoxOpen] = useState(false);
  const [dateBoxOpen, setDateBoxOpen] = useState(false);

  const setAgeRef = useRef(setPlantAgeDays);
  setAgeRef.current = setPlantAgeDays;
  const { ageToUse, needsWaveDates } = waveDates;
  useEffect(() => {
    // A wave without a germination date has no age yet: don't show a previous one.
    if (ageToUse !== null) setAgeRef.current(String(ageToUse));
    else if (needsWaveDates) setAgeRef.current('');
  }, [ageToUse, needsWaveDates]);

  const holdsStartScan =
    waveDates.loading ||
    waveDates.loadError !== null ||
    waveDates.needsWaveDates ||
    ageBoxOpen ||
    dateBoxOpen;
  const startScanHold = waveDates.loadError
    ? 'Restart Bloom Desktop to start the scan'
    : waveDates.needsWaveDates
      ? `Save wave ${waveDates.waveNumber}'s dates above to start the scan`
      : isScanning
        ? null
        : ageBoxOpen
          ? 'Use the new age or cancel the age change above to start the scan'
          : dateBoxOpen
            ? "Save or cancel the change to the wave's dates above to start the scan"
            : null;

  const waveNote = waveDates.loadError ? (
    <WaveDatesLoadError error={waveDates.loadError} />
  ) : waveDates.needsWaveDates && waveDates.waveNumber !== null ? (
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
    <WaveDatesInfo
      key={waveDates.wave.id}
      wave={waveDates.wave}
      waves={waveDates.waves}
      onChangeDate={waveDates.changeDate}
      phenotyperChosen={metadata.phenotyper !== ''}
      onOpenChange={setDateBoxOpen}
      lockedMessage={
        waveDates.change
          ? ONE_CHANGE_AGE_CHANGED
          : ageBoxOpen
            ? FINISH_AGE_CHANGE
            : null
      }
      disabled={isScanning}
    />
  ) : undefined;

  const plantAgeNote =
    waveDates.wave && waveDates.calculatedAge !== null ? (
      <PlantAgeNote
        // A new plant, wave, experiment or phenotyper starts with the box
        // closed and empty: a half-typed age never carries over.
        key={[
          metadata.experimentId,
          waveDates.wave.id,
          metadata.plantQrCode,
          metadata.phenotyper,
        ].join('|')}
        wave={waveDates.wave}
        calculatedAge={waveDates.calculatedAge}
        change={waveDates.change}
        onChange={waveDates.setChange}
        phenotyperName={phenotyperName ?? undefined}
        onOpenChange={setAgeBoxOpen}
        lockedMessage={
          waveDates.dateChanged
            ? ONE_CHANGE_DATE_CHANGED
            : dateBoxOpen
              ? FINISH_DATE_CHANGE
              : null
        }
        disabled={isScanning}
      />
    ) : undefined;

  return { waveDates, holdsStartScan, startScanHold, waveNote, plantAgeNote };
}
