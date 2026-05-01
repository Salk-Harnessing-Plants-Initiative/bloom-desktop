/**
 * Validation utilities for GraviScan metadata upload.
 */

export interface GraviMetadataRow {
  plateId: string;
  sectionId: string;
  plantQr: string;
  accession: string;
  medium: string | null;
  transplantDate?: string | null;
}

/**
 * Validates GraviScan metadata rows.
 * Returns an array of error messages (empty = valid).
 */
export function validateGraviMetadata(rows: GraviMetadataRow[]): string[] {
  const errors: string[] = [];

  // Check consistent accession per plate
  const plateAccessions = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!plateAccessions.has(row.plateId)) {
      plateAccessions.set(row.plateId, new Set());
    }
    plateAccessions.get(row.plateId)!.add(row.accession);
  }
  for (const [plateId, accessions] of plateAccessions) {
    if (accessions.size > 1) {
      errors.push(
        `Plate ${plateId} has inconsistent accession values: ${[...accessions].join(', ')}`
      );
    }
  }

  // Check transplant_date is a valid date (YYYY-MM-DD or parseable)
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const invalidDateRows: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const td = rows[i].transplantDate;
    if (td) {
      const d = new Date(td);
      if (
        isNaN(d.getTime()) ||
        d.getFullYear() < 1900 ||
        d.getFullYear() > 2100
      ) {
        invalidDateRows.push(i + 2); // +2 for 1-indexed + header row
      } else if (!datePattern.test(td)) {
        // Parseable but not YYYY-MM-DD — warn but don't block
      }
    }
  }
  if (invalidDateRows.length > 0) {
    errors.push(
      `Invalid transplant date in row(s) ${invalidDateRows.join(', ')}. Expected format: YYYY-MM-DD (e.g. 2025-06-15). Please fix the column in your Excel file and re-upload.`
    );
  }

  // Check unique plant_qr per plate
  const plantKeys = new Set<string>();
  for (const row of rows) {
    const key = `${row.plateId}::${row.plantQr}`;
    if (plantKeys.has(key)) {
      errors.push(`Plate ${row.plateId} has duplicate plant QR ${row.plantQr}`);
    }
    plantKeys.add(key);
  }

  return errors;
}
