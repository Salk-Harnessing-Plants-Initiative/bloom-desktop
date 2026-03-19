/**
 * PythonProcess unit tests
 *
 * Tests sendCommand timeout cleanup to prevent closure leaks.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

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
