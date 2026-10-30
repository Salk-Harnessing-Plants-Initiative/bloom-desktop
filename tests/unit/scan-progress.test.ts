/**
 * A scan's progress, from Python's PROGRESS lines to ScannerProcess's 'progress' event.
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { PythonProcess } from '../../src/main/python-process';
import { ScannerProcess } from '../../src/main/cylinderscan/scanner-process';

vi.mock('../../src/main/database', () => ({ getDatabase: vi.fn() }));

const parseLine = (process: PythonProcess, line: string) =>
  (process as unknown as { parseLine(l: string): void }).parseLine(line);

describe('scan progress', () => {
  it('reads a PROGRESS line into a progress event', () => {
    const process = new PythonProcess('python', []);
    const progress = vi.fn();
    process.on('progress', progress);

    parseLine(
      process,
      'PROGRESS:{"frame_number":11,"total_frames":72,"position":60}'
    );

    expect(progress).toHaveBeenCalledWith({
      frame_number: 11,
      total_frames: 72,
      position: 60,
    });
  });

  it('ignores an unreadable line, without an error that would cancel the scan', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const process = new PythonProcess('python', []);
    const error = vi.fn();
    process.on('error', error);

    parseLine(process, 'PROGRESS:{not json');

    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('passes progress on from the Python process to the scanner', () => {
    const python = new EventEmitter();
    const scanner = new ScannerProcess(python as unknown as PythonProcess);
    const progress = vi.fn();
    scanner.onProgress(progress);

    const update = { frame_number: 0, total_frames: 72, position: 5 };
    python.emit('progress', update);

    expect(progress).toHaveBeenCalledWith(update);
  });
});
