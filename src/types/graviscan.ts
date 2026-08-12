/**
 * Type definitions for GraviScan functionality.
 */

import type { WedgeDetectedEvent } from '../main/wedge-detector';

/** Renderer-facing alias for the main-process wedge-detector's event shape.
 * Type-only import — erased at compile time, so this does not pull
 * wedge-detector.ts's runtime code into the renderer bundle. */
export type GraviWedgeEvent = WedgeDetectedEvent;

// =============================================================================
// Scan Timing Constants
// Empirical values from Epson Perfection V600 at 1200dpi with 2 scanners.
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
  scan_started_at: Date | null;
  scan_ended_at: Date | null;
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
  box_status: string; // Box backup: "pending" | "uploaded" | "failed" | "collision" (requires manual resolution — never auto-retried)
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
 * Restricted to the V600-validated set (issue #232) — 3200/6400 are not
 * reliably achievable on the production scanner hardware.
 */
export const GRAVISCAN_RESOLUTIONS = [200, 400, 600, 800, 1200, 1600] as const;

export type GraviScanResolution = (typeof GRAVISCAN_RESOLUTIONS)[number];

/**
 * Type guard for the validated GraviScan resolution set.
 */
export function isValidResolution(value: number): value is GraviScanResolution {
  return (GRAVISCAN_RESOLUTIONS as readonly number[]).includes(value);
}

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
 * Plate configuration for a single scan operation.
 * Used by scan-coordinator, scanner-subprocess, and session-handlers.
 */
export interface PlateConfig {
  plate_index: string;
  grid_mode: GridMode;
  resolution: number;
  output_path: string;
  exp_name?: string;
  wave_number?: number;
  phenotyper_name?: string;
  st_timestamp?: string;
}

/**
 * Scanner configuration for coordinator initialization.
 * Maps a physical scanner to its SANE name and plate assignments.
 */
export interface ScannerConfig {
  scannerId: string;
  saneName: string;
  plates: PlateConfig[];
}

/**
 * Result of a full USB reset (shutdown → re-detect → re-initialize).
 */
export interface ResetUsbResult {
  success: boolean;
  scanners?: Array<{ id: string; status: 'ready' | 'disconnected' }>;
  error?: string;
}

/**
 * Merged live-coordinator + saved-DB row shown on the Configure Scanner
 * page. Shared between `electron.d.ts` (GraviAPI.getScannerStatus) and
 * ConfigureScanner.tsx so the two don't drift, as they did for `resetUsb()`.
 */
export interface ScannerStatusRow {
  scannerId: string;
  displayName: string;
  usbPort: string | null;
  gridMode: string;
  status: 'ready' | 'starting' | 'error' | 'dead' | 'disconnected';
  error?: string;
}

/** Input payload for `graviscan:save-scanners-db`. */
export type SaveScannersInput = Array<{
  name: string;
  display_name?: string | null;
  vendor_id: string;
  product_id: string;
  usb_port?: string;
  usb_bus?: number;
  usb_device?: number;
}>;

/** Result of `graviscan:detect-scanners` (`scanner-handlers.ts#detectScanners`). */
export interface DetectScannersResult {
  success: boolean;
  scanners: DetectedScanner[];
  count: number;
  mock?: boolean;
  error?: string;
}

/** Result of `graviscan:get-config` (`scanner-handlers.ts#getConfig`). */
export interface GetConfigResult {
  success: boolean;
  config: GraviConfig | null;
  error?: string;
}

/** Result of `graviscan:save-config` (`scanner-handlers.ts#saveConfig`). */
export interface SaveConfigResult {
  success: boolean;
  config?: GraviConfig;
  error?: string;
}

/** Result of `graviscan:save-scanners-db` (`scanner-handlers.ts#saveScannersToDB`). */
export interface SaveScannersToDBResult {
  success: boolean;
  scanners: GraviScanner[];
  count?: number;
  disabled: string[];
  error?: string;
}

/**
 * Result of `graviscan:get-scan-status` (`session-handlers.ts#getScanStatus`).
 * The underlying session-state object is intentionally loosely typed
 * (`Record<string, any>` server-side) — this only pins down the one field
 * every caller actually relies on.
 */
export interface GetScanStatusResult {
  isActive: boolean;
  [key: string]: unknown;
}

/**
 * Substring that marks a `UploadAllScansResult.boxErrors` entry as a
 * filename-collision error (see box-backup.ts's runBoxBackup) rather than
 * an ordinary transient failure — a collision needs the operator to
 * rename a conflicting file and manually reset the image's status, since
 * (unlike every other boxErrors entry) it will never resolve on its own
 * via retry. Shared between box-backup.ts (which generates the message)
 * and the renderer (which needs to recognize and prioritize it) so a
 * future wording tweak to the message can't silently break the
 * renderer's matching with no compiler error.
 */
export const BOX_COLLISION_ERROR_MARKER = 'NOT resolve on retry';

/**
 * Result of `graviscan:upload-all-scans`
 * (`image-handlers.ts#uploadAllScans`) — the data payload nested under the
 * IPC-wide `{success, data}`/`{success, error}` envelope, not the envelope
 * itself.
 */
export interface UploadAllScansResult {
  success: boolean;
  uploaded: number;
  skipped: number;
  failed: number;
  errors: string[];
  /**
   * Whether the installed @salk-hpi/bloom-js supports Bloom session/plate-
   * metadata linking (see graviscan-upload.ts's UploadResult). Surfaced here
   * so a future renderer can show operators when metadata linking isn't
   * active, rather than that only being visible in main-process logs.
   */
  metadataLinkingAvailable: boolean;
  /**
   * Per-target success/counts/errors, in addition to the merged fields
   * above. Bloom (Supabase) and Box (rclone) run independently, so one can
   * fully succeed while the other fails outright — the renderer needs these
   * to attribute a failure message to the right system rather than
   * reporting e.g. a Bloom-only failure as a generic "Box backup failed".
   */
  bloomSuccess: boolean;
  boxSuccess: boolean;
  bloomUploaded: number;
  boxUploaded: number;
  bloomErrors: string[];
  boxErrors: string[];
}

/**
 * Result of `graviscan:read-scan-image`
 * (`image-handlers.ts#readScanImage`) — this IS the whole IPC response,
 * not a payload nested under a further envelope. `readScanImage` never
 * throws, so `register-handlers.ts` returns it directly rather than
 * passing it through `wrapHandler`.
 */
export interface ReadScanImageResult {
  success: boolean;
  dataUri?: string;
  error?: string;
}

/**
 * Payload of the `graviscan:upload-progress` push event
 * (`box-backup.ts`'s `BoxBackupProgress`, forwarded verbatim by
 * `uploadAllScans`'s `onProgress` callback). Previously untyped (`any`),
 * which let three independent, unlinked hand-typed mirrors of this same
 * shape drift across `BrowseGraviScans.tsx`, `Layout.tsx`, and this file's
 * own main-process source of truth with no compiler check tying them
 * together.
 */
export interface BoxBackupProgress {
  totalImages: number;
  completedImages: number;
  failedImages: number;
  currentExperiment: string;
}

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
 * Format a plate index for display — alias for getPlateLabel.
 */
export const formatPlateIndex = getPlateLabel;

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

// =============================================================================
// Scan Session State (used by main.ts for IPC session tracking)
// =============================================================================

export interface ScanSessionJob {
  scannerId: string;
  plateIndex: string;
  outputPath: string;
  plantBarcode: string | null;
  transplantDate: string | null;
  customNote: string | null;
  gridMode: string;
  status: 'pending' | 'scanning' | 'complete' | 'error' | 'recorded';
  imagePath?: string;
  error?: string;
  durationMs?: number;
}

/** A single parsed worksheet from a metadata spreadsheet upload. */
export interface ParsedSheet {
  headers: string[];
  rows: string[][];
}

/**
 * Result of `graviscan:parse-excel-file` (`excel-parser.ts#parseExcelWorkbook`).
 * Parsing runs in the main process — exceljs's browser bundle has a
 * require() call that survives webpack bundling and throws in the
 * renderer's sandbox.
 */
export interface ParsedWorkbook {
  sheetNames: string[];
  sheets: Record<string, ParsedSheet>;
}

export interface ScanSessionState {
  isActive: boolean;
  isContinuous: boolean;
  experimentId: string;
  phenotyperId: string;
  resolution: number;
  sessionId: string | null;
  jobs: Record<string, ScanSessionJob>;
  currentCycle: number;
  totalCycles: number;
  intervalMs: number;
  scanStartedAt: number;
  scanEndedAt: number | null;
  scanDurationMs: number;
  coordinatorState: 'idle' | 'scanning' | 'waiting';
  nextScanAt: number | null;
  waveNumber: number;
}
