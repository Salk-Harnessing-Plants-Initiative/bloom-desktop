/**
 * Bloom scanner password handling for Machine Configuration
 *
 * The stored password never leaves the main process: `config:get` sends an
 * empty password plus `hasCredentials`, and the form shows the field blank
 * with a "Leave blank to keep existing" placeholder. A blank password coming
 * back from Save or Fetch scanners therefore means "keep the stored one"
 * (#391); only a newly typed password replaces it.
 *
 * Pure and Electron-free so the config:get / config:set / config:fetch-scanners
 * handler logic can be unit-tested without main.ts.
 */

import type { MachineConfig, ValidationResult } from './config-store';

/** Minimal shape of the stored config this module reads. */
export interface StoredPasswordConfigLike {
  bloom_scanner_password?: string;
}

/** Anything carrying a submitted Bloom password (form config, credentials). */
export interface SubmittedPasswordLike {
  bloom_scanner_password: string;
}

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

/**
 * Resolve the password to save or send.
 *
 * A newly typed password is returned as-is without reading the stored
 * config. Otherwise the stored password is returned, or `''` when none is
 * stored yet (first run).
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
    hasCredentials: stored.bloom_scanner_password !== '',
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

  const saved = withResolvedPassword(submitted, store.load);
  store.save(saved);
  return { success: true, saved };
}
