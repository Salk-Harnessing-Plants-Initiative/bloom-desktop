/**
 * Unit tests for config-store module
 *
 * TDD: These tests are written first before implementation.
 * The tests define the expected behavior of the config store.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Import the module under test (will fail until implemented)
import {
  loadConfig,
  saveConfig,
  loadCredentials,
  saveCredentials,
  loadEnvConfig,
  saveEnvConfig,
  validateConfig,
  getDefaultConfig,
  fetchScannersFromBloom,
  MachineConfig,
  MachineCredentials,
} from '../../src/main/config-store';

describe('config-store', () => {
  let testDir: string;
  let configPath: string;
  let envPath: string;

  beforeEach(() => {
    // Create a temporary directory for each test
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-config-test-'));
    configPath = path.join(testDir, 'config.json');
    envPath = path.join(testDir, '.env');
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // ========================================
  // NEW UNIFIED CONFIG TESTS (Phase 0)
  // ========================================

  describe('loadEnvConfig (unified config)', () => {
    it('should load all fields from .env file', () => {
      const envContent = `SCANNER_NAME=PBIOBScanner
CAMERA_IP_ADDRESS=10.0.0.50
SCANS_DIR=/Users/scanner/.bloom/scans
BLOOM_API_URL=https://api.bloom.salk.edu/proxy
BLOOM_SCANNER_USERNAME=pbiob_scanner@salk.edu
BLOOM_SCANNER_PASSWORD=scanner_password_123
BLOOM_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9`;
      fs.writeFileSync(envPath, envContent);

      const config = loadEnvConfig(envPath);

      expect(config.scanner_name).toBe('PBIOBScanner');
      expect(config.camera_ip_address).toBe('10.0.0.50');
      expect(config.scans_dir).toBe('/Users/scanner/.bloom/scans');
      expect(config.bloom_api_url).toBe('https://api.bloom.salk.edu/proxy');
      expect(config.bloom_scanner_username).toBe('pbiob_scanner@salk.edu');
      expect(config.bloom_scanner_password).toBe('scanner_password_123');
      expect(config.bloom_anon_key).toBe(
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
      );
    });

    it('should return defaults when .env file does not exist', () => {
      const nonExistentPath = path.join(testDir, 'nonexistent.env');

      const config = loadEnvConfig(nonExistentPath);
      const defaults = getDefaultConfig();

      expect(config.scanner_name).toBe(defaults.scanner_name);
      expect(config.camera_ip_address).toBe(defaults.camera_ip_address);
      expect(config.bloom_scanner_username).toBe('');
      expect(config.bloom_scanner_password).toBe('');
      expect(config.bloom_anon_key).toBe('');
    });

    it('should handle .env with comments and whitespace', () => {
      const envContent = `# Machine Configuration
SCANNER_NAME = TestScanner  
  CAMERA_IP_ADDRESS=192.168.1.1
# Bloom API Settings
BLOOM_API_URL = https://test.api.url
BLOOM_SCANNER_USERNAME=test@test.com
BLOOM_SCANNER_PASSWORD = testpass
BLOOM_ANON_KEY=testkey
SCANS_DIR=/test/dir`;
      fs.writeFileSync(envPath, envContent);

      const config = loadEnvConfig(envPath);

      expect(config.scanner_name).toBe('TestScanner');
      expect(config.camera_ip_address).toBe('192.168.1.1');
      expect(config.bloom_api_url).toBe('https://test.api.url');
    });

    it('should migrate from legacy config.json + .env', () => {
      // Create old-style config.json
      const legacyConfig = {
        scanner_name: 'LegacyScanner',
        camera_ip_address: '10.0.0.100',
        scans_dir: '/legacy/scans',
        bloom_api_url: 'https://legacy.api.url',
      };
      fs.writeFileSync(configPath, JSON.stringify(legacyConfig));

      // Create old-style .env with credentials only
      const legacyEnv = `BLOOM_SCANNER_USERNAME=legacy@test.com
BLOOM_SCANNER_PASSWORD=legacypass
BLOOM_ANON_KEY=legacykey`;
      fs.writeFileSync(envPath, legacyEnv);

      const config = loadEnvConfig(envPath);

      // Should load ALL fields (merged from both files)
      expect(config.scanner_name).toBe('LegacyScanner');
      expect(config.camera_ip_address).toBe('10.0.0.100');
      expect(config.scans_dir).toBe('/legacy/scans');
      expect(config.bloom_api_url).toBe('https://legacy.api.url');
      expect(config.bloom_scanner_username).toBe('legacy@test.com');
      expect(config.bloom_scanner_password).toBe('legacypass');
      expect(config.bloom_anon_key).toBe('legacykey');

      // Verify config.json was deleted after migration
      expect(fs.existsSync(configPath)).toBe(false);

      // Verify new .env contains ALL fields
      const newEnvContent = fs.readFileSync(envPath, 'utf-8');
      expect(newEnvContent).toContain('SCANNER_NAME=LegacyScanner');
      expect(newEnvContent).toContain('CAMERA_IP_ADDRESS=10.0.0.100');
      expect(newEnvContent).toContain('BLOOM_SCANNER_USERNAME=legacy@test.com');
    });

    it('should handle migration when only config.json exists', () => {
      const legacyConfig = {
        scanner_name: 'ConfigOnlyScanner',
        camera_ip_address: 'mock',
        scans_dir: '/config/only',
        bloom_api_url: 'https://config.only.url',
      };
      fs.writeFileSync(configPath, JSON.stringify(legacyConfig));

      const config = loadEnvConfig(envPath);

      expect(config.scanner_name).toBe('ConfigOnlyScanner');
      expect(config.bloom_scanner_username).toBe(''); // Empty credentials
      expect(fs.existsSync(configPath)).toBe(false); // Deleted
    });
  });

  describe('saveEnvConfig (unified config)', () => {
    it('should save all fields to .env file', () => {
      const config: MachineConfig = {
        scanner_name: 'SavedScanner',
        camera_ip_address: '192.168.1.100',
        scans_dir: '/custom/path',
        bloom_api_url: 'https://custom.api.url',
        bloom_scanner_username: 'user@test.com',
        bloom_scanner_password: 'password123',
        bloom_anon_key: 'anonkey123',
      };

      saveEnvConfig(config, envPath);

      expect(fs.existsSync(envPath)).toBe(true);
      const content = fs.readFileSync(envPath, 'utf-8');
      expect(content).toContain('SCANNER_NAME=SavedScanner');
      expect(content).toContain('CAMERA_IP_ADDRESS=192.168.1.100');
      expect(content).toContain('SCANS_DIR=/custom/path');
      expect(content).toContain('BLOOM_API_URL=https://custom.api.url');
      expect(content).toContain('BLOOM_SCANNER_USERNAME=user@test.com');
      expect(content).toContain('BLOOM_SCANNER_PASSWORD=password123');
      expect(content).toContain('BLOOM_ANON_KEY=anonkey123');
    });

    it('should create parent directories if needed', () => {
      const nestedPath = path.join(testDir, 'deep', 'nested', '.env');
      const config: MachineConfig = {
        scanner_name: 'NestedScanner',
        camera_ip_address: 'mock',
        scans_dir: '/data',
        bloom_api_url: 'https://api.bloom.salk.edu/proxy',
        bloom_scanner_username: 'nested@test.com',
        bloom_scanner_password: 'nestedpass',
        bloom_anon_key: 'nestedkey',
      };

      saveEnvConfig(config, nestedPath);

      expect(fs.existsSync(nestedPath)).toBe(true);
    });

    it('should overwrite existing .env file', () => {
      fs.writeFileSync(envPath, 'SCANNER_NAME=OldScanner');

      const config: MachineConfig = {
        scanner_name: 'NewScanner',
        camera_ip_address: '10.0.0.1',
        scans_dir: '/new',
        bloom_api_url: 'https://new.api',
        bloom_scanner_username: 'new@test.com',
        bloom_scanner_password: 'newpass',
        bloom_anon_key: 'newkey',
      };
      saveEnvConfig(config, envPath);

      const content = fs.readFileSync(envPath, 'utf-8');
      expect(content).toContain('SCANNER_NAME=NewScanner');
      expect(content).not.toContain('OldScanner');
    });
  });

  // ========================================
  // EXISTING TESTS (will be deprecated)
  // ========================================

  describe('getDefaultConfig', () => {
    it('should return default config values', () => {
      const defaults = getDefaultConfig();

      expect(defaults.scanner_name).toBe('');
      expect(defaults.camera_ip_address).toBe('mock');
      expect(defaults.scans_dir).toContain('.bloom/scans');
      expect(defaults.bloom_api_url).toBe('https://api.bloom.salk.edu/proxy');
    });
  });

  describe('loadConfig', () => {
    it('should load config from a valid JSON file', () => {
      const testConfig: MachineConfig = {
        scanner_name: 'TestScanner',
        camera_ip_address: '10.0.0.23',
        scans_dir: '/data/scans',
        bloom_api_url: 'https://api.bloom.salk.edu/proxy',
      };
      fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2));

      const loaded = loadConfig(configPath);

      expect(loaded.scanner_name).toBe('TestScanner');
      expect(loaded.camera_ip_address).toBe('10.0.0.23');
      expect(loaded.scans_dir).toBe('/data/scans');
      expect(loaded.bloom_api_url).toBe('https://api.bloom.salk.edu/proxy');
    });

    it('should return default config when file does not exist', () => {
      const nonExistentPath = path.join(testDir, 'nonexistent.json');

      const loaded = loadConfig(nonExistentPath);
      const defaults = getDefaultConfig();

      expect(loaded.scanner_name).toBe(defaults.scanner_name);
      expect(loaded.camera_ip_address).toBe(defaults.camera_ip_address);
      expect(loaded.bloom_api_url).toBe(defaults.bloom_api_url);
    });

    it('should return default config when file contains invalid JSON', () => {
      fs.writeFileSync(configPath, 'not valid json {{{');

      const loaded = loadConfig(configPath);
      const defaults = getDefaultConfig();

      expect(loaded.scanner_name).toBe(defaults.scanner_name);
      expect(loaded.camera_ip_address).toBe(defaults.camera_ip_address);
    });

    it('should merge partial config with defaults', () => {
      // Config file with only some fields
      const partialConfig = {
        scanner_name: 'PartialScanner',
        // Missing: camera_ip_address, scans_dir, bloom_api_url
      };
      fs.writeFileSync(configPath, JSON.stringify(partialConfig));

      const loaded = loadConfig(configPath);
      const defaults = getDefaultConfig();

      expect(loaded.scanner_name).toBe('PartialScanner');
      expect(loaded.camera_ip_address).toBe(defaults.camera_ip_address);
      expect(loaded.bloom_api_url).toBe(defaults.bloom_api_url);
    });
  });

  describe('saveConfig', () => {
    it('should save config to a JSON file', () => {
      const config: MachineConfig = {
        scanner_name: 'SavedScanner',
        camera_ip_address: '192.168.1.100',
        scans_dir: '/custom/path',
        bloom_api_url: 'https://custom.api.url',
      };

      saveConfig(config, configPath);

      expect(fs.existsSync(configPath)).toBe(true);
      const savedContent = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(savedContent.scanner_name).toBe('SavedScanner');
      expect(savedContent.camera_ip_address).toBe('192.168.1.100');
    });

    it('should create parent directories if they do not exist', () => {
      const nestedPath = path.join(testDir, 'deep', 'nested', 'config.json');
      const config: MachineConfig = {
        scanner_name: 'NestedScanner',
        camera_ip_address: 'mock',
        scans_dir: '/data',
        bloom_api_url: 'https://api.bloom.salk.edu/proxy',
      };

      saveConfig(config, nestedPath);

      expect(fs.existsSync(nestedPath)).toBe(true);
      const savedContent = JSON.parse(fs.readFileSync(nestedPath, 'utf-8'));
      expect(savedContent.scanner_name).toBe('NestedScanner');
    });

    it('should overwrite existing config file', () => {
      const initialConfig: MachineConfig = {
        scanner_name: 'Initial',
        camera_ip_address: 'mock',
        scans_dir: '/initial',
        bloom_api_url: 'https://api.bloom.salk.edu/proxy',
      };
      fs.writeFileSync(configPath, JSON.stringify(initialConfig));

      const updatedConfig: MachineConfig = {
        scanner_name: 'Updated',
        camera_ip_address: '10.0.0.1',
        scans_dir: '/updated',
        bloom_api_url: 'https://new.api.url',
      };
      saveConfig(updatedConfig, configPath);

      const savedContent = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(savedContent.scanner_name).toBe('Updated');
      expect(savedContent.scans_dir).toBe('/updated');
    });

    it('should write valid JSON with proper formatting', () => {
      const config: MachineConfig = {
        scanner_name: 'FormattedScanner',
        camera_ip_address: 'mock',
        scans_dir: '/data',
        bloom_api_url: 'https://api.bloom.salk.edu/proxy',
      };

      saveConfig(config, configPath);

      const content = fs.readFileSync(configPath, 'utf-8');
      // Should be formatted with indentation
      expect(content).toContain('\n');
      // Should be valid JSON
      expect(() => JSON.parse(content)).not.toThrow();
    });
  });

  describe('loadCredentials', () => {
    it('should load credentials from a valid .env file', () => {
      const envContent = `BLOOM_SCANNER_USERNAME=scanner@example.com
BLOOM_SCANNER_PASSWORD=secretpassword
BLOOM_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9`;
      fs.writeFileSync(envPath, envContent);

      const credentials = loadCredentials(envPath);

      expect(credentials.bloom_scanner_username).toBe('scanner@example.com');
      expect(credentials.bloom_scanner_password).toBe('secretpassword');
      expect(credentials.bloom_anon_key).toBe(
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
      );
    });

    it('should return empty credentials when file does not exist', () => {
      const nonExistentPath = path.join(testDir, 'nonexistent.env');

      const credentials = loadCredentials(nonExistentPath);

      expect(credentials.bloom_scanner_username).toBe('');
      expect(credentials.bloom_scanner_password).toBe('');
      expect(credentials.bloom_anon_key).toBe('');
    });

    it('should handle .env file with extra whitespace and comments', () => {
      const envContent = `# Bloom credentials
BLOOM_SCANNER_USERNAME = user@example.com
  BLOOM_SCANNER_PASSWORD=pass123
# This is a comment
BLOOM_ANON_KEY=key123
OTHER_VAR=ignored`;
      fs.writeFileSync(envPath, envContent);

      const credentials = loadCredentials(envPath);

      expect(credentials.bloom_scanner_username).toBe('user@example.com');
      expect(credentials.bloom_scanner_password).toBe('pass123');
      expect(credentials.bloom_anon_key).toBe('key123');
    });

    it('should return empty string for missing keys', () => {
      const envContent = `BLOOM_SCANNER_USERNAME=onlyuser`;
      fs.writeFileSync(envPath, envContent);

      const credentials = loadCredentials(envPath);

      expect(credentials.bloom_scanner_username).toBe('onlyuser');
      expect(credentials.bloom_scanner_password).toBe('');
      expect(credentials.bloom_anon_key).toBe('');
    });
  });

  describe('saveCredentials', () => {
    it('should save credentials to a .env file', () => {
      const credentials: MachineCredentials = {
        bloom_scanner_username: 'test@example.com',
        bloom_scanner_password: 'testpass',
        bloom_anon_key: 'testkey123',
      };

      saveCredentials(credentials, envPath);

      expect(fs.existsSync(envPath)).toBe(true);
      const content = fs.readFileSync(envPath, 'utf-8');
      expect(content).toContain('BLOOM_SCANNER_USERNAME=test@example.com');
      expect(content).toContain('BLOOM_SCANNER_PASSWORD=testpass');
      expect(content).toContain('BLOOM_ANON_KEY=testkey123');
    });

    it('should create parent directories if they do not exist', () => {
      const nestedEnvPath = path.join(testDir, 'nested', '.env');
      const credentials: MachineCredentials = {
        bloom_scanner_username: 'nested@example.com',
        bloom_scanner_password: 'nestedpass',
        bloom_anon_key: 'nestedkey',
      };

      saveCredentials(credentials, nestedEnvPath);

      expect(fs.existsSync(nestedEnvPath)).toBe(true);
    });

    it('should overwrite existing .env file', () => {
      fs.writeFileSync(envPath, 'BLOOM_SCANNER_USERNAME=old@example.com');

      const credentials: MachineCredentials = {
        bloom_scanner_username: 'new@example.com',
        bloom_scanner_password: 'newpass',
        bloom_anon_key: 'newkey',
      };
      saveCredentials(credentials, envPath);

      const content = fs.readFileSync(envPath, 'utf-8');
      expect(content).toContain('BLOOM_SCANNER_USERNAME=new@example.com');
      expect(content).not.toContain('old@example.com');
    });

    it('should write one KEY=value per line', () => {
      const credentials: MachineCredentials = {
        bloom_scanner_username: 'user@test.com',
        bloom_scanner_password: 'pass',
        bloom_anon_key: 'key',
      };

      saveCredentials(credentials, envPath);

      const content = fs.readFileSync(envPath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(3);
      expect(lines[0]).toMatch(/^BLOOM_SCANNER_USERNAME=.+$/);
      expect(lines[1]).toMatch(/^BLOOM_SCANNER_PASSWORD=.+$/);
      expect(lines[2]).toMatch(/^BLOOM_ANON_KEY=.+$/);
    });
  });

  describe('Development vs Production Path Defaults (improve-database-scans-config)', () => {
    describe('Development environment paths', () => {
      it('should use ~/.bloom/dev-scans for development scans default', () => {
        // Save original NODE_ENV
        const originalEnv = process.env.NODE_ENV;

        try {
          // Set development mode
          process.env.NODE_ENV = 'development';

          const config = getDefaultConfig();

          // Should contain 'dev-scans' in the path
          expect(config.scans_dir).toContain('.bloom');
          expect(config.scans_dir).toContain('dev-scans');
          expect(config.scans_dir).not.toContain('scans/');
        } finally {
          // Restore original NODE_ENV
          process.env.NODE_ENV = originalEnv;
        }
      });
    });

    describe('Production environment paths', () => {
      it('should use ~/.bloom/scans for production scans default (unchanged)', () => {
        // Save original NODE_ENV
        const originalEnv = process.env.NODE_ENV;

        try {
          // Set production mode (or unset to simulate production)
          process.env.NODE_ENV = 'production';

          const config = getDefaultConfig();

          // Should contain '.bloom/scans' but NOT 'dev-scans'
          expect(config.scans_dir).toContain('.bloom');
          expect(config.scans_dir).toContain('scans');
          expect(config.scans_dir).not.toContain('dev-scans');
        } finally {
          // Restore original NODE_ENV
          process.env.NODE_ENV = originalEnv;
        }
      });
    });

    describe('Scans directory validation', () => {
      let testDir: string;
      let writableDir: string;
      let nonWritableDir: string;

      beforeEach(() => {
        // Create temp directory for tests
        testDir = fs.mkdtempSync(
          path.join(os.tmpdir(), 'bloom-scans-validation-')
        );

        // Create a writable directory
        writableDir = path.join(testDir, 'writable-scans');
        fs.mkdirSync(writableDir, { recursive: true });

        // Create a non-writable directory (if possible on this platform)
        nonWritableDir = path.join(testDir, 'non-writable-scans');
        fs.mkdirSync(nonWritableDir, { recursive: true });

        // Try to make it non-writable (may not work on all platforms)
        try {
          fs.chmodSync(nonWritableDir, 0o444); // Read-only
        } catch {
          // chmod may not work on all platforms, skip this test setup
        }
      });

      afterEach(() => {
        // Restore permissions before cleanup
        try {
          if (fs.existsSync(nonWritableDir)) {
            fs.chmodSync(nonWritableDir, 0o755);
          }
        } catch {
          // Ignore permission errors during cleanup
        }

        // Clean up test directory
        if (fs.existsSync(testDir)) {
          fs.rmSync(testDir, { recursive: true, force: true });
        }
      });

      it('should pass validation for existing writable directory', () => {
        const config: MachineConfig = {
          scanner_name: 'test-scanner',
          camera_ip_address: 'mock',
          scans_dir: writableDir,
          bloom_api_url: 'https://api.bloom.salk.edu/proxy',
        };

        const result = validateConfig(config);

        // Should NOT have scans_dir error for writable directory
        expect(result.errors.scans_dir).toBeUndefined();
      });

      it('should fail validation for non-existent directory', () => {
        const nonExistentPath = path.join(testDir, 'does-not-exist');

        const config: MachineConfig = {
          scanner_name: 'test-scanner',
          camera_ip_address: 'mock',
          scans_dir: nonExistentPath,
          bloom_api_url: 'https://api.bloom.salk.edu/proxy',
        };

        const result = validateConfig(config);

        // Should have scans_dir error for non-existent directory
        expect(result.valid).toBe(false);
        expect(result.errors.scans_dir).toBeDefined();
        expect(result.errors.scans_dir).toContain('does not exist');
      });

      it('should fail validation for non-writable directory', () => {
        // Skip test if chmod doesn't work (e.g., Windows)
        let isActuallyNonWritable = false;
        try {
          fs.accessSync(nonWritableDir, fs.constants.W_OK);
        } catch {
          isActuallyNonWritable = true;
        }

        if (!isActuallyNonWritable) {
          // Skip this test on platforms where chmod doesn't restrict writes
          return;
        }

        const config: MachineConfig = {
          scanner_name: 'test-scanner',
          camera_ip_address: 'mock',
          scans_dir: nonWritableDir,
          bloom_api_url: 'https://api.bloom.salk.edu/proxy',
        };

        const result = validateConfig(config);

        // Should have scans_dir error for non-writable directory
        expect(result.valid).toBe(false);
        expect(result.errors.scans_dir).toBeDefined();
        expect(result.errors.scans_dir).toContain('not writable');
      });
    });
  });

  describe('validateConfig', () => {
    describe('scanner_name validation', () => {
      it('should reject empty scanner name', () => {
        const config: MachineConfig = {
          scanner_name: '',
          camera_ip_address: 'mock',
          scans_dir: '/data',
          bloom_api_url: 'https://api.bloom.salk.edu/proxy',
        };

        const result = validateConfig(config);

        expect(result.valid).toBe(false);
        expect(result.errors.scanner_name).toBe('Scanner name is required');
      });

      it('should accept scanner names with any characters (dropdown enforces validity)', () => {
        // Create a temporary writable directory
        const testDir = fs.mkdtempSync(
          path.join(os.tmpdir(), 'bloom-scanner-')
        );

        try {
          const config: MachineConfig = {
            scanner_name: 'PBIOBScanner',
            camera_ip_address: 'mock',
            scans_dir: testDir, // Use actual writable directory
            bloom_api_url: 'https://api.bloom.salk.edu/proxy',
          };

          const result = validateConfig(config);

          expect(result.valid).toBe(true);
          expect(result.errors.scanner_name).toBeUndefined();
        } finally {
          // Clean up
          if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
          }
        }
      });

      it('should accept valid scanner names', () => {
        // Create a temporary writable directory once for all names
        const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-names-'));

        try {
          const validNames = [
            'Scanner1',
            'PBIOB-Scanner',
            'scanner_lab_2',
            'Scanner-A1_v2',
          ];

          for (const name of validNames) {
            const config: MachineConfig = {
              scanner_name: name,
              camera_ip_address: 'mock',
              scans_dir: testDir, // Use actual writable directory
              bloom_api_url: 'https://api.bloom.salk.edu/proxy',
            };

            const result = validateConfig(config);
            expect(result.errors.scanner_name).toBeUndefined();
          }
        } finally {
          // Clean up
          if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
          }
        }
      });
    });

    describe('camera_ip_address validation', () => {
      it('should accept "mock" as valid', () => {
        const config: MachineConfig = {
          scanner_name: 'Scanner',
          camera_ip_address: 'mock',
          scans_dir: '/data',
          bloom_api_url: 'https://api.bloom.salk.edu/proxy',
        };

        const result = validateConfig(config);

        expect(result.errors.camera_ip_address).toBeUndefined();
      });

      it('should accept valid IPv4 addresses', () => {
        const validIPs = [
          '10.0.0.23',
          '192.168.1.100',
          '172.16.0.1',
          '1.2.3.4',
        ];

        for (const ip of validIPs) {
          const config: MachineConfig = {
            scanner_name: 'Scanner',
            camera_ip_address: ip,
            scans_dir: '/data',
            bloom_api_url: 'https://api.bloom.salk.edu/proxy',
          };

          const result = validateConfig(config);
          expect(result.errors.camera_ip_address).toBeUndefined();
        }
      });

      it('should reject invalid IP formats', () => {
        const invalidIPs = [
          '256.0.0.1',
          '10.0.0',
          'not-an-ip',
          '10.0.0.1.5',
          '',
        ];

        for (const ip of invalidIPs) {
          const config: MachineConfig = {
            scanner_name: 'Scanner',
            camera_ip_address: ip,
            scans_dir: '/data',
            bloom_api_url: 'https://api.bloom.salk.edu/proxy',
          };

          const result = validateConfig(config);
          expect(result.errors.camera_ip_address).toBe(
            'Invalid IP address format'
          );
        }
      });
    });

    describe('scans_dir validation', () => {
      it('should reject empty scans directory', () => {
        const config: MachineConfig = {
          scanner_name: 'Scanner',
          camera_ip_address: 'mock',
          scans_dir: '',
          bloom_api_url: 'https://api.bloom.salk.edu/proxy',
        };

        const result = validateConfig(config);

        expect(result.valid).toBe(false);
        expect(result.errors.scans_dir).toBe('Scans directory is required');
      });

      it('should accept valid directory paths', () => {
        // Create a temporary directory that actually exists
        const testDir = fs.mkdtempSync(
          path.join(os.tmpdir(), 'bloom-validation-')
        );

        try {
          const config: MachineConfig = {
            scanner_name: 'Scanner',
            camera_ip_address: 'mock',
            scans_dir: testDir, // Use actual writable directory
            bloom_api_url: 'https://api.bloom.salk.edu/proxy',
          };

          const result = validateConfig(config);
          expect(result.errors.scans_dir).toBeUndefined();
        } finally {
          // Clean up
          if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
          }
        }
      });
    });

    describe('bloom_api_url validation', () => {
      it('should accept valid HTTPS URLs', () => {
        const validURLs = [
          'https://api.bloom.salk.edu/proxy',
          'https://localhost:3000',
          'https://example.com/api/v1',
        ];

        for (const url of validURLs) {
          const config: MachineConfig = {
            scanner_name: 'Scanner',
            camera_ip_address: 'mock',
            scans_dir: '/data',
            bloom_api_url: url,
          };

          const result = validateConfig(config);
          expect(result.errors.bloom_api_url).toBeUndefined();
        }
      });

      it('should reject invalid URL formats', () => {
        const invalidURLs = ['not-a-url', 'ftp://example.com', ''];

        for (const url of invalidURLs) {
          const config: MachineConfig = {
            scanner_name: 'Scanner',
            camera_ip_address: 'mock',
            scans_dir: '/data',
            bloom_api_url: url,
          };

          const result = validateConfig(config);
          expect(result.errors.bloom_api_url).toBe('Invalid URL format');
        }
      });

      it('should accept HTTP URLs for local development', () => {
        const config: MachineConfig = {
          scanner_name: 'Scanner',
          camera_ip_address: 'mock',
          scans_dir: '/data',
          bloom_api_url: 'http://localhost:3000',
        };

        const result = validateConfig(config);

        expect(result.errors.bloom_api_url).toBeUndefined();
      });
    });

    describe('overall validation', () => {
      it('should return valid=true when all fields are valid', () => {
        // Create a temporary writable directory for testing
        const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-valid-'));

        try {
          const config: MachineConfig = {
            scanner_name: 'ValidScanner',
            camera_ip_address: '10.0.0.23',
            scans_dir: testDir, // Use actual writable directory
            bloom_api_url: 'https://api.bloom.salk.edu/proxy',
          };

          const result = validateConfig(config);

          expect(result.valid).toBe(true);
          expect(Object.keys(result.errors).length).toBe(0);
        } finally {
          // Clean up
          if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
          }
        }
      });

      it('should return valid=false with multiple errors', () => {
        const config: MachineConfig = {
          scanner_name: '',
          camera_ip_address: 'invalid',
          scans_dir: '',
          bloom_api_url: 'not-a-url',
        };

        const result = validateConfig(config);

        expect(result.valid).toBe(false);
        expect(result.errors.scanner_name).toBeDefined();
        expect(result.errors.camera_ip_address).toBeDefined();
        expect(result.errors.scans_dir).toBeDefined();
        expect(result.errors.bloom_api_url).toBeDefined();
      });
    });
  });

  describe('fetchScannersFromBloom', () => {
    const mockApiUrl = 'https://api.bloom.salk.edu/proxy';
    const mockCredentials = {
      bloom_scanner_username: 'scanner@salk.edu',
      bloom_scanner_password: 'password123',
      bloom_anon_key: 'test-anon-key',
    };

    // Mock Supabase client and store
    let mockSupabaseClient: any;
    let mockSupabaseStore: any;
    let mockCreateClient: any;
    let mockSupabaseStoreConstructor: any;

    beforeEach(async () => {
      // Reset all mocks
      vi.clearAllMocks();

      // Create mock Supabase client with auth
      mockSupabaseClient = {
        auth: {
          signInWithPassword: vi.fn(),
        },
      };

      // Create mock SupabaseStore with scanner query method
      mockSupabaseStore = {
        getAllCylScanners: vi.fn(),
      };

      // Mock createClient function
      mockCreateClient = vi.fn(() => mockSupabaseClient);

      // Mock SupabaseStore constructor
      mockSupabaseStoreConstructor = vi.fn(() => mockSupabaseStore);

      // Mock the module imports
      vi.doMock('@supabase/supabase-js', () => ({
        createClient: mockCreateClient,
      }));

      vi.doMock('@salk-hpi/bloom-js', () => ({
        SupabaseStore: mockSupabaseStoreConstructor,
      }));
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should fetch scanners successfully with Supabase authentication', async () => {
      // Mock successful authentication
      mockSupabaseClient.auth.signInWithPassword.mockResolvedValue({
        data: {
          session: { access_token: 'mock-token' },
          user: { id: 'user-123' },
        },
        error: null,
      });

      // Mock successful scanner query
      const mockScanners = [
        { id: 1, name: 'FastScanner' },
        { id: 2, name: 'SlowScanner' },
        { id: 3, name: 'Unknown' },
        { id: 4, name: 'PBIOBScanner' },
      ];
      mockSupabaseStore.getAllCylScanners.mockResolvedValue({
        data: mockScanners,
        error: null,
      });

      const result = await fetchScannersFromBloom(mockApiUrl, mockCredentials);

      // Verify result
      expect(result.success).toBe(true);
      expect(result.scanners).toEqual(mockScanners);
      expect(result.error).toBeUndefined();

      // Verify Supabase client was created correctly
      expect(mockCreateClient).toHaveBeenCalledWith(
        mockApiUrl,
        mockCredentials.bloom_anon_key
      );

      // Verify authentication was called correctly
      expect(mockSupabaseClient.auth.signInWithPassword).toHaveBeenCalledWith({
        email: mockCredentials.bloom_scanner_username,
        password: mockCredentials.bloom_scanner_password,
      });

      // Verify SupabaseStore was instantiated
      expect(mockSupabaseStoreConstructor).toHaveBeenCalledWith(
        mockSupabaseClient
      );

      // Verify scanner query was called
      expect(mockSupabaseStore.getAllCylScanners).toHaveBeenCalled();
    });

    it('should handle authentication failure', async () => {
      // Mock authentication failure
      mockSupabaseClient.auth.signInWithPassword.mockResolvedValue({
        data: { session: null, user: null },
        error: { message: 'Invalid login credentials' },
      });

      const result = await fetchScannersFromBloom(mockApiUrl, mockCredentials);

      expect(result.success).toBe(false);
      expect(result.scanners).toBeUndefined();
      expect(result.error).toBe(
        'Authentication failed: Invalid login credentials'
      );

      // Verify SupabaseStore was NOT called (auth failed before that)
      expect(mockSupabaseStoreConstructor).not.toHaveBeenCalled();
      expect(mockSupabaseStore.getAllCylScanners).not.toHaveBeenCalled();
    });

    it('should handle network errors', async () => {
      // Mock network error during authentication
      mockSupabaseClient.auth.signInWithPassword.mockRejectedValue(
        new Error('Network error')
      );

      const result = await fetchScannersFromBloom(mockApiUrl, mockCredentials);

      expect(result.success).toBe(false);
      expect(result.scanners).toBeUndefined();
      expect(result.error).toBe('Network error: Network error');
    });

    it('should handle scanner query failure', async () => {
      // Mock successful authentication
      mockSupabaseClient.auth.signInWithPassword.mockResolvedValue({
        data: {
          session: { access_token: 'mock-token' },
          user: { id: 'user-123' },
        },
        error: null,
      });

      // Mock query failure
      mockSupabaseStore.getAllCylScanners.mockResolvedValue({
        data: null,
        error: { message: 'Database query failed' },
      });

      const result = await fetchScannersFromBloom(mockApiUrl, mockCredentials);

      expect(result.success).toBe(false);
      expect(result.scanners).toBeUndefined();
      expect(result.error).toBe(
        'Failed to fetch scanners: Database query failed'
      );
    });

    it('should handle scanner query returning null data', async () => {
      // Mock successful authentication
      mockSupabaseClient.auth.signInWithPassword.mockResolvedValue({
        data: {
          session: { access_token: 'mock-token' },
          user: { id: 'user-123' },
        },
        error: null,
      });

      // Mock query returning null data (but no error)
      mockSupabaseStore.getAllCylScanners.mockResolvedValue({
        data: null,
        error: null,
      });

      const result = await fetchScannersFromBloom(mockApiUrl, mockCredentials);

      // Should handle gracefully, returning empty array
      expect(result.success).toBe(true);
      expect(result.scanners).toEqual([]);
    });

    it('should handle scanners with nullable names', async () => {
      // Mock successful authentication
      mockSupabaseClient.auth.signInWithPassword.mockResolvedValue({
        data: {
          session: { access_token: 'mock-token' },
          user: { id: 'user-123' },
        },
        error: null,
      });

      // Mock scanner data with null names (valid according to schema)
      const mockScanners = [
        { id: 1, name: 'FastScanner' },
        { id: 2, name: null }, // Nullable name
        { id: 3, name: 'PBIOBScanner' },
      ];
      mockSupabaseStore.getAllCylScanners.mockResolvedValue({
        data: mockScanners,
        error: null,
      });

      const result = await fetchScannersFromBloom(mockApiUrl, mockCredentials);

      expect(result.success).toBe(true);
      expect(result.scanners).toEqual(mockScanners);
      // Verify nullable name is preserved
      expect(result.scanners?.[1].name).toBeNull();
    });
  });
});
