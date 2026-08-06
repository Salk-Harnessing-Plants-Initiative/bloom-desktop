/**
 * Resolves once a given pattern appears in a stream of text within a
 * timeout, ported from scripts/lib/test-utils.sh's wait_for_log_pattern().
 *
 * Accepts anything that emits 'data' events with string/Buffer chunks
 * (e.g. a child process's stdout stream), not just a Node Readable, so it
 * stays trivially unit-testable without a real process.
 */

interface DataEmitter {
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  removeListener(
    event: 'data',
    listener: (chunk: Buffer | string) => void
  ): unknown;
}

export function waitForLogPattern(
  stream: DataEmitter,
  pattern: string | RegExp,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = '';

    const matches = (text: string): boolean =>
      typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text);

    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      if (matches(buffer)) {
        cleanup();
        resolve();
      }
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timed out after ${timeoutMs}ms waiting for pattern: ${pattern}`
        )
      );
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      stream.removeListener('data', onData);
    }

    stream.on('data', onData);
  });
}
