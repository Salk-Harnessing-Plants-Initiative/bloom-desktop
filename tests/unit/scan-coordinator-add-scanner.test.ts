/**
 * Task 7 (#234): ScanCoordinator.addScanner / hasWorker / stopScanner.
 *
 * The IPC handler `graviscan:save-scanners-db` calls addScanner() for
 * each newly-created enabled scanner row so workers come online
 * without an app restart. hasWorker() lets the handler skip already-
 * running scanners. stopScanner() is invoked by the new
 * `graviscan:disable-scanner` IPC (Task 9).
 *
 * Mid-scan safety: addScanner() called while isScanning===true queues
 * the spawn until the next cycle-complete event (see design.md
 * Risks table).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

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
    options?: { shouldFail?: boolean; spawnDelay?: number },
  ) {
    super();
    this.scannerId = scannerId;
    this._shouldFail = options?.shouldFail ?? false;
    this._spawnDelay = options?.spawnDelay ?? 0;
  }

  get isReady(): boolean {
    return this._isReady;
  }

  async spawn(): Promise<void> {
    this.spawnCalled = true;
    await new Promise((r) => setTimeout(r, this._spawnDelay));
    if (this._shouldFail) {
      throw new Error(`Scanner ${this.scannerId} init failed`);
    }
    this._isReady = true;
  }

  async shutdown(): Promise<void> {
    this.shutdownCalled = true;
    this._isReady = false;
    this.emit('exit', { scannerId: this.scannerId, code: 0 });
  }

  removeAllListeners(event?: string | symbol): this {
    return super.removeAllListeners(event);
  }
}

let subprocessOptionsMap: Map<
  string,
  { shouldFail?: boolean; spawnDelay?: number }
>;
let createdSubprocesses: MockSubprocess[];

vi.mock('../../src/main/scanner-subprocess', () => ({
  ScannerSubprocess: vi.fn(
    (
      pythonPath: string,
      isPackaged: boolean,
      scannerId: string,
      saneName: string,
      mock: boolean,
    ) => {
      const opts = subprocessOptionsMap.get(scannerId) ?? {};
      const sub = new MockSubprocess(
        pythonPath,
        isPackaged,
        scannerId,
        saneName,
        mock,
        opts,
      );
      createdSubprocesses.push(sub);
      return sub;
    },
  ),
}));

vi.mock('../../src/main/scan-logger', () => ({
  scanLog: vi.fn(),
}));

import {
  ScanCoordinator,
  ScannerConfig,
} from '../../src/main/scan-coordinator';

function makeConfig(id: string): ScannerConfig {
  return { scannerId: id, saneName: `epkowa:001:${id}`, plates: [] };
}

describe('ScanCoordinator.hasWorker', () => {
  let coordinator: ScanCoordinator;

  beforeEach(() => {
    vi.clearAllMocks();
    subprocessOptionsMap = new Map();
    createdSubprocesses = [];
    coordinator = new ScanCoordinator('/usr/bin/python3', false, true);
  });

  it('returns false when no worker exists for that id', () => {
    expect(coordinator.hasWorker('does-not-exist')).toBe(false);
  });

  it('returns true after a successful spawn (worker is ready)', async () => {
    await coordinator.initialize([makeConfig('A')]);
    expect(coordinator.hasWorker('A')).toBe(true);
  });

  it('returns false when the worker failed to spawn', async () => {
    subprocessOptionsMap.set('A', { shouldFail: true });
    await coordinator.initialize([makeConfig('A')]);
    expect(coordinator.hasWorker('A')).toBe(false);
  });
});

describe('ScanCoordinator.addScanner', () => {
  let coordinator: ScanCoordinator;

  beforeEach(() => {
    vi.clearAllMocks();
    subprocessOptionsMap = new Map();
    createdSubprocesses = [];
    coordinator = new ScanCoordinator('/usr/bin/python3', false, true);
  });

  it('spawns one new worker without disturbing existing ones', async () => {
    await coordinator.initialize([makeConfig('A'), makeConfig('B')]);
    const before = createdSubprocesses.length;

    await coordinator.addScanner(makeConfig('C'));

    expect(createdSubprocesses.length).toBe(before + 1);
    expect(coordinator.hasWorker('A')).toBe(true);
    expect(coordinator.hasWorker('B')).toBe(true);
    expect(coordinator.hasWorker('C')).toBe(true);
  });

  it('is idempotent when the scanner is already ready (no respawn)', async () => {
    await coordinator.initialize([makeConfig('A')]);
    const before = createdSubprocesses.length;

    await coordinator.addScanner(makeConfig('A'));

    expect(createdSubprocesses.length).toBe(before);
  });

  it('does not throw if spawn fails (logs and reports via init-status event)', async () => {
    subprocessOptionsMap.set('X', { shouldFail: true });

    await expect(coordinator.addScanner(makeConfig('X'))).resolves
      .toBeUndefined();
    expect(coordinator.hasWorker('X')).toBe(false);
  });
});

describe('ScanCoordinator.stopScanner', () => {
  let coordinator: ScanCoordinator;

  beforeEach(() => {
    vi.clearAllMocks();
    subprocessOptionsMap = new Map();
    createdSubprocesses = [];
    coordinator = new ScanCoordinator('/usr/bin/python3', false, true);
  });

  it('removes a single worker from the subprocess map', async () => {
    await coordinator.initialize([makeConfig('A'), makeConfig('B')]);

    await coordinator.stopScanner('A');

    expect(coordinator.hasWorker('A')).toBe(false);
    expect(coordinator.hasWorker('B')).toBe(true);
  });

  it('is a no-op when the scanner is not in the map (no throw)', async () => {
    await expect(
      coordinator.stopScanner('does-not-exist'),
    ).resolves.toBeUndefined();
  });

  it('shuts down the subprocess (calls .shutdown)', async () => {
    await coordinator.initialize([makeConfig('A')]);
    const sub = createdSubprocesses.find((s) => s.scannerId === 'A');
    expect(sub).toBeDefined();

    await coordinator.stopScanner('A');

    expect(sub!.shutdownCalled).toBe(true);
  });
});
