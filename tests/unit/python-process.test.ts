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

    // Simulate response
    process.emit('data', { success: true });

    const result = await commandPromise;
    expect(result).toEqual({ success: true });
    expect(clearTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
  });

  it('3.2 clears timeout when error response arrives', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    const commandPromise = process.sendCommand({ command: 'test' });

    // Simulate error
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
});
