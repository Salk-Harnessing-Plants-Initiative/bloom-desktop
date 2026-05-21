// @vitest-environment node
/**
 * Task 1 (#236, #228): env-var loading for new toggles
 *
 * - BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL (absent ⇒ undefined, feature disabled)
 * - LIBUSB_ENDPOINT_RECOVERY (default true, case-insensitive false to disable)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { loadEnvConfig } from '../../src/main/config-store';

describe('loadEnvConfig — new env vars', () => {
  let testDir: string;
  let envPath: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-env-test-'));
    envPath = path.join(testDir, '.env');
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL', () => {
    it('is undefined when .env file does not exist', () => {
      const config = loadEnvConfig(envPath);
      expect(config.slack_webhook_url).toBeUndefined();
    });

    it('is undefined when .env exists but the variable is not set', () => {
      fs.writeFileSync(envPath, 'SCANNER_NAME=TestScanner\n');
      const config = loadEnvConfig(envPath);
      expect(config.slack_webhook_url).toBeUndefined();
    });

    it('is set to the configured URL when present', () => {
      fs.writeFileSync(
        envPath,
        'BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T/B/X\n',
      );
      const config = loadEnvConfig(envPath);
      expect(config.slack_webhook_url).toBe(
        'https://hooks.slack.com/services/T/B/X',
      );
    });

    it('is undefined when the variable is present but empty', () => {
      fs.writeFileSync(envPath, 'BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL=\n');
      const config = loadEnvConfig(envPath);
      expect(config.slack_webhook_url).toBeUndefined();
    });
  });

  describe('LIBUSB_ENDPOINT_RECOVERY', () => {
    it('defaults to true when .env file does not exist', () => {
      const config = loadEnvConfig(envPath);
      expect(config.libusb_endpoint_recovery).toBe(true);
    });

    it('defaults to true when .env exists but the variable is not set', () => {
      fs.writeFileSync(envPath, 'SCANNER_NAME=TestScanner\n');
      const config = loadEnvConfig(envPath);
      expect(config.libusb_endpoint_recovery).toBe(true);
    });

    it('is false when set to "false"', () => {
      fs.writeFileSync(envPath, 'LIBUSB_ENDPOINT_RECOVERY=false\n');
      const config = loadEnvConfig(envPath);
      expect(config.libusb_endpoint_recovery).toBe(false);
    });

    it('is false when set to "False" (case-insensitive)', () => {
      fs.writeFileSync(envPath, 'LIBUSB_ENDPOINT_RECOVERY=False\n');
      const config = loadEnvConfig(envPath);
      expect(config.libusb_endpoint_recovery).toBe(false);
    });

    it('is false when set to "FALSE" (case-insensitive)', () => {
      fs.writeFileSync(envPath, 'LIBUSB_ENDPOINT_RECOVERY=FALSE\n');
      const config = loadEnvConfig(envPath);
      expect(config.libusb_endpoint_recovery).toBe(false);
    });

    it('is true when set to "true"', () => {
      fs.writeFileSync(envPath, 'LIBUSB_ENDPOINT_RECOVERY=true\n');
      const config = loadEnvConfig(envPath);
      expect(config.libusb_endpoint_recovery).toBe(true);
    });

    it('is true when set to "True" (case-insensitive truthy)', () => {
      fs.writeFileSync(envPath, 'LIBUSB_ENDPOINT_RECOVERY=True\n');
      const config = loadEnvConfig(envPath);
      expect(config.libusb_endpoint_recovery).toBe(true);
    });

    it('is true when set to an arbitrary non-"false" string (default-on)', () => {
      fs.writeFileSync(envPath, 'LIBUSB_ENDPOINT_RECOVERY=banana\n');
      const config = loadEnvConfig(envPath);
      expect(config.libusb_endpoint_recovery).toBe(true);
    });
  });

  describe('saveEnvConfig round-trip', () => {
    it('persists slack_webhook_url across load → save → load', async () => {
      fs.writeFileSync(
        envPath,
        'BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/X/Y/Z\n',
      );
      const { saveEnvConfig } = await import('../../src/main/config-store');
      const c1 = loadEnvConfig(envPath);
      saveEnvConfig(c1, envPath);
      const c2 = loadEnvConfig(envPath);
      expect(c2.slack_webhook_url).toBe(
        'https://hooks.slack.com/services/X/Y/Z',
      );
    });

    it('persists libusb_endpoint_recovery=false across save', async () => {
      fs.writeFileSync(envPath, 'LIBUSB_ENDPOINT_RECOVERY=false\n');
      const { saveEnvConfig } = await import('../../src/main/config-store');
      const c1 = loadEnvConfig(envPath);
      saveEnvConfig(c1, envPath);
      const c2 = loadEnvConfig(envPath);
      expect(c2.libusb_endpoint_recovery).toBe(false);
    });

    it('omits both vars from the saved file when undefined', async () => {
      const { saveEnvConfig, getDefaultConfig } = await import(
        '../../src/main/config-store'
      );
      const cfg = {
        ...getDefaultConfig(),
        slack_webhook_url: undefined,
        libusb_endpoint_recovery: undefined,
      };
      saveEnvConfig(cfg, envPath);
      const written = fs.readFileSync(envPath, 'utf-8');
      expect(written).not.toMatch(/BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL/);
      expect(written).not.toMatch(/LIBUSB_ENDPOINT_RECOVERY/);
    });
  });

  describe('both vars together', () => {
    it('reads both vars from the same .env file', () => {
      fs.writeFileSync(
        envPath,
        [
          'BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/A/B/C',
          'LIBUSB_ENDPOINT_RECOVERY=false',
          '',
        ].join('\n'),
      );
      const config = loadEnvConfig(envPath);
      expect(config.slack_webhook_url).toBe(
        'https://hooks.slack.com/services/A/B/C',
      );
      expect(config.libusb_endpoint_recovery).toBe(false);
    });

    it('does not interfere with existing config fields', () => {
      fs.writeFileSync(
        envPath,
        [
          'SCANNER_NAME=Sc1',
          'BLOOM_API_URL=https://api.example.com',
          'BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/X/Y/Z',
          'LIBUSB_ENDPOINT_RECOVERY=true',
          '',
        ].join('\n'),
      );
      const config = loadEnvConfig(envPath);
      expect(config.scanner_name).toBe('Sc1');
      expect(config.bloom_api_url).toBe('https://api.example.com');
      expect(config.slack_webhook_url).toBe(
        'https://hooks.slack.com/services/X/Y/Z',
      );
      expect(config.libusb_endpoint_recovery).toBe(true);
    });
  });
});
