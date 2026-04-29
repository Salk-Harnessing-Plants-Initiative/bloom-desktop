/**
 * Unit tests for GraviScan metadata validation utilities.
 *
 * Tests validateGraviMetadata() which checks metadata rows for:
 * - Consistent accession per plate
 * - Unique plant QR per plate
 * - Valid transplant date format (YYYY-MM-DD)
 */

import { describe, it, expect } from 'vitest';
import {
  validateGraviMetadata,
  GraviMetadataRow,
} from '../../src/renderer/utils/graviMetadataValidation';

function makeRow(overrides: Partial<GraviMetadataRow> = {}): GraviMetadataRow {
  return {
    plateId: 'P001',
    sectionId: 'S1',
    plantQr: 'QR-001',
    accession: 'ACC-A',
    medium: 'MS',
    transplantDate: '2025-06-15',
    ...overrides,
  };
}

describe('validateGraviMetadata', () => {
  it('returns empty error array for valid metadata rows', () => {
    const rows: GraviMetadataRow[] = [
      makeRow({ plantQr: 'QR-001' }),
      makeRow({ plantQr: 'QR-002' }),
      makeRow({ plantQr: 'QR-003' }),
    ];
    expect(validateGraviMetadata(rows)).toEqual([]);
  });

  it('returns error for inconsistent accession per plate', () => {
    const rows: GraviMetadataRow[] = [
      makeRow({ plateId: 'P001', accession: 'ACC-A', plantQr: 'QR-001' }),
      makeRow({ plateId: 'P001', accession: 'ACC-B', plantQr: 'QR-002' }),
    ];
    const errors = validateGraviMetadata(rows);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some((e) => e.includes('P001'))).toBe(true);
    expect(errors.some((e) => /inconsistent/i.test(e))).toBe(true);
  });

  it('returns error for duplicate plant QR per plate', () => {
    const rows: GraviMetadataRow[] = [
      makeRow({ plateId: 'P001', plantQr: 'QR-001' }),
      makeRow({ plateId: 'P001', plantQr: 'QR-001' }),
    ];
    const errors = validateGraviMetadata(rows);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some((e) => e.includes('QR-001'))).toBe(true);
    expect(errors.some((e) => /duplicate/i.test(e))).toBe(true);
  });

  it('allows same plant QR on different plates', () => {
    const rows: GraviMetadataRow[] = [
      makeRow({ plateId: 'P001', plantQr: 'QR-001', accession: 'ACC-A' }),
      makeRow({ plateId: 'P002', plantQr: 'QR-001', accession: 'ACC-B' }),
    ];
    expect(validateGraviMetadata(rows)).toEqual([]);
  });

  it('returns error for invalid transplant date format', () => {
    const rows: GraviMetadataRow[] = [
      makeRow({ plantQr: 'QR-001', transplantDate: 'not-a-date' }),
    ];
    const errors = validateGraviMetadata(rows);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some((e) => /transplant date/i.test(e))).toBe(true);
  });

  it('returns error for transplant date with year out of range', () => {
    const rows: GraviMetadataRow[] = [
      makeRow({ plantQr: 'QR-001', transplantDate: '1800-01-01' }),
    ];
    const errors = validateGraviMetadata(rows);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some((e) => /transplant date/i.test(e))).toBe(true);
  });

  it('handles empty rows gracefully', () => {
    expect(validateGraviMetadata([])).toEqual([]);
  });

  it('handles rows with missing optional fields gracefully', () => {
    const rows: GraviMetadataRow[] = [
      {
        plateId: 'P001',
        sectionId: 'S1',
        plantQr: 'QR-001',
        accession: 'ACC-A',
        medium: null,
        // transplantDate omitted
      },
    ];
    expect(validateGraviMetadata(rows)).toEqual([]);
  });

  it('handles rows with null transplantDate gracefully', () => {
    const rows: GraviMetadataRow[] = [
      makeRow({ plantQr: 'QR-001', transplantDate: null }),
    ];
    expect(validateGraviMetadata(rows)).toEqual([]);
  });

  it('ignores extra fields without error', () => {
    const row = {
      ...makeRow({ plantQr: 'QR-001' }),
      extraField: 'should be ignored',
      anotherExtra: 42,
    } as GraviMetadataRow;
    expect(validateGraviMetadata([row])).toEqual([]);
  });

  it('reports multiple errors at once', () => {
    const rows: GraviMetadataRow[] = [
      makeRow({
        plateId: 'P001',
        accession: 'ACC-A',
        plantQr: 'QR-001',
        transplantDate: 'bad-date',
      }),
      makeRow({
        plateId: 'P001',
        accession: 'ACC-B',
        plantQr: 'QR-001',
        transplantDate: '2025-06-15',
      }),
    ];
    const errors = validateGraviMetadata(rows);
    // Should have at least: inconsistent accession, duplicate QR, invalid date
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});
