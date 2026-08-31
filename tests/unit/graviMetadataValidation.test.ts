import { describe, it, expect } from 'vitest';
import {
  validateGraviMetadata,
  validatePlateIdPattern,
  GraviMetadataRow,
} from '../../src/renderer/utils/graviMetadataValidation';

describe('validateGraviMetadata', () => {
  const validRows: GraviMetadataRow[] = [
    {
      plateId: 'P001',
      sectionId: 'S1',
      plantQr: 'QR-001',
      accession: 'Ara-1',
      medium: 'MS',
    },
    {
      plateId: 'P001',
      sectionId: 'S2',
      plantQr: 'QR-002',
      accession: 'Ara-1',
      medium: 'MS',
    },
    {
      plateId: 'P002',
      sectionId: 'S1',
      plantQr: 'QR-003',
      accession: 'Col-0',
      medium: 'MS+Suc',
    },
  ];

  it('returns no errors for valid data', () => {
    expect(validateGraviMetadata(validRows)).toHaveLength(0);
  });

  it('detects inconsistent accession per plate', () => {
    const rows: GraviMetadataRow[] = [
      {
        plateId: 'P001',
        sectionId: 'S1',
        plantQr: 'QR-001',
        accession: 'Ara-1',
        medium: 'MS',
      },
      {
        plateId: 'P001',
        sectionId: 'S2',
        plantQr: 'QR-002',
        accession: 'Col-0',
        medium: 'MS',
      },
    ];

    const errors = validateGraviMetadata(rows);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('P001');
    expect(errors[0]).toContain('inconsistent accession');
  });

  it('detects duplicate plant QR within the same plate', () => {
    const rows: GraviMetadataRow[] = [
      {
        plateId: 'P001',
        sectionId: 'S1',
        plantQr: 'QR-001',
        accession: 'Ara-1',
        medium: 'MS',
      },
      {
        plateId: 'P001',
        sectionId: 'S2',
        plantQr: 'QR-001',
        accession: 'Ara-1',
        medium: 'MS',
      },
    ];

    const errors = validateGraviMetadata(rows);
    expect(errors.some((e) => e.includes('duplicate plant QR'))).toBe(true);
    expect(errors.some((e) => e.includes('QR-001'))).toBe(true);
  });

  // Stricter than the production pilot's own check (which only guards
  // per-plate) — matches the backend's cross-plate uniqueness rule added to
  // close #313, so the operator sees this before Import rather than after a
  // rejected backend call.
  it('detects the same plant QR reused on two different plates', () => {
    const rows: GraviMetadataRow[] = [
      {
        plateId: 'P001',
        sectionId: 'S1',
        plantQr: 'QR-001',
        accession: 'Ara-1',
        medium: 'MS',
      },
      {
        plateId: 'P002',
        sectionId: 'S1',
        plantQr: 'QR-001',
        accession: 'Col-0',
        medium: 'MS',
      },
    ];

    const errors = validateGraviMetadata(rows);
    expect(errors.some((e) => e.includes('QR-001'))).toBe(true);
    expect(errors.some((e) => e.includes('P001'))).toBe(true);
    expect(errors.some((e) => e.includes('P002'))).toBe(true);
  });

  it('detects duplicate section ID within the same plate', () => {
    const rows: GraviMetadataRow[] = [
      {
        plateId: 'P001',
        sectionId: 'S1',
        plantQr: 'QR-001',
        accession: 'Ara-1',
        medium: 'MS',
      },
      {
        plateId: 'P001',
        sectionId: 'S1',
        plantQr: 'QR-002',
        accession: 'Ara-1',
        medium: 'MS',
      },
    ];

    const errors = validateGraviMetadata(rows);
    expect(errors.some((e) => e.includes('duplicate section'))).toBe(true);
    expect(errors.some((e) => e.includes('S1'))).toBe(true);
  });

  it('allows the same section ID reused on two different plates', () => {
    const rows: GraviMetadataRow[] = [
      {
        plateId: 'P001',
        sectionId: 'S1',
        plantQr: 'QR-001',
        accession: 'Ara-1',
        medium: 'MS',
      },
      {
        plateId: 'P002',
        sectionId: 'S1',
        plantQr: 'QR-002',
        accession: 'Col-0',
        medium: 'MS',
      },
    ];

    expect(validateGraviMetadata(rows)).toHaveLength(0);
  });

  it('handles empty rows', () => {
    expect(validateGraviMetadata([])).toHaveLength(0);
  });
});

describe('validatePlateIdPattern', () => {
  it('accepts consistent zero-padded ids (P001..P012)', () => {
    expect(
      validatePlateIdPattern(['P001', 'P002', 'P003', 'P010', 'P012'])
    ).toHaveLength(0);
  });

  it('accepts unpadded ids with varying digit width (PLATE_1..PLATE_25)', () => {
    expect(
      validatePlateIdPattern(['PLATE_1', 'PLATE_2', 'PLATE_9', 'PLATE_25'])
    ).toHaveLength(0);
  });

  it('rejects mismatched prefix and names the outlier', () => {
    const errors = validatePlateIdPattern(['P001', 'P002', 'Plate3']);
    const prefixErr = errors.find((e) => e.includes('prefix'));
    expect(prefixErr).toBeDefined();
    expect(prefixErr).toContain('Plate3');
  });

  it('rejects mismatched zero-padding width', () => {
    const errors = validatePlateIdPattern(['P01', 'P02', 'P003']);
    const padErr = errors.find((e) => e.includes('padding'));
    expect(padErr).toBeDefined();
    expect(padErr).toContain('P003');
  });

  it('rejects a plate_id with no numeric suffix', () => {
    const errors = validatePlateIdPattern(['P001', 'P002', 'plate']);
    const suffixErr = errors.find((e) => e.includes('end in a number'));
    expect(suffixErr).toBeDefined();
    expect(suffixErr).toContain('plate');
  });

  it('handles an empty list', () => {
    expect(validatePlateIdPattern([])).toHaveLength(0);
  });
});
