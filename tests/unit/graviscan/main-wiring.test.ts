// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock electron (dynamic import inside getOrCreateCoordinator)
vi.mock('electron', () => ({
  app: { isPackaged: false },
}));

// Mock graviscan modules
vi.mock('../../../src/main/graviscan/scan-coordinator', () => {
  const MockCoordinator = vi.fn().mockImplementation(() => {
    const emitter = new EventEmitter();
    return Object.assign(emitter, {
      shutdown: vi.fn().mockResolvedValue(undefined),
    });
  });
  return { ScanCoordinator: MockCoordinator };
});

vi.mock('../../../src/main/python-paths', () => ({
  getPythonExecutablePath: vi.fn().mockReturnValue('/usr/bin/python3'),
}));

vi.mock('../../../src/main/graviscan/register-handlers', () => ({
  registerGraviScanHandlers: vi.fn(),
  _resetRegistration: vi.fn(),
}));

vi.mock('../../../src/main/graviscan/scan-logger', () => ({
  scanLog: vi.fn(),
  cleanupOldLogs: vi.fn(),
  closeScanLog: vi.fn(),
}));

import {
  graviSessionFns,
  setupCoordinatorEventForwarding,
  setupWedgeDetection,
  getOrCreateCoordinator,
  initGraviScan,
  shutdownGraviScan,
  _resetWiringState,
} from '../../../src/main/graviscan/wiring';
import { registerGraviScanHandlers } from '../../../src/main/graviscan/register-handlers';
import {
  cleanupOldLogs,
  closeScanLog,
  scanLog,
} from '../../../src/main/graviscan/scan-logger';
import { ScanCoordinator } from '../../../src/main/graviscan/scan-coordinator';

describe('GraviScan wiring module', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await _resetWiringState();
    // Re-establish the base ScanCoordinator mock implementation every
    // test. `afterEach`'s `vi.restoreAllMocks()` degrades a plain
    // `vi.fn()` (the one built inside the `vi.mock()` factory above)
    // back to a no-op returning `undefined` — so without this, only
    // the FIRST test in this file would get a working EventEmitter-
    // shaped coordinator from `new ScanCoordinator(...)`; every test
    // after it would silently get `{}` (no `.on`), which stayed latent
    // until `setupWedgeDetection()` started unconditionally calling
    // `coordinator.on(...)` on every construction.
    vi.mocked(ScanCoordinator).mockImplementation(() => {
      const emitter = new EventEmitter();
      return Object.assign(emitter, {
        shutdown: vi.fn().mockResolvedValue(undefined),
      }) as unknown as InstanceType<typeof ScanCoordinator>;
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('side-effect-free import', () => {
    it('module imports successfully and all exports are defined', () => {
      expect(graviSessionFns).toBeDefined();
      expect(setupCoordinatorEventForwarding).toBeDefined();
      expect(getOrCreateCoordinator).toBeDefined();
      expect(initGraviScan).toBeDefined();
      expect(shutdownGraviScan).toBeDefined();
      expect(_resetWiringState).toBeDefined();
      expect(typeof graviSessionFns.getScanSession).toBe('function');
      expect(typeof graviSessionFns.setScanSession).toBe('function');
      expect(typeof graviSessionFns.markScanJobRecorded).toBe('function');
    });
  });

  describe('initGraviScan', () => {
    it('registers handlers when mode is graviscan', async () => {
      await initGraviScan('graviscan', {} as any, {} as any, () => null);

      expect(cleanupOldLogs).toHaveBeenCalled();
      expect(registerGraviScanHandlers).toHaveBeenCalled();
    });

    it('does NOT register handlers when mode is cylinderscan', async () => {
      await initGraviScan('cylinderscan', {} as any, {} as any, () => null);

      expect(registerGraviScanHandlers).not.toHaveBeenCalled();
    });

    it('does NOT register handlers when mode is empty', async () => {
      await initGraviScan('', {} as any, {} as any, () => null);

      expect(registerGraviScanHandlers).not.toHaveBeenCalled();
    });

    it('calls cleanupOldLogs on startup', async () => {
      await initGraviScan('graviscan', {} as any, {} as any, () => null);

      expect(cleanupOldLogs).toHaveBeenCalled();
    });

    it('wires arguments correctly to registerGraviScanHandlers', async () => {
      const mockIpc = {} as any;
      const mockDb = {} as any;
      const mockGetWindow = () => null;

      await initGraviScan('graviscan', mockIpc, mockDb, mockGetWindow);

      expect(registerGraviScanHandlers).toHaveBeenCalledWith(
        mockIpc,
        mockDb,
        mockGetWindow,
        graviSessionFns,
        expect.any(Function), // () => scanCoordinator
        getOrCreateCoordinator
      );
    });
  });

  describe('session state lifecycle', () => {
    it('getScanSession returns null initially', () => {
      expect(graviSessionFns.getScanSession()).toBeNull();
    });

    it('setScanSession updates state', () => {
      graviSessionFns.setScanSession({ isActive: true, jobs: {} } as any);
      expect(graviSessionFns.getScanSession()).toEqual({
        isActive: true,
        jobs: {},
      });
    });

    it('markScanJobRecorded updates job status', () => {
      graviSessionFns.setScanSession({
        isActive: true,
        jobs: { 'scanner1:00': { status: 'complete' } },
      } as any);

      graviSessionFns.markScanJobRecorded('scanner1:00');
      expect(
        (graviSessionFns.getScanSession() as any).jobs['scanner1:00'].status
      ).toBe('recorded');
    });

    it('markScanJobRecorded ignores unknown key', () => {
      graviSessionFns.setScanSession({
        isActive: true,
        jobs: { 'scanner1:00': { status: 'complete' } },
      } as any);

      graviSessionFns.markScanJobRecorded('nonexistent:99');
      expect(
        (graviSessionFns.getScanSession() as any).jobs['scanner1:00'].status
      ).toBe('complete');
    });

    it('markScanJobRecorded no-ops when scanSession is null', () => {
      expect(graviSessionFns.getScanSession()).toBeNull();
      expect(() =>
        graviSessionFns.markScanJobRecorded('scanner1:00')
      ).not.toThrow();
      expect(graviSessionFns.getScanSession()).toBeNull();
    });

    it('setScanSession(null) clears state', () => {
      graviSessionFns.setScanSession({ isActive: true } as any);
      graviSessionFns.setScanSession(null);
      expect(graviSessionFns.getScanSession()).toBeNull();
    });
  });

  describe('coordinator event forwarding', () => {
    it('forwards all 12 coordinator events to renderer (task 11.1 — scan-event replaced by scan-started/scan-complete)', () => {
      const coordinator = new EventEmitter();
      const send = vi.fn();
      const mockWindow = {
        isDestroyed: () => false,
        webContents: { send },
      };

      setupCoordinatorEventForwarding(
        coordinator as any,
        () => mockWindow as any
      );

      const events = [
        'scan-started',
        'scan-complete',
        'grid-start',
        'grid-complete',
        'cycle-complete',
        'interval-start',
        'interval-waiting',
        'interval-complete',
        'overtime',
        'cancelled',
        'scan-error',
        'scanner-init-status',
      ];

      for (const eventName of events) {
        send.mockClear();
        coordinator.emit(eventName, { test: eventName });
        expect(send).toHaveBeenCalledWith(`graviscan:${eventName}`, {
          test: eventName,
        });
      }
    });

    it('does not crash when mainWindow is null (task 11.1a — retargeted from scan-event)', () => {
      const coordinator = new EventEmitter();
      setupCoordinatorEventForwarding(coordinator as any, () => null);

      expect(() =>
        coordinator.emit('scan-error', { test: true })
      ).not.toThrow();
    });

    it('does not crash when mainWindow is destroyed (task 11.1a — retargeted from scan-event)', () => {
      const coordinator = new EventEmitter();
      const mockWindow = {
        isDestroyed: () => true,
        webContents: { send: vi.fn() },
      };

      setupCoordinatorEventForwarding(
        coordinator as any,
        () => mockWindow as any
      );

      expect(() =>
        coordinator.emit('scan-error', { test: true })
      ).not.toThrow();
      expect(mockWindow.webContents.send).not.toHaveBeenCalled();
    });
  });

  describe('setupWedgeDetection', () => {
    // Exercises the REAL setupWedgeDetection() production code path
    // directly — not a hand-rolled reimplementation (see
    // tests/unit/wedge-pipeline-integration.test.ts, which tests
    // WedgeDetector/SlackNotifier in isolation via its own inline
    // buildPipeline() helper, not this function). WedgeDetector and
    // SlackNotifier are real (unmocked) here — both are pure/side-
    // effect-free aside from SlackNotifier's fetch() call, which we
    // stub globally.
    const WEBHOOK = 'https://hooks.slack.com/services/TEST/FAKE/URL';
    let fetchMock: ReturnType<typeof vi.fn>;
    const originalWebhookEnv = process.env.BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL;

    beforeEach(() => {
      process.env.BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL = WEBHOOK;
      fetchMock = vi
        .fn()
        .mockResolvedValue(new Response('ok', { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      if (originalWebhookEnv === undefined) {
        delete process.env.BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL;
      } else {
        process.env.BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL = originalWebhookEnv;
      }
    });

    // Retargeted (task 11.2) from the retired generic 'scan-event' bus
    // (`{type: 'scan-error', ...}`) to the first-class 'scan-error'
    // channel with no embedded `type` field.
    function emitScanError(
      coordinator: EventEmitter,
      overrides: Record<string, unknown> = {}
    ) {
      coordinator.emit('scan-error', {
        scanner_id: 'sc-1',
        plate_index: '00',
        job_id: 'job-1',
        error: 'epkowa: sane_start: Invalid argument',
        bytes_received: 0,
        wall_seconds: 5,
        cycle_number: 1,
        ...overrides,
      });
    }

    it('interval-start → scan-error (sane_start_invalid) → Slack POST + scanLog fire end-to-end, using the active session id', async () => {
      graviSessionFns.setScanSession({
        sessionId: 'sess-real-42',
        isActive: true,
        jobs: {},
      } as any);

      const coordinator = new EventEmitter();
      setupWedgeDetection(coordinator as any);

      coordinator.emit('interval-start', {
        totalCycles: 3,
        intervalMs: 1000,
        durationMs: 3000,
        startedAt: 1000,
      });

      // Cycle tracking is driven by scan-started (task 11.5) — in
      // production this always precedes the scan-error/scan-complete
      // for the same job, so establish cycle 1 here too.
      coordinator.emit('scan-started', {
        scanner_id: 'sc-1',
        plate_index: '00',
        cycle_number: 1,
      });
      emitScanError(coordinator);

      // slackNotifier.notify() is fire-and-forget (`void`) — flush
      // any pending microtasks before asserting on the fetch call.
      await new Promise((r) => setTimeout(r, 0));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(WEBHOOK);
      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string
      );
      expect(body.text).toContain('sc-1');
      expect(body.text).toContain('sane_start_invalid');
      expect(body.text).toContain('sess-real-42');

      expect(scanLog).toHaveBeenCalledWith(
        expect.stringContaining(
          '[WedgeDetector] wedge-detected scanner=sc-1 signature=sane_start_invalid cycle=1'
        )
      );
    });

    it('falls back to a startedAt-based session id when no active scan session exists', async () => {
      const coordinator = new EventEmitter();
      setupWedgeDetection(coordinator as any);

      coordinator.emit('interval-start', { startedAt: 999999 });
      emitScanError(coordinator);
      await new Promise((r) => setTimeout(r, 0));

      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string
      );
      expect(body.text).toContain('session-999999');
    });

    it('routes two same-cycle scan-error events for one scanner to a single consecutive_failures wedge', async () => {
      const coordinator = new EventEmitter();
      setupWedgeDetection(coordinator as any);
      coordinator.emit('interval-start', { startedAt: 1 });

      emitScanError(coordinator, {
        plate_index: '00',
        job_id: 'j1',
        error: 'transient error',
      });
      emitScanError(coordinator, {
        plate_index: '01',
        job_id: 'j2',
        error: 'another transient error',
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string
      );
      expect(body.text).toContain('consecutive_failures');
    });

    it('scan-complete resolves a scanner without triggering a wedge (recovered path) (task 11.2 — retargeted from scan-event)', async () => {
      const coordinator = new EventEmitter();
      setupWedgeDetection(coordinator as any);
      coordinator.emit('interval-start', { startedAt: 1 });

      coordinator.emit('scan-complete', {
        scanner_id: 'sc-9',
        plate_index: '00',
        job_id: 'j1',
        cycle_number: 1,
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('tears down the detector on interval-complete — a later scan-error no longer triggers a wedge', async () => {
      const coordinator = new EventEmitter();
      setupWedgeDetection(coordinator as any);
      coordinator.emit('interval-start', { startedAt: 1 });
      coordinator.emit('interval-complete', {
        cyclesCompleted: 1,
        totalCycles: 1,
        cancelled: false,
        overtimeMs: 0,
      });

      emitScanError(coordinator, { scanner_id: 'sc-torn-down' });
      await new Promise((r) => setTimeout(r, 0));

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not POST to Slack when scan-error fires before any interval-start (no detector yet) (task 11.2b — renamed from scan-event)', async () => {
      const coordinator = new EventEmitter();
      setupWedgeDetection(coordinator as any);

      emitScanError(coordinator, { scanner_id: 'sc-too-early' });
      await new Promise((r) => setTimeout(r, 0));

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not POST to Slack when the webhook env var is unset (feature disabled)', async () => {
      delete process.env.BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL;

      const coordinator = new EventEmitter();
      setupWedgeDetection(coordinator as any);
      coordinator.emit('interval-start', { startedAt: 1 });
      emitScanError(coordinator, { scanner_id: 'sc-disabled' });
      await new Promise((r) => setTimeout(r, 0));

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('enriches the Slack message with display_name/usb_port looked up from the db (final-review #4)', async () => {
      const coordinator = new EventEmitter();
      const mockDb = {
        graviScanner: {
          findUnique: vi.fn().mockResolvedValue({
            display_name: 'Bench 3',
            usb_port: '1-4',
          }),
        },
      };

      setupWedgeDetection(coordinator as any, mockDb as any);
      coordinator.emit('interval-start', { startedAt: 1 });
      emitScanError(coordinator, { scanner_id: 'sc-enriched' });
      await new Promise((r) => setTimeout(r, 0));

      expect(mockDb.graviScanner.findUnique).toHaveBeenCalledWith({
        where: { id: 'sc-enriched' },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string
      );
      expect(body.text).toContain('Bench 3');
      expect(body.text).toContain('1-4');
    });

    it('falls back to the unenriched event when no db is passed', async () => {
      const coordinator = new EventEmitter();
      setupWedgeDetection(coordinator as any); // no db arg — matches every other test in this block

      coordinator.emit('interval-start', { startedAt: 1 });
      emitScanError(coordinator, { scanner_id: 'sc-no-db' });
      await new Promise((r) => setTimeout(r, 0));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string
      );
      expect(body.text).toContain('sc-no-db');
      expect(body.text).not.toContain('USB path');
    });

    it('falls back to the unenriched event when the scanner_id is not found in the db', async () => {
      const coordinator = new EventEmitter();
      const mockDb = {
        graviScanner: { findUnique: vi.fn().mockResolvedValue(null) },
      };

      setupWedgeDetection(coordinator as any, mockDb as any);
      coordinator.emit('interval-start', { startedAt: 1 });
      emitScanError(coordinator, { scanner_id: 'sc-unknown' });
      await new Promise((r) => setTimeout(r, 0));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string
      );
      expect(body.text).toContain('sc-unknown');
    });

    it('falls back to the unenriched event when the db lookup throws', async () => {
      const coordinator = new EventEmitter();
      const mockDb = {
        graviScanner: {
          findUnique: vi.fn().mockRejectedValue(new Error('DB unavailable')),
        },
      };

      setupWedgeDetection(coordinator as any, mockDb as any);
      coordinator.emit('interval-start', { startedAt: 1 });
      emitScanError(coordinator, { scanner_id: 'sc-db-error' });
      await new Promise((r) => setTimeout(r, 0));

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('repeated scan-complete events for the same scanner never trigger a wedge (task 11.3 — onScanEnd success routing)', async () => {
      const coordinator = new EventEmitter();
      setupWedgeDetection(coordinator as any);
      coordinator.emit('interval-start', { startedAt: 1 });

      // setupWedgeDetection() must route every scan-complete to
      // wedgeDetector.onScanEnd({success: true}) (replacing the old
      // event.type === 'scan-complete' branch) — proven here by firing
      // several in a row across two plates and confirming none of them
      // ever accumulates toward a wedge.
      for (const plateIndex of ['00', '01', '00', '01']) {
        coordinator.emit('scan-complete', {
          scanner_id: 'sc-1',
          plate_index: plateIndex,
          job_id: `j-${plateIndex}`,
          cycle_number: 1,
        });
      }
      await new Promise((r) => setTimeout(r, 0));

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('a coordinator-originated scan-error (camelCase scannerId/plateIndex, no snake_case fields) reaches wedge detection and can contribute to consecutive_failures (task 11.4 — design.md Decision 2 found-bug fix)', async () => {
      const coordinator = new EventEmitter();
      setupWedgeDetection(coordinator as any);
      coordinator.emit('interval-start', { startedAt: 1 });

      // Shape of ScanCoordinator's own direct scan-error emissions
      // (scanOnce()'s row-timeout / file-verification-failure sites) —
      // camelCase only, no `type` field, no snake_case scanner_id. Before
      // this migration these were invisible to wedge detection because
      // setupWedgeDetection() only listened on the generic scan-event bus,
      // which the coordinator never emitted these on either.
      coordinator.emit('scan-error', {
        scannerId: 'sc-coord',
        jobId: 'sc-coord',
        error: 'Row scan timeout after 90000ms',
      });
      coordinator.emit('scan-error', {
        scannerId: 'sc-coord',
        plateIndex: '00',
        jobId: 'sc-coord:00',
        error: 'Output file missing after scan-complete: /tmp/x.tif',
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string
      );
      expect(body.text).toContain('sc-coord');
      expect(body.text).toContain('consecutive_failures');
    });
  });

  describe('coordinator lazy instantiation', () => {
    it('first call creates coordinator', async () => {
      const coordinator = await getOrCreateCoordinator();
      expect(coordinator).toBeDefined();
      expect(ScanCoordinator).toHaveBeenCalledTimes(1);
    });

    it('second call returns cached instance', async () => {
      const c1 = await getOrCreateCoordinator();
      const c2 = await getOrCreateCoordinator();
      expect(c1).toBe(c2);
      expect(ScanCoordinator).toHaveBeenCalledTimes(1);
    });

    it('concurrent calls return same instance', async () => {
      const [c1, c2] = await Promise.all([
        getOrCreateCoordinator(),
        getOrCreateCoordinator(),
      ]);

      expect(c1).toBe(c2);
      expect(ScanCoordinator).toHaveBeenCalledTimes(1);
    });

    it('threads the db passed to initGraviScan through to setupWedgeDetection for wedge-event enrichment (final-review #4) (task 11.7 — retargeted from scan-event)', async () => {
      const originalWebhookEnv = process.env.BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL;
      process.env.BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL =
        'https://hooks.slack.com/services/TEST/FAKE/URL';
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response('ok', { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      const mockDb = {
        graviScanner: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ display_name: 'Bench 9', usb_port: '2-1' }),
        },
      };

      await initGraviScan('graviscan', {} as any, mockDb, () => null);
      const coordinator = await getOrCreateCoordinator();

      (coordinator as unknown as EventEmitter).emit('interval-start', {
        startedAt: 1,
      });
      (coordinator as unknown as EventEmitter).emit('scan-error', {
        scanner_id: 'sc-wired',
        plate_index: '00',
        job_id: 'job-1',
        error: 'epkowa: sane_start: Invalid argument',
        bytes_received: 0,
        wall_seconds: 5,
        cycle_number: 1,
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(mockDb.graviScanner.findUnique).toHaveBeenCalledWith({
        where: { id: 'sc-wired' },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string
      );
      expect(body.text).toContain('Bench 9');

      vi.unstubAllGlobals();
      if (originalWebhookEnv === undefined) {
        delete process.env.BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL;
      } else {
        process.env.BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL = originalWebhookEnv;
      }
    });
  });

  describe('shutdownGraviScan', () => {
    it('shuts down active coordinator and calls closeScanLog', async () => {
      // Create a coordinator with a trackable shutdown spy
      const shutdownFn = vi.fn().mockResolvedValue(undefined);
      vi.mocked(ScanCoordinator).mockImplementationOnce(() => {
        const emitter = new EventEmitter();
        return Object.assign(emitter, { shutdown: shutdownFn }) as any;
      });

      await getOrCreateCoordinator();
      await shutdownGraviScan();

      expect(shutdownFn).toHaveBeenCalled();
      expect(closeScanLog).toHaveBeenCalled();
    });

    it('no-ops when no coordinator exists, still calls closeScanLog', async () => {
      await shutdownGraviScan();

      expect(closeScanLog).toHaveBeenCalled();
    });

    it('catches coordinator.shutdown() error and still calls closeScanLog', async () => {
      // Create a coordinator with a failing shutdown
      const shutdownFn = vi
        .fn()
        .mockRejectedValue(new Error('shutdown failed'));
      vi.mocked(ScanCoordinator).mockImplementationOnce(() => {
        const emitter = new EventEmitter();
        return Object.assign(emitter, { shutdown: shutdownFn }) as any;
      });

      await getOrCreateCoordinator();
      await shutdownGraviScan();

      expect(shutdownFn).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Error shutting down'),
        expect.any(Error)
      );
      expect(closeScanLog).toHaveBeenCalled();
    });

    it('awaits in-flight _coordinatorCreating before shutting down', async () => {
      // Verify the promise memoization pattern works with shutdown.
      // We simulate concurrent create + shutdown by calling both without awaiting.
      const shutdownFn = vi.fn().mockResolvedValue(undefined);
      vi.mocked(ScanCoordinator).mockImplementationOnce(() => {
        const emitter = new EventEmitter();
        return Object.assign(emitter, { shutdown: shutdownFn }) as any;
      });

      // Start creation (sets _coordinatorCreating) and shutdown concurrently
      const createPromise = getOrCreateCoordinator();
      const shutdownPromise = shutdownGraviScan();

      // Both should resolve without error
      await createPromise;
      await shutdownPromise;

      expect(shutdownFn).toHaveBeenCalled();
      expect(closeScanLog).toHaveBeenCalled();
    });

    it('handles rejected _coordinatorCreating gracefully', async () => {
      // Make coordinator creation fail
      vi.mocked(ScanCoordinator).mockImplementationOnce(() => {
        throw new Error('Python not found');
      });

      // Start creation — will reject
      const createPromise = getOrCreateCoordinator();
      await createPromise.catch(() => {});

      // Shutdown should handle this gracefully
      await shutdownGraviScan();

      expect(closeScanLog).toHaveBeenCalled();
    });
  });

  describe('session completion', () => {
    it('session is cleared after scan completes successfully', () => {
      graviSessionFns.setScanSession({
        isActive: true,
        experimentId: 'exp1',
        jobs: {},
      } as any);

      graviSessionFns.setScanSession(null);
      expect(graviSessionFns.getScanSession()).toBeNull();
    });
  });
});
