/**
 * Scanner handler functions for GraviScan.
 *
 * Extracted from Ben's monolithic graviscan-handlers.ts.
 * Pure async exports with db injection — no ipcMain wrappers.
 */

import { PrismaClient } from '@prisma/client';
import { detectEpsonScanners } from '../lsusb-detection';
import type {
  DetectedScanner,
  GraviConfig,
  GraviConfigInput,
  GraviScanner,
  GraviScanPlatformInfo,
} from '../../types/graviscan';

// ---------------------------------------------------------------------------
// Session validation state — module-level singleton
// ---------------------------------------------------------------------------

export interface SessionValidationState {
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
  db: PrismaClient,
  cachedScannerIds: string[],
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
    const mockEnabled = process.env.GRAVISCAN_MOCK?.toLowerCase() === 'true';

    // Get scanner records from database
    const dbScanners = await (db as any).graviScanner.findMany({
      where: { enabled: true },
    });

    let detectedScanners: DetectedScanner[] = [];

    if (mockEnabled) {
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
          (s: any) =>
            s.usb_bus === detected.usb_bus &&
            s.usb_device === detected.usb_device,
        );
        if (match) {
          detected.scanner_id = match.id;
          detected.name = match.name;
        } else {
          const portMatch = dbScanners.find(
            (s: any) => s.usb_port && s.usb_port === detected.usb_port,
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
      detectedScanners.filter((s) => s.is_available).map((s) => s.scanner_id),
    );

    // Check if all cached scanners are still available
    const allScannersAvailable = cachedScannerIds.every((id) =>
      currentIds.has(id),
    );

    sessionValidation.allScannersAvailable = allScannersAvailable;
    sessionValidation.isValidated =
      allScannersAvailable && detectedScanners.length > 0;
    sessionValidation.isValidating = false;

    if (!allScannersAvailable) {
      sessionValidation.validationError =
        'Some previously configured scanners are no longer available';
    }

    return sessionValidation;
  } catch (error) {
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

// ---------------------------------------------------------------------------
// detectScanners
// ---------------------------------------------------------------------------

export async function detectScanners(db: PrismaClient) {
  try {
    const mockEnabled = process.env.GRAVISCAN_MOCK?.toLowerCase() === 'true';

    // Get scanner records from database
    const dbScanners = await (db as any).graviScanner.findMany({
      where: { enabled: true },
    });

    let detectedScanners: DetectedScanner[];

    if (mockEnabled) {
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

    // Real mode: detect via lsusb
    const lsusbResult = detectEpsonScanners();

    if (!lsusbResult.success) {
      return {
        success: false,
        error: lsusbResult.error,
        scanners: [] as DetectedScanner[],
        count: 0,
      };
    }

    detectedScanners = lsusbResult.scanners;

    // Match detected scanners against DB records by usb_bus + usb_device
    for (const detected of detectedScanners) {
      const match = dbScanners.find(
        (s: any) =>
          s.usb_bus === detected.usb_bus &&
          s.usb_device === detected.usb_device,
      );
      if (match) {
        detected.scanner_id = match.id;
        detected.name = match.name;
      } else {
        const portMatch = dbScanners.find(
          (s: any) => s.usb_port && s.usb_port === detected.usb_port,
        );
        if (portMatch) {
          detected.scanner_id = portMatch.id;
          detected.name = portMatch.name;
        } else {
          detected.scanner_id = `new:${detected.usb_bus}:${detected.usb_device}`;
        }
      }
    }

    return {
      success: true,
      scanners: detectedScanners,
      count: detectedScanners.length,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Detection failed',
      scanners: [] as DetectedScanner[],
    };
  }
}

// ---------------------------------------------------------------------------
// getConfig
// ---------------------------------------------------------------------------

export async function getConfig(db: PrismaClient) {
  try {
    const config = await (db as any).graviConfig.findFirst();
    return {
      success: true,
      config: config as GraviConfig | null,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get config',
      config: null as GraviConfig | null,
    };
  }
}

// ---------------------------------------------------------------------------
// saveConfig
// ---------------------------------------------------------------------------

export async function saveConfig(db: PrismaClient, configInput: GraviConfigInput) {
  try {
    const existing = await (db as any).graviConfig.findFirst();

    let config: GraviConfig;
    if (existing) {
      config = (await (db as any).graviConfig.update({
        where: { id: existing.id },
        data: {
          grid_mode: configInput.grid_mode,
          resolution: configInput.resolution,
        },
      })) as GraviConfig;
    } else {
      config = (await (db as any).graviConfig.create({
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
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save config',
    };
  }
}

// ---------------------------------------------------------------------------
// saveScannersToDB
// ---------------------------------------------------------------------------

export async function saveScannersToDB(
  db: PrismaClient,
  scanners: Array<{
    name: string;
    display_name?: string | null;
    vendor_id: string;
    product_id: string;
    usb_port?: string;
    usb_bus?: number;
    usb_device?: number;
  }>,
) {
  try {
    const savedScanners: GraviScanner[] = [];

    for (const scanner of scanners) {
      // Look up existing scanner by USB bus + device (unique physical identifier)
      let existing: GraviScanner | null = null;
      if (scanner.usb_bus != null && scanner.usb_device != null) {
        existing = (await (db as any).graviScanner.findFirst({
          where: {
            usb_bus: scanner.usb_bus,
            usb_device: scanner.usb_device,
          },
        })) as GraviScanner | null;
      }
      // Fallback: match by usb_port (stable across replug, unlike usb_device)
      if (!existing && scanner.usb_port) {
        existing = (await (db as any).graviScanner.findFirst({
          where: { usb_port: scanner.usb_port },
        })) as GraviScanner | null;
      }

      if (existing) {
        const updated = await (db as any).graviScanner.update({
          where: { id: existing.id },
          data: {
            name: scanner.name,
            display_name: scanner.display_name ?? existing.display_name ?? null,
            vendor_id: scanner.vendor_id,
            product_id: scanner.product_id,
            usb_port: scanner.usb_port || null,
            usb_bus: scanner.usb_bus || null,
            usb_device: scanner.usb_device || null,
          },
        });
        savedScanners.push(updated as GraviScanner);
      } else {
        const created = await (db as any).graviScanner.create({
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
        savedScanners.push(created as GraviScanner);
      }
    }

    return {
      success: true,
      scanners: savedScanners,
      count: savedScanners.length,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save scanners',
      scanners: [] as GraviScanner[],
    };
  }
}

// ---------------------------------------------------------------------------
// getPlatformInfo
// ---------------------------------------------------------------------------

export async function getPlatformInfo() {
  try {
    const mockEnabled = process.env.GRAVISCAN_MOCK?.toLowerCase() === 'true';

    if (mockEnabled) {
      return {
        success: true,
        supported: true,
        backend: 'sane' as const,
        mock_enabled: true,
        system_name: process.env.GRAVISCAN_SYSTEM_NAME || null,
      };
    }

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
    return {
      success: false,
      supported: false,
      backend: 'unsupported',
      mock_enabled: false,
    } as { success: boolean } & GraviScanPlatformInfo;
  }
}

// ---------------------------------------------------------------------------
// validateConfig
// ---------------------------------------------------------------------------

export async function validateConfig(db: PrismaClient) {
  try {
    // 1. Load saved scanners from database
    const savedScanners = await (db as any).graviScanner.findMany({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
    });

    // If no saved scanners, return no-config status
    if (savedScanners.length === 0) {
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
      detectedScanners = savedScanners.map((s: any, i: number) => ({
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
      const lsusbResult = detectEpsonScanners();

      if (!lsusbResult.success) {
        return {
          success: false,
          status: 'error' as const,
          error: lsusbResult.error || 'Scanner detection failed',
          matched: [] as Array<{ saved: GraviScanner; detected: DetectedScanner }>,
          missing: [] as GraviScanner[],
          new: [] as DetectedScanner[],
          savedScanners: savedScanners as GraviScanner[],
          detectedScanners: [] as DetectedScanner[],
        };
      }

      detectedScanners = lsusbResult.scanners;
    }

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
    return {
      success: false,
      status: 'error' as const,
      error: error instanceof Error ? error.message : 'Validation failed',
      matched: [] as Array<{ saved: GraviScanner; detected: DetectedScanner }>,
      missing: [] as GraviScanner[],
      new: [] as DetectedScanner[],
      savedScanners: [] as GraviScanner[],
      detectedScanners: [] as DetectedScanner[],
    };
  }
}
