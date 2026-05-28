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

function summarizeIds(ids: string[], max = 5): string {
  if (ids.length <= max) return ids.join(', ');
  return `${ids.slice(0, max).join(', ')} (+${ids.length - max} more)`;
}

/**
 * Plate IDs in one file must share a consistent prefix + numeric suffix shape
 * so the natural-sort ordering (P1 < P2 < P10) matches the user's intent.
 * Rejects mixed prefixes (P001 vs Plate3) and mixed zero-padding widths
 * (P01 vs P003) — those usually mean a typo, not deliberate intent.
 */
export function validatePlateIdPattern(plateIds: string[]): string[] {
  const errors: string[] = [];
  const unique = Array.from(new Set(plateIds));
  if (unique.length === 0) return errors;

  const parsed = unique.map((id) => {
    const match = id.match(/^(.*?)(\d+)$/);
    return {
      id,
      prefix: match?.[1] ?? null,
      digits: match?.[2] ?? null,
    };
  });

  const missingSuffix = parsed
    .filter((p) => p.digits === null)
    .map((p) => p.id);
  if (missingSuffix.length > 0) {
    errors.push(
      `Plate ID(s) must end in a number: ${summarizeIds(missingSuffix)}`
    );
  }

  const valid = parsed.filter(
    (p): p is { id: string; prefix: string; digits: string } =>
      p.digits !== null
  );
  if (valid.length === 0) return errors;

  const prefixCounts = new Map<string, number>();
  for (const p of valid) {
    prefixCounts.set(p.prefix, (prefixCounts.get(p.prefix) ?? 0) + 1);
  }
  if (prefixCounts.size > 1) {
    let canonical = '';
    let maxCount = -1;
    for (const [prefix, count] of prefixCounts) {
      if (count > maxCount) {
        canonical = prefix;
        maxCount = count;
      }
    }
    const outliers = valid.filter((p) => p.prefix !== canonical).map((p) => p.id);
    errors.push(
      `Plate IDs do not share a consistent prefix (expected "${canonical}…"): ${summarizeIds(outliers)}`
    );
  }

  const anyPadded = valid.some(
    (p) => p.digits.length > 1 && p.digits.startsWith('0')
  );
  if (anyPadded) {
    const widthCounts = new Map<number, number>();
    for (const p of valid) {
      const w = p.digits.length;
      widthCounts.set(w, (widthCounts.get(w) ?? 0) + 1);
    }
    if (widthCounts.size > 1) {
      let canonicalWidth = 0;
      let maxCount = -1;
      for (const [w, count] of widthCounts) {
        if (count > maxCount) {
          canonicalWidth = w;
          maxCount = count;
        }
      }
      const outliers = valid
        .filter((p) => p.digits.length !== canonicalWidth)
        .map((p) => p.id);
      errors.push(
        `Plate IDs use inconsistent number padding (expected ${canonicalWidth} digits, e.g. ${'0'.repeat(canonicalWidth - 1)}1): ${summarizeIds(outliers)}`
      );
    }
  }

  return errors;
}

/**
 * Validates GraviScan metadata rows.
 * Returns an array of error messages (empty = valid).
 */
export function validateGraviMetadata(rows: GraviMetadataRow[]): string[] {
  const errors: string[] = [];

  // Plate ID pattern (shared prefix + consistent padding within the file)
  errors.push(...validatePlateIdPattern(rows.map((r) => r.plateId)));

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
