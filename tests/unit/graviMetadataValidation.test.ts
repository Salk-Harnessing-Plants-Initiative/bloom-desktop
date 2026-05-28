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

  describe('plate_id pattern check', () => {
    const row = (
      plateId: string,
      sectionId = 'S1',
      plantQr = `QR-${plateId}`
    ): GraviMetadataRow => ({
      plateId,
      sectionId,
      plantQr,
      accession: 'Ara-1',
      medium: 'MS',
    });

    it('accepts consistent zero-padded ids (P001..P012)', () => {
      const rows = ['P001', 'P002', 'P003', 'P010', 'P012'].map((id) =>
        row(id)
      );
      const errors = validateGraviMetadata(rows);
      expect(errors).toHaveLength(0);
    });

    it('accepts unpadded ids with varying digit width (PLATE_1..PLATE_25)', () => {
      const rows = ['PLATE_1', 'PLATE_2', 'PLATE_9', 'PLATE_25'].map((id) =>
        row(id)
      );
      const errors = validateGraviMetadata(rows);
      expect(errors).toHaveLength(0);
    });

    it('rejects mismatched prefix and names the outlier', () => {
      const rows = ['P001', 'P002', 'Plate3'].map((id) => row(id));
      const errors = validateGraviMetadata(rows);
      const prefixErr = errors.find((e) => e.includes('prefix'));
      expect(prefixErr).toBeDefined();
      expect(prefixErr).toContain('Plate3');
    });

    it('rejects mismatched zero-padding width', () => {
      const rows = ['P01', 'P02', 'P003'].map((id) => row(id));
      const errors = validateGraviMetadata(rows);
      const padErr = errors.find((e) => e.includes('padding'));
      expect(padErr).toBeDefined();
      expect(padErr).toContain('P003');
    });

    it('rejects plate_id with no numeric suffix', () => {
      const rows = ['P001', 'P002', 'plate'].map((id) => row(id));
      const errors = validateGraviMetadata(rows);
      const suffixErr = errors.find((e) => e.includes('end in a number'));
      expect(suffixErr).toBeDefined();
      expect(suffixErr).toContain('plate');
    });

    it('rejects plate_id with trailing non-digit (P3x)', () => {
      const rows = ['P1', 'P2', 'P3x'].map((id) => row(id));
      const errors = validateGraviMetadata(rows);
      expect(errors.some((e) => e.includes('P3x'))).toBe(true);
    });

    it('accepts single plate with valid format', () => {
      const errors = validateGraviMetadata([row('P001')]);
      expect(errors).toHaveLength(0);
    });
  });
});
