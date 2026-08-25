/**
 * Pure aggregation helpers for summarizing a GraviScan experiment's scans on
 * BrowseGraviScans.tsx/ExperimentDetail.tsx. Neither caps, formats, or picks
 * a display string — that's the rendering layer's job (design.md Decision
 * 12's Round 2 correction) — so these stay trivially testable.
 */

export function computeDistinctValueSummary(values: Array<string | number>): {
  values: string[];
  isMixed: boolean;
} {
  const distinct = Array.from(new Set(values.map((v) => String(v))));
  return { values: distinct, isMixed: distinct.length > 1 };
}

export function computeNameList(names: string[]): { values: string[] } {
  const distinct = Array.from(new Set(names)).sort();
  return { values: distinct };
}

export function computeDateRange(
  dates: Array<Date | string>
): { earliest: Date; latest: Date } | null {
  if (dates.length === 0) return null;
  const parsed = dates.map((d) => (typeof d === 'string' ? new Date(d) : d));
  const times = parsed.map((d) => d.getTime());
  return {
    earliest: parsed[times.indexOf(Math.min(...times))],
    latest: parsed[times.indexOf(Math.max(...times))],
  };
}

export function computeImageCountBreakdown(
  scans: Array<{
    scanner_id: string;
    plate_index: string;
    cycle_number?: number | null;
  }>
): {
  scannerCount: number;
  plateCount: number;
  cycleCount: number;
  scansWithoutCycle: number;
  totalImages: number;
} {
  const scannerIds = new Set<string>();
  const plateIndices = new Set<string>();
  const cycleNumbers = new Set<number>();
  let scansWithoutCycle = 0;

  for (const scan of scans) {
    scannerIds.add(scan.scanner_id);
    plateIndices.add(scan.plate_index);
    if (scan.cycle_number === null || scan.cycle_number === undefined) {
      scansWithoutCycle += 1;
    } else {
      cycleNumbers.add(scan.cycle_number);
    }
  }

  return {
    scannerCount: scannerIds.size,
    plateCount: plateIndices.size,
    cycleCount: cycleNumbers.size,
    scansWithoutCycle,
    totalImages: scans.length,
  };
}

const DISPLAY_CAP = 3;

/** Caps a distinct-value list at 3 for inline display, with the full list
 * always available via `title` — design.md Decision 12's Round 2 correction.
 * Shared by BrowseGraviScans.tsx and ExperimentDetail.tsx. */
export function capForDisplay(values: string[]): {
  display: string;
  title: string;
} {
  const display =
    values.length > DISPLAY_CAP
      ? `${values.slice(0, DISPLAY_CAP).join(', ')} +${values.length - DISPLAY_CAP} more`
      : values.join(', ');
  return { display, title: values.join(', ') };
}

export function formatDateRange(
  range: { earliest: Date; latest: Date } | null
): string {
  if (!range) return '';
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  return fmt(range.earliest) === fmt(range.latest)
    ? fmt(range.earliest)
    : `${fmt(range.earliest)} - ${fmt(range.latest)}`;
}
