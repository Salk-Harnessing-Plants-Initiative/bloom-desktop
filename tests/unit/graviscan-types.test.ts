import { describe, it, expect } from 'vitest';
import {
  MIN_SCAN_INTERVAL_MINUTES,
  PLATE_INDICES,
  GRAVISCAN_RESOLUTIONS,
  DEFAULT_SCANNER_SLOTS,
  MAX_SCANNER_SLOTS,
  createPlateAssignments,
  getPlateLabel,
  formatPlateIndex,
  generateScannerSlotName,
  generateScannerSlots,
  createEmptyScannerAssignment,
  findDetectedForAssignment,
  findIndexDetectedForAssignment,
  findAssignmentForDetected,
} from '../../src/types/graviscan';
import type { PlateConfig, ScannerConfig } from '../../src/types/graviscan';
import type { ScanCoordinatorLike } from '../../src/main/graviscan/session-handlers';

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

    it('DEFAULT_SCANNER_SLOTS is 1', () => {
      expect(DEFAULT_SCANNER_SLOTS).toBe(1);
    });

    it('MAX_SCANNER_SLOTS is 10', () => {
      expect(MAX_SCANNER_SLOTS).toBe(10);
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
    it('returns correct labels for all plate indices', () => {
      expect(formatPlateIndex('00')).toBe('A(00)');
      expect(formatPlateIndex('01')).toBe('B(01)');
      expect(formatPlateIndex('10')).toBe('C(10)');
      expect(formatPlateIndex('11')).toBe('D(11)');
    });

    it('returns the index itself for unknown indices', () => {
      expect(formatPlateIndex('99')).toBe('99');
    });
  });

  describe('generateScannerSlotName', () => {
    it('returns 1-indexed slot name', () => {
      expect(generateScannerSlotName(0)).toBe('Scanner 1');
      expect(generateScannerSlotName(1)).toBe('Scanner 2');
      expect(generateScannerSlotName(9)).toBe('Scanner 10');
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

    it('returns DEFAULT_SCANNER_SLOTS count when called without argument', () => {
      const slots = generateScannerSlots();
      expect(slots).toHaveLength(DEFAULT_SCANNER_SLOTS);
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

  describe('PlateConfig shared type', () => {
    it('has expected fields', () => {
      const plate: PlateConfig = {
        plate_index: '00',
        grid_mode: '2grid',
        resolution: 600,
        output_path: '/tmp/scan/plate00.tif',
      };
      expect(plate.plate_index).toBe('00');
      expect(plate.grid_mode).toBe('2grid');
      expect(plate.resolution).toBe(600);
      expect(plate.output_path).toBe('/tmp/scan/plate00.tif');
    });
  });

  describe('ScannerConfig shared type', () => {
    it('has expected fields with PlateConfig array', () => {
      const config: ScannerConfig = {
        scannerId: 'scanner-1',
        saneName: 'epkowa:interpreter:001:002',
        plates: [
          {
            plate_index: '00',
            grid_mode: '2grid',
            resolution: 600,
            output_path: '/tmp/scan/plate00.tif',
          },
        ],
      };
      expect(config.scannerId).toBe('scanner-1');
      expect(config.saneName).toBe('epkowa:interpreter:001:002');
      expect(config.plates).toHaveLength(1);
      expect(config.plates[0].plate_index).toBe('00');
    });
  });

  describe('ScanCoordinatorLike references shared types', () => {
    it('can construct a conforming mock with shared types', () => {
      // Verifies that ScanCoordinatorLike, ScannerConfig, and PlateConfig
      // are importable and compatible. The `implements` clause on
      // ScanCoordinator enforces this at tsc compile time for src/.
      /* eslint-disable @typescript-eslint/no-unused-vars */
      const mockCoordinator: ScanCoordinatorLike = {
        isScanning: false,
        initialize: async (_scanners: ScannerConfig[]) => {},
        scanOnce: async (_plates: Map<string, PlateConfig[]>) => {},
        scanInterval: async (
          _plates: Map<string, PlateConfig[]>,
          _interval: number,
          _duration: number
        ) => {},
        cancelAll: () => {},
        shutdown: async () => {},
        on: function () {
          return this;
        } as ScanCoordinatorLike['on'],
      };
      /* eslint-enable @typescript-eslint/no-unused-vars */
      expect(mockCoordinator.isScanning).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // fix-renderer-empty-scanner-id-collision: helpers
  // ──────────────────────────────────────────────────────────────────────

  describe('findDetectedForAssignment', () => {
    const detected = [
      {
        scanner_id: '',
        usb_port: '1-1',
        vendor_id: '04b8',
        product_id: '013a',
        name: 'Epson V850',
        usb_bus: '1',
        usb_device: '2',
      },
      {
        scanner_id: '',
        usb_port: '1-2',
        vendor_id: '04b8',
        product_id: '013a',
        name: 'Epson V850',
        usb_bus: '1',
        usb_device: '3',
      },
    ];

    it('returns the detected scanner whose usb_port matches assignment.usbPort', () => {
      const result = findDetectedForAssignment(detected, {
        scannerId: '',
        usbPort: '1-1',
      });
      expect(result).toBeDefined();
      expect(result.usb_port).toBe('1-1');
    });

    it('two placeholder lookups return two distinct detected scanners', () => {
      const a = findDetectedForAssignment(detected, {
        scannerId: '',
        usbPort: '1-1',
      });
      const b = findDetectedForAssignment(detected, {
        scannerId: '',
        usbPort: '1-2',
      });
      expect(a.usb_port).toBe('1-1');
      expect(b.usb_port).toBe('1-2');
      expect(a).not.toBe(b);
    });

    it('returns undefined when assignment.usbPort is null', () => {
      const result = findDetectedForAssignment(detected, {
        scannerId: 'some-id',
        usbPort: null,
      });
      expect(result).toBeUndefined();
    });

    it('falls back to composite key when both assignment and detected have empty usb_port', () => {
      const detectedEmptyPort = [
        {
          scanner_id: '',
          usb_port: '',
          vendor_id: '04b8',
          product_id: '013a',
          name: 'Epson V850',
          usb_bus: '1',
          usb_device: '2',
        },
        {
          scanner_id: '',
          usb_port: '',
          vendor_id: '04b8',
          product_id: '013a',
          name: 'Epson V850',
          usb_bus: '1',
          usb_device: '3',
        },
      ];
      const a = findDetectedForAssignment(detectedEmptyPort, {
        scannerId: '',
        usbPort: '',
        vendorId: '04b8',
        productId: '013a',
        name: 'Epson V850',
        usbBus: '1',
        usbDevice: '2',
      });
      const b = findDetectedForAssignment(detectedEmptyPort, {
        scannerId: '',
        usbPort: '',
        vendorId: '04b8',
        productId: '013a',
        name: 'Epson V850',
        usbBus: '1',
        usbDevice: '3',
      });
      expect(a.usb_device).toBe('2');
      expect(b.usb_device).toBe('3');
    });

    it('returns undefined when assignment has valid usbPort but no detected match', () => {
      const result = findDetectedForAssignment(detected, {
        scannerId: 'real-id',
        usbPort: '9-9',
      });
      expect(result).toBeUndefined();
    });

    it('returns undefined for empty detected array', () => {
      const result = findDetectedForAssignment([], {
        scannerId: '',
        usbPort: '1-1',
      });
      expect(result).toBeUndefined();
    });
  });

  describe('findIndexDetectedForAssignment', () => {
    const detected = [
      { scanner_id: '', usb_port: '1-1' },
      { scanner_id: '', usb_port: '1-2' },
    ];

    it('returns the array index for the matching scanner', () => {
      expect(
        findIndexDetectedForAssignment(detected, {
          scannerId: '',
          usbPort: '1-1',
        })
      ).toBe(0);
      expect(
        findIndexDetectedForAssignment(detected, {
          scannerId: '',
          usbPort: '1-2',
        })
      ).toBe(1);
    });

    it('returns -1 when no match', () => {
      expect(
        findIndexDetectedForAssignment(detected, {
          scannerId: '',
          usbPort: '9-9',
        })
      ).toBe(-1);
    });

    it('returns -1 when assignment.usbPort is null and composite has no match', () => {
      expect(
        findIndexDetectedForAssignment(detected, {
          scannerId: 'real',
          usbPort: null,
        })
      ).toBe(-1);
    });
  });

  describe('findAssignmentForDetected (inverse direction)', () => {
    const assignments = [
      { scannerId: '', usbPort: '1-1' },
      { scannerId: '', usbPort: '1-2' },
    ];

    it('returns the assignment whose usbPort matches detected.usb_port', () => {
      const a = findAssignmentForDetected(assignments, {
        scanner_id: '',
        usb_port: '1-1',
      });
      const b = findAssignmentForDetected(assignments, {
        scanner_id: '',
        usb_port: '1-2',
      });
      expect(a.usbPort).toBe('1-1');
      expect(b.usbPort).toBe('1-2');
      expect(a).not.toBe(b);
    });

    it('falls back to composite key when detected.usb_port is empty', () => {
      const assignmentsWithComposite = [
        {
          scannerId: '',
          usbPort: '',
          vendorId: '04b8',
          productId: '013a',
          name: 'Epson V850',
          usbBus: '1',
          usbDevice: '2',
        },
        {
          scannerId: '',
          usbPort: '',
          vendorId: '04b8',
          productId: '013a',
          name: 'Epson V850',
          usbBus: '1',
          usbDevice: '3',
        },
      ];
      const result = findAssignmentForDetected(assignmentsWithComposite, {
        scanner_id: '',
        usb_port: '',
        vendor_id: '04b8',
        product_id: '013a',
        name: 'Epson V850',
        usb_bus: '1',
        usb_device: '3',
      });
      expect(result.usbDevice).toBe('3');
    });

    it('returns undefined when no assignment matches', () => {
      const result = findAssignmentForDetected(assignments, {
        scanner_id: '',
        usb_port: '9-9',
      });
      expect(result).toBeUndefined();
    });
  });
});
