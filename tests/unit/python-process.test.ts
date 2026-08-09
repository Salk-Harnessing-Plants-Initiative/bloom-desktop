/**
 * PythonProcess unit tests
 *
 * Tests sendCommand timeout cleanup to prevent closure leaks.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';

// Create mock streams that behave like Node streams
function createMockProcess() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  return {
    stdout,
    stderr,
    stdin: { write: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
    killed: false,
    pid: 1234,
  };
}

vi.mock('child_process', () => ({
  spawn: vi.fn(() => createMockProcess()),
}));

import { PythonProcess } from '../../src/main/python-process';

describe('PythonProcess.sendCommand', () => {
  let process: PythonProcess;

  beforeEach(async () => {
    vi.useFakeTimers();
    process = new PythonProcess('/fake/python', ['--ipc']);

    // Simulate startup: emit 'status' with 'ready' after start() is called
    const startPromise = process.start();
    setTimeout(() => process.emit('status', 'IPC handler ready'), 10);
    vi.advanceTimersByTime(10);
    await startPromise;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.stop();
  });

  it('3.1 clears timeout when data response arrives', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    const commandPromise = process.sendCommand({ command: 'test' });

    // Simulate response — id 1 since this is the first sendCommand() call
    // on a freshly-constructed PythonProcess (correlation, #47).
    process.emit('data', { success: true, id: 1 });

    const result = await commandPromise;
    expect(result).toEqual({ success: true, id: 1 });
    expect(clearTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
  });

  it('3.2 clears timeout when error response arrives', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    const commandPromise = process.sendCommand({ command: 'test' });

    // An error with no id is unattributable and rejects every pending
    // request — including this sole in-flight one.
    process.emit('error', 'Something failed');

    await expect(commandPromise).rejects.toThrow('Something failed');
    expect(clearTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
  });

  it('3.3 timeout still fires if no response', async () => {
    const commandPromise = process.sendCommand({ command: 'test' });

    // Advance past the 3-minute timeout
    vi.advanceTimersByTime(180001);

    await expect(commandPromise).rejects.toThrow('Command timeout');
  });

  it('correlates concurrent commands to their own response, even out of order', async () => {
    const first = process.sendCommand({ command: 'first' });
    const second = process.sendCommand({ command: 'second' });

    // Respond to the second command first — it must resolve its own
    // promise, not the first (cross-talk regression check, #47).
    process.emit('data', { result: 'second-result', id: 2 });
    process.emit('data', { result: 'first-result', id: 1 });

    await expect(second).resolves.toEqual({ result: 'second-result', id: 2 });
    await expect(first).resolves.toEqual({ result: 'first-result', id: 1 });
  });

  it('an attributable error rejects only its own request, leaving others pending', async () => {
    const first = process.sendCommand({ command: 'first' });
    const second = process.sendCommand({ command: 'second' });

    process.emit('error', 'first failed', 1);

    await expect(first).rejects.toThrow('first failed');

    // Second is still pending — resolve it normally to confirm it wasn't
    // affected by the first's rejection.
    process.emit('data', { result: 'ok', id: 2 });
    await expect(second).resolves.toEqual({ result: 'ok', id: 2 });
  });

  it('a response with an already-timed-out id is ignored, not a crash', async () => {
    const commandPromise = process.sendCommand({ command: 'test' });

    vi.advanceTimersByTime(180001);
    await expect(commandPromise).rejects.toThrow('Command timeout');

    // A late response for the now-stale id must not throw or resolve anything.
    expect(() => process.emit('data', { success: true, id: 1 })).not.toThrow();
  });

  it('rejects every pending request when the underlying process exits', async () => {
    const first = process.sendCommand({ command: 'first' });
    const second = process.sendCommand({ command: 'second' });

    // The mock child process's `on` is a spy, not a real event emitter —
    // invoke the 'exit' callback PythonProcess registered on it directly,
    // simulating the real child process exiting.
    const mockChild = vi.mocked(spawn).mock.results[
      vi.mocked(spawn).mock.results.length - 1
    ].value as ReturnType<typeof createMockProcess>;
    const exitCallback = mockChild.on.mock.calls.find(
      ([event]) => event === 'exit'
    )?.[1] as ((code: number | null) => void) | undefined;

    expect(exitCallback).toBeDefined();
    exitCallback!(1);

    await expect(first).rejects.toThrow();
    await expect(second).rejects.toThrow();
  });
});

describe('PythonProcess.restart', () => {
  let proc: PythonProcess;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.mocked(spawn).mockClear();
    proc = new PythonProcess('/fake/python', ['--ipc']);

    const startPromise = proc.start();
    setTimeout(() => proc.emit('status', 'IPC handler ready'), 10);
    vi.advanceTimersByTime(10);
    await startPromise;
  });

  afterEach(() => {
    vi.useRealTimers();
    proc.stop();
  });

  it('concurrent restart() calls share the same in-flight operation instead of racing', async () => {
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1); // the initial start() above

    // Two restart() calls fired back-to-back, before the first resolves —
    // simulates a user double-clicking "Restart Python" (PythonStatus.tsx
    // has no disabled-while-restarting guard).
    const restart1 = proc.restart();
    const restart2 = proc.restart();

    // Advance past restart()'s internal stop()-then-start() delay. Use
    // the async variant so the promise continuation that actually calls
    // start() (and, inside it, registers the 'status' listener) has run
    // by the time this resolves — a plain vi.advanceTimersByTime() only
    // fires the timer callback and does not flush the microtask queue,
    // so the listener wouldn't exist yet when 'status' is emitted below.
    await vi.advanceTimersByTimeAsync(100);

    // start()'s Promise executor (which registers the 'status' listener
    // and calls spawn()) runs synchronously once reached, so the ready
    // event can be emitted directly with no further timer needed.
    proc.emit('status', 'IPC handler ready');

    await expect(Promise.all([restart1, restart2])).resolves.toBeDefined();

    // Exactly one new process should have been spawned for the two
    // concurrent restart() calls — not two competing spawns, and not a
    // rejection from the second call finding a process already started.
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(2);
  });

  it('a stale exit event from a process generation superseded by restart() does not reject the new process’s pending requests', async () => {
    // Capture the FIRST (pre-restart) process's exit callback before
    // restarting — this simulates that process's real OS-level exit
    // event arriving late (e.g. delayed by OS scheduling), after a
    // restart() has already spawned a replacement.
    const staleMock = vi.mocked(spawn).mock.results[0].value as ReturnType<
      typeof createMockProcess
    >;
    const staleExitCallback = staleMock.on.mock.calls.find(
      ([event]) => event === 'exit'
    )?.[1] as ((code: number | null) => void) | undefined;
    expect(staleExitCallback).toBeDefined();

    // Restart to a new process generation.
    const restartPromise = proc.restart();
    await vi.advanceTimersByTimeAsync(100);
    proc.emit('status', 'IPC handler ready');
    await restartPromise;

    // A command is now in flight against the NEW process generation.
    const commandPromise = proc.sendCommand({ command: 'test' });

    // The stale, pre-restart process's exit event arrives late.
    staleExitCallback!(1);

    // It must NOT reject the new generation's in-flight command, and
    // must NOT null out the live process reference either — resolve the
    // command normally via the new generation's own response id to
    // prove both.
    proc.emit('data', { success: true, id: 1 });
    await expect(commandPromise).resolves.toEqual({ success: true, id: 1 });
    expect(proc.isRunning()).toBe(true);
  });

  it('stop() proactively rejects currently-pending requests instead of leaving them to time out', async () => {
    // A request is in flight against the process being stopped.
    const commandPromise = proc.sendCommand({ command: 'test' });

    // Once stop() is called, this request can never get a real response —
    // the generation guard on the (possibly-delayed, possibly-never-fired)
    // real exit event now intentionally no-ops once a new generation has
    // started, so relying on that event to reject an old-generation
    // request would otherwise leave it hanging for the full 3-minute
    // COMMAND_TIMEOUT_MS instead of failing fast.
    proc.stop();

    await expect(commandPromise).rejects.toThrow();
  });

  it('a stale exit event after a direct stop()+start() (no restart()) does not corrupt the new process — generation protection is not restart()-specific', async () => {
    const staleMock = vi.mocked(spawn).mock.results[0].value as ReturnType<
      typeof createMockProcess
    >;
    const staleExitCallback = staleMock.on.mock.calls.find(
      ([event]) => event === 'exit'
    )?.[1] as ((code: number | null) => void) | undefined;
    expect(staleExitCallback).toBeDefined();

    // Stop and start again directly — no restart() involved.
    proc.stop();
    const startPromise = proc.start();
    proc.emit('status', 'IPC handler ready');
    await startPromise;

    const commandPromise = proc.sendCommand({ command: 'test' });

    // The first process's real exit event arrives late, after the second
    // start() has already begun a new generation.
    staleExitCallback!(1);

    proc.emit('data', { success: true, id: 1 });
    await expect(commandPromise).resolves.toEqual({ success: true, id: 1 });
    expect(proc.isRunning()).toBe(true);
  });
});

describe('handleStdout', () => {
  let pyProc: PythonProcess;
  let mockProc: ReturnType<typeof createMockProcess>;

  beforeEach(async () => {
    vi.useFakeTimers();
    // Clear previous mock calls and set up a fresh mock process
    mockProc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mockProc as never);

    pyProc = new PythonProcess('/fake/python', ['--ipc']);

    // Start the process — the mock stdout listener gets wired up here
    const startPromise = pyProc.start();
    setTimeout(() => pyProc.emit('status', 'IPC handler ready'), 10);
    vi.advanceTimersByTime(10);
    await startPromise;
  });

  afterEach(() => {
    vi.useRealTimers();
    pyProc.stop();
  });

  it('parses a single complete line', () => {
    const statusSpy = vi.fn();
    pyProc.on('status', statusSpy);

    mockProc.stdout.emit('data', Buffer.from('STATUS:ready\n'));

    expect(statusSpy).toHaveBeenCalledTimes(1);
    expect(statusSpy).toHaveBeenCalledWith('ready');
  });

  it('reassembles a line split across two chunks', () => {
    const statusSpy = vi.fn();
    pyProc.on('status', statusSpy);

    mockProc.stdout.emit('data', Buffer.from('STATUS:rea'));
    expect(statusSpy).not.toHaveBeenCalled();

    mockProc.stdout.emit('data', Buffer.from('dy\n'));
    expect(statusSpy).toHaveBeenCalledTimes(1);
    expect(statusSpy).toHaveBeenCalledWith('ready');
  });

  it('parses multiple lines in one chunk', () => {
    const statusSpy = vi.fn();
    pyProc.on('status', statusSpy);

    mockProc.stdout.emit('data', Buffer.from('STATUS:one\nSTATUS:two\n'));

    expect(statusSpy).toHaveBeenCalledTimes(2);
    expect(statusSpy).toHaveBeenNthCalledWith(1, 'one');
    expect(statusSpy).toHaveBeenNthCalledWith(2, 'two');
  });

  it('retains trailing incomplete line for next chunk', () => {
    const statusSpy = vi.fn();
    pyProc.on('status', statusSpy);

    mockProc.stdout.emit('data', Buffer.from('STATUS:one\nSTATUS:tw'));
    expect(statusSpy).toHaveBeenCalledTimes(1);
    expect(statusSpy).toHaveBeenCalledWith('one');

    mockProc.stdout.emit('data', Buffer.from('o\n'));
    expect(statusSpy).toHaveBeenCalledTimes(2);
    expect(statusSpy).toHaveBeenNthCalledWith(2, 'two');
  });

  it('handles empty Buffer without error', () => {
    const statusSpy = vi.fn();
    const errorSpy = vi.fn();
    pyProc.on('status', statusSpy);
    pyProc.on('error', errorSpy);

    // Should not throw or emit any events
    mockProc.stdout.emit('data', Buffer.alloc(0));

    expect(statusSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('mid-line chunk is independent of parent buffer', () => {
    const statusSpy = vi.fn();
    pyProc.on('status', statusSpy);

    const original = Buffer.from('STATUS:hello\nSTATUS:trail');
    mockProc.stdout.emit('data', original);

    // First complete line was parsed
    expect(statusSpy).toHaveBeenCalledWith('hello');

    // Mutate the original buffer — should NOT affect the stored trailing partial
    original.fill(0);

    // Complete the trailing partial
    mockProc.stdout.emit('data', Buffer.from('ing\n'));

    // The trailing partial should NOT have been corrupted
    expect(statusSpy).toHaveBeenCalledTimes(2);
    expect(statusSpy).toHaveBeenNthCalledWith(2, 'trailing');
  });

  it('trailing partial is independent of parent buffer', () => {
    const statusSpy = vi.fn();
    pyProc.on('status', statusSpy);

    // Send data with a trailing partial (no newline at end)
    const original = Buffer.from('STATUS:partial');
    mockProc.stdout.emit('data', original);
    expect(statusSpy).not.toHaveBeenCalled();

    // Mutate the original buffer
    original.fill(0);

    // Complete the line — the partial should still be intact
    mockProc.stdout.emit('data', Buffer.from('_end\n'));
    expect(statusSpy).toHaveBeenCalledTimes(1);
    expect(statusSpy).toHaveBeenCalledWith('partial_end');
  });

  it('clears buffer on stop', () => {
    const statusSpy = vi.fn();
    pyProc.on('status', statusSpy);

    // Emit partial data (no newline) to fill the internal buffer
    mockProc.stdout.emit('data', Buffer.from('STATUS:partial'));
    expect(statusSpy).not.toHaveBeenCalled();

    // Stop the process — should not throw even with partial data buffered
    expect(() => pyProc.stop()).not.toThrow();
  });

  describe('unrecognized-line warning (#318)', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('logs a warning for a truly unrecognized line', () => {
      const rawSpy = vi.fn();
      pyProc.on('raw', rawSpy);

      mockProc.stdout.emit('data', Buffer.from('garbled-nonsense-line\n'));

      expect(rawSpy).toHaveBeenCalledWith('garbled-nonsense-line');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('garbled-nonsense-line');
    });

    it('does not warn for a WARNING: line', () => {
      const rawSpy = vi.fn();
      pyProc.on('raw', rawSpy);

      mockProc.stdout.emit(
        'data',
        Buffer.from('WARNING:Error closing DAQ task: boom\n')
      );

      expect(rawSpy).toHaveBeenCalledWith(
        'WARNING:Error closing DAQ task: boom'
      );
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('does not warn for an INFO: line', () => {
      const rawSpy = vi.fn();
      pyProc.on('raw', rawSpy);

      mockProc.stdout.emit(
        'data',
        Buffer.from('INFO:Camera enumeration not available: no pypylon\n')
      );

      expect(rawSpy).toHaveBeenCalledWith(
        'INFO:Camera enumeration not available: no pypylon'
      );
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('does not warn for the known benign "Generating synthetic test patterns instead" line', () => {
      const rawSpy = vi.fn();
      pyProc.on('raw', rawSpy);

      mockProc.stdout.emit(
        'data',
        Buffer.from('Generating synthetic test patterns instead\n')
      );

      expect(rawSpy).toHaveBeenCalledWith(
        'Generating synthetic test patterns instead'
      );
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('warns for a lowercase "warning:" line (case-sensitive allowlist)', () => {
      const rawSpy = vi.fn();
      pyProc.on('raw', rawSpy);

      mockProc.stdout.emit('data', Buffer.from('warning:lowercase\n'));

      expect(rawSpy).toHaveBeenCalledWith('warning:lowercase');
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('warns for a "WARNINGLY:" line (false-prefix trap)', () => {
      const rawSpy = vi.fn();
      pyProc.on('raw', rawSpy);

      mockProc.stdout.emit(
        'data',
        Buffer.from('WARNINGLY:not actually the WARNING: prefix\n')
      );

      expect(rawSpy).toHaveBeenCalledWith(
        'WARNINGLY:not actually the WARNING: prefix'
      );
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('an empty line does not warn (handleStdout already filters it before parseLine)', () => {
      const rawSpy = vi.fn();
      pyProc.on('raw', rawSpy);

      expect(() =>
        mockProc.stdout.emit('data', Buffer.from('\n'))
      ).not.toThrow();

      // handleStdout() trims each line and only calls parseLine() when
      // truthy — a bare newline never reaches parseLine at all, so neither
      // 'raw' nor the warning fires for it.
      expect(rawSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
