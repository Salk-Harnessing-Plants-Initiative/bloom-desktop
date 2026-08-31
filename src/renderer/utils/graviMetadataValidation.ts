/**
 * Validation utilities for GraviScan metadata upload — checks that run
 * client-side, before Import, so an operator sees a specific error instead
 * of a generic backend rejection (or, worse, a silent wrong-order plate
 * auto-assignment downstream on the Capture Scan screen).
 */

export interface GraviMetadataRow {
  plateId: string;
  sectionId: string;
  plantQr: string;
  accession: string;
  medium: string | null;
}

function summarizeIds(ids: string[], max = 5): string {
  if (ids.length <= max) return ids.join(', ');
  return `${ids.slice(0, max).join(', ')} (+${ids.length - max} more)`;
}

/**
 * Plate IDs in one file must share a consistent prefix + numeric suffix
 * shape so downstream natural-sort ordering (P1 < P2 < P10, per
 * `graviPlateAccessionsList`) matches the operator's physical intent.
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
    const outliers = valid
      .filter((p) => p.prefix !== canonical)
      .map((p) => p.id);
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
 * Validates GraviScan metadata rows before they're grouped and sent to
 * `createWithSections`. Returns an array of error messages (empty = valid).
 */
export function validateGraviMetadata(rows: GraviMetadataRow[]): string[] {
  const errors: string[] = [];

  errors.push(...validatePlateIdPattern(rows.map((r) => r.plateId)));

  // Consistent accession per plate
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

  // Unique section ID per plate (mirrors the backend's
  // @@unique([gravi_plate_id, plate_section_id]) constraint, #313)
  const plateSectionIds = new Map<string, Set<string>>();
  for (const row of rows) {
    const seen = plateSectionIds.get(row.plateId) ?? new Set<string>();
    if (seen.has(row.sectionId)) {
      errors.push(
        `Plate ${row.plateId} has duplicate section ${row.sectionId}`
      );
    }
    seen.add(row.sectionId);
    plateSectionIds.set(row.plateId, seen);
  }

  // Unique plant_qr per plate, matching the DB's existing
  // @@unique([gravi_plate_id, plant_qr])
  const plantKeysByPlate = new Set<string>();
  for (const row of rows) {
    const key = `${row.plateId}::${row.plantQr}`;
    if (plantKeysByPlate.has(key)) {
      errors.push(`Plate ${row.plateId} has duplicate plant QR ${row.plantQr}`);
    }
    plantKeysByPlate.add(key);
  }

  // Unique plant_qr across the whole upload, not just within one plate —
  // the same physical plant can't legitimately appear on two different
  // plates in one wave's metadata. Mirrors the backend's cross-plate check
  // (#313) so the operator sees this before Import, not after a rejected
  // backend call.
  const qrToPlateId = new Map<string, string>();
  const flaggedCrossPlateQrs = new Set<string>();
  for (const row of rows) {
    const existingPlateId = qrToPlateId.get(row.plantQr);
    if (existingPlateId !== undefined && existingPlateId !== row.plateId) {
      if (!flaggedCrossPlateQrs.has(row.plantQr)) {
        errors.push(
          `Plant QR ${row.plantQr} appears on both plate ${existingPlateId} and plate ${row.plateId}`
        );
        flaggedCrossPlateQrs.add(row.plantQr);
      }
    } else if (existingPlateId === undefined) {
      qrToPlateId.set(row.plantQr, row.plateId);
    }
  }

  return errors;
}
