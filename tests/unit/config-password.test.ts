/**
 * Unit tests for config-password module (#391)
 *
 * config:get never sends the stored Bloom password to the renderer, so the
 * form's password field is blank. Saving Machine Configuration or fetching
 * scanners with that blank field must keep using the stored password, and
 * only a newly typed password may replace it.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  getDefaultConfig,
  loadEnvConfig,
  saveEnvConfig,
  validateConfig,
} from '../../src/main/config-store';
import type { MachineConfig } from '../../src/main/config-store';
import {
  keepsStoredPassword,
  resolveBloomPassword,
  saveSubmittedConfig,
  toRendererConfig,
  withResolvedPassword,
} from '../../src/main/config-password';
import type { ConfigStoreLike } from '../../src/main/config-password';

const STORED_PASSWORD = 'stored-S3cret!';
const NEW_PASSWORD = 'new-S3cret!';

function storedConfig(password: string = STORED_PASSWORD) {
  return () => ({ bloom_scanner_password: password });
}

function failingLoad(): never {
  throw new Error('EACCES: permission denied');
}

describe('keepsStoredPassword', () => {
  it('is true for a blank field', () => {
    expect(keepsStoredPassword('')).toBe(true);
  });

  it('is true for a whitespace-only field', () => {
    expect(keepsStoredPassword('   ')).toBe(true);
  });

  it('is true for a missing value', () => {
    expect(keepsStoredPassword(undefined)).toBe(true);
    expect(keepsStoredPassword(null)).toBe(true);
  });

  it('is false for a typed password', () => {
    expect(keepsStoredPassword(NEW_PASSWORD)).toBe(false);
  });

  it('is false for a typed password made of asterisks', () => {
    expect(keepsStoredPassword('********')).toBe(false);
  });
});

describe('resolveBloomPassword', () => {
  it('returns the stored password for a blank field', () => {
    expect(resolveBloomPassword('', storedConfig())).toBe(STORED_PASSWORD);
  });

  it('returns a typed password unchanged', () => {
    expect(resolveBloomPassword(NEW_PASSWORD, storedConfig())).toBe(
      NEW_PASSWORD
    );
  });

  it('does not read the stored config for a typed password', () => {
    const load = vi.fn(storedConfig());
    resolveBloomPassword(NEW_PASSWORD, load);
    expect(load).not.toHaveBeenCalled();
  });

  it('returns empty when no password is stored yet', () => {
    expect(resolveBloomPassword('', storedConfig(''))).toBe('');
  });

  it('returns empty when the stored config has no password field', () => {
    expect(resolveBloomPassword('', () => ({}))).toBe('');
  });

  it('propagates a stored-config read error instead of guessing', () => {
    expect(() => resolveBloomPassword('', failingLoad)).toThrow('EACCES');
  });
});

describe('withResolvedPassword', () => {
  const credentials = {
    bloom_scanner_username: 'scanner@salk.edu',
    bloom_scanner_password: '',
    bloom_anon_key: 'anon-key',
  };

  it('fills a blank password from the stored config', () => {
    expect(withResolvedPassword(credentials, storedConfig())).toEqual({
      ...credentials,
      bloom_scanner_password: STORED_PASSWORD,
    });
  });

  it('keeps a typed password (Fetch scanners before saving)', () => {
    const typed = { ...credentials, bloom_scanner_password: NEW_PASSWORD };
    expect(withResolvedPassword(typed, failingLoad)).toEqual(typed);
  });

  it('does not mutate the submitted object', () => {
    withResolvedPassword(credentials, storedConfig());
    expect(credentials.bloom_scanner_password).toBe('');
  });

  it('propagates a stored-config read error', () => {
    expect(() => withResolvedPassword(credentials, failingLoad)).toThrow(
      'EACCES'
    );
  });
});

describe('toRendererConfig (config:get)', () => {
  const stored: MachineConfig = {
    ...getDefaultConfig(),
    scanner_mode: 'cylinderscan',
    scanner_name: 'FastScanner',
    camera_ip_address: '10.0.0.45',
    bloom_scanner_username: 'scanner@salk.edu',
    bloom_scanner_password: STORED_PASSWORD,
    bloom_anon_key: 'anon-key',
    slack_webhook_url: 'https://hooks.slack.example/secret',
  };

  it('never sends the stored password', () => {
    const response = toRendererConfig(stored);
    expect(response.config.bloom_scanner_password).toBe('');
    expect(JSON.stringify(response)).not.toContain(STORED_PASSWORD);
  });

  it('reports a saved password through hasCredentials', () => {
    expect(toRendererConfig(stored).hasCredentials).toBe(true);
  });

  it('reports no saved password on first run', () => {
    const fresh = { ...stored, bloom_scanner_password: '' };
    expect(toRendererConfig(fresh).hasCredentials).toBe(false);
  });

  it('does not send env-only settings such as the Slack webhook', () => {
    const response = toRendererConfig(stored);
    expect(response.config).not.toHaveProperty('slack_webhook_url');
    expect(JSON.stringify(response)).not.toContain('hooks.slack.example');
  });

  it('sends the form fields unchanged', () => {
    const { config } = toRendererConfig(stored);
    expect(config.scanner_name).toBe('FastScanner');
    expect(config.camera_ip_address).toBe('10.0.0.45');
    expect(config.bloom_scanner_username).toBe('scanner@salk.edu');
    expect(config.bloom_anon_key).toBe('anon-key');
  });
});

describe('config:get / config:set against a real .env', () => {
  let tempDir: string;
  let envPath: string;
  let store: ConfigStoreLike;

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

  /** What the form sends back after loading: config:get's response. */
  function formFromStored(): MachineConfig {
    return toRendererConfig(loadEnvConfig(envPath)).config;
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-config-password-'));
    envPath = path.join(tempDir, '.env');
    store = {
      load: () => loadEnvConfig(envPath),
      save: (config) => saveEnvConfig(config, envPath),
      validate: validateConfig,
    };
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('saving the form unchanged keeps the stored password', () => {
    store.save(formConfig(STORED_PASSWORD));

    const result = saveSubmittedConfig(formFromStored(), store);

    expect(result.success).toBe(true);
    expect(loadEnvConfig(envPath).bloom_scanner_password).toBe(STORED_PASSWORD);
  });

  it('changing only the camera IP keeps the stored password', () => {
    store.save(formConfig(STORED_PASSWORD));

    saveSubmittedConfig(
      { ...formFromStored(), camera_ip_address: '10.0.0.99' },
      store
    );

    const saved = loadEnvConfig(envPath);
    expect(saved.camera_ip_address).toBe('10.0.0.99');
    expect(saved.bloom_scanner_password).toBe(STORED_PASSWORD);
  });

  it('repeated saves keep the stored password', () => {
    store.save(formConfig(STORED_PASSWORD));

    saveSubmittedConfig(formFromStored(), store);
    saveSubmittedConfig(formFromStored(), store);

    expect(loadEnvConfig(envPath).bloom_scanner_password).toBe(STORED_PASSWORD);
  });

  it('a typed password replaces the stored one', () => {
    store.save(formConfig(STORED_PASSWORD));

    saveSubmittedConfig(
      { ...formFromStored(), bloom_scanner_password: NEW_PASSWORD },
      store
    );

    expect(loadEnvConfig(envPath).bloom_scanner_password).toBe(NEW_PASSWORD);
  });

  it('first run with a blank password saves an empty password', () => {
    saveSubmittedConfig(formConfig(''), store);

    expect(loadEnvConfig(envPath).bloom_scanner_password).toBe('');
  });

  it('returns the saved config so the caller can sync scanner identity', () => {
    store.save(formConfig(STORED_PASSWORD));

    const result = saveSubmittedConfig(formFromStored(), store);

    expect(result.saved?.scanner_name).toBe('TestScanner');
    expect(result.saved?.bloom_scanner_password).toBe(STORED_PASSWORD);
  });

  it('does not save, or read the stored config, when validation fails', () => {
    store.save(formConfig(STORED_PASSWORD));
    const load = vi.spyOn(store, 'load');
    const save = vi.spyOn(store, 'save');

    const result = saveSubmittedConfig(
      { ...formFromStored(), scanner_name: '' },
      store
    );

    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(load).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('does not save when the stored config cannot be read', () => {
    const save = vi.spyOn(store, 'save');
    const broken = { ...store, load: failingLoad };

    expect(() => saveSubmittedConfig(formConfig(''), broken)).toThrow('EACCES');
    expect(save).not.toHaveBeenCalled();
  });
});
