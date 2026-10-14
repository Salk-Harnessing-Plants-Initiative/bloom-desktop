// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Complete-replacement factory: every export `scanner-handlers.ts` reaches
// through this module must appear here or the file fails at import.
// `buildSaneName` moves into `lsusb-detection.ts` (it was duplicated), and
// gets a REAL implementation rather than a `vi.fn()` because assertions
// elsewhere check its output.
vi.mock('../../../src/main/lsusb-detection', () => ({
  detectEpsonScanners: vi.fn(),
  detectEpsonScannersAsync: vi.fn(),
  buildSaneName: (bus: number, device: number) =>
    `epkowa:interpreter:${String(bus).padStart(3, '0')}:${String(device).padStart(3, '0')}`,
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

  it('attaches no spawn-time resolver to the configs it re-initializes with', async () => {
    // design.md Decision 3: `resetUsb` performs its own fresh detection in
    // the same operation, so re-resolving at spawn time would spawn a second
    // detection pass per scanner moments after the first — and give each row
    // a different view of the bus. Only retry and session-start attach one.
    db.graviScanner.findMany.mockResolvedValue([MOCK_SAVED_SCANNER_1]);
    mockDetect.mockReturnValue({
      success: true,
      scanners: [MOCK_DETECTED_1],
      count: 1,
    });
    const coordinator = createMockCoordinator();

    const resultPromise = resetUsb(coordinator, db);
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(coordinator.initialize).toHaveBeenCalledTimes(1);
    const configs = coordinator.initialize.mock.calls[0][0];
    expect(configs).toHaveLength(1);
    expect(configs[0]).not.toHaveProperty('resolveSaneName');
  });

  it('resolves a duplicate usb_port to the first detected entry in list order', async () => {
    // design.md Decision 2. `resetUsb` built a Map<usb_port, DetectedScanner>,
    // and `Map.set` keeps the LAST entry for a duplicate key; the shared
    // matcher does a linear scan and finds the FIRST. Real detection dedupes
    // by port so this cannot arise there — but `resetUsb`'s own mock branch
    // synthesises `usb_port: s.usb_port || \`1-${i + 1}\``, which can
    // collide. Pinning the order keeps it a specified behaviour rather than
    // an artefact of a Map's iteration order.
    db.graviScanner.findMany.mockResolvedValue([MOCK_SAVED_SCANNER_1]);
    const first: DetectedScanner = {
      ...MOCK_DETECTED_1,
      scanner_id: 'first',
      usb_device: 5,
    };
    const second: DetectedScanner = {
      ...MOCK_DETECTED_1,
      scanner_id: 'second',
      usb_device: 9,
    };
    mockDetect.mockReturnValue({
      success: true,
      scanners: [first, second],
      count: 2,
    });
    const coordinator = createMockCoordinator();

    const resultPromise = resetUsb(coordinator, db);
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(db.graviScanner.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { usb_bus: 1, usb_device: 5 },
    });
    expect(db.graviScanner.update).not.toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { usb_bus: 1, usb_device: 9 },
    });
  });
});
