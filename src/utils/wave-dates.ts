/**
 * Dates and plant ages for CylinderScan waves (#407, #428).
 *
 * A wave has a sowing, germination and transfer-to-cylinder date, each a local
 * calendar date, "YYYY-MM-DD". The plant age on a scan is always the number of
 * calendar days from the germination date to the scan date (days after
 * germination), in the scanner PC's local time: the processing pipeline reads it that
 * way and picks its model from it. These rules are shared by the main process (which
 * enforces them when saving) and Capture Scan (which explains them to the operator).
 */

/** Longest note or reason the operator can type. */
export const MAX_REASON_LENGTH = 500;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface WaveGerminationDate {
  wave_number: number;
  /** Null for a wave whose dates are per plant. */
  germination_date: string | null;
  /** Null for a wave whose dates are per plant, or one the backfill set. */
  sowing_date?: string | null;
}

/** A date of this wave that's out of order with another wave's. */
export interface WaveOrderConflict {
  field: 'sowing' | 'germination';
  /** The other wave, and its date. */
  waveNumber: number;
  date: string;
  /** This wave's date is on or before an earlier wave's, or on or after a later one's. */
  when: 'on or before' | 'on or after';
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

/** Calendar days from the germination date to `on` (local time); negative before germination. */
export function plantAgeDays(germinationDate: string, on: Date): number {
  const parts = parseIsoDate(germinationDate);
  if (!parts) throw new Error(`Not a date: ${germinationDate}`);
  const germinated = new Date(parts[0], parts[1] - 1, parts[2]);
  const day = new Date(on.getFullYear(), on.getMonth(), on.getDate());
  return Math.round((day.getTime() - germinated.getTime()) / MS_PER_DAY);
}

/**
 * Bloom's germ_day: calendar days from sowing to germination (#427, #429). 0 when
 * either date is missing or unreadable (e.g. scans from before the dates were
 * recorded), which is what was always sent before.
 */
export function germDay(dates: {
  germination_date: string | null;
  sowing_date: string | null;
}): number {
  const sowing = dates.sowing_date && parseIsoDate(dates.sowing_date);
  const germination =
    dates.germination_date && parseIsoDate(dates.germination_date);
  if (!sowing || !germination) return 0;
  const days = plantAgeDays(
    dates.sowing_date!,
    new Date(germination[0], germination[1] - 1, germination[2])
  );
  return Math.max(days, 0);
}

/** "5 Dec 2025" for a "YYYY-MM-DD" date. */
export function formatWaveDate(date: string): string {
  const parts = parseIsoDate(date);
  if (!parts) return date;
  return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString(
    undefined,
    { day: 'numeric', month: 'short', year: 'numeric' }
  );
}

/** "1 day", "9 days". */
export function formatDays(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** A problem with a date the operator entered, or null when it can be used. */
export function germinationDateError(
  germinationDate: string,
  today: Date
): string | null {
  if (!isIsoDate(germinationDate)) return 'Enter the germination date.';
  if (plantAgeDays(germinationDate, today) < 0) {
    return "The germination date can't be in the future.";
  }
  return null;
}

/** Something unusual the phenotyper confirms, with a note, before saving. */
export interface WaveWarning {
  /** "Are you sure wave 3's germination date is correct?", or "Wave 2 was skipped" */
  question: string;
  /** Why it is asked. */
  detail: string;
  /** What to confirm, shown in bold: "Are you sure you want to scan wave 3?" */
  confirm?: string;
  /** For dates out of order with other waves': which ones. */
  conflicts?: WaveOrderConflict[];
  /** For a wave number that skips ahead: the waves skipped, "wave 2" or "waves 2–4". */
  skipped?: string;
}

/** The whole warning as one sentence, for the main process's error message. */
export function warningText(warning: WaveWarning): string {
  return [warning.question, warning.detail, warning.confirm]
    .filter(Boolean)
    .map((part) => (/[.?!]$/.test(part as string) ? part : `${part}.`))
    .join(' ');
}

/** A wave's three dates as entered; `transfer` is '' when it's the same day as germination. */
export interface WaveDates {
  germination: string;
  sowing: string;
  transfer: string;
}

/**
 * What's wrong with a wave's dates, or null: germination and sowing are required and
 * not in the future, sowing is before germination, and a transfer date (when it
 * isn't the germination day) is a real date, not in the future, and on or after
 * germination (so after sowing too).
 */
export function waveDatesError(dates: WaveDates, today: Date): string | null {
  const germination = germinationDateError(dates.germination, today);
  if (germination) return germination;
  if (!isIsoDate(dates.sowing)) return 'Enter the sowing date.';
  if (plantAgeDays(dates.sowing, today) < 0) {
    return "The sowing date can't be in the future.";
  }
  if (dates.sowing >= dates.germination) {
    return 'The sowing date must be before the germination date.';
  }
  if (dates.transfer) {
    if (!isIsoDate(dates.transfer)) {
      return 'Enter the transfer date, or tick "Same as germination date".';
    }
    if (plantAgeDays(dates.transfer, today) < 0) {
      return "The transfer date can't be in the future.";
    }
    // On or after germination, so also after sowing.
    if (dates.transfer < dates.germination) {
      return "The transfer date can't be before the germination date.";
    }
  }
  return null;
}

/** A wave's stored dates as entered: null sowing (a backfilled wave) and null transfer (the germination day) become ''. */
export function storedWaveDates(wave: {
  germination_date: string | null;
  sowing_date: string | null;
  transfer_date: string | null;
}): WaveDates {
  return {
    germination: wave.germination_date ?? '',
    sowing: wave.sowing_date ?? '',
    transfer: wave.transfer_date ?? '',
  };
}

export interface NewWaveCheck {
  /** The date can't be used. */
  error: string | null;
  /** The date is out of order with another wave's. */
  dateWarning: WaveWarning | null;
  /** The wave number skips ahead of the experiment's waves. */
  waveWarning: WaveWarning | null;
  /** Either warning applies, so saving needs a note: what to say without one. */
  noteNeeded: string | null;
}

/**
 * "Is the wave number correct?" when a new wave's number skips ahead of the
 * experiment's waves (wave 3 after wave 1), or null. Asked before the germination date.
 */
export function waveNumberWarning(
  waveNumber: number,
  existing: WaveGerminationDate[]
): WaveWarning | null {
  const highest = existing.reduce(
    (max, w) => Math.max(max, w.wave_number),
    existing.length > 0 ? -1 : 0
  );
  if (waveNumber <= highest + 1) return null;
  const first = highest + 1;
  const last = waveNumber - 1;
  const skipped = first === last ? `wave ${first}` : `waves ${first}–${last}`;
  return {
    question:
      first === last
        ? `Wave ${first} was skipped`
        : `Waves ${first}–${last} were skipped`,
    detail:
      existing.length > 0
        ? `The latest wave in this experiment is wave ${highest}.`
        : 'This experiment has no waves yet.',
    skipped,
  };
}

/**
 * Checks for a new wave's germination date against the experiment's other waves. A wave
 * sown on or before an earlier-numbered wave (or on or after a later-numbered one),
 * or a wave number that skips ahead, can be saved, but only with a note.
 */
export function checkNewWave(
  waveNumber: number,
  dates: WaveDates,
  existing: WaveGerminationDate[],
  today: Date
): NewWaveCheck {
  const result: NewWaveCheck = {
    error: waveDatesError(dates, today),
    dateWarning: null,
    waveWarning: null,
    noteNeeded: null,
  };
  if (result.error) return result;

  result.dateWarning = waveConflict(waveNumber, dates, existing);

  result.waveWarning = waveNumberWarning(waveNumber, existing);
  const first = result.dateWarning ?? result.waveWarning;
  if (first) {
    result.noteNeeded = `${warningText(first)} Add a note to proceed.`;
  }
  return result;
}

/**
 * The first other wave whose date is out of order with this one: an earlier-numbered
 * wave sown on or after it, or a later-numbered one sown on or before it.
 */
function waveConflict(
  waveNumber: number,
  dates: { sowing: string; germination: string },
  others: WaveGerminationDate[],
  /** Only these dates (e.g. the ones a change touches); all when left out. */
  fields?: ('sowing' | 'germination')[]
): WaveWarning | null {
  const conflicts = waveOrderConflicts(waveNumber, dates, others).filter(
    (c) => !fields || fields.includes(c.field)
  );
  if (conflicts.length === 0) return null;
  return {
    question: `Are you sure about wave ${waveNumber}'s dates?`,
    detail: conflicts
      .map(
        (c) =>
          `Its ${c.field} date is ${c.when} wave ${c.waveNumber}'s (${formatWaveDate(c.date)}).`
      )
      .join(' '),
    conflicts,
  };
}

/**
 * This wave's sowing and germination dates against the experiment's other waves': a
 * later wave is sown and germinates after an earlier one. For each date, the first
 * other wave it's out of order with (on or before an earlier wave's, or on or after a
 * later one's).
 */
export function waveOrderConflicts(
  waveNumber: number,
  dates: { sowing: string; germination: string },
  others: WaveGerminationDate[]
): WaveOrderConflict[] {
  const sorted = [...others].sort((a, b) => a.wave_number - b.wave_number);
  const found: WaveOrderConflict[] = [];
  for (const field of ['sowing', 'germination'] as const) {
    const mine = field === 'sowing' ? dates.sowing : dates.germination;
    if (!mine) continue;
    for (const w of sorted) {
      const theirs = field === 'sowing' ? w.sowing_date : w.germination_date;
      if (!theirs) continue;
      const earlier = w.wave_number < waveNumber;
      if (earlier ? theirs >= mine : theirs <= mine) {
        found.push({
          field,
          waveNumber: w.wave_number,
          date: theirs,
          when: earlier ? 'on or before' : 'on or after',
        });
        break;
      }
    }
  }
  return found;
}

/** Once a wave has scans its dates are final; a mistake is corrected with the Bloom team (#428). */
export function scannedWaveError(waveNumber: number): string {
  return `Wave ${waveNumber} already has scans, so its dates can't be changed.`;
}

/** Once a plant has scans its dates are final, as for a wave. */
export function scannedPlantError(plantBarcode: string): string {
  return `Plant ${plantBarcode} already has scans, so its dates can't be changed.`;
}

export interface WaveDateChangeCheck {
  /** The new date can't be used, whatever the reason. */
  error: string | null;
  /** The new date is out of order with another wave's: saving needs a reason. */
  conflict: WaveWarning | null;
  /** A reason is needed: the date conflicts with another wave's. */
  reasonNeeded: boolean;
  /** Why the change can't be saved with this reason, or null when it can. */
  saveError: string | null;
}

/**
 * The rules for changing a wave's dates, shared by the Edit box and the main process.
 * They can only change before the wave's first scan, and need a reason only when a new
 * date conflicts with another wave's.
 */
export function checkWaveDateChange(
  change: {
    waveNumber: number;
    current: WaveDates;
    next: WaveDates;
    reason: string;
    waveHasScans: boolean;
  },
  otherWaves: WaveGerminationDate[],
  today: Date
): WaveDateChangeCheck {
  const reason = change.reason.trim();
  const { current, next } = change;
  const changed =
    next.germination !== current.germination ||
    next.sowing !== current.sowing ||
    next.transfer !== current.transfer;
  const error = change.waveHasScans
    ? scannedWaveError(change.waveNumber)
    : changed
      ? waveDatesError(next, today)
      : "Those are already the wave's dates.";
  // Only a date the change touches is checked against the other waves'.
  const touched = (['sowing', 'germination'] as const).filter(
    (f) => next[f] !== current[f]
  );
  const conflict =
    error || touched.length === 0
      ? null
      : waveConflict(change.waveNumber, next, otherWaves, [...touched]);
  const reasonNeeded = conflict !== null;
  const saveError =
    error ??
    (conflict && !reason
      ? `${warningText(conflict)} Give a reason for the change.`
      : reason.length > MAX_REASON_LENGTH
        ? `Keep the reason under ${MAX_REASON_LENGTH} characters.`
        : null);
  return { error, conflict, reasonNeeded, saveError };
}
