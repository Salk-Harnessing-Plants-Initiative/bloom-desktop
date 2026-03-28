/**
 * Extract message from an unknown error.
 *
 * TypeScript catch blocks should use `catch (error: unknown)` instead of
 * `catch (error: any)`. This helper safely extracts the message string.
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
