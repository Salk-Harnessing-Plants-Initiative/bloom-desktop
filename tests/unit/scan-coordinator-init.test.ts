/**
 * ScanCoordinator Parallel Initialization Tests
 *
 * Tests that subprocess initialization runs in parallel, handles partial
 * failures gracefully, and reuses existing ready subprocesses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Mock ScannerSubprocess — each instance tracks its own spawn/shutdown calls
// ---------------------------------------------------------------------------

class MockSubprocess extends EventEmitter {
  readonly scannerId: string;
  private _isReady = false;
  private _shouldFail: boolean;
  private _spawnDelay: number;
  spawnCalled = false;
  shutdownCalled = false;

  constructor(
    _pythonPath: string,
    _isPackaged: boolean,
    scannerId: string,
    _saneName: string,
    _mock: boolean,
    options?: { shouldFail?: boolean; spawnDelay?: number }
  ) {
    super();
    this.scannerId = scannerId;
    this._shouldFail = options?.shouldFail ?? false;
    this._spawnDelay = options?.spawnDelay ?? 10;
  }

  get isReady(): boolean {
    return this._isReady;
  }

  async spawn(): Promise<void> {
    this.spawnCalled = true;
    await new Promise((r) => setTimeout(r, this._spawnDelay));
    if (this._shouldFail) {
      throw new Error(
        `Scanner ${this.scannerId} init failed: Device not found`
      );
    }
    this._isReady = true;
  }

  async shutdown(): Promise<void> {
    this.shutdownCalled = true;
    this._isReady = false;
  }
}

// ---------------------------------------------------------------------------
// Factory that lets tests control per-scanner behaviour
// ---------------------------------------------------------------------------

type SubprocessOptions = { shouldFail?: boolean; spawnDelay?: number };

let subprocessOptionsMap: Map<string, SubprocessOptions>;
let createdSubprocesses: MockSubprocess[];

function mockSubprocessFactory(
  pythonPath: string,
  isPackaged: boolean,
  scannerId: string,
  saneName: string,
  mock: boolean
): MockSubprocess {
  const opts = subprocessOptionsMap.get(scannerId) ?? {};
  const sub = new MockSubprocess(
    pythonPath,
    isPackaged,
    scannerId,
    saneName,
    mock,
    opts
  );
  createdSubprocesses.push(sub);
  return sub;
}

// Mock the module so ScanCoordinator uses our MockSubprocess
vi.mock('../../src/main/scanner-subprocess', () => ({
  ScannerSubprocess: vi.fn(
    (
      pythonPath: string,
      isPackaged: boolean,
      scannerId: string,
      saneName: string,
      mock: boolean
    ) =>
      mockSubprocessFactory(pythonPath, isPackaged, scannerId, saneName, mock)
  ),
}));

vi.mock('../../src/main/scan-logger', () => ({
  scanLog: vi.fn(),
}));

// Import AFTER mocks are set up
import {
  ScanCoordinator,
  ScannerConfig,
} from '../../src/main/scan-coordinator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfigs(count: number): ScannerConfig[] {
  return Array.from({ length: count }, (_, i) => ({
    scannerId: `scanner-${i + 1}`,
    saneName: `epkowa:interpreter:00${i + 1}:001`,
    plates: [],
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScanCoordinator.initialize — parallel spawn', () => {
  let coordinator: ScanCoordinator;

  beforeEach(() => {
    vi.clearAllMocks();
    subprocessOptionsMap = new Map();
    createdSubprocesses = [];
    coordinator = new ScanCoordinator('/usr/bin/python3', false, true);
  });

  // -----------------------------------------------------------------------
  // Core: parallelism
  // -----------------------------------------------------------------------

  it('should spawn all subprocesses in parallel, not sequentially', async () => {
    const SPAWN_DELAY = 100; // ms per scanner
    const configs = makeConfigs(4);
    for (const c of configs) {
      subprocessOptionsMap.set(c.scannerId, { spawnDelay: SPAWN_DELAY });
    }

    const start = Date.now();
    await coordinator.initialize(configs);
    const elapsed = Date.now() - start;

    // 4 scanners × 100ms sequential = ~400ms.  Parallel ≈ ~100ms.
    // Allow generous margin but it must be well under sequential time.
    expect(elapsed).toBeLessThan(SPAWN_DELAY * 2.5);

    // All 4 spawned
    expect(createdSubprocesses).toHaveLength(4);
    expect(createdSubprocesses.every((s) => s.spawnCalled)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Partial failure
  // -----------------------------------------------------------------------

  it('should continue with healthy scanners when one fails', async () => {
    const configs = makeConfigs(4);
    // Scanner 3 is unplugged
    subprocessOptionsMap.set('scanner-3', { shouldFail: true });

    await coordinator.initialize(configs);

    const ready = createdSubprocesses.filter((s) => s.isReady);
    const failed = createdSubprocesses.filter((s) => !s.isReady);

    expect(ready).toHaveLength(3);
    expect(failed).toHaveLength(1);
    expect(failed[0].scannerId).toBe('scanner-3');
  });

  it('should emit scanner-init-status "error" for a failed scanner', async () => {
    const configs = makeConfigs(2);
    subprocessOptionsMap.set('scanner-2', { shouldFail: true });

    const statusEvents: { scannerId: string; status: string }[] = [];
    coordinator.on('scanner-init-status', (ev) => statusEvents.push(ev));

    await coordinator.initialize(configs);

    const readyEvents = statusEvents.filter((e) => e.status === 'ready');
    const errorEvents = statusEvents.filter((e) => e.status === 'error');

    expect(readyEvents).toHaveLength(1);
    expect(readyEvents[0].scannerId).toBe('scanner-1');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].scannerId).toBe('scanner-2');
  });

  it('should emit scanner-init-status "ready" for each successful scanner', async () => {
    const configs = makeConfigs(3);

    const readyIds: string[] = [];
    coordinator.on('scanner-init-status', (ev) => {
      if (ev.status === 'ready') readyIds.push(ev.scannerId);
    });

    await coordinator.initialize(configs);

    expect(readyIds.sort()).toEqual(['scanner-1', 'scanner-2', 'scanner-3']);
  });

  // -----------------------------------------------------------------------
  // Reuse existing ready subprocesses
  // -----------------------------------------------------------------------

  it('should reuse already-ready subprocesses without respawning', async () => {
    const configs = makeConfigs(4);

    // First init — all 4 spawned
    await coordinator.initialize(configs);
    expect(createdSubprocesses).toHaveLength(4);

    // Reset tracking
    const firstBatch = [...createdSubprocesses];
    createdSubprocesses = [];

    // Second init with same config — should reuse, spawn 0
    await coordinator.initialize(configs);
    expect(createdSubprocesses).toHaveLength(0);

    // Original subprocesses still ready
    expect(firstBatch.every((s) => s.isReady)).toBe(true);
  });

  it('should only spawn new scanners when some are already ready', async () => {
    // Init with 2 scanners
    const first2 = makeConfigs(2);
    await coordinator.initialize(first2);
    expect(createdSubprocesses).toHaveLength(2);

    createdSubprocesses = [];

    // Now init with 4 — scanner-1 and scanner-2 are reused, scanner-3 and scanner-4 are new
    const all4 = makeConfigs(4);
    await coordinator.initialize(all4);

    expect(createdSubprocesses).toHaveLength(2);
    const newIds = createdSubprocesses.map((s) => s.scannerId).sort();
    expect(newIds).toEqual(['scanner-3', 'scanner-4']);
  });

  // -----------------------------------------------------------------------
  // Stale subprocess cleanup
  // -----------------------------------------------------------------------

  it('should shut down subprocesses for removed scanners', async () => {
    const configs4 = makeConfigs(4);
    await coordinator.initialize(configs4);

    const allSubs = [...createdSubprocesses];

    // Now init with only scanner-1 and scanner-2
    const configs2 = makeConfigs(2);
    await coordinator.initialize(configs2);

    // Scanner-3 and scanner-4 should have been shut down
    expect(allSubs[2].shutdownCalled).toBe(true);
    expect(allSubs[3].shutdownCalled).toBe(true);
  });

  // -----------------------------------------------------------------------
  // All fail
  // -----------------------------------------------------------------------

  it('should handle all scanners failing without throwing', async () => {
    const configs = makeConfigs(3);
    for (const c of configs) {
      subprocessOptionsMap.set(c.scannerId, { shouldFail: true });
    }

    // Should not throw
    await coordinator.initialize(configs);

    expect(createdSubprocesses.every((s) => !s.isReady)).toBe(true);
  });
});
