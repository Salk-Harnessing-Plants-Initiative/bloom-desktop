/**
 * Export Scans' search (#471): which scans a search and a date range match. Used by the main process for the experiment counts, the days
 * and a day's scans alike, so a count always equals what opening the row lists.
 */

import type { ScanFilter } from '../types/scan-groups';
import { toIsoDate } from './wave-dates';

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
/** "nov", "novem" and "november" all name November; "no" doesn't. */
const MIN_MONTH_LETTERS = 3;
const MAX_DAY = 31;
const YEAR_DIGITS = 4;

/** A date typed the way the page shows dates ("Nov 20, 2026"), or part of one. */
export interface SearchDate {
  /** 1–12. */
  month: number;
  day?: number;
  year?: number;
}

function monthOf(word: string): number | null {
  if (word.length < MIN_MONTH_LETTERS) return null;
  const index = MONTH_NAMES.findIndex((name) => name.startsWith(word));
  return index === -1 ? null : index + 1;
}

const isDay = (word: string) =>
  /^\d{1,2}$/.test(word) && Number(word) >= 1 && Number(word) <= MAX_DAY;
const isYear = (word: string) => new RegExp(`^\\d{${YEAR_DIGITS}}$`).test(word);

/**
 * Reads "Nov 20, 2026", "Nov 20", "Nov 2026" or "Nov" (any case, short or full month,
 * commas and spacing ignored). Anything else, including "2026-11-20", is not a date.
 */
export function parseSearchDate(text: string): SearchDate | null {
  const words = text.toLowerCase().replace(/,/g, ' ').trim().split(/\s+/);
  const month = monthOf(words[0] ?? '');
  if (month === null) return null;
  const [first, second, ...extra] = words.slice(1);
  if (extra.length > 0) return null;
  if (first === undefined) return { month };
  if (second === undefined) {
    if (isDay(first)) return { month, day: Number(first) };
    if (isYear(first)) return { month, year: Number(first) };
    return null;
  }
  if (isDay(first) && isYear(second)) {
    return { month, day: Number(first), year: Number(second) };
  }
  return null;
}

function onSearchDate(captured: Date, date: SearchDate): boolean {
  return (
    captured.getMonth() + 1 === date.month &&
    (date.day === undefined || captured.getDate() === date.day) &&
    (date.year === undefined || captured.getFullYear() === date.year)
  );
}

/** The fields of a scan the filter looks at. */
export interface FilterableScan {
  plant_id: string;
  capture_date: Date;
  experiment_name: string;
  phenotyper_name: string;
}

/** True when there is nothing to filter by. */
export function isEmptyFilter(filter: ScanFilter | undefined): boolean {
  return !filter?.search?.trim() && !filter?.dateFrom && !filter?.dateTo;
}

/**
 * Builds the test for one filter. The search matches the experiment name, the
 * phenotyper's name or the plant barcode as text (any part, any case), or the
 * capture date, in the station's local time, when it reads as a date. The date range
 * compares the capture's local day, both ends inclusive.
 */
export function scanMatcher(
  filter: ScanFilter
): (scan: FilterableScan) => boolean {
  const text = filter.search?.trim().toLowerCase() ?? '';
  const date = text ? parseSearchDate(text) : null;
  return (scan) => {
    if (filter.dateFrom || filter.dateTo) {
      const day = toIsoDate(scan.capture_date);
      if (filter.dateFrom && day < filter.dateFrom) return false;
      if (filter.dateTo && day > filter.dateTo) return false;
    }
    if (!text) return true;
    return (
      scan.experiment_name.toLowerCase().includes(text) ||
      scan.phenotyper_name.toLowerCase().includes(text) ||
      scan.plant_id.toLowerCase().includes(text) ||
      (date !== null && onSearchDate(scan.capture_date, date))
    );
  };
}
