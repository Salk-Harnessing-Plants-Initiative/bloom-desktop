// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/main/lsusb-detection', () => ({
  detectEpsonScanners: vi.fn(),
}));

import { detectEpsonScanners } from '../../../src/main/lsusb-detection';
import { resetUsb } from '../../../src/main/graviscan/scanner-handlers';
import type { DetectedScanner } from '../../../src/types/graviscan';

const mockDetect = vi.mocked(detectEpsonScanners);

function createMockDb() {
  return {
    graviScanner: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn(),
    },
  } as any;
}

function createMockCoordinator() {
  return {
    isScanning: false,
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  } as any;
}

const MOCK_SAVED_SCANNER_1 = {
  id: 's1',
  name: 'Scanner 1',
  usb_port: '1-2',
  vendor_id: '04b8',
  product_id: '013a',
  enabled: true,
};

const MOCK_SAVED_SCANNER_2 = {
  id: 's2',
  name: 'Scanner 2',
  usb_port: '1-3',
  vendor_id: '04b8',
  product_id: '013a',
  enabled: true,
};

const MOCK_DETECTED_1: DetectedScanner = {
  name: 'Perfection V600 Photo',
  scanner_id: 's1',
  usb_bus: 1,
  usb_device: 5,
  usb_port: '1-2',
  is_available: true,
  vendor_id: '04b8',
  product_id: '013a',
  sane_name: 'epkowa:interpreter:001:005',
};

const MOCK_DETECTED_2: DetectedScanner = {
  name: 'Perfection V600 Photo',
  scanner_id: 's2',
  usb_bus: 1,
  usb_device: 6,
  usb_port: '1-3',
  is_available: true,
  vendor_id: '04b8',
  product_id: '013a',
  sane_name: 'epkowa:interpreter:001:006',
};

describe('resetUsb', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    vi.stubEnv('GRAVISCAN_MOCK', '');
    mockDetect.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports ready for all saved scanners matched by usb_port and re-initializes the coordinator', async () => {
    db.graviScanner.findMany.mockResolvedValue([
      MOCK_SAVED_SCANNER_1,
      MOCK_SAVED_SCANNER_2,
    ]);
    mockDetect.mockReturnValue({
      success: true,
      scanners: [MOCK_DETECTED_1, MOCK_DETECTED_2],
      count: 2,
    });
    const coordinator = createMockCoordinator();

    const resultPromise = resetUsb(coordinator, db);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.scanners).toEqual([
      { id: 's1', status: 'ready' },
      { id: 's2', status: 'ready' },
    ]);
    expect(coordinator.shutdown).toHaveBeenCalledTimes(1);
    expect(db.graviScanner.updateMany).toHaveBeenCalledWith({
      where: { enabled: true },
      data: { usb_bus: null, usb_device: null },
    });
    expect(db.graviScanner.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { usb_bus: 1, usb_device: 5 },
    });
    expect(db.graviScanner.update).toHaveBeenCalledWith({
      where: { id: 's2' },
      data: { usb_bus: 1, usb_device: 6 },
    });
    expect(coordinator.initialize).toHaveBeenCalledWith([
      { scannerId: 's1', saneName: 'epkowa:interpreter:001:005', plates: [] },
      { scannerId: 's2', saneName: 'epkowa:interpreter:001:006', plates: [] },
    ]);
  });

  it('reports disconnected for a saved scanner whose usb_port is not in the fresh detection results', async () => {
    db.graviScanner.findMany.mockResolvedValue([
      MOCK_SAVED_SCANNER_1,
      MOCK_SAVED_SCANNER_2,
    ]);
    // Only scanner 1 is detected after replug; scanner 2's port vanished.
    mockDetect.mockReturnValue({
      success: true,
      scanners: [MOCK_DETECTED_1],
      count: 1,
    });
    const coordinator = createMockCoordinator();

    const resultPromise = resetUsb(coordinator, db);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.scanners).toEqual([
      { id: 's1', status: 'ready' },
      { id: 's2', status: 'disconnected' },
    ]);
    // Only the matched scanner is included in the re-initialize call.
    expect(coordinator.initialize).toHaveBeenCalledWith([
      { scannerId: 's1', saneName: 'epkowa:interpreter:001:005', plates: [] },
    ]);
    expect(db.graviScanner.update).toHaveBeenCalledTimes(1);
    expect(db.graviScanner.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { usb_bus: 1, usb_device: 5 },
    });
  });

  it('skips shutdown/initialize when coordinator is null but still runs the DB-clear/redetect/match steps', async () => {
    db.graviScanner.findMany.mockResolvedValue([MOCK_SAVED_SCANNER_1]);
    mockDetect.mockReturnValue({
      success: true,
      scanners: [MOCK_DETECTED_1],
      count: 1,
    });

    const resultPromise = resetUsb(null, db);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.scanners).toEqual([{ id: 's1', status: 'ready' }]);
    expect(db.graviScanner.updateMany).toHaveBeenCalled();
    expect(db.graviScanner.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { usb_bus: 1, usb_device: 5 },
    });
  });

  it('returns gracefully without throwing when detection fails', async () => {
    db.graviScanner.findMany.mockResolvedValue([MOCK_SAVED_SCANNER_1]);
    mockDetect.mockReturnValue({
      success: false,
      error: 'lsusb not found',
      scanners: [],
      count: 0,
    });
    const coordinator = createMockCoordinator();

    const resultPromise = resetUsb(coordinator, db);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.scanners).toEqual([]);
    expect(result.error).toBe('lsusb not found');
    expect(coordinator.initialize).not.toHaveBeenCalled();
  });
});
