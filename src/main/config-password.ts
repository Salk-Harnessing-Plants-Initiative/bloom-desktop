/**
 * Bloom scanner password masking (Machine Configuration)
 *
 * `config:get` never sends the stored password to the renderer; it sends
 * MASKED_PASSWORD instead. The form shows that value and sends it straight
 * back on Save and Fetch scanners, so the main process must treat the mask
 * (or a blank field, "Leave blank to keep existing") as "keep the stored
 * password" rather than writing it to ~/.bloom/.env or sending it to the
 * Bloom API (#391).
 *
 * Pure and Electron-free so it can be unit-tested without main.ts.
 */

/** Placeholder `config:get` returns in place of a stored password. */
export const MASKED_PASSWORD = '********';

/** Minimal shape of the machine config this module reads. */
export interface StoredPasswordConfigLike {
  bloom_scanner_password?: string;
}

/** Anything carrying a submitted Bloom password (form config, credentials). */
export interface SubmittedPasswordLike {
  bloom_scanner_password: string;
}

/**
 * Value `config:get` returns for the password field: the mask when a
 * password is stored, otherwise empty so the form shows the placeholder.
 */
export function maskPassword(stored: string | undefined): string {
  return stored ? MASKED_PASSWORD : '';
}

/**
 * Whether a submitted password means "keep the stored one": the unchanged
 * mask, or a blank field. Whitespace-only counts as blank because .env
 * values are trimmed on load, so it could never be stored as typed.
 */
export function keepsStoredPassword(
  submitted: string | null | undefined
): boolean {
  return (
    submitted === undefined ||
    submitted === null ||
    submitted === MASKED_PASSWORD ||
    submitted.trim() === ''
  );
}

/**
 * Resolve the password to save or send.
 *
 * A real new password is returned as-is without reading the stored config.
 * Otherwise the stored password is returned, or `''` when none is stored
 * yet (first run), so the mask itself is never saved or sent.
 *
 * Errors from `loadStored` propagate: callers fail the save/fetch rather
 * than overwriting the stored password with a guess.
 */
export function resolveBloomPassword(
  submitted: string | null | undefined,
  loadStored: () => StoredPasswordConfigLike
): string {
  if (typeof submitted === 'string' && !keepsStoredPassword(submitted)) {
    return submitted;
  }
  return loadStored().bloom_scanner_password ?? '';
}

/** Return a copy of `values` with its password resolved. */
export function withResolvedPassword<T extends SubmittedPasswordLike>(
  values: T,
  loadStored: () => StoredPasswordConfigLike
): T {
  return {
    ...values,
    bloom_scanner_password: resolveBloomPassword(
      values.bloom_scanner_password,
      loadStored
    ),
  };
}
