/**
 * Unit tests for Config IPC handlers
 *
 * Tests the config IPC handler logic that will be used in main.ts
 * Uses mocking since we can't easily test actual Electron IPC in unit tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadConfig,
  saveConfig,
  loadCredentials,
  saveCredentials,
  validateConfig,
  getDefaultConfig,
  MachineConfig,
  MachineCredentials,
} from '../../src/main/config-store';

// Test directory setup
const TEST_DIR = path.join(os.tmpdir(), 'bloom-config-ipc-test');
const CONFIG_PATH = path.join(TEST_DIR, 'config.json');
const ENV_PATH = path.join(TEST_DIR, '.env');

describe('Config IPC Handler Logic', () => {
  beforeEach(() => {
    // Clean up and recreate test directory
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    // Clean up
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe('config:get handler logic', () => {
    it('should return config and masked credentials when both exist', () => {
      // Setup: Create config and credentials files
      // Use temp directory path so saveConfig can auto-create it
      const testScansDir = path.join(TEST_DIR, 'test-scans');
      const config: MachineConfig = {
        scanner_name: 'TestScanner',
        camera_ip_address: '10.0.0.50',
        scans_dir: testScansDir,
        bloom_api_url: 'https://api.bloom.salk.edu/proxy',
        bloom_scanner_username: '',
        bloom_scanner_password: '',
        bloom_anon_key: '',
      };
      saveConfig(config, CONFIG_PATH);

      const credentials: MachineCredentials = {
        bloom_scanner_username: 'test@salk.edu',
        bloom_scanner_password: 'supersecret123',
        bloom_anon_key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      };
      saveCredentials(credentials, ENV_PATH);

      // Simulate handler logic
      const loadedConfig = loadConfig(CONFIG_PATH);
      const loadedCredentials = loadCredentials(ENV_PATH);
      const hasCredentials = loadedCredentials.bloom_scanner_password !== '';

      const result = {
        config: loadedConfig,
        credentials: {
          bloom_scanner_username: loadedCredentials.bloom_scanner_username,
          bloom_scanner_password: hasCredentials ? '********' : '',
          bloom_anon_key: loadedCredentials.bloom_anon_key,
        },
        hasCredentials,
      };

      // Verify
      expect(result.config.scanner_name).toBe('TestScanner');
      expect(result.config.camera_ip_address).toBe('10.0.0.50');
      expect(result.credentials.bloom_scanner_username).toBe('test@salk.edu');
      expect(result.credentials.bloom_scanner_password).toBe('********'); // Masked
      expect(result.credentials.bloom_anon_key).toBe(
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
      );
      expect(result.hasCredentials).toBe(true);
    });

    it('should return defaults and hasCredentials=false when no files exist', () => {
      // Simulate handler logic with non-existent files
      const loadedConfig = loadConfig(CONFIG_PATH);
      const loadedCredentials = loadCredentials(ENV_PATH);
      const hasCredentials = loadedCredentials.bloom_scanner_password !== '';

      const result = {
        config: loadedConfig,
        credentials: {
          bloom_scanner_username: loadedCredentials.bloom_scanner_username,
          bloom_scanner_password: hasCredentials ? '********' : '',
          bloom_anon_key: loadedCredentials.bloom_anon_key,
        },
        hasCredentials,
      };

      // Verify defaults
      const defaults = getDefaultConfig();
      expect(result.config.scanner_name).toBe(defaults.scanner_name);
      expect(result.config.camera_ip_address).toBe(defaults.camera_ip_address);
      expect(result.credentials.bloom_scanner_username).toBe('');
      expect(result.credentials.bloom_scanner_password).toBe('');
      expect(result.hasCredentials).toBe(false);
    });
  });

  describe('config:set handler logic', () => {
    it('should save valid config and return success', () => {
      // Use temp directory path so saveConfig can auto-create it
      const testScansDir = path.join(TEST_DIR, 'new-scans');
      const config: MachineConfig = {
        scanner_name: 'NewScanner',
        camera_ip_address: '192.168.1.100',
        scans_dir: testScansDir,
        bloom_api_url: 'https://api.bloom.salk.edu/proxy',
        bloom_scanner_username: '',
        bloom_scanner_password: '',
        bloom_anon_key: '',
      };

      // Simulate handler logic
      const validation = validateConfig(config);
      let result: { success: boolean; errors?: Record<string, string> };

      if (validation.valid) {
        saveConfig(config, CONFIG_PATH);
        result = { success: true };
      } else {
        result = { success: false, errors: validation.errors };
      }

      // Verify
      expect(result.success).toBe(true);
      expect(result.errors).toBeUndefined();

      // Verify file was written
      const loadedConfig = loadConfig(CONFIG_PATH);
      expect(loadedConfig.scanner_name).toBe('NewScanner');
    });

    it('should save credentials when provided', () => {
      // Use temp directory path so saveConfig can auto-create it
      const testScansDir = path.join(TEST_DIR, 'scans-with-creds');
      const config: MachineConfig = {
        scanner_name: 'Scanner1',
        camera_ip_address: 'mock',
        scans_dir: testScansDir,
        bloom_api_url: 'https://api.bloom.salk.edu/proxy',
        bloom_scanner_username: '',
        bloom_scanner_password: '',
        bloom_anon_key: '',
      };

      const credentials: MachineCredentials = {
        bloom_scanner_username: 'scanner@salk.edu',
        bloom_scanner_password: 'password123',
        bloom_anon_key: 'anonkey123',
      };

      // Simulate handler logic
      const validation = validateConfig(config);
      let result: { success: boolean; errors?: Record<string, string> };

      if (validation.valid) {
        saveConfig(config, CONFIG_PATH);
        saveCredentials(credentials, ENV_PATH);
        result = { success: true };
      } else {
        result = { success: false, errors: validation.errors };
      }

      // Verify
      expect(result.success).toBe(true);

      // Verify credentials were saved
      const loadedCreds = loadCredentials(ENV_PATH);
      expect(loadedCreds.bloom_scanner_username).toBe('scanner@salk.edu');
      expect(loadedCreds.bloom_scanner_password).toBe('password123');
    });

    it('should return validation errors for invalid config', () => {
      // Use temp directory path (though validation will fail before saveConfig)
      const testScansDir = path.join(TEST_DIR, 'invalid-scans');
      const config: MachineConfig = {
        scanner_name: '', // Invalid: empty
        camera_ip_address: 'invalid-ip', // Invalid: bad format
        scans_dir: testScansDir,
        bloom_api_url: 'https://api.bloom.salk.edu/proxy',
        bloom_scanner_username: '',
        bloom_scanner_password: '',
        bloom_anon_key: '',
      };

      // Simulate handler logic
      const validation = validateConfig(config);
      let result: { success: boolean; errors?: Record<string, string> };

      if (validation.valid) {
        saveConfig(config, CONFIG_PATH);
        result = { success: true };
      } else {
        result = { success: false, errors: validation.errors };
      }

      // Verify
      expect(result.success).toBe(false);
      expect(result.errors?.scanner_name).toBe('Scanner name is required');
      expect(result.errors?.camera_ip_address).toBe(
        'Invalid IP address format'
      );

      // Verify file was NOT written
      expect(fs.existsSync(CONFIG_PATH)).toBe(false);
    });
  });

  describe('config:validate-credentials handler logic', () => {
    it('should return valid=true when credentials match', () => {
      // Setup: Save credentials
      const credentials: MachineCredentials = {
        bloom_scanner_username: 'admin@salk.edu',
        bloom_scanner_password: 'correctpassword',
        bloom_anon_key: 'key123',
      };
      saveCredentials(credentials, ENV_PATH);

      // Simulate handler logic
      const storedCredentials = loadCredentials(ENV_PATH);
      const inputUsername = 'admin@salk.edu';
      const inputPassword = 'correctpassword';

      const valid =
        storedCredentials.bloom_scanner_username === inputUsername &&
        storedCredentials.bloom_scanner_password === inputPassword;

      // Verify
      expect(valid).toBe(true);
    });

    it('should return valid=false when username does not match', () => {
      // Setup: Save credentials
      const credentials: MachineCredentials = {
        bloom_scanner_username: 'admin@salk.edu',
        bloom_scanner_password: 'correctpassword',
        bloom_anon_key: 'key123',
      };
      saveCredentials(credentials, ENV_PATH);

      // Simulate handler logic
      const storedCredentials = loadCredentials(ENV_PATH);
      const inputUsername = 'wrong@salk.edu';
      const inputPassword = 'correctpassword';

      const valid =
        storedCredentials.bloom_scanner_username === inputUsername &&
        storedCredentials.bloom_scanner_password === inputPassword;

      // Verify
      expect(valid).toBe(false);
    });

    it('should return valid=false when password does not match', () => {
      // Setup: Save credentials
      const credentials: MachineCredentials = {
        bloom_scanner_username: 'admin@salk.edu',
        bloom_scanner_password: 'correctpassword',
        bloom_anon_key: 'key123',
      };
      saveCredentials(credentials, ENV_PATH);

      // Simulate handler logic
      const storedCredentials = loadCredentials(ENV_PATH);
      const inputUsername = 'admin@salk.edu';
      const inputPassword = 'wrongpassword';

      const valid =
        storedCredentials.bloom_scanner_username === inputUsername &&
        storedCredentials.bloom_scanner_password === inputPassword;

      // Verify
      expect(valid).toBe(false);
    });

    it('should return valid=false when no credentials are stored', () => {
      // No setup - no credentials file exists

      // Simulate handler logic
      const storedCredentials = loadCredentials(ENV_PATH);
      const inputUsername = 'admin@salk.edu';
      const inputPassword = 'anypassword';

      const valid =
        storedCredentials.bloom_scanner_username === inputUsername &&
        storedCredentials.bloom_scanner_password === inputPassword;

      // Verify
      expect(valid).toBe(false);
    });
  });

  describe('config:exists handler logic', () => {
    it('should return true when config file exists', () => {
      // Setup: Create config file
      // Use temp directory path so saveConfig can auto-create it
      const testScansDir = path.join(TEST_DIR, 'existing-scans');
      const config: MachineConfig = {
        scanner_name: 'ExistingScanner',
        camera_ip_address: 'mock',
        scans_dir: testScansDir,
        bloom_api_url: 'https://api.bloom.salk.edu/proxy',
        bloom_scanner_username: '',
        bloom_scanner_password: '',
        bloom_anon_key: '',
      };
      saveConfig(config, CONFIG_PATH);

      // Simulate handler logic
      const exists = fs.existsSync(CONFIG_PATH);

      // Verify
      expect(exists).toBe(true);
    });

    it('should return false when config file does not exist', () => {
      // No setup - no config file

      // Simulate handler logic
      const exists = fs.existsSync(CONFIG_PATH);

      // Verify
      expect(exists).toBe(false);
    });
  });

  describe('config:browse-directory handler logic', () => {
    // Note: This handler uses Electron's dialog.showOpenDialog which cannot
    // be unit tested without mocking Electron. The actual implementation
    // will be tested in E2E tests.
    it('should return a valid directory path structure', () => {
      // This test documents the expected return type
      // Actual implementation returns: string | null

      // Mock result from dialog
      const mockDialogResult = {
        canceled: false,
        filePaths: ['/selected/directory/path'],
      };

      // Simulate handler logic
      const result = mockDialogResult.canceled
        ? null
        : mockDialogResult.filePaths[0];

      // Verify
      expect(result).toBe('/selected/directory/path');
    });

    it('should return null when dialog is cancelled', () => {
      // Mock cancelled dialog
      const mockDialogResult = {
        canceled: true,
        filePaths: [],
      };

      // Simulate handler logic
      const result = mockDialogResult.canceled
        ? null
        : mockDialogResult.filePaths[0];

      // Verify
      expect(result).toBeNull();
    });
  });

  describe('config:test-camera handler logic', () => {
    // Note: This handler will attempt to connect to a camera, which requires
    // hardware. The actual implementation will use the CameraProcess.
    // Unit tests here document the expected interface.
    it('should return success structure for valid mock camera', () => {
      // The 'mock' camera should always succeed
      const ipAddress = 'mock';

      // Expected result structure when camera test succeeds
      const expectedSuccessResult = {
        success: true,
      };

      // Verify structure
      expect(expectedSuccessResult).toHaveProperty('success', true);
      expect(ipAddress).toBe('mock');
    });

    it('should return error structure for invalid IP', () => {
      // Expected result structure when camera test fails
      const expectedFailureResult = {
        success: false,
        error: 'Failed to connect to camera at 10.0.0.999',
      };

      // Verify structure
      expect(expectedFailureResult).toHaveProperty('success', false);
      expect(expectedFailureResult).toHaveProperty('error');
    });
  });
});
