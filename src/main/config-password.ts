/**
 * Bloom scanner password handling for Machine Configuration
 *
 * The stored password never leaves the main process: `config:get` sends an
 * empty password plus `hasCredentials`, and the form shows the field blank
 * with a "Leave blank to keep existing" placeholder. A blank password coming
 * back from Save or Fetch scanners therefore means "keep the stored one"
 * (#391), but only for the same Bloom server and username; only a newly
 * typed password replaces it.
 *
 * Pure and Electron-free so the config:get / config:set / config:fetch-scanners
 * handler logic can be unit-tested without main.ts.
 */

import type { MachineConfig, ValidationResult } from './config-store';

/**
 * The placeholder `config:get` used to send in place of the password. #391
 * saved it to .env as the real password on some stations, so a stored value
 * equal to it is treated as "no password saved" and the form asks for one.
 */
export const LEGACY_MASKED_PASSWORD = '********';

/** Error when the URL, username, password or anon key is missing. */
export const CREDENTIALS_REQUIRED_MESSAGE =
  'Bloom API URL and credentials are required';

/** Error when a blank password is submitted for a different server/account. */
export const PASSWORD_REQUIRED_MESSAGE =
  'Enter the password for this Bloom server and account';

/** Minimal shape of the stored config this module reads. */
export interface StoredCredentialsLike {
  bloom_api_url?: string;
  bloom_scanner_username?: string;
  bloom_scanner_password?: string;
}

/** Anything carrying submitted Bloom credentials (form config, fetch args). */
export interface SubmittedCredentialsLike {
  bloom_api_url: string;
  bloom_scanner_username: string;
  bloom_scanner_password: string;
}

/** Outcome of resolving a submitted password against the stored config. */
export type PasswordResolution =
  | { ok: true; password: string }
  | { ok: false; error: string };

/** What `config:get` returns to the renderer. */
export interface RendererConfigResponse {
  config: MachineConfig;
  hasCredentials: boolean;
}

/** Result of `config:set`. */
export interface SaveConfigResult {
  success: boolean;
  errors?: ValidationResult['errors'];
}

/** Injected config-store functions, bound to the .env path by the caller. */
export interface ConfigStoreLike {
  load: () => MachineConfig;
  save: (config: MachineConfig) => void;
  validate: (config: MachineConfig) => ValidationResult;
}

/**
 * Whether a submitted password means "keep the stored one": a blank field.
 * Whitespace-only counts as blank because .env values are trimmed on load,
 * so it could never be stored as typed.
 */
export function keepsStoredPassword(
  submitted: string | null | undefined
): boolean {
  return (
    submitted === undefined || submitted === null || submitted.trim() === ''
  );
}

/** The usable stored password: `''` when none is saved or it is the #391 placeholder. */
export function storedPassword(stored: StoredCredentialsLike): string {
  const password = stored.bloom_scanner_password ?? '';
  return password === LEGACY_MASKED_PASSWORD ? '' : password;
}

/** Whether the submitted Bloom server and username match the stored ones. */
export function isSameBloomAccount(
  submitted: SubmittedCredentialsLike,
  stored: StoredCredentialsLike
): boolean {
  return (
    submitted.bloom_api_url.trim() === (stored.bloom_api_url ?? '').trim() &&
    submitted.bloom_scanner_username.trim() ===
      (stored.bloom_scanner_username ?? '').trim()
  );
}

/**
 * Resolve the password to save or send.
 *
 * - A newly typed password is used as-is, without reading the stored config.
 * - A blank field takes the stored password, but only for the same Bloom
 *   server and username it was saved with. For a different server or
 *   account it is an error, so the stored password is never sent to, or
 *   saved for, an account it doesn't belong to.
 * - With no stored password (first run), a blank field resolves to `''`.
 *
 * Errors from `loadStored` propagate: callers fail the save/fetch rather
 * than overwriting the stored password with a guess.
 */
export function resolveBloomPassword(
  submitted: SubmittedCredentialsLike,
  loadStored: () => StoredCredentialsLike
): PasswordResolution {
  if (!keepsStoredPassword(submitted.bloom_scanner_password)) {
    return { ok: true, password: submitted.bloom_scanner_password };
  }

  const stored = loadStored();
  const password = storedPassword(stored);
  if (password === '') {
    return { ok: true, password: '' };
  }
  if (!isSameBloomAccount(submitted, stored)) {
    return { ok: false, error: PASSWORD_REQUIRED_MESSAGE };
  }
  return { ok: true, password };
}

/** Return a copy of `values` with its password resolved, or the error. */
export function withResolvedPassword<T extends SubmittedCredentialsLike>(
  values: T,
  loadStored: () => StoredCredentialsLike
): { ok: true; values: T } | { ok: false; error: string } {
  const resolution = resolveBloomPassword(values, loadStored);
  if ('error' in resolution) {
    return { ok: false, error: resolution.error };
  }
  return {
    ok: true,
    values: { ...values, bloom_scanner_password: resolution.password },
  };
}

/**
 * Build the `config:get` response: the form fields with the password
 * blanked, and `hasCredentials` telling the form a password is saved.
 * Fields are listed explicitly so env-only settings (e.g. the Slack
 * webhook URL) never reach the renderer.
 */
export function toRendererConfig(
  stored: MachineConfig
): RendererConfigResponse {
  return {
    config: {
      scanner_mode: stored.scanner_mode,
      scanner_name: stored.scanner_name,
      camera_ip_address: stored.camera_ip_address,
      scans_dir: stored.scans_dir,
      bloom_api_url: stored.bloom_api_url,
      bloom_scanner_username: stored.bloom_scanner_username,
      bloom_scanner_password: '',
      bloom_anon_key: stored.bloom_anon_key,
      num_frames: stored.num_frames,
      seconds_per_rot: stored.seconds_per_rot,
    },
    hasCredentials: storedPassword(stored) !== '',
  };
}

/**
 * `config:set`: validate the submitted form, resolve its password against
 * the stored config, and save. Returns the saved config on success so the
 * caller can sync derived state (scanner identity).
 */
export function saveSubmittedConfig(
  submitted: MachineConfig,
  store: ConfigStoreLike
): SaveConfigResult & { saved?: MachineConfig } {
  const validation = store.validate(submitted);
  if (!validation.valid) {
    return { success: false, errors: validation.errors };
  }

  const resolution = withResolvedPassword(submitted, store.load);
  if ('error' in resolution) {
    return {
      success: false,
      errors: { bloom_scanner_password: resolution.error },
    };
  }

  store.save(resolution.values);
  return { success: true, saved: resolution.values };
}
