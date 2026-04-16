/**
 * Test fixture factory functions for GraviScan entities.
 * Used by unit tests and E2E tests to create consistent test data.
 */

import type {
  DetectedScanner,
  GraviConfig,
  GraviScanner,
  GraviScan,
  GraviImage,
  GraviScanSession,
  PlateAssignment,
  GraviScanPlatformInfo,
  ScanSessionState,
  ScanSessionJob,
} from '../../src/types/graviscan';

// =============================================================================
// DetectedScanner
// =============================================================================

let scannerCounter = 0;

export function createDetectedScanner(
  overrides: Partial<DetectedScanner> = {}
): DetectedScanner {
  scannerCounter++;
  return {
    name: `Mock Scanner ${scannerCounter}`,
    scanner_id: `mock-scanner-${scannerCounter}`,
    usb_bus: 1,
    usb_device: scannerCounter,
    usb_port: `1-${scannerCounter}`,
    is_available: true,
    vendor_id: '04b8',
    product_id: '013a',
    sane_name: `epkowa:interpreter:001:${String(scannerCounter).padStart(3, '0')}`,
    ...overrides,
  };
}

// =============================================================================
// GraviConfig
// =============================================================================

export function createGraviConfig(
  overrides: Partial<GraviConfig> = {}
): GraviConfig {
  return {
    id: 'config-1',
    grid_mode: '2grid',
    resolution: 600,
    format: 'tiff',
    usb_signature: null,
    updatedAt: new Date('2026-04-16T10:00:00Z'),
    ...overrides,
  };
}

// =============================================================================
// GraviScanner
// =============================================================================

let graviScannerCounter = 0;

export function createGraviScanner(
  overrides: Partial<GraviScanner> = {}
): GraviScanner {
  graviScannerCounter++;
  return {
    id: `scanner-${graviScannerCounter}`,
    name: `Epson Perfection V600 Photo #${graviScannerCounter}`,
    display_name: `Scanner ${graviScannerCounter}`,
    vendor_id: '04b8',
    product_id: '013a',
    usb_port: `1-${graviScannerCounter}`,
    usb_bus: 1,
    usb_device: graviScannerCounter,
    enabled: true,
    createdAt: new Date('2026-04-16T10:00:00Z'),
    updatedAt: new Date('2026-04-16T10:00:00Z'),
    ...overrides,
  };
}

// =============================================================================
// GraviScan
// =============================================================================

let graviScanCounter = 0;

export function createGraviScan(
  overrides: Partial<GraviScan> = {}
): GraviScan {
  graviScanCounter++;
  const dateStr = '2026-04-16';
  return {
    id: `graviscan-${graviScanCounter}`,
    experiment_id: 'exp-1',
    phenotyper_id: 'pheno-1',
    scanner_id: 'scanner-1',
    session_id: 'session-1',
    cycle_number: 1,
    wave_number: 1,
    plate_barcode: `PLATE-${graviScanCounter}`,
    transplant_date: new Date('2026-04-10'),
    custom_note: null,
    path: `${dateStr}/graviscan-${graviScanCounter}`,
    capture_date: new Date(`${dateStr}T14:30:00Z`),
    scan_started_at: new Date(`${dateStr}T14:30:00Z`),
    scan_ended_at: new Date(`${dateStr}T14:31:15Z`),
    grid_mode: '2grid',
    plate_index: '00',
    resolution: 600,
    format: 'tiff',
    deleted: false,
    ...overrides,
  };
}

// =============================================================================
// GraviImage
// =============================================================================

let graviImageCounter = 0;

export function createGraviImage(
  overrides: Partial<GraviImage> = {}
): GraviImage {
  graviImageCounter++;
  return {
    id: `image-${graviImageCounter}`,
    graviscan_id: 'graviscan-1',
    path: `2026-04-16/graviscan-1/plate_00_st_20260416T143000_et_20260416T143115_cy1.tiff`,
    status: 'pending',
    box_status: 'pending',
    ...overrides,
  };
}

// =============================================================================
// GraviScanSession
// =============================================================================

let sessionCounter = 0;

export function createGraviScanSession(
  overrides: Partial<GraviScanSession> = {}
): GraviScanSession {
  sessionCounter++;
  return {
    id: `session-${sessionCounter}`,
    experiment_id: 'exp-1',
    phenotyper_id: 'pheno-1',
    scan_mode: 'single',
    interval_seconds: null,
    duration_seconds: null,
    total_cycles: 1,
    started_at: new Date('2026-04-16T14:30:00Z'),
    completed_at: null,
    cancelled: false,
    ...overrides,
  };
}

// =============================================================================
// PlateAssignment
// =============================================================================

export function createPlateAssignment(
  overrides: Partial<PlateAssignment> = {}
): PlateAssignment {
  return {
    plateIndex: '00',
    plantBarcode: null,
    transplantDate: null,
    customNote: null,
    selected: true,
    ...overrides,
  };
}

// =============================================================================
// GraviScanPlateAssignment (DB record shape)
// =============================================================================

export interface GraviScanPlateAssignmentRecord {
  id: string;
  experiment_id: string;
  scanner_id: string;
  plate_index: string;
  plate_barcode: string | null;
  transplant_date: Date | null;
  custom_note: string | null;
  selected: boolean;
  createdAt: Date;
  updatedAt: Date;
}

let plateAssignmentCounter = 0;

export function createGraviScanPlateAssignmentRecord(
  overrides: Partial<GraviScanPlateAssignmentRecord> = {}
): GraviScanPlateAssignmentRecord {
  plateAssignmentCounter++;
  return {
    id: `plate-assign-${plateAssignmentCounter}`,
    experiment_id: 'exp-1',
    scanner_id: 'scanner-1',
    plate_index: '00',
    plate_barcode: null,
    transplant_date: null,
    custom_note: null,
    selected: true,
    createdAt: new Date('2026-04-16T10:00:00Z'),
    updatedAt: new Date('2026-04-16T10:00:00Z'),
    ...overrides,
  };
}

// =============================================================================
// GraviScanPlatformInfo
// =============================================================================

export function createPlatformInfo(
  overrides: Partial<GraviScanPlatformInfo> = {}
): GraviScanPlatformInfo {
  return {
    supported: true,
    backend: 'sane',
    mock_enabled: true,
    system_name: 'Linux',
    ...overrides,
  };
}

// =============================================================================
// ScanSessionState (in-memory state)
// =============================================================================

export function createScanSessionState(
  overrides: Partial<ScanSessionState> = {}
): ScanSessionState {
  return {
    isActive: false,
    isContinuous: false,
    experimentId: 'exp-1',
    phenotyperId: 'pheno-1',
    resolution: 600,
    sessionId: null,
    jobs: {},
    currentCycle: 0,
    totalCycles: 1,
    intervalMs: 0,
    scanStartedAt: 0,
    scanEndedAt: null,
    scanDurationMs: 0,
    coordinatorState: 'idle',
    nextScanAt: null,
    waveNumber: 1,
    ...overrides,
  };
}

// =============================================================================
// ScanSessionJob
// =============================================================================

export function createScanSessionJob(
  overrides: Partial<ScanSessionJob> = {}
): ScanSessionJob {
  return {
    scannerId: 'scanner-1',
    plateIndex: '00',
    outputPath: '/tmp/graviscan/2026-04-16/scan-1/plate_00.tiff',
    plantBarcode: null,
    transplantDate: null,
    customNote: null,
    gridMode: '2grid',
    status: 'pending',
    ...overrides,
  };
}

// =============================================================================
// Reset counters (for test isolation)
// =============================================================================

export function resetFixtureCounters(): void {
  scannerCounter = 0;
  graviScannerCounter = 0;
  graviScanCounter = 0;
  graviImageCounter = 0;
  sessionCounter = 0;
  plateAssignmentCounter = 0;
}
