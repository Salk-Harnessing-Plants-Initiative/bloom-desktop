/**
 * SQL for a scan's capture time in ms. The pilot app stored capture_date as text,
 * newer scans store a number, and SQLite ranks any text above any number, so MAX or
 * ORDER BY over the raw column puts every pilot scan last-or-first regardless of its
 * date. Text is read as UTC, which it is: the pilot's database wrote it with SQLite's
 * CURRENT_TIMESTAMP.
 */
export function capturedMsSql(column = '"capture_date"'): string {
  return `CASE typeof(${column})
    WHEN 'integer' THEN ${column}
    WHEN 'real' THEN CAST(${column} AS INTEGER)
    WHEN 'text' THEN CAST(ROUND((julianday(${column}) - 2440587.5) * 86400000) AS INTEGER)
    ELSE NULL
  END`;
}
