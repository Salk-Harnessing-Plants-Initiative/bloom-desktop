/**
 * Unit tests for config-password module (#391)
 *
 * Saving Machine Configuration or fetching scanners with the masked password
 * that config:get returned (or with a blank field) must use the stored Bloom
 * password, never write or send the mask.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  getDefaultConfig,
  loadEnvConfig,
  saveEnvConfig,
} from '../../src/main/config-store';
import type { MachineConfig } from '../../src/main/config-store';
import {
  MASKED_PASSWORD,
  maskPassword,
  keepsStoredPassword,
  resolveBloomPassword,
  withResolvedPassword,
} from '../../src/main/config-password';

const STORED_PASSWORD = 'stored-S3cret!';
const NEW_PASSWORD = 'new-S3cret!';

function storedConfig(password: string = STORED_PASSWORD) {
  return () => ({ bloom_scanner_password: password });
}

function failingLoad(): never {
  throw new Error('EACCES: permission denied');
}

describe('MASKED_PASSWORD', () => {
  it('is non-empty so a masked field is distinguishable from a blank one', () => {
    expect(MASKED_PASSWORD).not.toBe('');
    expect(MASKED_PASSWORD.trim()).toBe(MASKED_PASSWORD);
  });
});

describe('maskPassword', () => {
  it('returns the mask when a password is stored', () => {
    expect(maskPassword(STORED_PASSWORD)).toBe(MASKED_PASSWORD);
  });

  it('returns empty when no password is stored', () => {
    expect(maskPassword('')).toBe('');
  });

  it('returns empty when the password is undefined', () => {
    expect(maskPassword(undefined)).toBe('');
  });

  it('never returns the stored password', () => {
    expect(maskPassword(STORED_PASSWORD)).not.toContain(STORED_PASSWORD);
  });
});

describe('keepsStoredPassword', () => {
  it('is true for the mask', () => {
    expect(keepsStoredPassword(MASKED_PASSWORD)).toBe(true);
  });

  it('is true for a blank field', () => {
    expect(keepsStoredPassword('')).toBe(true);
  });

  it('is true for a whitespace-only field', () => {
    expect(keepsStoredPassword('   \t')).toBe(true);
  });

  it('is true for undefined and null', () => {
    expect(keepsStoredPassword(undefined)).toBe(true);
    expect(keepsStoredPassword(null)).toBe(true);
  });

  it('is false for a real password', () => {
    expect(keepsStoredPassword(NEW_PASSWORD)).toBe(false);
  });

  it('is false for a password that only contains the mask', () => {
    expect(keepsStoredPassword(`${MASKED_PASSWORD}x`)).toBe(false);
    expect(keepsStoredPassword('*******')).toBe(false);
  });
});

describe('resolveBloomPassword', () => {
  it('returns the stored password for the mask', () => {
    expect(resolveBloomPassword(MASKED_PASSWORD, storedConfig())).toBe(
      STORED_PASSWORD
    );
  });

  it('returns the stored password for a blank field', () => {
    expect(resolveBloomPassword('', storedConfig())).toBe(STORED_PASSWORD);
  });

  it('returns a real new password unchanged', () => {
    expect(resolveBloomPassword(NEW_PASSWORD, storedConfig())).toBe(
      NEW_PASSWORD
    );
  });

  it('does not read the stored config for a real new password', () => {
    const load = vi.fn(storedConfig());
    resolveBloomPassword(NEW_PASSWORD, load);
    expect(load).not.toHaveBeenCalled();
  });

  it('returns empty, not the mask, when no password is stored yet', () => {
    expect(resolveBloomPassword(MASKED_PASSWORD, storedConfig(''))).toBe('');
    expect(resolveBloomPassword('', storedConfig(''))).toBe('');
  });

  it('returns empty when the stored config has no password field', () => {
    expect(resolveBloomPassword(MASKED_PASSWORD, () => ({}))).toBe('');
  });

  it('propagates a stored-config read error instead of guessing', () => {
    expect(() => resolveBloomPassword(MASKED_PASSWORD, failingLoad)).toThrow(
      'EACCES'
    );
  });
});

describe('withResolvedPassword', () => {
  const credentials = {
    bloom_scanner_username: 'scanner@salk.edu',
    bloom_scanner_password: MASKED_PASSWORD,
    bloom_anon_key: 'anon-key',
  };

  it('replaces the mask with the stored password', () => {
    expect(withResolvedPassword(credentials, storedConfig())).toEqual({
      ...credentials,
      bloom_scanner_password: STORED_PASSWORD,
    });
  });

  it('keeps a real new password (Fetch scanners before saving)', () => {
    const typed = { ...credentials, bloom_scanner_password: NEW_PASSWORD };
    expect(withResolvedPassword(typed, storedConfig())).toEqual(typed);
  });

  it('does not mutate the submitted object', () => {
    const submitted = { ...credentials };
    withResolvedPassword(submitted, storedConfig());
    expect(submitted.bloom_scanner_password).toBe(MASKED_PASSWORD);
  });

  it('propagates a stored-config read error', () => {
    expect(() => withResolvedPassword(credentials, failingLoad)).toThrow(
      'EACCES'
    );
  });
});

describe('.env round-trip through saveEnvConfig/loadEnvConfig', () => {
  let tempDir: string;
  let envPath: string;

  function formConfig(password: string): MachineConfig {
    return {
      ...getDefaultConfig(),
      scanner_mode: 'cylinderscan',
      scanner_name: 'TestScanner',
      camera_ip_address: '10.0.0.23',
      scans_dir: path.join(tempDir, 'scans'),
      bloom_scanner_username: 'scanner@salk.edu',
      bloom_scanner_password: password,
      bloom_anon_key: 'anon-key',
    };
  }

  /** What config:set does: resolve against the stored config, then save. */
  function saveFromForm(config: MachineConfig): void {
    saveEnvConfig(
      withResolvedPassword(config, () => loadEnvConfig(envPath)),
      envPath
    );
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-config-password-'));
    envPath = path.join(tempDir, '.env');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('saving the masked value leaves the stored password unchanged', () => {
    saveEnvConfig(formConfig(STORED_PASSWORD), envPath);

    saveFromForm({
      ...formConfig(MASKED_PASSWORD),
      camera_ip_address: '10.0.0.99',
    });

    const loaded = loadEnvConfig(envPath);
    expect(loaded.bloom_scanner_password).toBe(STORED_PASSWORD);
    expect(loaded.camera_ip_address).toBe('10.0.0.99');
    expect(fs.readFileSync(envPath, 'utf-8')).not.toContain(MASKED_PASSWORD);
  });

  it('saving a blank password leaves the stored password unchanged', () => {
    saveEnvConfig(formConfig(STORED_PASSWORD), envPath);

    saveFromForm(formConfig(''));

    expect(loadEnvConfig(envPath).bloom_scanner_password).toBe(STORED_PASSWORD);
  });

  it('saving a new password replaces the stored one', () => {
    saveEnvConfig(formConfig(STORED_PASSWORD), envPath);

    saveFromForm(formConfig(NEW_PASSWORD));

    expect(loadEnvConfig(envPath).bloom_scanner_password).toBe(NEW_PASSWORD);
  });

  it('repeated masked saves keep the stored password', () => {
    saveEnvConfig(formConfig(STORED_PASSWORD), envPath);

    saveFromForm(formConfig(MASKED_PASSWORD));
    saveFromForm(formConfig(MASKED_PASSWORD));

    expect(loadEnvConfig(envPath).bloom_scanner_password).toBe(STORED_PASSWORD);
  });

  it('first run with no .env saves an empty password, not the mask', () => {
    saveFromForm(formConfig(MASKED_PASSWORD));

    expect(loadEnvConfig(envPath).bloom_scanner_password).toBe('');
    expect(fs.readFileSync(envPath, 'utf-8')).not.toContain(MASKED_PASSWORD);
  });

  it('config:get masking round-trips back to the stored password', () => {
    saveEnvConfig(formConfig(STORED_PASSWORD), envPath);
    const shown = maskPassword(loadEnvConfig(envPath).bloom_scanner_password);

    saveFromForm(formConfig(shown));

    expect(shown).toBe(MASKED_PASSWORD);
    expect(loadEnvConfig(envPath).bloom_scanner_password).toBe(STORED_PASSWORD);
  });
});
