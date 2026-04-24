/**
 * Scanner handler functions for GraviScan.
 *
 * Extracted from Ben's monolithic graviscan-handlers.ts.
 * Pure async exports with db injection — no ipcMain wrappers.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

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
// Constants
// ---------------------------------------------------------------------------

const MOCK_SCANNER_COUNT = 2;

// ---------------------------------------------------------------------------
// Helpers — mock-scanner construction & DB matching
// ---------------------------------------------------------------------------

/**
 * Build mock DetectedScanner objects from DB records (or generate fakes when
 * there are fewer DB records than MOCK_SCANNER_COUNT).
 */
function buildMockScanners(dbScanners: any[]): DetectedScanner[] {
  const scanners: DetectedScanner[] = [];
  for (let i = 0; i < MOCK_SCANNER_COUNT; i++) {
    if (i < dbScanners.length) {
      scanners.push({
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
      scanners.push({
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
  return scanners;
}

/**
 * Match detected scanners to DB records by USB bus+device, falling back to
 * usb_port. Mutates `detectedScanners` in-place (sets scanner_id and name).
 */
function matchDetectedToDb(
  detectedScanners: DetectedScanner[],
  dbScanners: any[]
): void {
  for (const detected of detectedScanners) {
    const match = dbScanners.find(
      (s: any) =>
        s.usb_bus === detected.usb_bus && s.usb_device === detected.usb_device
    );
    if (match) {
      detected.scanner_id = match.id;
      detected.name = match.name;
    } else {
      const portMatch = dbScanners.find(
        (s: any) => s.usb_port && s.usb_port === detected.usb_port
      );
      if (portMatch) {
        detected.scanner_id = portMatch.id;
        detected.name = portMatch.name;
      }
    }
  }
}

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
  cachedScannerIds: string[]
): Promise<SessionValidationState> {
  sessionValidation.isValidating = true;
  sessionValidation.validationError = null;
  sessionValidation.cachedScannerIds = [...cachedScannerIds];

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
      detectedScanners = buildMockScanners(dbScanners);
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
      matchDetectedToDb(detectedScanners, dbScanners);
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
  return {
    ...sessionValidation,
    detectedScanners: [...sessionValidation.detectedScanners],
    cachedScannerIds: [...sessionValidation.cachedScannerIds],
  };
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
      detectedScanners = buildMockScanners(dbScanners);

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
    matchDetectedToDb(detectedScanners, dbScanners);

    // Tag any still-unmatched scanners as new
    for (const detected of detectedScanners) {
      if (!detected.scanner_id) {
        detected.scanner_id = `new:${detected.usb_bus}:${detected.usb_device}`;
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
      count: 0,
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

export async function saveConfig(
  db: PrismaClient,
  configInput: GraviConfigInput
) {
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
  }>
) {
  // Reject empty payload (Task 2.8: defense-in-depth with renderer's zero-enabled guard)
  if (scanners.length === 0) {
    return {
      success: false,
      error: 'no scanners to save',
      scanners: [] as GraviScanner[],
    };
  }

  try {
    const savedScanners: GraviScanner[] = [];

    for (const scanner of scanners) {
      let existing: GraviScanner | null = null;

      // Match by usb_port primary (stable across replug — see #182).
      if (scanner.usb_port) {
        existing = (await (db as any).graviScanner.findFirst({
          where: { usb_port: scanner.usb_port },
        })) as GraviScanner | null;
      }
      // Fallback: composite (vendor_id, product_id, name, usb_bus, usb_device).
      // Intentionally does NOT match by (usb_bus, usb_device) alone — the OS
      // reassigns usb_device, so bus+device alone could match an unrelated row.
      if (!existing && scanner.usb_bus != null && scanner.usb_device != null) {
        existing = (await (db as any).graviScanner.findFirst({
          where: {
            vendor_id: scanner.vendor_id,
            product_id: scanner.product_id,
            name: scanner.name,
            usb_bus: scanner.usb_bus,
            usb_device: scanner.usb_device,
          },
        })) as GraviScanner | null;
      }

      if (existing) {
        const updated = await (db as any).graviScanner.update({
          where: { id: existing.id },
          data: {
            name: scanner.name,
            // `display_name: undefined` from renderer means "preserve admin-chosen value"
            display_name: scanner.display_name ?? existing.display_name ?? null,
            vendor_id: scanner.vendor_id,
            product_id: scanner.product_id,
            usb_port: scanner.usb_port || null,
            usb_bus: scanner.usb_bus || null,
            usb_device: scanner.usb_device || null,
            enabled: true,
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
// disableMissingScanners (Task 2.9)
// ---------------------------------------------------------------------------

/**
 * Sets `GraviScanner.enabled = false` on every enabled row that is NOT in
 * the provided `enabledIdentities` list. Matches by usb_port primary with
 * composite fallback — consistent with saveScannersToDB.
 *
 * Does NOT delete rows — preserves FK references from historical GraviScan.
 */
export async function disableMissingScanners(
  db: PrismaClient,
  enabledIdentities: Array<{
    usb_port: string;
    vendor_id: string;
    product_id: string;
    name: string;
    usb_bus: number | null;
    usb_device: number | null;
  }>
): Promise<{ success: boolean; error?: string; disabled?: number }> {
  try {
    const rows = (await (db as any).graviScanner.findMany({
      where: { enabled: true },
    })) as GraviScanner[];

    const toDisable: string[] = [];
    for (const row of rows) {
      const isMatched = enabledIdentities.some((id) => {
        // Primary: usb_port match (both sides non-empty)
        if (id.usb_port && row.usb_port && id.usb_port === row.usb_port) {
          return true;
        }
        // Fallback: composite match
        return (
          row.vendor_id === id.vendor_id &&
          row.product_id === id.product_id &&
          row.name === id.name &&
          row.usb_bus === id.usb_bus &&
          row.usb_device === id.usb_device
        );
      });
      if (!isMatched) {
        toDisable.push(row.id);
      }
    }

    for (const id of toDisable) {
      await (db as any).graviScanner.update({
        where: { id },
        data: { enabled: false },
      });
    }

    return { success: true, disabled: toDisable.length };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Failed to disable scanners',
    };
  }
}

// ---------------------------------------------------------------------------
// getPlatformInfo
// ---------------------------------------------------------------------------

export async function getPlatformInfo() {
  try {
    const mockEnabled = process.env.GRAVISCAN_MOCK?.toLowerCase() === 'true';

    const platform = process.platform;
    const isSupported = platform === 'linux' || platform === 'win32';
    const backend =
      platform === 'linux'
        ? 'sane'
        : platform === 'win32'
          ? 'twain'
          : 'unsupported';

    if (mockEnabled) {
      return {
        success: true,
        supported: true,
        backend: backend,
        mock_enabled: true,
        system_name: process.env.GRAVISCAN_SYSTEM_NAME || null,
      } as { success: boolean } & GraviScanPlatformInfo;
    }

    return {
      success: true,
      supported: isSupported,
      backend: backend,
      mock_enabled: mockEnabled,
      system_name: process.env.GRAVISCAN_SYSTEM_NAME || null,
    } as { success: boolean } & GraviScanPlatformInfo;
  } catch {
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
        sane_name: `epkowa:interpreter:${String(s.usb_bus || 1).padStart(3, '0')}:${String(s.usb_device || i + 1).padStart(3, '0')}`,
      }));
    } else {
      const lsusbResult = detectEpsonScanners();

      if (!lsusbResult.success) {
        return {
          success: false,
          status: 'error' as const,
          error: lsusbResult.error || 'Scanner detection failed',
          matched: [] as Array<{
            saved: GraviScanner;
            detected: DetectedScanner;
          }>,
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
