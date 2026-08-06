/**
 * Unit tests for waitForLogPattern(), ported from
 * scripts/lib/test-utils.sh's wait_for_log_pattern().
 */

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import { waitForLogPattern } from '../integration/lib/wait-for-log-pattern';

/** Minimal stand-in for a Node Readable stream's 'data' event interface. */
function createMockStream() {
  return new EventEmitter();
}

describe('waitForLogPattern', () => {
  it('resolves when the pattern appears in a single chunk', async () => {
    const stream = createMockStream();

    const resultPromise = waitForLogPattern(
      stream,
      '[Main] Database initialized',
      1000
    );

    stream.emit(
      'data',
      '[Main] Database initialized and handlers registered\n'
    );

    await expect(resultPromise).resolves.toBeUndefined();
  });

  it('resolves when the pattern is split across multiple chunks', async () => {
    const stream = createMockStream();

    const resultPromise = waitForLogPattern(
      stream,
      '[Main] Database initialized',
      1000
    );

    stream.emit('data', '[Main] Database ');
    stream.emit('data', 'initialized and handlers registered\n');

    await expect(resultPromise).resolves.toBeUndefined();
  });

  it('rejects with a timeout error when the pattern never appears', async () => {
    const stream = createMockStream();

    const resultPromise = waitForLogPattern(stream, 'never appears', 20);

    stream.emit('data', 'some unrelated log output\n');

    await expect(resultPromise).rejects.toThrow(/timed out/i);
  });

  it('matches using a RegExp pattern', async () => {
    const stream = createMockStream();

    const resultPromise = waitForLogPattern(
      stream,
      /Database initialized/,
      1000
    );

    stream.emit('data', '[Main] Database initialized OK\n');

    await expect(resultPromise).resolves.toBeUndefined();
  });
});
