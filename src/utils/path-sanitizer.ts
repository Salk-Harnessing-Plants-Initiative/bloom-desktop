/**
 * Path Sanitization Utilities
 *
 * Provides functions to sanitize user input before using it in file paths
 * to prevent path traversal attacks and ensure valid filesystem names.
 */

/**
 * Sanitizes a string to be safe for use as a path component.
 *
 * Security considerations:
 * - Removes path traversal sequences (../, ..\, etc.)
 * - Removes directory separators (/, \)
 * - Removes null bytes and other dangerous characters
 * - Enforces maximum length
 * - Only allows alphanumeric, dash, underscore, and period
 *
 * @param input - The user input string to sanitize
 * @param maxLength - Maximum allowed length (default: 100)
 * @returns Sanitized string safe for use in file paths
 *
 * @example
 * sanitizePathComponent("../../etc/passwd") // returns "etcpasswd"
 * sanitizePathComponent("Plant-123_v2.0") // returns "Plant-123_v2.0"
 * sanitizePathComponent("invalid/path") // returns "invalidpath"
 */
export function sanitizePathComponent(
  input: string,
  maxLength: number = 100
): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // 1. Trim whitespace
  let sanitized = input.trim();

  // 2. Remove null bytes (security)
  sanitized = sanitized.replace(/\0/g, '');

  // 3. Remove path traversal sequences
  sanitized = sanitized.replace(/\.\./g, '');

  // 4. Remove directory separators
  sanitized = sanitized.replace(/[/\\]/g, '');

  // 5. Only allow alphanumeric, dash, underscore, and period
  // This whitelist approach is more secure than blacklisting
  sanitized = sanitized.replace(/[^a-zA-Z0-9\-_.]/g, '_');

  // 6. Remove leading/trailing periods and dashes (may cause issues on some filesystems)
  sanitized = sanitized.replace(/^[.-]+|[.-]+$/g, '');

  // 7. Collapse multiple underscores
  sanitized = sanitized.replace(/_+/g, '_');

  // 8. Enforce maximum length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  // 9. If result is empty after sanitization, provide a default
  if (sanitized.length === 0) {
    sanitized = 'unknown';
  }

  return sanitized;
}

/**
 * Sanitizes multiple path components and joins them with a separator.
 *
 * @param components - Array of path components to sanitize
 * @param separator - Separator to use between components (default: '/')
 * @returns Sanitized path string
 *
 * @example
 * sanitizePath(['experiment', '../evil', 'plant-123']) // returns "experiment/evil/plant-123"
 */
export function sanitizePath(
  components: string[],
  separator: string = '/'
): string {
  return components
    .map((component) => sanitizePathComponent(component))
    .filter((component) => component.length > 0)
    .join(separator);
}
