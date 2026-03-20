/**
 * Type definitions for GraviScan functionality.
 */

// =============================================================================
// Scan Timing Constants
// Empirical values from Epson Perfection V39 at 1200dpi with 2 scanners.
// Measured: ~1m15s for 2 grids, ~2m36s for 4 grids.
// Minimum interval must exceed the total cycle scan time.
// =============================================================================

/** Minimum scan interval in minutes (must be > worst-case cycle time of ~2m36s for 4 grids) */
export const MIN_SCAN_INTERVAL_MINUTES = 3;

/**
 * Detected scanner at runtime.
 * USB details are ephemeral and detected when scanning for devices.
 */
export interface DetectedScanner {
  name: string;
  scanner_id: string;
  usb_bus: number;
  usb_device: number;
  usb_port: string;
  is_available: boolean;
  vendor_id: string;
  product_id: string;
  sane_name?: string; // SANE device identifier (e.g., "epkowa:usb:001:005")
}

/**
 * GraviScan configuration from database.
 */
export interface GraviConfig {
  id: string;
  grid_mode: '2grid' | '4grid';
  resolution: number;
  format: string; // Reserved for future format selection
  usb_signature: string | null; // Reserved for future USB signature caching
  updatedAt: Date;
}

/**
 * Input for saving GraviScan configuration.
 */
export interface GraviConfigInput {
  grid_mode: '2grid' | '4grid';
  resolution: number;
}

/**
 * GraviScanner record from database.
 * Includes USB port info for scanner re-identification across app restarts.
 */
export interface GraviScanner {
  id: string;
  name: string;
  display_name: string | null; // User-assigned slot name (e.g., "Scanner 1")
  vendor_id: string;
  product_id: string;
  usb_port: string | null; // Stable USB port identifier (e.g., "1-2")
  usb_bus: number | null; // USB bus number
  usb_device: number | null; // USB device number (can change on replug)
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * GraviScan record from database - represents a single scan operation.
 */
export interface GraviScan {
  id: string;
  experiment_id: string;
  phenotyper_id: string;
  scanner_id: string;
  session_id: string | null;
  cycle_number: number | null;
  wave_number: number;
  plate_barcode: string | null;
  transplant_date: Date | null;
  custom_note: string | null;
  path: string;
  capture_date: Date;
  grid_mode: string;
  plate_index: string;
  resolution: number;
  format: string;
  deleted: boolean;
}

/**
 * GraviScanSession record - groups scans from a single "Start Scan" click.
 */
export interface GraviScanSession {
  id: string;
  experiment_id: string;
  phenotyper_id: string;
  scan_mode: string;
  interval_seconds: number | null;
  duration_seconds: number | null;
  total_cycles: number | null;
  started_at: Date;
  completed_at: Date | null;
  cancelled: boolean;
}

/**
 * GraviScan with all related data, returned by the browse query.
 */
export interface GraviScanWithRelations extends GraviScan {
  experiment: {
    id: string;
    name: string;
    species: string;
    experiment_type: string;
    scientist?: { id: string; name: string; email: string } | null;
  };
  phenotyper: { id: string; name: string; email: string };
  scanner: { id: string; name: string; display_name?: string | null };
  images: GraviImage[];
  session: GraviScanSession | null;
}

/**
 * Experiment with all its GraviScans and related data, returned by experiment-based browse.
 */
export interface ExperimentWithScans {
  id: string;
  name: string;
  species: string;
  scientist?: { id: string; name: string; email: string } | null;
  accession?: { id: string; name: string } | null;
  scans: GraviScanWithRelations[];
}

/**
 * GraviImage record from database - represents an image from a scan.
 */
export interface GraviImage {
  id: string;
  graviscan_id: string;
  path: string;
  status: string; // Bloom upload: "pending" | "uploaded" | "failed"
  box_status: string; // Box backup: "pending" | "uploaded" | "failed"
}

/**
 * Platform information for GraviScan support.
 */
export interface GraviScanPlatformInfo {
  supported: boolean;
  backend: 'sane' | 'twain' | 'unsupported';
  mock_enabled: boolean;
  system_name?: string | null;
}

/**
 * Available resolutions for GraviScan (DPI).
 */
export const GRAVISCAN_RESOLUTIONS = [
  200, 400, 600, 800, 1200, 1600, 3200, 6400,
] as const;

export type GraviScanResolution = (typeof GRAVISCAN_RESOLUTIONS)[number];

/**
 * Grid mode options.
 */
export type GridMode = '2grid' | '4grid';

/**
 * Plate indices by grid mode.
 */
export const PLATE_INDICES: Record<GridMode, string[]> = {
  '2grid': ['00', '01'],
  '4grid': ['00', '01', '10', '11'],
};

/**
 * Scanner state during scan operations.
 */
export type ScannerState =
  | 'idle'
  | 'scanning'
  | 'waiting'
  | 'complete'
  | 'error';

/**
 * Per-scanner state for tracking scan progress.
 */
export interface ScannerPanelState {
  scannerId: string;
  name: string;
  enabled: boolean;
  isOnline: boolean;
  isBusy: boolean;
  state: ScannerState;
  progress: number;
  outputFilename: string;
  lastError?: string;
}

/**
 * Plate assignment - maps a plate position to a plant barcode.
 * Used to track which plant is on which plate position.
 */
export interface PlateAssignment {
  plateIndex: string; // "00", "01", "10", "11"
  plantBarcode: string | null; // Plant barcode or null if not assigned
  transplantDate: string | null; // ISO date string (YYYY-MM-DD) or null
  customNote: string | null; // Free-form metadata text or null
  selected: boolean; // Whether this plate is selected for scanning
}

/**
 * Plate metadata from GraviScan accession data.
 * Used for plate-level assignment on the Scan page (vs barcode-level for CylScan).
 */
export interface AvailablePlate {
  id: string; // GraviPlateAccession database ID
  plate_id: string; // Human-readable plate identifier (e.g., "PLATE_001")
  accession: string; // Accession/genotype line (e.g., "Ara-1")
  custom_note: string | null; // User-defined note from metadata CSV
  sectionCount: number; // Number of sections on this plate
  plantQrCodes: string[]; // All plant QR codes from sections
}

/**
 * Create plate assignments for a grid mode.
 */
export function createPlateAssignments(gridMode: GridMode): PlateAssignment[] {
  return PLATE_INDICES[gridMode].map(
    (plateIndex): PlateAssignment => ({
      plateIndex,
      plantBarcode: null,
      transplantDate: null,
      customNote: null,
      selected: true,
    })
  );
}

const PLATE_INDEX_LABELS: Record<string, string> = {
  '00': 'A(00)',
  '01': 'B(01)',
  '10': 'C(10)',
  '11': 'D(11)',
};

/**
 * Get plate label for display - e.g., "A(00)", "B(01)", "C(10)", "D(11)".
 */
export function getPlateLabel(plateIndex: string): string {
  return PLATE_INDEX_LABELS[plateIndex] ?? plateIndex;
}

/**
 * Format a plate index for display — standalone version without gridMode.
 */
export function formatPlateIndex(plateIndex: string): string {
  return PLATE_INDEX_LABELS[plateIndex] ?? plateIndex;
}

/**
 * Scanner assignment - maps a slot name to a detected scanner.
 * Used for user-selected scanner configuration.
 */
export interface ScannerAssignment {
  slot: string; // "Scanner 1", "Scanner 2", etc.
  scannerId: string | null; // Assigned scanner ID or null if not assigned
  usbPort: string | null; // USB port for display (e.g., "1-2")
  gridMode: '2grid' | '4grid'; // Per-scanner grid mode
}

/**
 * Default number of scanner slots to start with (user can add more).
 */
export const DEFAULT_SCANNER_SLOTS = 1;

/**
 * Maximum number of scanner slots allowed.
 */
export const MAX_SCANNER_SLOTS = 10;

/**
 * Generate a single scanner slot name.
 */
export function generateScannerSlotName(index: number): string {
  return `Scanner ${index + 1}`;
}

/**
 * Generate default scanner slot names.
 */
export function generateScannerSlots(
  count: number = DEFAULT_SCANNER_SLOTS
): string[] {
  return Array.from({ length: count }, (_, i) => generateScannerSlotName(i));
}

/**
 * Create an empty scanner assignment for a slot.
 */
export function createEmptyScannerAssignment(
  slotIndex: number
): ScannerAssignment {
  return {
    slot: generateScannerSlotName(slotIndex),
    scannerId: null,
    usbPort: null,
    gridMode: '2grid', // Default to 2-grid
  };
}
