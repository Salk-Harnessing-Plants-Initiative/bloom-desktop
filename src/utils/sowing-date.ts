/**
 * Sowing dates and plant ages for CylinderScan waves (#407).
 *
 * A wave's sowing date is a local calendar date, "YYYY-MM-DD". The plant age on a
 * scan is the number of calendar days from that date to the scan date, in the
 * scanner PC's local time. These rules are shared by the main process (which
 * enforces them when saving) and Capture Scan (which explains them to the operator).
 */

/** Longest note or reason the operator can type. */
export const MAX_REASON_LENGTH = 500;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface WaveSowingDate {
  wave_number: number;
  sowing_date: string;
}

/** The parts of a "YYYY-MM-DD" date, or null when it isn't a real calendar date. */
function parseIsoDate(value: string): [number, number, number] | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return [year, month, day];
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && parseIsoDate(value) !== null;
}

/** `date` as a local "YYYY-MM-DD". */
export function toIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Calendar days from the sowing date to `on` (local time); negative before sowing. */
export function plantAgeDays(sowingDate: string, on: Date): number {
  const parts = parseIsoDate(sowingDate);
  if (!parts) throw new Error(`Not a date: ${sowingDate}`);
  const sown = new Date(parts[0], parts[1] - 1, parts[2]);
  const day = new Date(on.getFullYear(), on.getMonth(), on.getDate());
  return Math.round((day.getTime() - sown.getTime()) / MS_PER_DAY);
}

/** "5 Dec 2025" for a "YYYY-MM-DD" date. */
export function formatSowingDate(sowingDate: string): string {
  const parts = parseIsoDate(sowingDate);
  if (!parts) return sowingDate;
  return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString(
    undefined,
    { day: 'numeric', month: 'short', year: 'numeric' }
  );
}

/** A problem with a date the operator entered, or null when it can be used. */
export function sowingDateError(
  sowingDate: string,
  today: Date
): string | null {
  if (!isIsoDate(sowingDate)) return 'Enter the sowing date.';
  if (plantAgeDays(sowingDate, today) < 0) {
    return "The sowing date can't be in the future.";
  }
  return null;
}

export interface NewWaveCheck {
  /** The date can't be used. */
  error: string | null;
  /** Another wave's date conflicts with this one: saving needs a note. */
  noteNeeded: string | null;
  /** The wave number skips ahead: saving needs the operator to confirm it. */
  waveConfirmNeeded: string | null;
}

/**
 * Checks for a new wave's sowing date against the experiment's other waves. A wave
 * sown on or before an earlier-numbered wave (or on or after a later-numbered one)
 * needs a note; a wave number that skips ahead needs a confirmation.
 * `scannedWaveNumbers` adds waves that have scans but no date yet (scanned before
 * sowing dates existed), so they count when judging a skip.
 */
export function checkNewWave(
  waveNumber: number,
  sowingDate: string,
  existing: WaveSowingDate[],
  today: Date,
  scannedWaveNumbers: number[] = []
): NewWaveCheck {
  const result: NewWaveCheck = {
    error: sowingDateError(sowingDate, today),
    noteNeeded: null,
    waveConfirmNeeded: null,
  };
  if (result.error) return result;

  const conflict = [...existing]
    .sort((a, b) => a.wave_number - b.wave_number)
    .find((w) =>
      w.wave_number < waveNumber
        ? w.sowing_date >= sowingDate
        : w.sowing_date <= sowingDate
    );
  if (conflict) {
    const when =
      conflict.wave_number < waveNumber ? 'on or before' : 'on or after';
    result.noteNeeded =
      `Wave ${conflict.wave_number} was sown on ${formatSowingDate(conflict.sowing_date)}, ` +
      `so wave ${waveNumber} would be sown ${when} it. Add a note saying why.`;
  }

  const known = [
    ...existing.map((w) => w.wave_number),
    ...scannedWaveNumbers,
  ].filter((n) => n !== waveNumber);
  const highest = known.reduce(
    (max, n) => Math.max(max, n),
    known.length > 0 ? -1 : 0
  );
  if (waveNumber > highest + 1) {
    result.waveConfirmNeeded =
      known.length > 0
        ? `The highest wave of this experiment so far is ${highest}. Is this really wave ${waveNumber}?`
        : `This is the experiment's first wave. Is it really wave ${waveNumber}?`;
  }
  return result;
}

/** Why a sowing-date change can't be saved, or null. */
export function sowingDateChangeError(
  newSowingDate: string,
  reason: string,
  waveHasScans: boolean,
  today: Date
): string | null {
  const dateError = sowingDateError(newSowingDate, today);
  if (dateError) return dateError;
  if (waveHasScans && !reason.trim()) {
    return 'This wave already has scans: give a reason for the change.';
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return `Keep the reason under ${MAX_REASON_LENGTH} characters.`;
  }
  return null;
}
