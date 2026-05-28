// @vitest-environment node
/**
 * Copilot PR #237 review (#20): when `save-scanners-db` disables stale
 * `GraviScanner` rows via `disableStaleScannerRows()`, it must also stop
 * any running `scan_worker` subprocesses for those scanner IDs. Without
 * this, workers keep holding USB / SANE resources even though the
 * scanner is now disabled — particularly painful on the rig where
 * libusb_open is exclusive per device.
 *
 * Tests target the extracted `stopWorkersForDisabledScanners` helper
 * (sibling to `disableStaleScannerRows` in scanner-upsert.ts), mirroring
 * the existing testable-helper pattern.
 */

import { describe, it, expect, vi } from 'vitest';
import { stopWorkersForDisabledScanners } from '../../src/main/scanner-upsert';

interface MockCoordinator {
  hasWorker: ReturnType<typeof vi.fn>;
  stopScanner: ReturnType<typeof vi.fn>;
}

function makeCoordinator(scannersWithWorkers: string[] = []): MockCoordinator {
  return {
    hasWorker: vi.fn((id: string) => scannersWithWorkers.includes(id)),
    stopScanner: vi.fn(async () => undefined),
  };
}

describe('stopWorkersForDisabledScanners (#20)', () => {
  it('stops the worker for a disabled scanner that has one running', async () => {
    const coordinator = makeCoordinator(['scanner-a']);
    await stopWorkersForDisabledScanners(coordinator, ['scanner-a']);
    expect(coordinator.stopScanner).toHaveBeenCalledTimes(1);
    expect(coordinator.stopScanner).toHaveBeenCalledWith('scanner-a');
  });

  it('does not call stopScanner for a disabled scanner with no running worker', async () => {
    const coordinator = makeCoordinator([]);
    await stopWorkersForDisabledScanners(coordinator, ['scanner-b']);
    expect(coordinator.stopScanner).not.toHaveBeenCalled();
  });

  it('stops only those scanners that have workers, skipping the rest', async () => {
    const coordinator = makeCoordinator(['scanner-a', 'scanner-c']);
    await stopWorkersForDisabledScanners(coordinator, [
      'scanner-a',
      'scanner-b',
      'scanner-c',
    ]);
    expect(coordinator.stopScanner).toHaveBeenCalledTimes(2);
    expect(coordinator.stopScanner).toHaveBeenCalledWith('scanner-a');
    expect(coordinator.stopScanner).toHaveBeenCalledWith('scanner-c');
    expect(coordinator.stopScanner).not.toHaveBeenCalledWith('scanner-b');
  });

  it('does not throw when stopScanner rejects — one stuck worker should not block the rest', async () => {
    const coordinator = makeCoordinator(['scanner-a', 'scanner-b']);
    coordinator.stopScanner.mockImplementation(async (id: string) => {
      if (id === 'scanner-a') throw new Error('worker stuck');
    });
    await expect(
      stopWorkersForDisabledScanners(coordinator, ['scanner-a', 'scanner-b']),
    ).resolves.not.toThrow();
    // Both attempts still occur — scanner-b is reached after scanner-a fails.
    expect(coordinator.stopScanner).toHaveBeenCalledTimes(2);
  });

  it('handles an empty disabled list without any coordinator interaction', async () => {
    const coordinator = makeCoordinator(['scanner-a']);
    await stopWorkersForDisabledScanners(coordinator, []);
    expect(coordinator.stopScanner).not.toHaveBeenCalled();
    expect(coordinator.hasWorker).not.toHaveBeenCalled();
  });
});
