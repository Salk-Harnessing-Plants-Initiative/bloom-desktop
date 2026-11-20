/**
 * GraviScan session folder and image file names, exactly as the GraviScan
 * rig writes them, so files from the rig and from this app read the same
 * and existing analysis keeps working.
 *
 *   folder: {exp}_wave{N}_{YYYYMMDDTHHMMSS}/
 *   file:   {exp}_wave{N}_st_{time}_et_{time}_cy{N}_{system}_Sc{K}_{plate}.tif
 *
 * As on the rig, the scan worker builds the file name from its parts when it
 * saves (`compose_output_path()` in scan_worker.py), adding `_et_`; nothing
 * rewrites a name. These functions prepare and check the parts, and give the
 * planned name without `_et_` for job tracking and log messages. All times
 * are UTC.
 */

import * as path from 'path';
import type { PlateConfig } from '../../types/graviscan';
import { sanitizeExpName } from '../../utils/graviscan-exp-name';

export { sanitizeExpName };

/** Extension of every GraviScan session image. */
export const SCAN_FILE_EXTENSION = '.tif';

const TIMESTAMP_PATTERN = /^\d{8}T\d{6}$/;
const PLATE_INDEX_PATTERN = /^\d{2}$/;

/**
 * `_st_<time>` followed by an optional `_et_<time>` and then `_cy<N>_`. It
 * cannot occur inside the experiment part: that is at most 20 characters and
 * is followed by `_wave`.
 */
const ST_CYCLE_PATTERN = /_st_(\d{8}T\d{6})((?:_et_\d{8}T\d{6})?)_cy(\d+)_/;

export interface SessionDirNameParts {
  expName: string | null | undefined;
  waveNumber: number;
  startedAt: Date;
}

export interface ScanFileNameParts {
  expName: string | null | undefined;
  waveNumber: number;
  /** Grid start, `YYYYMMDDTHHMMSS` UTC (see `formatScanTimestamp`). */
  stTimestamp: string;
  cycle: number;
  /** `GRAVISCAN_SYSTEM_NAME`; the part is left out when empty. */
  systemName?: string | null;
  /** 0-based position of the scanner in the session's scanner list. */
  scannerIndex: number;
  /** Grid position as row and column digits: `00`, `01`, `10`, `11`. */
  plateIndex: string;
}

/** `YYYYMMDDTHHMMSS` in UTC. */
export function formatScanTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').slice(0, 15);
}

/** `Sc{K}`, K = 1-based position of the scanner in the session. */
export function buildScannerTag(scannerIndex: number): string {
  if (!Number.isInteger(scannerIndex) || scannerIndex < 0) {
    throw new Error(`Invalid scanner position: ${scannerIndex}`);
  }
  return `Sc${scannerIndex + 1}`;
}

function assertWaveNumber(waveNumber: number): void {
  if (!Number.isInteger(waveNumber) || waveNumber < 0) {
    throw new Error(`Invalid wave number: ${waveNumber}`);
  }
}

/** Session folder name, a single path segment: `{exp}_wave{N}_{UTC time}`. */
export function buildSessionDirName(parts: SessionDirNameParts): string {
  assertWaveNumber(parts.waveNumber);
  return (
    `${sanitizeExpName(parts.expName)}_wave${parts.waveNumber}` +
    `_${formatScanTimestamp(parts.startedAt)}`
  );
}

/**
 * `GRAVISCAN_SYSTEM_NAME` as it may appear in file names: letters, digits,
 * `-` and `_`, up to 32 characters (e.g. `graviscan-desktop`).
 */
const SYSTEM_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** `{system}_`, or empty when no system name is set (rig rule). */
export function buildSystemPrefix(
  systemName: string | null | undefined
): string {
  if (!systemName) return '';
  if (!SYSTEM_NAME_PATTERN.test(systemName)) {
    throw new Error(
      `GRAVISCAN_SYSTEM_NAME in ~/.bloom/.env ("${systemName}") can only use ` +
        `letters, digits, - and _ (up to 32 characters), because it goes into ` +
        `every scan's file name. Change it there and restart the app.`
    );
  }
  return `${systemName}_`;
}

/** Name parts as the worker receives them (rig field names). */
export interface PreparedNameParts {
  /** Cleaned experiment name, as in the file name. */
  exp_name: string;
  wave_number: number;
  st_timestamp: string;
  cycle: number;
  system_prefix: string;
  scanner_tag: string;
  plate_index: string;
}

/**
 * Planned file name from prepared parts, without `_et_` (only the worker
 * knows the save time). Mirrors the worker's `compose_output_path()`.
 */
export function composeScanFileName(parts: PreparedNameParts): string {
  return (
    `${parts.exp_name}_wave${parts.wave_number}` +
    `_st_${parts.st_timestamp}_cy${parts.cycle}` +
    `_${parts.system_prefix}${parts.scanner_tag}` +
    `_${parts.plate_index}${SCAN_FILE_EXTENSION}`
  );
}

/** Planned image file name (without `_et_`), with every part checked. */
export function buildScanFileName(parts: ScanFileNameParts): string {
  assertWaveNumber(parts.waveNumber);
  if (!TIMESTAMP_PATTERN.test(parts.stTimestamp)) {
    throw new Error(`Invalid start time: ${parts.stTimestamp}`);
  }
  if (!Number.isInteger(parts.cycle) || parts.cycle < 1) {
    throw new Error(`Invalid cycle: ${parts.cycle}`);
  }
  if (!PLATE_INDEX_PATTERN.test(parts.plateIndex)) {
    throw new Error(`Invalid plate index: ${parts.plateIndex}`);
  }
  return composeScanFileName({
    exp_name: sanitizeExpName(parts.expName),
    wave_number: parts.waveNumber,
    st_timestamp: parts.stTimestamp,
    cycle: parts.cycle,
    system_prefix: buildSystemPrefix(parts.systemName),
    scanner_tag: buildScannerTag(parts.scannerIndex),
    plate_index: parts.plateIndex,
  });
}

/** Cycle of a rig-style name (before or after `_et_`), or null. */
export function readCycleFromScanFileName(fileName: string): number | null {
  return readStAndCycleFromScanFileName(fileName)?.cycle ?? null;
}

/** `_st_` time and cycle of a rig-style name (before or after `_et_`), or null. */
export function readStAndCycleFromScanFileName(
  fileName: string
): { stTimestamp: string; cycle: number } | null {
  const m = ST_CYCLE_PATTERN.exec(fileName);
  return m ? { stTimestamp: m[1], cycle: Number(m[3]) } : null;
}

/**
 * Where a plate's image is planned to be saved: the name built from its
 * parts, without `_et_` (the worker adds it when it saves). Used for job
 * tracking and log messages; `resolveGraviScanPath()` finds the saved file
 * from it.
 */
export function plannedPlatePath(plate: PlateConfig): string {
  return path.join(
    plate.output_dir ?? '',
    composeScanFileName({
      exp_name: plate.exp_name ?? '',
      wave_number: plate.wave_number ?? 0,
      st_timestamp: plate.st_timestamp ?? '',
      cycle: plate.cycle ?? 1,
      system_prefix: plate.system_prefix ?? '',
      scanner_tag: plate.scanner_tag ?? '',
      plate_index: plate.plate_index,
    })
  );
}
