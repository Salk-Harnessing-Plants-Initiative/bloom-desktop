// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock child_process with factory pattern (Pattern B from python-process.test.ts)
// stdout/stderr need resume() for readline.createInterface compatibility
function createMockReadable() {
  const emitter = new EventEmitter();
  (emitter as unknown as Record<string, unknown>).resume = vi.fn();
  (emitter as unknown as Record<string, unknown>).pause = vi.fn();
  (emitter as unknown as Record<string, unknown>).setEncoding = vi.fn();
  return emitter;
}

function createMockProcess() {
  const stdout = createMockReadable();
  const stderr = createMockReadable();
  return {
    stdout,
    stderr,
    stdin: { write: vi.fn() },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      // Store handlers so we can trigger them in tests
      mockProcessHandlers[event] = cb;
    }),
    once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      mockProcessHandlers[event] = cb;
    }),
    kill: vi.fn(),
    killed: false,
    pid: 12345,
  };
}

let mockProc: ReturnType<typeof createMockProcess>;
let mockProcessHandlers: Record<string, (...args: unknown[]) => void>;

vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    mockProc = createMockProcess();
    return mockProc;
  }),
}));

vi.mock('../../../src/main/graviscan/scan-logger', () => ({
  scanLog: vi.fn(),
}));

import { spawn } from 'child_process';
import { ScannerSubprocess } from '../../../src/main/graviscan/scanner-subprocess';
import { scanLog } from '../../../src/main/graviscan/scan-logger';

/** Emit a line on mock stdout (readline needs data events with newlines) */
function emitLine(line: string) {
  mockProc.stdout.emit('data', line + '\n');
}

describe('ScannerSubprocess', () => {
  let subprocess: ScannerSubprocess;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessHandlers = {};
    subprocess = new ScannerSubprocess(
      '/usr/bin/python3',
      false, // not packaged
      'scanner-1',
      'epkowa:interpreter:001:002',
      false // not mock
    );
    // Suppress console output
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('spawn()', () => {
    it('spawns process and resolves on EVENT:ready', async () => {
      const spawnPromise = subprocess.spawn();

      // Simulate EVENT:ready on stdout
      emitLine('EVENT:{"type":"ready","scanner_id":"scanner-1"}');

      await spawnPromise;

      expect(spawn).toHaveBeenCalledWith(
        '/usr/bin/python3',
        expect.arrayContaining([
          '-m',
          'graviscan.scan_worker',
          '--scanner-id',
          'scanner-1',
          '--device',
          'epkowa:interpreter:001:002',
        ]),
        expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] })
      );
      expect(subprocess.isReady).toBe(true);
      expect(subprocess.isAlive).toBe(true);
    });

    it('uses bloom-hardware args in packaged mode', async () => {
      subprocess = new ScannerSubprocess(
        '/app/bloom-hardware',
        true, // packaged
        'scanner-1',
        'epkowa:interpreter:001:002'
      );

      const spawnPromise = subprocess.spawn();
      emitLine('EVENT:{"type":"ready","scanner_id":"scanner-1"}');
      await spawnPromise;

      expect(spawn).toHaveBeenCalledWith(
        '/app/bloom-hardware',
        expect.arrayContaining([
          '--scan-worker',
          '--scanner-id',
          'scanner-1',
          '--device',
          'epkowa:interpreter:001:002',
        ]),
        expect.any(Object)
      );
    });

    it('rejects on spawn error (ENOENT)', async () => {
      const spawnPromise = subprocess.spawn();

      // Simulate spawn error — triggers 'process-error' (renamed from 'error'
      // to avoid Node EventEmitter special behavior)
      const handler = mockProcessHandlers['error'];
      if (handler) handler(new Error('spawn ENOENT'));

      await expect(spawnPromise).rejects.toThrow('spawn failed');
    });

    it('rejects if process exits before ready', async () => {
      const spawnPromise = subprocess.spawn();

      // Simulate unexpected exit
      const exitHandler = mockProcessHandlers['exit'];
      if (exitHandler) exitHandler(1, null);

      await expect(spawnPromise).rejects.toThrow('exited');
    });

    it('rejects on init-error event', async () => {
      const spawnPromise = subprocess.spawn();

      emitLine(
        'EVENT:{"type":"error","scanner_id":"scanner-1","error":"SANE device not found"}'
      );

      await expect(spawnPromise).rejects.toThrow('SANE device not found');
    });
  });

  describe('scan()', () => {
    it('sends JSON scan command to stdin and transitions to scanning', async () => {
      // Get to ready state
      const spawnPromise = subprocess.spawn();
      emitLine('EVENT:{"type":"ready","scanner_id":"scanner-1"}');
      await spawnPromise;

      const plates = [
        {
          plate_index: '00',
          grid_mode: '2grid',
          resolution: 600,
          output_path: '/tmp/scan/plate00.tif',
        },
      ];

      subprocess.scan(plates);

      expect(mockProc.stdin.write).toHaveBeenCalledWith(
        expect.stringContaining('"action":"scan"')
      );
      const written = mockProc.stdin.write.mock.calls[0][0];
      const parsed = JSON.parse(written.replace('\n', ''));
      expect(parsed.action).toBe('scan');
      expect(parsed.plates).toEqual(plates);
    });
  });

  describe('cancel()', () => {
    it('sends cancel command to stdin', async () => {
      const spawnPromise = subprocess.spawn();
      emitLine('EVENT:{"type":"ready","scanner_id":"scanner-1"}');
      await spawnPromise;

      subprocess.cancel();

      expect(mockProc.stdin.write).toHaveBeenCalledWith(
        expect.stringContaining('"action":"cancel"')
      );
    });
  });

  describe('event parsing', () => {
    beforeEach(async () => {
      const spawnPromise = subprocess.spawn();
      emitLine('EVENT:{"type":"ready","scanner_id":"scanner-1"}');
      await spawnPromise;
    });

    it('emits typed events for scan-started', () => {
      const handler = vi.fn();
      subprocess.on('scan-started', handler);

      emitLine(
        'EVENT:{"type":"scan-started","scanner_id":"scanner-1","plate_index":"00"}'
      );

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'scan-started',
          scanner_id: 'scanner-1',
          plate_index: '00',
        })
      );
    });

    it('emits typed events for scan-complete', () => {
      const handler = vi.fn();
      subprocess.on('scan-complete', handler);

      emitLine(
        'EVENT:{"type":"scan-complete","scanner_id":"scanner-1","path":"/tmp/out.tif","duration_ms":5000}'
      );

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'scan-complete',
          path: '/tmp/out.tif',
          duration_ms: 5000,
        })
      );
    });

    it('emits typed events for scan-error', () => {
      const handler = vi.fn();
      subprocess.on('scan-error', handler);

      emitLine(
        'EVENT:{"type":"scan-error","scanner_id":"scanner-1","error":"SANE IO error"}'
      );

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'scan-error',
          error: 'SANE IO error',
        })
      );
    });

    it('emits typed events for scan-cancelled', () => {
      const handler = vi.fn();
      subprocess.on('scan-cancelled', handler);

      emitLine('EVENT:{"type":"scan-cancelled","scanner_id":"scanner-1"}');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'scan-cancelled' })
      );
    });

    it('emits typed events for cycle-done and transitions back to ready', () => {
      const handler = vi.fn();
      subprocess.on('cycle-done', handler);

      // Force state to scanning first
      subprocess.scan([
        {
          plate_index: '00',
          grid_mode: '2grid',
          resolution: 600,
          output_path: '/tmp/scan.tif',
        },
      ]);

      emitLine('EVENT:{"type":"cycle-done","scanner_id":"scanner-1"}');

      expect(handler).toHaveBeenCalled();
      expect(subprocess.isReady).toBe(true);
    });

    it('emits generic event for coordinator forwarding', () => {
      const handler = vi.fn();
      subprocess.on('event', handler);

      emitLine('EVENT:{"type":"scan-complete","scanner_id":"scanner-1"}');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'scan-complete' })
      );
    });

    it('logs malformed EVENT JSON as warning without crashing', () => {
      emitLine('EVENT:not-valid-json');

      // Should not throw, subprocess should still be alive
      expect(subprocess.isReady).toBe(true);
      // The malformed line should be logged
      expect(scanLog).toHaveBeenCalledWith(
        expect.stringContaining('Invalid EVENT JSON')
      );
    });
  });

  describe('process exit with non-zero code', () => {
    it('emits exit event and transitions to dead', async () => {
      const spawnPromise = subprocess.spawn();
      emitLine('EVENT:{"type":"ready","scanner_id":"scanner-1"}');
      await spawnPromise;

      const exitHandler = vi.fn();
      subprocess.on('exit', exitHandler);

      // Trigger exit
      const procExitHandler = mockProcessHandlers['exit'];
      if (procExitHandler) procExitHandler(1, 'SIGTERM');

      expect(exitHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          scannerId: 'scanner-1',
          code: 1,
          signal: 'SIGTERM',
        })
      );
    });
  });

  describe('shutdown()', () => {
    it('sends quit command and resolves on exit', async () => {
      const spawnPromise = subprocess.spawn();
      emitLine('EVENT:{"type":"ready","scanner_id":"scanner-1"}');
      await spawnPromise;

      const shutdownPromise = subprocess.shutdown(5000);

      // Check quit command was sent
      expect(mockProc.stdin.write).toHaveBeenCalledWith(
        expect.stringContaining('"action":"quit"')
      );

      // Simulate clean exit
      const procExitHandler = mockProcessHandlers['exit'];
      if (procExitHandler) procExitHandler(0, null);

      await shutdownPromise;
    });

    it('force-kills after timeout', async () => {
      vi.useFakeTimers();

      const spawnPromise = subprocess.spawn();
      emitLine('EVENT:{"type":"ready","scanner_id":"scanner-1"}');
      await spawnPromise;

      const shutdownPromise = subprocess.shutdown(100);

      // Advance past timeout without triggering exit
      vi.advanceTimersByTime(150);

      await shutdownPromise;

      expect(mockProc.kill).toHaveBeenCalledWith('SIGKILL');

      vi.useRealTimers();
    });

    it('resolves immediately if already dead', async () => {
      // Never spawned — state is idle
      await subprocess.shutdown();
      // Should resolve without error
    });
  });

  describe('readline cleanup', () => {
    beforeEach(async () => {
      // Spawn subprocess to create readline interfaces
      const spawnPromise = subprocess.spawn();
      emitLine('EVENT:{"type":"ready","scanner_id":"scanner-1"}');
      await spawnPromise;
    });

    it('closes both readline interfaces on shutdown', async () => {
      // Access the private rl and stderrRl fields
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rl = (subprocess as any).rl;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stderrRl = (subprocess as any).stderrRl;
      expect(rl).toBeTruthy();
      expect(stderrRl).toBeTruthy();

      const rlCloseSpy = vi.spyOn(rl, 'close');
      const stderrRlCloseSpy = vi.spyOn(stderrRl, 'close');

      // Trigger shutdown — need to handle the exit event
      const shutdownPromise = subprocess.shutdown(100);
      // Simulate process exit
      const exitHandler = mockProcessHandlers['exit'];
      if (exitHandler) exitHandler(0, null);
      await shutdownPromise;

      expect(rlCloseSpy).toHaveBeenCalled();
      expect(stderrRlCloseSpy).toHaveBeenCalled();
    });

    it('closes both readline interfaces on kill', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rl = (subprocess as any).rl;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stderrRl = (subprocess as any).stderrRl;

      const rlCloseSpy = vi.spyOn(rl, 'close');
      const stderrRlCloseSpy = vi.spyOn(stderrRl, 'close');

      subprocess.kill();

      expect(rlCloseSpy).toHaveBeenCalled();
      expect(stderrRlCloseSpy).toHaveBeenCalled();
    });

    it('double cleanup is safe (shutdown then kill)', async () => {
      const shutdownPromise = subprocess.shutdown(100);
      const exitHandler = mockProcessHandlers['exit'];
      if (exitHandler) exitHandler(0, null);
      await shutdownPromise;

      // Kill after shutdown should not throw
      expect(() => subprocess.kill()).not.toThrow();
    });
  });

  describe('sendCommand safety', () => {
    it('warns if process is not running', () => {
      // Not spawned yet — proc is null
      subprocess.cancel();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Cannot send command')
      );
    });
  });
});
