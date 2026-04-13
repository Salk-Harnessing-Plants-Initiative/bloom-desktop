/**
 * Reset USB Handler Tests
 *
 * Tests the graviscan:reset-usb handler logic: shutdown coordinator,
 * clear stale USB addresses, re-detect via lsusb, match by usb_port,
 * and re-initialize subprocesses.
 *
 * Since IPC handlers are registered inline, we test the logic by
 * reimplementing the handler flow with injected mocks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DetectedScanner } from '../../src/types/graviscan';

// ---------------------------------------------------------------------------
// Mock types matching Prisma GraviScanner model
// ---------------------------------------------------------------------------

interface MockGraviScanner {
  id: string;
  name: string;
  display_name: string | null;
  vendor_id: string;
  product_id: string;
  usb_port: string | null;
  usb_bus: number | null;
  usb_device: number | null;
  grid_mode: string;
  enabled: boolean;
}

interface ScannerConfig {
  scannerId: string;
  saneName: string;
  plates: unknown[];
}

// ---------------------------------------------------------------------------
// Mock coordinator
// ---------------------------------------------------------------------------

function createMockCoordinator() {
  return {
    shutdown: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------

function createMockDb(scanners: MockGraviScanner[]) {
  const data = [...scanners];
  return {
    graviScanner: {
      updateMany: vi.fn().mockResolvedValue({ count: data.length }),
      findMany: vi.fn().mockResolvedValue(data),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

// ---------------------------------------------------------------------------
// Reset USB logic extracted from graviscan-handlers.ts
// Mirrors the handler exactly — no extra abstractions.
// ---------------------------------------------------------------------------

async function resetUsbLogic(opts: {
  coordinator: ReturnType<typeof createMockCoordinator> | null;
  db: ReturnType<typeof createMockDb>;
  detectEpsonScanners: () => {
    success: boolean;
    scanners: DetectedScanner[];
    count: number;
    error?: string;
  };
  mockEnabled?: boolean;
  waitMs?: number;
}) {
  const { coordinator, db, detectEpsonScanners, waitMs = 0 } = opts;

  try {
    // 1. Shutdown coordinator
    if (coordinator) {
      await coordinator.shutdown();
    }

    // 2. Clear stale USB addresses
    await db.graviScanner.updateMany({
      where: { enabled: true },
      data: { usb_bus: null, usb_device: null },
    });

    // 3. Wait for USB release (skipped in tests via waitMs=0)
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    // 4. Fresh detection
    const lsusbResult = detectEpsonScanners();
    if (!lsusbResult.success) {
      return {
        success: false,
        scanners: [],
        error: lsusbResult.error || 'lsusb detection failed',
      };
    }
    const detectedScanners = lsusbResult.scanners;

    // 5. Match detected → DB by usb_port
    const savedScanners = await db.graviScanner.findMany({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
    });

    const detectedByPort = new Map<string, DetectedScanner>();
    for (const detected of detectedScanners) {
      if (detected.usb_port) {
        detectedByPort.set(detected.usb_port, detected);
      }
    }

    const scannerConfigs: ScannerConfig[] = [];
    const scannerStatuses: {
      id: string;
      status: 'ready' | 'disconnected' | 'error';
    }[] = [];

    for (const saved of savedScanners) {
      if (!saved.usb_port) {
        scannerStatuses.push({ id: saved.id, status: 'disconnected' });
        continue;
      }

      const detected = detectedByPort.get(saved.usb_port);
      if (!detected) {
        scannerStatuses.push({ id: saved.id, status: 'disconnected' });
        continue;
      }

      await db.graviScanner.update({
        where: { id: saved.id },
        data: {
          usb_bus: detected.usb_bus,
          usb_device: detected.usb_device,
        },
      });

      scannerConfigs.push({
        scannerId: saved.id,
        saneName:
          detected.sane_name ||
          `epkowa:interpreter:${String(detected.usb_bus).padStart(3, '0')}:${String(detected.usb_device).padStart(3, '0')}`,
        plates: [],
      });
      scannerStatuses.push({ id: saved.id, status: 'ready' });
    }

    // 6. Re-initialize coordinator
    if (coordinator && scannerConfigs.length > 0) {
      await coordinator.initialize(scannerConfigs);
    }

    return { success: true, scanners: scannerStatuses };
  } catch (error) {
    return {
      success: false,
      scanners: [],
      error: error instanceof Error ? error.message : 'USB reset failed',
    };
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeSavedScanner(overrides: Partial<MockGraviScanner>): MockGraviScanner {
  return {
    id: 'scanner-1',
    name: 'Perfection V600 Photo',
    display_name: 'Scanner 1',
    vendor_id: '04b8',
    product_id: '013a',
    usb_port: '1-3',
    usb_bus: 1,
    usb_device: 3,
    grid_mode: '4grid',
    enabled: true,
    ...overrides,
  };
}

function makeDetected(overrides: Partial<DetectedScanner>): DetectedScanner {
  return {
    name: 'Perfection V600 Photo',
    scanner_id: '',
    usb_bus: 1,
    usb_device: 8, // New device number after re-enumeration
    usb_port: '1-3',
    is_available: true,
    vendor_id: '04b8',
    product_id: '013a',
    sane_name: 'epkowa:interpreter:001:008',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Reset USB handler logic', () => {
  let coordinator: ReturnType<typeof createMockCoordinator>;

  beforeEach(() => {
    vi.clearAllMocks();
    coordinator = createMockCoordinator();
  });

  it('should shutdown coordinator, clear DB, re-detect, and re-initialize', async () => {
    const saved = [
      makeSavedScanner({ id: 'sc-1', usb_port: '1-3', usb_device: 3 }),
      makeSavedScanner({ id: 'sc-2', usb_port: '1-4', usb_device: 4 }),
    ];
    const db = createMockDb(saved);
    const detected = [
      makeDetected({ usb_port: '1-3', usb_bus: 1, usb_device: 8, sane_name: 'epkowa:interpreter:001:008' }),
      makeDetected({ usb_port: '1-4', usb_bus: 1, usb_device: 9, sane_name: 'epkowa:interpreter:001:009' }),
    ];

    const result = await resetUsbLogic({
      coordinator,
      db,
      detectEpsonScanners: () => ({
        success: true,
        scanners: detected,
        count: 2,
      }),
    });

    // Coordinator shut down
    expect(coordinator.shutdown).toHaveBeenCalledOnce();

    // DB cleared
    expect(db.graviScanner.updateMany).toHaveBeenCalledWith({
      where: { enabled: true },
      data: { usb_bus: null, usb_device: null },
    });

    // DB updated with fresh addresses
    expect(db.graviScanner.update).toHaveBeenCalledTimes(2);
    expect(db.graviScanner.update).toHaveBeenCalledWith({
      where: { id: 'sc-1' },
      data: { usb_bus: 1, usb_device: 8 },
    });
    expect(db.graviScanner.update).toHaveBeenCalledWith({
      where: { id: 'sc-2' },
      data: { usb_bus: 1, usb_device: 9 },
    });

    // Re-initialized
    expect(coordinator.initialize).toHaveBeenCalledOnce();
    const configs = coordinator.initialize.mock.calls[0][0];
    expect(configs).toHaveLength(2);
    expect(configs[0].saneName).toBe('epkowa:interpreter:001:008');
    expect(configs[1].saneName).toBe('epkowa:interpreter:001:009');

    // Result
    expect(result.success).toBe(true);
    expect(result.scanners).toEqual([
      { id: 'sc-1', status: 'ready' },
      { id: 'sc-2', status: 'ready' },
    ]);
  });

  it('should return disconnected for unplugged scanners', async () => {
    const saved = [
      makeSavedScanner({ id: 'sc-1', usb_port: '1-3' }),
      makeSavedScanner({ id: 'sc-2', usb_port: '15-2' }),
    ];
    const db = createMockDb(saved);

    // Only one scanner detected — sc-2 unplugged
    const detected = [
      makeDetected({ usb_port: '1-3', usb_bus: 1, usb_device: 8 }),
    ];

    const result = await resetUsbLogic({
      coordinator,
      db,
      detectEpsonScanners: () => ({
        success: true,
        scanners: detected,
        count: 1,
      }),
    });

    expect(result.success).toBe(true);
    expect(result.scanners).toEqual([
      { id: 'sc-1', status: 'ready' },
      { id: 'sc-2', status: 'disconnected' },
    ]);

    // Only 1 scanner re-initialized
    expect(coordinator.initialize).toHaveBeenCalledOnce();
    expect(coordinator.initialize.mock.calls[0][0]).toHaveLength(1);

    // Only 1 DB update (for matched scanner)
    expect(db.graviScanner.update).toHaveBeenCalledTimes(1);
  });

  it('should work when coordinator is null', async () => {
    const saved = [makeSavedScanner({ id: 'sc-1', usb_port: '1-3' })];
    const db = createMockDb(saved);
    const detected = [
      makeDetected({ usb_port: '1-3', usb_bus: 1, usb_device: 8 }),
    ];

    const result = await resetUsbLogic({
      coordinator: null,
      db,
      detectEpsonScanners: () => ({
        success: true,
        scanners: detected,
        count: 1,
      }),
    });

    expect(result.success).toBe(true);
    expect(result.scanners).toEqual([{ id: 'sc-1', status: 'ready' }]);

    // DB still cleared and updated
    expect(db.graviScanner.updateMany).toHaveBeenCalledOnce();
    expect(db.graviScanner.update).toHaveBeenCalledOnce();
  });

  it('should handle lsusb returning 0 scanners', async () => {
    const saved = [
      makeSavedScanner({ id: 'sc-1', usb_port: '1-3' }),
      makeSavedScanner({ id: 'sc-2', usb_port: '15-2' }),
    ];
    const db = createMockDb(saved);

    const result = await resetUsbLogic({
      coordinator,
      db,
      detectEpsonScanners: () => ({
        success: true,
        scanners: [],
        count: 0,
      }),
    });

    expect(result.success).toBe(true);
    expect(result.scanners).toEqual([
      { id: 'sc-1', status: 'disconnected' },
      { id: 'sc-2', status: 'disconnected' },
    ]);

    // Coordinator not re-initialized (no scanners to init)
    expect(coordinator.initialize).not.toHaveBeenCalled();

    // No DB updates (nothing matched)
    expect(db.graviScanner.update).not.toHaveBeenCalled();
  });
});
