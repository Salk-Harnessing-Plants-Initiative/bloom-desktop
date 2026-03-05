/**
 * Date helper utilities for scan path generation.
 *
 * Provides local-timezone date formatting matching the pilot implementation.
 * Reference: bloom-desktop-pilot/app/src/main/scanner.ts lines 321-327
 */

/**
 * Format a date as YYYY-MM-DD in the local timezone.
 *
 * Uses the pilot's approach: offset by timezone to get local date,
 * then extract YYYY-MM-DD from the ISO string.
 *
 * @param date - Date to format (defaults to current date)
 * @returns Date string in YYYY-MM-DD format (local timezone)
 */
export function getLocalDateYYYYMMDD(date: Date = new Date()): string {
  const timeZoneOffsetInMs = date.getTimezoneOffset() * 60000;
  const localDate = new Date(date.getTime() - timeZoneOffsetInMs);
  return localDate.toISOString().slice(0, 10);
}
