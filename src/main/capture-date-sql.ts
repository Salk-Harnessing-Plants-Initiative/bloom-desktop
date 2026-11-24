/**
 * SQL for a scan's capture time in ms. The pilot app stored capture_date as text,
 * newer scans store a number, and SQLite ranks any text above any number, so MAX or
 * ORDER BY over the raw column puts every pilot scan last-or-first regardless of its
 * date. Text is read as UTC, which it is: the pilot's database wrote it with SQLite's
 * CURRENT_TIMESTAMP.
 */
export function capturedMsSql(): string {
  return `CASE typeof("capture_date")
    WHEN 'integer' THEN "capture_date"
    WHEN 'real' THEN CAST("capture_date" AS INTEGER)
    WHEN 'text' THEN CAST(ROUND((julianday("capture_date") - 2440587.5) * 86400000) AS INTEGER)
    ELSE NULL
  END`;
}
