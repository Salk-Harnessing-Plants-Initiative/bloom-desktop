import { describe, it, expect } from 'vitest';
import {
  validateGraviMetadata,
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
      sectionId: 'S1',
      plantQr: 'QR-002',
      accession: 'Ara-1',
      medium: 'MS',
    },
    {
      plateId: 'P001',
      sectionId: 'S2',
      plantQr: 'QR-003',
      accession: 'Ara-1',
      medium: 'MS',
    },
    {
      plateId: 'P002',
      sectionId: 'S1',
      plantQr: 'QR-004',
      accession: 'Col-0',
      medium: 'MS+Suc',
    },
    {
      plateId: 'P002',
      sectionId: 'S1',
      plantQr: 'QR-005',
      accession: 'Col-0',
      medium: 'MS+Suc',
    },
  ];

  it('returns no errors for valid data', () => {
    const errors = validateGraviMetadata(validRows);
    expect(errors).toHaveLength(0);
  });

  it('allows multiple plants in the same section', () => {
    // P001 S1 has QR-001 and QR-002 — this is valid
    const errors = validateGraviMetadata(validRows);
    expect(errors).toHaveLength(0);
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
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('P001');
    expect(errors[0]).toContain('duplicate plant QR');
    expect(errors[0]).toContain('QR-001');
  });

  it('allows same plant QR on different plates', () => {
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
    expect(errors).toHaveLength(0);
  });

  it('reports both accession and duplicate errors when present', () => {
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
        accession: 'Col-0',
        medium: 'MS',
      },
    ];

    const errors = validateGraviMetadata(rows);
    expect(errors).toHaveLength(2);
    expect(errors.some((e) => e.includes('inconsistent accession'))).toBe(true);
    expect(errors.some((e) => e.includes('duplicate plant QR'))).toBe(true);
  });

  it('handles empty rows', () => {
    const errors = validateGraviMetadata([]);
    expect(errors).toHaveLength(0);
  });

  it('handles single row', () => {
    const rows: GraviMetadataRow[] = [
      {
        plateId: 'P001',
        sectionId: 'S1',
        plantQr: 'QR-001',
        accession: 'Ara-1',
        medium: null,
      },
    ];

    const errors = validateGraviMetadata(rows);
    expect(errors).toHaveLength(0);
  });
});
