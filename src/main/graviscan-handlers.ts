/**
 * GraviScan IPC Handlers
 *
 * Handles IPC communication for GraviScan functionality including:
 * - Scanner detection
 * - Configuration management
 * - Scan operations
 */

import { ipcMain, app, BrowserWindow, dialog } from 'electron';
import { PrismaClient } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs';
import sharp from 'sharp';
import { detectEpsonScanners } from './lsusb-detection';
import { resolveGraviScanPath } from './graviscan-path-utils';
import type { ScanCoordinator, ScannerConfig } from './scan-coordinator';
import type { PlateConfig } from './scanner-subprocess';
import { getScanSession, setScanSession, markScanJobRecorded } from './main';
// Bloom upload temporarily disabled (proxy size limit) — re-enable when fixed
// import { uploadAllPendingScans } from './graviscan-upload';
import { runBoxBackup } from './box-backup';
import type {
  DetectedScanner,
  GraviConfig,
  GraviConfigInput,
  GraviScanner,
  GraviScanPlatformInfo,
} from '../types/graviscan';

let db: PrismaClient;

// Session validation state - runs on app startup
interface SessionValidationState {
  isValidating: boolean;
  isValidated: boolean;
  validationError: string | null;
  detectedScanners: DetectedScanner[];
  cachedScannerIds: string[];
  allScannersAvailable: boolean;
}

const sessionValidation: SessionValidationState = {
  isValidating: false,
  isValidated: false,
  validationError: null,
  detectedScanners: [],
  cachedScannerIds: [],
  allScannersAvailable: false,
};

/**
 * Run background scanner validation on app startup.
 * Compares cached scanner IDs with currently connected scanners.
 */
export async function runStartupScannerValidation(
  cachedScannerIds: string[]
): Promise<SessionValidationState> {
  sessionValidation.isValidating = true;
  sessionValidation.validationError = null;
  sessionValidation.cachedScannerIds = cachedScannerIds;

  // If no cached scanners, skip validation (first-time user)
  if (cachedScannerIds.length === 0) {
    sessionValidation.isValidating = false;
    sessionValidation.isValidated = false;
    sessionValidation.allScannersAvailable = false;
    return sessionValidation;
  }

  try {
    // Check for mock mode
    const mockEnabled = process.env.GRAVISCAN_MOCK?.toLowerCase() === 'true';

    // Get scanner records from database
    const dbScanners = await db.graviScanner.findMany({
      where: { enabled: true },
    });

    let detectedScanners: DetectedScanner[] = [];

    if (mockEnabled) {
      // Mock mode: return simulated scanners
      const mockCount = 2;
      for (let i = 0; i < mockCount; i++) {
        if (i < dbScanners.length) {
          detectedScanners.push({
            name: dbScanners[i].name,
            scanner_id: dbScanners[i].id,
            usb_bus: 1,
            usb_device: i + 1,
            usb_port: `1-${i + 1}`,
            is_available: true,
            vendor_id: dbScanners[i].vendor_id,
            product_id: dbScanners[i].product_id,
            sane_name: `epkowa:interpreter:001:${String(i + 1).padStart(3, '0')}`,
          });
        } else {
          detectedScanners.push({
            name: `Mock Scanner ${i + 1}`,
            scanner_id: `mock-scanner-${i + 1}`,
            usb_bus: 1,
            usb_device: i + 1,
            usb_port: `1-${i + 1}`,
            is_available: true,
            vendor_id: '04b8',
            product_id: '013a',
            sane_name: `epkowa:interpreter:001:${String(i + 1).padStart(3, '0')}`,
          });
        }
      }
    } else {
      // Real mode: detect via lsusb (no Python needed)
      const lsusbResult = detectEpsonScanners();

      if (!lsusbResult.success) {
        sessionValidation.isValidating = false;
        sessionValidation.isValidated = false;
        sessionValidation.validationError =
          lsusbResult.error || 'Scanner detection failed';
        return sessionValidation;
      }

      detectedScanners = lsusbResult.scanners;

      // Match detected scanners against DB records
      for (const detected of detectedScanners) {
        const match = dbScanners.find(
          (s) =>
            s.usb_bus === detected.usb_bus &&
            s.usb_device === detected.usb_device
        );
        if (match) {
          detected.scanner_id = match.id;
          detected.name = match.name;
        } else {
          const portMatch = dbScanners.find(
            (s) => s.usb_port && s.usb_port === detected.usb_port
          );
          if (portMatch) {
            detected.scanner_id = portMatch.id;
            detected.name = portMatch.name;
          }
        }
      }
    }

    sessionValidation.detectedScanners = detectedScanners;

    // Build set of currently available scanner IDs
    const currentIds = new Set(
      detectedScanners.filter((s) => s.is_available).map((s) => s.scanner_id)
    );

    // Check if all cached scanners are still available
    const allScannersAvailable = cachedScannerIds.every((id) =>
      currentIds.has(id)
    );

    sessionValidation.allScannersAvailable = allScannersAvailable;
    sessionValidation.isValidated =
      allScannersAvailable && detectedScanners.length > 0;
    sessionValidation.isValidating = false;

    if (!allScannersAvailable) {
      sessionValidation.validationError =
        'Some previously configured scanners are no longer available';
    }

    console.log('[GraviScan] Startup validation complete:', {
      cached: cachedScannerIds.length,
      detected: detectedScanners.length,
      allAvailable: allScannersAvailable,
      validated: sessionValidation.isValidated,
    });

    return sessionValidation;
  } catch (error) {
    console.error('[GraviScan] Startup validation error:', error);
    sessionValidation.isValidating = false;
    sessionValidation.isValidated = false;
    sessionValidation.validationError =
      error instanceof Error ? error.message : 'Validation failed';
    return sessionValidation;
  }
}

/**
 * Get current session validation state.
 */
export function getSessionValidationState(): SessionValidationState {
  return { ...sessionValidation };
}

/**
 * Reset session validation (called on app close via IPC from renderer).
 */
export function resetSessionValidation(): void {
  sessionValidation.isValidating = false;
  sessionValidation.isValidated = false;
  sessionValidation.validationError = null;
  sessionValidation.detectedScanners = [];
  sessionValidation.cachedScannerIds = [];
  sessionValidation.allScannersAvailable = false;
}

/**
 * Initialize GraviScan handlers with database and Python process references.
 *
 * @param database - Prisma database client
 * @param python - Main Python process (fallback for GraviScan commands)
 * @param graviscan - Optional dedicated GraviScan subprocess
 */
// Callback to get the main BrowserWindow (for sending events to renderer in mock mode)
let getMainWindow: (() => BrowserWindow | null) | null = null;
let getCoordinator: (() => ScanCoordinator | null) | null = null;

export function registerGraviscanHandlers(
  database: PrismaClient,
  mainWindowGetter?: () => BrowserWindow | null,
  coordinatorGetter?: () => ScanCoordinator | null
): void {
  getMainWindow = mainWindowGetter ?? null;
  getCoordinator = coordinatorGetter ?? null;
  db = database;

  // ==========================================================================
  // Scanner Detection
  // ==========================================================================

  /**
   * Detect connected USB scanners.
   * Calls Python backend to scan USB devices and matches with DB records.
   * In mock mode, returns simulated scanners when Python is not running.
   */
  ipcMain.handle('graviscan:detect-scanners', async () => {
    console.log('[GraviScan:DETECT] Handler called');
    try {
      // Check for mock mode
      const mockEnabled = process.env.GRAVISCAN_MOCK?.toLowerCase() === 'true';
      console.log('[GraviScan:DETECT] Mock mode:', mockEnabled);

      // Get scanner records from database
      const dbScanners = await db.graviScanner.findMany({
        where: { enabled: true },
      });
      console.log('[GraviScan:DETECT] DB scanners:', dbScanners.length);

      let detectedScanners: DetectedScanner[];

      if (mockEnabled) {
        // Mock mode: return simulated scanners
        const mockCount = 2;
        detectedScanners = [];

        for (let i = 0; i < mockCount; i++) {
          if (i < dbScanners.length) {
            detectedScanners.push({
              name: dbScanners[i].name,
              scanner_id: dbScanners[i].id,
              usb_bus: 1,
              usb_device: i + 1,
              usb_port: `1-${i + 1}`,
              is_available: true,
              vendor_id: dbScanners[i].vendor_id,
              product_id: dbScanners[i].product_id,
              sane_name: `epkowa:interpreter:001:${String(i + 1).padStart(3, '0')}`,
            });
          } else {
            detectedScanners.push({
              name: `Mock Scanner ${i + 1}`,
              scanner_id: `mock-scanner-${i + 1}`,
              usb_bus: 1,
              usb_device: i + 1,
              usb_port: `1-${i + 1}`,
              is_available: true,
              vendor_id: '04b8',
              product_id: '013a',
              sane_name: `epkowa:interpreter:001:${String(i + 1).padStart(3, '0')}`,
            });
          }
        }

        return {
          success: true,
          scanners: detectedScanners,
          count: detectedScanners.length,
          mock: true,
        };
      }

      // Real mode: detect via lsusb (no Python needed)
      console.log('[GraviScan:DETECT] Detecting scanners via lsusb...');
      const lsusbResult = detectEpsonScanners();

      if (!lsusbResult.success) {
        return {
          success: false,
          error: lsusbResult.error,
          scanners: [],
          count: 0,
        };
      }

      detectedScanners = lsusbResult.scanners;

      // Match detected scanners against DB records by usb_bus + usb_device
      for (const detected of detectedScanners) {
        const match = dbScanners.find(
          (s) =>
            s.usb_bus === detected.usb_bus &&
            s.usb_device === detected.usb_device
        );
        if (match) {
          detected.scanner_id = match.id;
          detected.name = match.name;
        } else {
          // Try matching by usb_port (stable across reboots)
          const portMatch = dbScanners.find(
            (s) => s.usb_port && s.usb_port === detected.usb_port
          );
          if (portMatch) {
            detected.scanner_id = portMatch.id;
            detected.name = portMatch.name;
          } else {
            // No DB record yet — assign a temporary ID so the renderer dropdown works.
            // Real UUID is assigned when user saves via save-scanners-db.
            detected.scanner_id = `new:${detected.usb_bus}:${detected.usb_device}`;
          }
        }
      }

      console.log(
        '[GraviScan:DETECT] Found',
        detectedScanners.length,
        'Epson scanners via lsusb'
      );

      return {
        success: true,
        scanners: detectedScanners,
        count: detectedScanners.length,
      };
    } catch (error) {
      console.error('graviscan:detect-scanners error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Detection failed',
        scanners: [],
      };
    }
  });

  // ==========================================================================
  // Configuration Management
  // ==========================================================================

  /**
   * Get GraviScan configuration.
   * Returns the first (and only) config record, or null if none exists.
   */
  ipcMain.handle('graviscan:get-config', async () => {
    try {
      const config = await db.graviConfig.findFirst();
      return {
        success: true,
        config: config as GraviConfig | null,
      };
    } catch (error) {
      console.error('graviscan:get-config error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get config',
        config: null,
      };
    }
  });

  /**
   * Save GraviScan configuration.
   * Creates or updates the config record.
   */
  ipcMain.handle(
    'graviscan:save-config',
    async (_event, configInput: GraviConfigInput) => {
      try {
        // Find existing config or create new one
        const existing = await db.graviConfig.findFirst();

        let config: GraviConfig;
        if (existing) {
          config = (await db.graviConfig.update({
            where: { id: existing.id },
            data: {
              grid_mode: configInput.grid_mode,
              resolution: configInput.resolution,
            },
          })) as GraviConfig;
        } else {
          config = (await db.graviConfig.create({
            data: {
              grid_mode: configInput.grid_mode,
              resolution: configInput.resolution,
              format: 'tiff',
            },
          })) as GraviConfig;
        }

        return {
          success: true,
          config,
        };
      } catch (error) {
        console.error('graviscan:save-config error:', error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : 'Failed to save config',
        };
      }
    }
  );

  // ==========================================================================
  // Scanner Management (Database)
  // ==========================================================================

  /**
   * Save scanners to GraviScanner table in the database.
   * Uses findFirst + upsert to avoid duplicates by name.
   * If a scanner with the same name already exists, updates the USB port info.
   * USB port info is persisted for scanner re-identification across app restarts.
   */
  ipcMain.handle(
    'graviscan:save-scanners-db',
    async (
      _event,
      scanners: Array<{
        name: string;
        display_name?: string | null;
        vendor_id: string;
        product_id: string;
        usb_port?: string;
        usb_bus?: number;
        usb_device?: number;
      }>
    ) => {
      try {
        console.log(
          '[GraviScan:SAVE] Attempting to save scanners to database:',
          JSON.stringify(scanners, null, 2)
        );
        const savedScanners: GraviScanner[] = [];

        for (const scanner of scanners) {
          // Look up existing scanner by USB bus + device (unique physical identifier)
          let existing: GraviScanner | null = null;
          if (scanner.usb_bus != null && scanner.usb_device != null) {
            existing = (await db.graviScanner.findFirst({
              where: {
                usb_bus: scanner.usb_bus,
                usb_device: scanner.usb_device,
              },
            })) as GraviScanner | null;
          }
          // Fallback: match by usb_port (stable across replug, unlike usb_device)
          if (!existing && scanner.usb_port) {
            existing = (await db.graviScanner.findFirst({
              where: { usb_port: scanner.usb_port },
            })) as GraviScanner | null;
            if (existing) {
              console.log(
                '[GraviScan:SAVE] Matched by usb_port fallback:',
                existing.name,
                existing.id,
                `port:${existing.usb_port}`
              );
            }
          }

          if (existing) {
            console.log(
              '[GraviScan:SAVE] Updating existing scanner (matched by bus:device):',
              existing.name,
              existing.id,
              `bus:${existing.usb_bus} dev:${existing.usb_device}`
            );
            const updated = await db.graviScanner.update({
              where: { id: existing.id },
              data: {
                name: scanner.name,
                display_name:
                  scanner.display_name ?? existing.display_name ?? null,
                vendor_id: scanner.vendor_id,
                product_id: scanner.product_id,
                usb_port: scanner.usb_port || null,
                usb_bus: scanner.usb_bus || null,
                usb_device: scanner.usb_device || null,
              },
            });
            console.log('[GraviScan:SAVE] Updated scanner:', {
              id: updated.id,
              name: updated.name,
              usb_bus: updated.usb_bus,
              usb_device: updated.usb_device,
            });
            savedScanners.push(updated as GraviScanner);
          } else {
            console.log(
              '[GraviScan:SAVE] Creating new scanner:',
              scanner.name,
              `bus:${scanner.usb_bus} dev:${scanner.usb_device}`
            );
            const created = await db.graviScanner.create({
              data: {
                name: scanner.name,
                display_name: scanner.display_name || null,
                vendor_id: scanner.vendor_id,
                product_id: scanner.product_id,
                usb_port: scanner.usb_port || null,
                usb_bus: scanner.usb_bus || null,
                usb_device: scanner.usb_device || null,
                enabled: true,
              },
            });
            console.log('[GraviScan:SAVE] Created scanner:', {
              id: created.id,
              name: created.name,
              usb_bus: created.usb_bus,
              usb_device: created.usb_device,
            });
            savedScanners.push(created as GraviScanner);
          }
        }

        console.log(
          `[GraviScan:SAVE] Successfully saved ${savedScanners.length} scanners to database`
        );

        return {
          success: true,
          scanners: savedScanners,
          count: savedScanners.length,
        };
      } catch (error) {
        console.error('[GraviScan:SAVE] Error saving scanners:', error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : 'Failed to save scanners',
          scanners: [],
        };
      }
    }
  );

  // ==========================================================================
  // Scan Operations
  // ==========================================================================

  // ==========================================================================
  // Platform Detection
  // ==========================================================================

  /**
   * Get platform support information.
   */
  ipcMain.handle('graviscan:platform-info', async () => {
    try {
      // Check for mock mode from environment variable
      const mockEnabled = process.env.GRAVISCAN_MOCK?.toLowerCase() === 'true';

      // If mock mode is enabled, return mock platform info immediately
      // This allows testing on macOS without scanner drivers
      if (mockEnabled) {
        return {
          success: true,
          supported: true,
          backend: 'sane' as const, // Use 'sane' as backend type for mock mode
          mock_enabled: true,
          system_name: process.env.GRAVISCAN_SYSTEM_NAME || null,
        };
      }

      // Platform detection runs entirely in TypeScript now (no Python needed)
      const platform = process.platform;
      const isSupported = platform === 'linux' || platform === 'win32';
      const backend =
        platform === 'linux'
          ? 'sane'
          : platform === 'win32'
            ? 'twain'
            : 'unsupported';

      return {
        success: true,
        supported: isSupported,
        backend: backend,
        mock_enabled: mockEnabled,
        system_name: process.env.GRAVISCAN_SYSTEM_NAME || null,
      } as { success: boolean } & GraviScanPlatformInfo;
    } catch (error) {
      console.error('graviscan:platform-info error:', error);
      return {
        success: false,
        supported: false,
        backend: 'unsupported',
        mock_enabled: false,
      } as { success: boolean } & GraviScanPlatformInfo;
    }
  });

  // ==========================================================================
  // Session Validation
  // ==========================================================================

  /**
   * Run scanner validation with cached scanner IDs from renderer.
   * Called by renderer when it has cached scanner IDs in localStorage.
   */
  ipcMain.handle(
    'graviscan:validate-scanners',
    async (_event, cachedScannerIds: string[]) => {
      return await runStartupScannerValidation(cachedScannerIds);
    }
  );

  /**
   * Validate scanner configuration by matching saved USB ports with detected scanners.
   *
   * This is the primary config validation for Phase 3:
   * 1. Load saved scanners from database (with usb_port)
   * 2. Detect currently connected USB scanners
   * 3. Match by usb_port
   *
   * Returns validation result with matched, missing, and new scanners.
   */
  ipcMain.handle('graviscan:validate-config', async () => {
    try {
      console.log('[GraviScan:VALIDATE] Starting config validation...');

      // 1. Load saved scanners from database
      const savedScanners = await db.graviScanner.findMany({
        where: { enabled: true },
        orderBy: { createdAt: 'asc' },
      });
      console.log('[GraviScan:VALIDATE] Saved scanners:', savedScanners.length);

      // If no saved scanners, return no-config status
      if (savedScanners.length === 0) {
        console.log(
          '[GraviScan:VALIDATE] No saved scanners - need configuration'
        );
        return {
          success: true,
          status: 'no-config' as const,
          matched: [],
          missing: [],
          new: [],
          savedScanners: [],
          detectedScanners: [],
        };
      }

      // 2. Detect currently connected scanners via lsusb
      const mockEnabled = process.env.GRAVISCAN_MOCK?.toLowerCase() === 'true';
      let detectedScanners: DetectedScanner[] = [];

      if (mockEnabled) {
        // Return mock scanners for testing
        detectedScanners = savedScanners.map((s, i) => ({
          name: s.name,
          scanner_id: s.id,
          usb_bus: s.usb_bus || 1,
          usb_device: s.usb_device || i + 1,
          usb_port: s.usb_port || `1-${i + 1}`,
          is_available: true,
          vendor_id: s.vendor_id,
          product_id: s.product_id,
          sane_name: `epkowa:interpreter:001:${String(s.usb_device || i + 1).padStart(3, '0')}`,
        }));
      } else {
        // Detect via lsusb (no Python needed)
        const lsusbResult = detectEpsonScanners();

        if (!lsusbResult.success) {
          return {
            success: false,
            status: 'error' as const,
            error: lsusbResult.error || 'Scanner detection failed',
            matched: [],
            missing: [],
            new: [],
            savedScanners: savedScanners as GraviScanner[],
            detectedScanners: [],
          };
        }

        detectedScanners = lsusbResult.scanners;
      }

      console.log(
        '[GraviScan:VALIDATE] Detected scanners:',
        detectedScanners.length
      );

      // 3. Match by usb_port
      const detectedByPort = new Map<string, DetectedScanner>();
      for (const detected of detectedScanners) {
        if (detected.usb_port) {
          detectedByPort.set(detected.usb_port, detected);
        }
      }

      const matched: Array<{ saved: GraviScanner; detected: DetectedScanner }> =
        [];
      const missing: GraviScanner[] = [];

      for (const saved of savedScanners) {
        if (saved.usb_port && detectedByPort.has(saved.usb_port)) {
          const detected = detectedByPort.get(saved.usb_port)!;
          matched.push({ saved: saved as GraviScanner, detected });
          detectedByPort.delete(saved.usb_port);
        } else {
          missing.push(saved as GraviScanner);
        }
      }

      // Remaining detected scanners are "new" (not in saved config)
      const newScanners = Array.from(detectedByPort.values());

      // Determine status
      const isValid =
        missing.length === 0 && newScanners.length === 0 && matched.length > 0;
      const status = isValid
        ? 'valid'
        : missing.length > 0 || newScanners.length > 0
          ? 'mismatch'
          : 'no-config';

      console.log('[GraviScan:VALIDATE] Result:', {
        status,
        matched: matched.length,
        missing: missing.length,
        new: newScanners.length,
      });

      return {
        success: true,
        status: status as 'valid' | 'mismatch' | 'no-config',
        matched,
        missing,
        new: newScanners,
        savedScanners: savedScanners as GraviScanner[],
        detectedScanners,
      };
    } catch (error) {
      console.error('[GraviScan:VALIDATE] Error:', error);
      return {
        success: false,
        status: 'error' as const,
        error: error instanceof Error ? error.message : 'Validation failed',
        matched: [],
        missing: [],
        new: [],
        savedScanners: [],
        detectedScanners: [],
      };
    }
  });

  // ==========================================================================
  // Per-Scanner Subprocess Scanning (via ScanCoordinator)
  // ==========================================================================

  /**
   * Start a scan using the per-scanner subprocess architecture.
   * Initializes subprocesses (staggered), then triggers parallel scanning.
   *
   * Params:
   *   scanners: Array<{ scannerId, saneName, plates: PlateConfig[] }>
   *   interval?: { intervalSeconds, durationSeconds } — for continuous mode
   */
  ipcMain.handle(
    'graviscan:start-scan',
    async (
      _event,
      params: {
        scanners: Array<{
          scannerId: string;
          saneName: string;
          plates: (PlateConfig & { plate_barcode?: string | null })[];
        }>;
        interval?: { intervalSeconds: number; durationSeconds: number };
        metadata?: {
          experimentId: string;
          phenotyperId: string;
          resolution: number;
          sessionId?: string;
          waveNumber?: number;
        };
      }
    ) => {
      try {
        const coordinator = getCoordinator?.();
        if (!coordinator) {
          return { success: false, error: 'ScanCoordinator not initialized' };
        }

        if (coordinator.isScanning) {
          return { success: false, error: 'Scan already in progress' };
        }

        console.log(
          `[GraviScan:START-SCAN] Starting scan with ${params.scanners.length} scanner(s)`,
          params.interval
            ? `(continuous: ${params.interval.intervalSeconds}s interval, ${params.interval.durationSeconds}s duration)`
            : '(one-shot)'
        );

        // Build scan session state for persistence across renderer remounts
        const jobs: Record<
          string,
          {
            scannerId: string;
            plateIndex: string;
            outputPath: string;
            plantBarcode: string | null;
            transplantDate: string | null;
            customNote: string | null;
            gridMode: string;
            status: 'pending' | 'scanning' | 'complete' | 'error';
            imagePath?: string;
            error?: string;
            durationMs?: number;
          }
        > = {};
        for (const s of params.scanners) {
          for (const plate of s.plates) {
            const key = `${s.scannerId}:${plate.plate_index}`;
            jobs[key] = {
              scannerId: s.scannerId,
              plateIndex: plate.plate_index,
              outputPath: plate.output_path,
              plantBarcode: plate.plate_barcode ?? null,
              transplantDate: null,
              customNote: null,
              gridMode: plate.grid_mode,
              status: 'pending',
            };
          }
        }

        const sessIntervalMs = params.interval
          ? params.interval.intervalSeconds * 1000
          : 0;
        const sessDurationMs = params.interval
          ? params.interval.durationSeconds * 1000
          : 0;

        setScanSession({
          isActive: true,
          isContinuous: !!params.interval,
          experimentId: params.metadata?.experimentId || '',
          phenotyperId: params.metadata?.phenotyperId || '',
          resolution: params.metadata?.resolution || 300,
          sessionId: params.metadata?.sessionId || null,
          jobs,
          currentCycle: 0,
          totalCycles:
            sessIntervalMs > 0 ? Math.ceil(sessDurationMs / sessIntervalMs) : 1,
          intervalMs: sessIntervalMs,
          scanStartedAt: Date.now(),
          scanDurationMs: sessDurationMs,
          coordinatorState: 'idle',
          nextScanAt: null,
          waveNumber: params.metadata?.waveNumber || 0,
        });

        // Build scanner configs for coordinator initialization
        const scannerConfigs: ScannerConfig[] = params.scanners.map((s) => ({
          scannerId: s.scannerId,
          saneName: s.saneName,
          plates: s.plates,
        }));

        // Initialize subprocesses (staggered)
        await coordinator.initialize(scannerConfigs);

        // Build plates map for scanning
        const platesPerScanner = new Map<string, PlateConfig[]>();
        for (const s of params.scanners) {
          platesPerScanner.set(s.scannerId, s.plates);
        }

        if (params.interval) {
          // Continuous mode — runs in background, events drive the rest
          const intervalMs = params.interval.intervalSeconds * 1000;
          const durationMs = params.interval.durationSeconds * 1000;

          // Don't await — let it run in background. Subprocesses stay alive after
          // completion so they can be reused for the next scan without re-opening devices.
          coordinator
            .scanInterval(platesPerScanner, intervalMs, durationMs)
            .catch((err) => {
              console.error('[GraviScan:START-SCAN] Interval scan error:', err);
              setScanSession(null);
              getMainWindow?.()?.webContents.send('graviscan:scan-error', {
                error: err instanceof Error ? err.message : String(err),
              });
            });
        } else {
          // One-shot mode — runs in background, events drive the rest.
          // Subprocesses stay alive after completion for reuse.
          coordinator.scanOnce(platesPerScanner).catch((err) => {
            console.error('[GraviScan:START-SCAN] One-shot scan error:', err);
            setScanSession(null);
            getMainWindow?.()?.webContents.send('graviscan:scan-error', {
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }

        return { success: true };
      } catch (error) {
        console.error('graviscan:start-scan error:', error);
        setScanSession(null);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Start scan failed',
        };
      }
    }
  );

  /**
   * Get current scan session status.
   * Used by the renderer to restore state after navigating away and back.
   */
  ipcMain.handle('graviscan:get-scan-status', async () => {
    const session = getScanSession();
    if (!session) {
      return { isActive: false };
    }
    return {
      isActive: session.isActive,
      experimentId: session.experimentId,
      phenotyperId: session.phenotyperId,
      resolution: session.resolution,
      sessionId: session.sessionId,
      jobs: session.jobs,
      // Continuous scan timing (for restoring UI across tab navigation)
      isContinuous: session.isContinuous,
      currentCycle: session.currentCycle,
      totalCycles: session.totalCycles,
      intervalMs: session.intervalMs,
      scanStartedAt: session.scanStartedAt,
      scanDurationMs: session.scanDurationMs,
      coordinatorState: session.coordinatorState,
      nextScanAt: session.nextScanAt,
      waveNumber: session.waveNumber,
    };
  });

  /**
   * Mark a scan job as DB-recorded so it won't be re-recorded on remount.
   */
  ipcMain.handle(
    'graviscan:mark-job-recorded',
    async (_event, jobKey: string) => {
      markScanJobRecorded(jobKey);
    }
  );

  /**
   * Cancel an in-progress scan (one-shot or continuous).
   * Sends cancel to all subprocesses and stops the interval timer.
   */
  ipcMain.handle('graviscan:cancel-scan', async () => {
    try {
      const coordinator = getCoordinator?.();
      if (!coordinator) {
        return { success: false, error: 'ScanCoordinator not initialized' };
      }

      console.log('[GraviScan:CANCEL-SCAN] Cancelling scan...');
      coordinator.cancelAll();

      // Clear scan session
      setScanSession(null);

      // Give subprocesses a moment to finish current plate, then shutdown
      await coordinator.shutdown();

      return { success: true };
    } catch (error) {
      console.error('graviscan:cancel-scan error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Cancel failed',
      };
    }
  });

  // ==========================================================================
  // Scan Output Directory
  // ==========================================================================

  /**
   * Get the scan output directory path.
   * Development: .graviscan/ in project root
   * Production: ~/.bloom/graviscan/
   */
  ipcMain.handle('graviscan:get-output-dir', async () => {
    try {
      const isDev = process.env.NODE_ENV === 'development';
      let outputDir: string;

      if (isDev) {
        // Development: use .graviscan in project root
        outputDir = path.join(app.getAppPath(), '.graviscan');
      } else {
        // Production: use ~/.bloom/graviscan/
        const homeDir = app.getPath('home');
        outputDir = path.join(homeDir, '.bloom', 'graviscan');
      }

      // Ensure directory exists
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
        console.log('[GraviScan] Created output directory:', outputDir);
      }

      return {
        success: true,
        path: outputDir,
      };
    } catch (error) {
      console.error('[GraviScan] Error getting output directory:', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to get output directory',
        path: null,
      };
    }
  });

  /**
   * Read a scan image file and return as base64 data URI.
   * Used for displaying test scan previews in the renderer.
   */
  ipcMain.handle(
    'graviscan:read-scan-image',
    async (_event, filePath: string, options?: { full?: boolean }) => {
      try {
        // Resolve file path — handle stale DB paths (missing _et_, wrong extension)
        const resolvedPath = resolveGraviScanPath(filePath);
        if (!resolvedPath) {
          console.log(
            `[read-scan-image] File not found: ${filePath} (tried extensions + _et_ fallback)`
          );
          return { success: false, error: 'File not found' };
        }
        if (resolvedPath !== filePath) {
          console.log(
            `[read-scan-image] Resolved: ${path.basename(filePath)} -> ${path.basename(resolvedPath)}`
          );
          filePath = resolvedPath;
        }
        // Convert TIFF to JPEG for preview — resize to 400px thumbnail to avoid ~212MB native alloc per decode
        const quality = options?.full ? 95 : 85;
        const pipeline = sharp(filePath);
        if (!options?.full) {
          pipeline.resize(400, null, { withoutEnlargement: true });
        }
        const jpegBuffer = await pipeline.jpeg({ quality }).toBuffer();
        const base64 = jpegBuffer.toString('base64');
        return {
          success: true,
          dataUri: `data:image/jpeg;base64,${base64}`,
        };
      } catch (error) {
        return {
          success: false,
          error:
            error instanceof Error ? error.message : 'Failed to read image',
        };
      }
    }
  );

  // ==========================================================================
  // Cloud Upload
  // ==========================================================================

  /**
   * Upload all pending/failed scans to Box backup.
   * Bloom (Supabase) upload is temporarily disabled due to proxy size limit.
   * Sends progress events to the renderer via 'graviscan:box-backup-progress'.
   */
  let uploadInProgress = false;
  ipcMain.handle('graviscan:upload-all-scans', async () => {
    if (uploadInProgress) {
      console.log('[GraviScan:UPLOAD] Upload already in progress — skipping');
      return {
        success: false,
        uploaded: 0,
        skipped: 0,
        failed: 0,
        errors: ['Upload already in progress'],
      };
    }
    uploadInProgress = true;
    try {
      console.log(
        '[GraviScan:UPLOAD] Bloom upload disabled (proxy size limit) — Box backup only'
      );

      const mainWindow = getMainWindow?.();

      // Bloom upload temporarily disabled — proxy at api.bloom.salk.edu
      // rejects files >50MB. Re-enable by restoring uploadAllPendingScans
      // to a Promise.allSettled alongside runBoxBackup.

      const boxResult = await runBoxBackup(db, (progress) => {
        mainWindow?.webContents.send('graviscan:box-backup-progress', progress);
      });

      console.log('[GraviScan:UPLOAD] Box backup result:', boxResult);

      return {
        success: boxResult.success,
        uploaded: boxResult.filesCopied,
        skipped: 0,
        failed: boxResult.errors.length,
        errors: boxResult.errors,
      };
    } catch (error) {
      console.error('[GraviScan:UPLOAD] Error:', error);
      return {
        success: false,
        uploaded: 0,
        skipped: 0,
        failed: 0,
        errors: [error instanceof Error ? error.message : 'Upload failed'],
      };
    } finally {
      uploadInProgress = false;
    }
  });

  // ============================================
  // Download Experiment Images
  // ============================================

  ipcMain.handle(
    'graviscan:download-images',
    async (
      _event,
      params: {
        experimentId: string;
        experimentName: string;
        waveNumber?: number;
      }
    ) => {
      try {
        const mainWindow = getMainWindow?.();
        if (!mainWindow) {
          return {
            success: false,
            total: 0,
            copied: 0,
            errors: ['No main window'],
          };
        }

        // Open native folder picker
        const dialogResult = await dialog.showOpenDialog(mainWindow, {
          title: 'Select download folder',
          properties: ['openDirectory', 'createDirectory'],
        });

        if (dialogResult.canceled || !dialogResult.filePaths[0]) {
          return { success: false, total: 0, copied: 0, errors: ['Cancelled'] };
        }

        const targetDir = dialogResult.filePaths[0];

        // Query images for this experiment, optionally filtered by wave
        const scans = await db.graviScan.findMany({
          where: {
            experiment_id: params.experimentId,
            deleted: false,
            ...(params.waveNumber !== undefined && {
              wave_number: params.waveNumber,
            }),
          },
          include: {
            images: true,
            experiment: {
              include: {
                accession: {
                  include: { graviPlateAccessions: true },
                },
              },
            },
          },
          orderBy: [
            { wave_number: 'asc' },
            { capture_date: 'asc' },
            { plate_index: 'asc' },
          ],
        });

        const expDir = path.join(targetDir, params.experimentName);

        // Group scans by wave number for subfolder organization
        const waveGroups = new Map<number, typeof scans>();
        for (const scan of scans) {
          const wave = scan.wave_number;
          if (!waveGroups.has(wave)) waveGroups.set(wave, []);
          waveGroups.get(wave)!.push(scan);
        }

        const csvHeader =
          'experiment,wave_number,plate_barcode,plate_index,grid_mode,capture_date,accession,transplant_date,custom_note,image_filename';
        const filesToCopy: { src: string; dest: string }[] = [];

        for (const [waveNum, waveScans] of waveGroups) {
          const waveDir = path.join(expDir, `wave_${waveNum}`);
          fs.mkdirSync(waveDir, { recursive: true });

          const csvRows: string[] = [csvHeader];

          for (const scan of waveScans) {
            const plateAccessions =
              scan.experiment.accession?.graviPlateAccessions ?? [];
            const matchedPlate = plateAccessions.find(
              (p) => p.plate_id === scan.plate_barcode
            );
            const accession = matchedPlate?.accession ?? '';

            for (const img of scan.images) {
              const srcPath = resolveGraviScanPath(img.path);
              if (!srcPath) continue;

              const originalFilename = path.basename(srcPath);
              filesToCopy.push({
                src: srcPath,
                dest: path.join(waveDir, originalFilename),
              });

              csvRows.push(
                [
                  params.experimentName,
                  scan.wave_number,
                  scan.plate_barcode ?? '',
                  scan.plate_index,
                  scan.grid_mode,
                  scan.capture_date.toISOString(),
                  accession,
                  scan.transplant_date
                    ? scan.transplant_date.toISOString().split('T')[0]
                    : '',
                  scan.custom_note ?? '',
                  originalFilename,
                ].join(',')
              );
            }
          }

          // Write metadata.csv per wave subfolder
          fs.writeFileSync(
            path.join(waveDir, 'metadata.csv'),
            csvRows.join('\n') + '\n',
            'utf-8'
          );
        }

        // Copy files with progress (async, 4 concurrent copies)
        let copied = 0;
        const errors: string[] = [];
        const COPY_CONCURRENCY = 4;
        let nextIdx = 0;

        const copyNext = async (): Promise<void> => {
          const idx = nextIdx++;
          if (idx >= filesToCopy.length) return;
          const file = filesToCopy[idx];
          try {
            await fs.promises.copyFile(file.src, file.dest);
            copied++;
            mainWindow.webContents.send('graviscan:download-progress', {
              total: filesToCopy.length,
              completed: copied,
              currentFile: path.basename(file.dest),
            });
          } catch (err) {
            errors.push(
              `${path.basename(file.src)}: ${err instanceof Error ? err.message : 'Copy failed'}`
            );
          }
          return copyNext();
        };

        await Promise.all(
          Array.from(
            { length: Math.min(COPY_CONCURRENCY, filesToCopy.length) },
            () => copyNext()
          )
        );

        const waveLabel =
          params.waveNumber !== undefined ? ` (wave ${params.waveNumber})` : '';
        console.log(
          `[GraviScan:DOWNLOAD] Copied ${copied}/${filesToCopy.length} images${waveLabel} to ${expDir}`
        );
        return {
          success: errors.length === 0,
          total: filesToCopy.length,
          copied,
          errors,
        };
      } catch (error) {
        console.error('[GraviScan:DOWNLOAD] Error:', error);
        return {
          success: false,
          total: 0,
          copied: 0,
          errors: [error instanceof Error ? error.message : 'Download failed'],
        };
      }
    }
  );
}
