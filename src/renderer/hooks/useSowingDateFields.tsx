/**
 * Capture Scan's sowing-date fields (#407): the box under the wave number, the
 * note under the plant age, the age they put in the form, and whether Start Scan
 * has to wait for them.
 *
 * For each scan either the wave's sowing date (entered wrongly) or the plant's age
 * (accessions sown on different dates) can be changed, not both.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  useWaveSowingDate,
  type UseWaveSowingDateResult,
} from './useWaveSowingDate';
import { usePhenotyperName } from './usePhenotyperName';
import { WaveSowingDatePanel } from '../components/WaveSowingDatePanel';
import { WaveSowingDateInfo } from '../components/WaveSowingDateInfo';
import { PlantAgeNote } from '../components/PlantAgeNote';
import { SowingDateLoadError } from '../components/SowingDateLoadError';

const ONE_CHANGE_AGE_CHANGED =
  'The age was changed for this scan. To edit the start date instead, click Use calculated age.';
const FINISH_AGE_CHANGE = 'Finish or cancel the age change first.';
const ONE_CHANGE_DATE_CHANGED =
  'The start date was changed, so the age was recalculated. The age can be changed on the next scan.';
const FINISH_DATE_CHANGE = 'Finish or cancel the start date change first.';

export interface SowingDateFieldsInput {
  experimentId: string;
  waveNumber: string;
  plantQrCode: string;
  phenotyper: string;
}

export interface SowingDateFields {
  sowing: UseWaveSowingDateResult;
  /** Start Scan has to wait: dates loading or unreadable, a missing date, an open box. */
  holdsStartScan: boolean;
  /** What to tell the operator about that hold, if anything. */
  startScanHold: string | null;
  waveNote: ReactNode;
  plantAgeNote: ReactNode;
}

export function useSowingDateFields(
  metadata: SowingDateFieldsInput,
  /** Puts the age to use in the form; '' for a wave without a sowing date. */
  setPlantAgeDays: (age: string) => void,
  isScanning: boolean
): SowingDateFields {
  const sowing = useWaveSowingDate(
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
  const { ageToUse, needsSowingDate } = sowing;
  useEffect(() => {
    // A wave without a sowing date has no age yet: don't show a previous one.
    if (ageToUse !== null) setAgeRef.current(String(ageToUse));
    else if (needsSowingDate) setAgeRef.current('');
  }, [ageToUse, needsSowingDate]);

  const holdsStartScan =
    sowing.loading ||
    sowing.loadError !== null ||
    sowing.needsSowingDate ||
    ageBoxOpen ||
    dateBoxOpen;
  const startScanHold = sowing.loadError
    ? 'Restart Bloom Desktop to start the scan'
    : sowing.needsSowingDate
      ? `Save wave ${sowing.waveNumber}'s start date above to start the scan`
      : isScanning
        ? null
        : ageBoxOpen
          ? 'Use the new age or cancel the age change above to start the scan'
          : dateBoxOpen
            ? 'Save or cancel the start date change above to start the scan'
            : null;

  const waveNote = sowing.loadError ? (
    <SowingDateLoadError error={sowing.loadError} />
  ) : sowing.needsSowingDate && sowing.waveNumber !== null ? (
    <WaveSowingDatePanel
      key={`${metadata.experimentId}-${sowing.waveNumber}`}
      waveNumber={sowing.waveNumber}
      waves={sowing.waves}
      phenotyperId={metadata.phenotyper}
      earlier={sowing.earlier}
      onSave={sowing.saveWave}
      disabled={isScanning}
    />
  ) : sowing.wave ? (
    <WaveSowingDateInfo
      key={sowing.wave.id}
      wave={sowing.wave}
      waves={sowing.waves}
      onChangeDate={sowing.changeDate}
      phenotyperChosen={metadata.phenotyper !== ''}
      onOpenChange={setDateBoxOpen}
      lockedMessage={
        sowing.change
          ? ONE_CHANGE_AGE_CHANGED
          : ageBoxOpen
            ? FINISH_AGE_CHANGE
            : null
      }
      disabled={isScanning}
    />
  ) : undefined;

  const plantAgeNote =
    sowing.wave && sowing.calculatedAge !== null ? (
      <PlantAgeNote
        // A new plant, wave, experiment or phenotyper starts with the box
        // closed and empty: a half-typed age never carries over.
        key={[
          metadata.experimentId,
          sowing.wave.id,
          metadata.plantQrCode,
          metadata.phenotyper,
        ].join('|')}
        wave={sowing.wave}
        calculatedAge={sowing.calculatedAge}
        change={sowing.change}
        onChange={sowing.setChange}
        phenotyperName={phenotyperName ?? undefined}
        onOpenChange={setAgeBoxOpen}
        lockedMessage={
          sowing.dateChanged
            ? ONE_CHANGE_DATE_CHANGED
            : dateBoxOpen
              ? FINISH_DATE_CHANGE
              : null
        }
        disabled={isScanning}
      />
    ) : undefined;

  return { sowing, holdsStartScan, startScanHold, waveNote, plantAgeNote };
}
