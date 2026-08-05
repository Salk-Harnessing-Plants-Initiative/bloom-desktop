/**
 * Unit tests for waitForCondition() — polls a predicate until it returns
 * true or a timeout elapses. Used where a transient log line can race with
 * other stdout consumers (see design.md Decision 2b) and a directly
 * observable outcome (e.g. a file appearing with the right content) is a
 * more reliable signal than trying to catch an ephemeral log message.
 */

import { describe, it, expect, vi } from 'vitest';
import { waitForCondition } from '../integration/lib/wait-for-condition';

describe('waitForCondition', () => {
  it('resolves immediately if the predicate is already true', async () => {
    const predicate = vi.fn(() => true);

    await waitForCondition(predicate, 1000, 10);

    expect(predicate).toHaveBeenCalledTimes(1);
  });

  it('resolves once the predicate becomes true after a few false attempts', async () => {
    let calls = 0;
    const predicate = vi.fn(() => {
      calls++;
      return calls >= 3;
    });

    await waitForCondition(predicate, 1000, 5);

    expect(predicate).toHaveBeenCalledTimes(3);
  });

  it('rejects with a timeout error if the predicate never becomes true', async () => {
    const predicate = vi.fn(() => false);

    await expect(waitForCondition(predicate, 30, 5)).rejects.toThrow(
      /timed out/i
    );
  });

  it('treats a throwing predicate as "not ready yet" and keeps retrying', async () => {
    // Mirrors polling for a file that doesn't exist yet: better-sqlite3
    // throws (fileMustExist) rather than returning false, and that's an
    // expected, transient condition during polling — not a fatal error.
    let calls = 0;
    const predicate = vi.fn(() => {
      calls++;
      if (calls < 3) {
        throw new Error('ENOENT: file not found yet');
      }
      return true;
    });

    await waitForCondition(predicate, 1000, 5);

    expect(predicate).toHaveBeenCalledTimes(3);
  });

  it('rejects with a timeout error (including the last failure) if the predicate only ever throws', async () => {
    const predicate = vi.fn(() => {
      throw new Error('ENOENT: file not found yet');
    });

    await expect(waitForCondition(predicate, 30, 5)).rejects.toThrow(
      /timed out/i
    );
  });
});
