import { describe, it, expect } from 'vitest';
import {
  MIN_SCAN_INTERVAL_MINUTES,
  PLATE_INDICES,
  GRAVISCAN_RESOLUTIONS,
  createPlateAssignments,
  getPlateLabel,
  formatPlateIndex,
  generateScannerSlots,
  createEmptyScannerAssignment,
} from '../../src/types/graviscan';

describe('GraviScan TypeScript Types', () => {
  describe('constants', () => {
    it('MIN_SCAN_INTERVAL_MINUTES is 3', () => {
      expect(MIN_SCAN_INTERVAL_MINUTES).toBe(3);
    });

    it('PLATE_INDICES has correct 2grid mapping', () => {
      expect(PLATE_INDICES['2grid']).toEqual(['00', '01']);
      expect(PLATE_INDICES['2grid']).toHaveLength(2);
    });

    it('PLATE_INDICES has correct 4grid mapping', () => {
      expect(PLATE_INDICES['4grid']).toEqual(['00', '01', '10', '11']);
      expect(PLATE_INDICES['4grid']).toHaveLength(4);
    });

    it('GRAVISCAN_RESOLUTIONS has 8 entries', () => {
      expect(GRAVISCAN_RESOLUTIONS).toHaveLength(8);
      expect(GRAVISCAN_RESOLUTIONS).toEqual([
        200, 400, 600, 800, 1200, 1600, 3200, 6400,
      ]);
    });
  });

  describe('createPlateAssignments', () => {
    it('returns 2 assignments for 2grid with correct defaults', () => {
      const assignments = createPlateAssignments('2grid');
      expect(assignments).toHaveLength(2);
      for (const a of assignments) {
        expect(a.selected).toBe(true);
        expect(a.plantBarcode).toBeNull();
        expect(a.transplantDate).toBeNull();
        expect(a.customNote).toBeNull();
      }
      expect(assignments[0].plateIndex).toBe('00');
      expect(assignments[1].plateIndex).toBe('01');
    });

    it('returns 4 assignments for 4grid with correct defaults', () => {
      const assignments = createPlateAssignments('4grid');
      expect(assignments).toHaveLength(4);
      for (const a of assignments) {
        expect(a.selected).toBe(true);
        expect(a.plantBarcode).toBeNull();
        expect(a.transplantDate).toBeNull();
        expect(a.customNote).toBeNull();
      }
      expect(assignments.map((a) => a.plateIndex)).toEqual([
        '00',
        '01',
        '10',
        '11',
      ]);
    });
  });

  describe('getPlateLabel', () => {
    it('returns correct labels for all plate indices', () => {
      expect(getPlateLabel('00')).toBe('A(00)');
      expect(getPlateLabel('01')).toBe('B(01)');
      expect(getPlateLabel('10')).toBe('C(10)');
      expect(getPlateLabel('11')).toBe('D(11)');
    });

    it('returns the index itself for unknown indices', () => {
      expect(getPlateLabel('99')).toBe('99');
    });
  });

  describe('formatPlateIndex', () => {
    it('returns same labels as getPlateLabel', () => {
      expect(formatPlateIndex('00')).toBe(getPlateLabel('00'));
      expect(formatPlateIndex('01')).toBe(getPlateLabel('01'));
      expect(formatPlateIndex('10')).toBe(getPlateLabel('10'));
      expect(formatPlateIndex('11')).toBe(getPlateLabel('11'));
    });
  });

  describe('generateScannerSlots', () => {
    it('returns correct slot names', () => {
      expect(generateScannerSlots(3)).toEqual([
        'Scanner 1',
        'Scanner 2',
        'Scanner 3',
      ]);
    });

    it('returns default count when called without argument', () => {
      const slots = generateScannerSlots();
      expect(slots.length).toBeGreaterThan(0);
      expect(slots[0]).toBe('Scanner 1');
    });
  });

  describe('createEmptyScannerAssignment', () => {
    it('returns correct defaults for index 0', () => {
      const assignment = createEmptyScannerAssignment(0);
      expect(assignment.slot).toBe('Scanner 1');
      expect(assignment.scannerId).toBeNull();
      expect(assignment.usbPort).toBeNull();
      expect(assignment.gridMode).toBe('2grid');
    });

    it('returns correct slot name for index 2', () => {
      const assignment = createEmptyScannerAssignment(2);
      expect(assignment.slot).toBe('Scanner 3');
    });
  });
});
