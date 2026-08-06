/**
 * Polls a predicate until it returns true or a timeout elapses.
 *
 * A predicate that throws is treated as "not ready yet," not a fatal
 * error — e.g. polling for a file to appear naturally throws (ENOENT /
 * better-sqlite3's fileMustExist) until it does. The last thrown error
 * (if any) is included in the timeout message for debuggability.
 */

export function waitForCondition(
  predicate: () => boolean,
  timeoutMs: number,
  intervalMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;

    const attempt = () => {
      try {
        if (predicate()) {
          resolve();
          return;
        }
      } catch (error) {
        lastError = error;
      }

      if (Date.now() >= deadline) {
        const reason =
          lastError instanceof Error
            ? lastError.message
            : String(lastError ?? '');
        reject(
          new Error(
            `Timed out after ${timeoutMs}ms waiting for condition` +
              (reason ? ` (last error: ${reason})` : '')
          )
        );
        return;
      }

      setTimeout(attempt, intervalMs);
    };

    attempt();
  });
}
