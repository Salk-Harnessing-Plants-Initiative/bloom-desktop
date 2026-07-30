// @vitest-environment node
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
 *
 * Ported from df4f655 (`tests/unit/scan-coordinator-add-scanner.test.ts`
 * on the source branch) with import paths adapted to this repo's
 * `src/main/graviscan/` layout — the coordinator/scanner-subprocess/
 * scan-logger modules live there, not at `src/main/` directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

class MockSubprocess extends EventEmitter {
  readonly scannerId: string;
  private _isReady = false;
  private _isAlive = true;
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
    options?: { shouldFail?: boolean; spawnDelay?: number; isAlive?: boolean }
  ) {
    super();
    this.scannerId = scannerId;
    this._shouldFail = options?.shouldFail ?? false;
    this._spawnDelay = options?.spawnDelay ?? 0;
    this._isAlive = options?.isAlive ?? true;
  }

  get isReady(): boolean {
    return this._isReady;
  }

  get isAlive(): boolean {
    return this._isAlive;
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
  { shouldFail?: boolean; spawnDelay?: number; isAlive?: boolean }
>;
let createdSubprocesses: MockSubprocess[];

vi.mock('../../src/main/graviscan/scanner-subprocess', () => ({
  ScannerSubprocess: vi.fn(
    (
      pythonPath: string,
      isPackaged: boolean,
      scannerId: string,
      saneName: string,
      mock: boolean
    ) => {
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
  ),
}));

vi.mock('../../src/main/graviscan/scan-logger', () => ({
  scanLog: vi.fn(),
}));

import { ScanCoordinator } from '../../src/main/graviscan/scan-coordinator';
import type { ScannerConfig } from '../../src/types/graviscan';

function makeConfig(id: string): ScannerConfig {
  return { scannerId: id, saneName: `epkowa:001:${id}`, plates: [] };
}

/**
 * Reject instead of hanging forever when a promise never settles.
 *
 * The mid-scan queueing bug this file guards against manifests as a
 * livelock — `addScanner()`'s returned promise simply never resolves —
 * so a plain `await` would stall the whole suite until vitest's global
 * timeout instead of reporting a useful failure.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} did not settle within ${ms}ms`)),
        ms
      );
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>;
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

    await expect(
      coordinator.addScanner(makeConfig('X'))
    ).resolves.toBeUndefined();
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
      coordinator.stopScanner('does-not-exist')
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

describe('ScanCoordinator.addScanner — mid-scan queueing (Copilot PR #237)', () => {
  let coordinator: ScanCoordinator;

  beforeEach(() => {
    vi.clearAllMocks();
    subprocessOptionsMap = new Map();
    createdSubprocesses = [];
    coordinator = new ScanCoordinator('/usr/bin/python3', false, true);
  });

  /**
   * Force isScanning === true via the private `state` field. Driving a
   * real scanOnce()/scanInterval() cycle to reach this state isn't
   * necessary — the behavior under test is EventEmitter listener
   * ordering during a single 'cycle-complete' emission, which is
   * identical regardless of how the coordinator got into 'scanning'.
   *
   * Critically, this also reproduces scanOnce()'s own ordering:
   * `emit('cycle-complete', ...)` fires on one line and
   * `this.state = 'idle'` runs on the *next*, so every queued handler
   * observes `isScanning === true` at the exact synchronous instant it
   * runs. Leaving `state` at 'scanning' for the whole test models that
   * worst case.
   */
  function forceScanning(): void {
    (coordinator as unknown as { state: string }).state = 'scanning';
  }

  it('actually spawns a queued scanner once cycle-complete fires (does not livelock)', async () => {
    forceScanning();

    // Single mid-scan call. Pre-fix, the queued handler re-entered
    // addScanner(), whose own `if (this.isScanning)` check is STILL true
    // at this synchronous instant — so it just registered another queued
    // listener, forever, on every subsequent cycle-complete. Net effect:
    // zero subprocess constructions and a promise that never resolves,
    // which also wedged register-handlers.ts's serialized spawnChain for
    // the rest of the session.
    const added = coordinator.addScanner(makeConfig('NEW'));

    coordinator.emit('cycle-complete', { cycle: 1 });

    await withTimeout(added, 500, 'queued addScanner()');

    expect(coordinator.hasWorker('NEW')).toBe(true);
    expect(
      createdSubprocesses.filter((s) => s.scannerId === 'NEW')
    ).toHaveLength(1);
  });

  it('collapses two concurrent mid-scan calls for the same scannerId into exactly one spawn', async () => {
    // Give the spawn a small delay so the first attempt would still be
    // "not ready" at the instant a second queued handler ran within the
    // same 'cycle-complete' emission — this is what made the original
    // regression's "existing-but-not-ready → shut down and respawn"
    // branch trigger (2 constructions + 1 premature shutdown).
    subprocessOptionsMap.set('NEW', { spawnDelay: 20 });
    forceScanning();

    const config = makeConfig('NEW');
    // Operator double-clicks "Detect" mid-scan: two concurrent
    // addScanner() calls for the SAME scannerId.
    const first = coordinator.addScanner(config);
    const second = coordinator.addScanner(config);

    coordinator.emit('cycle-complete', { cycle: 1 });

    await withTimeout(
      Promise.all([first, second]),
      500,
      'both queued addScanner() calls'
    );

    const newSubs = createdSubprocesses.filter((s) => s.scannerId === 'NEW');

    // The pending-add map collapses the second call onto the first
    // call's promise, so only ONE 'cycle-complete' handler is ever
    // registered: exactly one construction, no shutdown of a subprocess
    // that is still mid-spawn, and both callers observe completion.
    expect(newSubs).toHaveLength(1);
    expect(newSubs.some((s) => s.shutdownCalled)).toBe(false);
    expect(coordinator.hasWorker('NEW')).toBe(true);
  });

  it('does not spawn before cycle-complete fires (queued, not immediate)', async () => {
    forceScanning();

    void coordinator.addScanner(makeConfig('NEW'));

    // Let microtasks and any stray timer flush without emitting.
    await new Promise((r) => setTimeout(r, 25));

    expect(createdSubprocesses.filter((s) => s.scannerId === 'NEW')).toEqual(
      []
    );
    expect(coordinator.hasWorker('NEW')).toBe(false);
  });

  it('allows a later addScanner for the same id after the queued spawn settles', async () => {
    forceScanning();

    const first = coordinator.addScanner(makeConfig('NEW'));
    coordinator.emit('cycle-complete', { cycle: 1 });
    await withTimeout(first, 500, 'first queued addScanner()');

    // The pending entry must be cleared once it settles, otherwise a
    // later call would be handed back the already-resolved promise and
    // silently skip its own idempotency/spawn path.
    const second = coordinator.addScanner(makeConfig('NEW'));
    await withTimeout(second, 500, 'second addScanner()');

    // hasWorker() short-circuits — still exactly one subprocess.
    expect(
      createdSubprocesses.filter((s) => s.scannerId === 'NEW')
    ).toHaveLength(1);
  });
});

describe('ScanCoordinator.getScannerStatuses', () => {
  let coordinator: ScanCoordinator;

  beforeEach(() => {
    vi.clearAllMocks();
    subprocessOptionsMap = new Map();
    createdSubprocesses = [];
    coordinator = new ScanCoordinator('/usr/bin/python3', false, true);
  });

  it('returns an empty array when there are no subprocesses and no init errors', () => {
    expect(coordinator.getScannerStatuses()).toEqual([]);
  });

  it("reports 'ready' for a subprocess that spawned successfully", async () => {
    await coordinator.initialize([makeConfig('A')]);

    expect(coordinator.getScannerStatuses()).toEqual([
      { scannerId: 'A', status: 'ready' },
    ]);
  });

  it("reports 'error' with the failure message for a scanner tracked only in initErrors (removed from the subprocess map)", async () => {
    subprocessOptionsMap.set('A', { shouldFail: true });

    await coordinator.initialize([makeConfig('A')]);

    expect(coordinator.hasWorker('A')).toBe(false);
    expect(coordinator.getScannerStatuses()).toEqual([
      {
        scannerId: 'A',
        status: 'error',
        error: 'Scanner A init failed',
      },
    ]);
  });

  it('merges ready and error statuses across multiple scanners', async () => {
    subprocessOptionsMap.set('BAD', { shouldFail: true });

    await coordinator.initialize([makeConfig('GOOD'), makeConfig('BAD')]);

    const statuses = coordinator.getScannerStatuses();
    expect(statuses).toEqual(
      expect.arrayContaining([
        { scannerId: 'GOOD', status: 'ready' },
        {
          scannerId: 'BAD',
          status: 'error',
          error: 'Scanner BAD init failed',
        },
      ])
    );
    expect(statuses).toHaveLength(2);
  });

  it("does not report an initErrors entry for a scannerId that is currently in the subprocess map (avoids a stale 'error' + 'ready' double-report)", async () => {
    // Fail once, then succeed on a fresh initialize() for the same id.
    // (initErrors.clear() at the top of initialize() is exercised by the
    // dedicated describe block below — this test defends the
    // getScannerStatuses() merge logic itself: even if an initErrors
    // entry somehow persisted, a live subprocess entry takes precedence.)
    subprocessOptionsMap.set('A', { shouldFail: true });
    await coordinator.initialize([makeConfig('A')]);
    expect(coordinator.getScannerStatuses()).toEqual([
      { scannerId: 'A', status: 'error', error: 'Scanner A init failed' },
    ]);

    subprocessOptionsMap.set('A', { shouldFail: false });
    await coordinator.addScanner(makeConfig('A'));

    const statuses = coordinator.getScannerStatuses();
    expect(statuses).toEqual([{ scannerId: 'A', status: 'ready' }]);
  });
});

describe('ScanCoordinator.initialize — initErrors clearing', () => {
  let coordinator: ScanCoordinator;

  beforeEach(() => {
    vi.clearAllMocks();
    subprocessOptionsMap = new Map();
    createdSubprocesses = [];
    coordinator = new ScanCoordinator('/usr/bin/python3', false, true);
  });

  it('does not keep a stale error entry once a previously-failing scanner succeeds on a later initialize()', async () => {
    subprocessOptionsMap.set('A', { shouldFail: true });
    await coordinator.initialize([makeConfig('A')]);
    expect(coordinator.getScannerStatuses()).toEqual([
      { scannerId: 'A', status: 'error', error: 'Scanner A init failed' },
    ]);

    // Same scanner now succeeds on a later initialize() call (e.g. after
    // reset-usb or a reconnect) — without initErrors.clear() at the top
    // of initialize(), the stale 'error' entry from the first attempt
    // would linger forever since spawnSingleScanner() never removes an
    // OLD entry for an id that succeeds this time (it only *sets* on
    // failure).
    subprocessOptionsMap.set('A', { shouldFail: false });
    await coordinator.initialize([makeConfig('A')]);

    expect(coordinator.getScannerStatuses()).toEqual([
      { scannerId: 'A', status: 'ready' },
    ]);
  });
});
