/**
 * Machine Configuration Store
 *
 * Handles loading, saving, and validating machine-level configuration
 * for Bloom Desktop scanning stations.
 *
 * Storage:
 * - Config file: ~/.bloom/config.json (non-sensitive settings)
 * - Credentials file: ~/.bloom/.env (sensitive API credentials)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Machine configuration settings (unified - includes credentials)
 * Stored in ~/.bloom/.env
 */
export interface MachineConfig {
  /** Unique identifier for this scanning station */
  scanner_name: string;

  /** Default camera IP address (or "mock" for development) */
  camera_ip_address: string;

  /** Directory where scan images are saved */
  scans_dir: string;

  /** Bloom API endpoint URL */
  bloom_api_url: string;

  /** Bloom scanner account email */
  bloom_scanner_username: string;

  /** Bloom scanner account password */
  bloom_scanner_password: string;

  /** Supabase anonymous key */
  bloom_anon_key: string;
}

/**
 * Machine credentials (sensitive)
 * Stored in ~/.bloom/.env
 */
export interface MachineCredentials {
  /** Bloom scanner account email */
  bloom_scanner_username: string;

  /** Bloom scanner account password */
  bloom_scanner_password: string;

  /** Supabase anonymous key */
  bloom_anon_key: string;
}

/**
 * Validation result for configuration
 */
export interface ValidationResult {
  /** Whether the configuration is valid */
  valid: boolean;

  /** Field-specific error messages */
  errors: {
    scanner_name?: string;
    camera_ip_address?: string;
    scans_dir?: string;
    bloom_api_url?: string;
  };
}

/**
 * Scanner information from Bloom API (cyl_scanners table)
 */
export interface Scanner {
  /** Scanner ID */
  id: number;
  /** Scanner name (e.g., "PBIOBScanner", "FastScanner") */
  name: string | null;
}

/**
 * Result of fetching scanners from Bloom API
 */
export interface FetchScannersResult {
  success: boolean;
  scanners?: Scanner[];
  error?: string;
}

/**
 * Get the default configuration values (unified - includes empty credentials)
 */
export function getDefaultConfig(): MachineConfig {
  const homeDir = os.homedir();
  return {
    scanner_name: '',
    camera_ip_address: 'mock',
    scans_dir: path.join(homeDir, '.bloom', 'scans'),
    bloom_api_url: 'https://api.bloom.salk.edu/proxy',
    bloom_scanner_username: '',
    bloom_scanner_password: '',
    bloom_anon_key: '',
  };
}

/**
 * Load configuration from a JSON file
 *
 * @param configPath - Path to config.json file
 * @returns Loaded config merged with defaults
 */
export function loadConfig(configPath: string): MachineConfig {
  const defaults = getDefaultConfig();

  try {
    if (!fs.existsSync(configPath)) {
      return defaults;
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content);

    // Merge with defaults to ensure all fields exist
    return {
      ...defaults,
      ...parsed,
    };
  } catch {
    // Return defaults on any error (invalid JSON, read error, etc.)
    return defaults;
  }
}

/**
 * Save configuration to a JSON file
 *
 * @param config - Configuration to save
 * @param configPath - Path to config.json file
 */
export function saveConfig(config: MachineConfig, configPath: string): void {
  // Ensure parent directory exists
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write formatted JSON
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Load credentials from a .env file
 *
 * @param envPath - Path to .env file
 * @returns Loaded credentials (empty strings for missing values)
 */
export function loadCredentials(envPath: string): MachineCredentials {
  const emptyCredentials: MachineCredentials = {
    bloom_scanner_username: '',
    bloom_scanner_password: '',
    bloom_anon_key: '',
  };

  try {
    if (!fs.existsSync(envPath)) {
      return emptyCredentials;
    }

    const content = fs.readFileSync(envPath, 'utf-8');
    const lines = content.split('\n');

    const credentials = { ...emptyCredentials };

    for (const line of lines) {
      // Skip comments and empty lines
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Parse KEY=value format
      const equalIndex = trimmed.indexOf('=');
      if (equalIndex === -1) {
        continue;
      }

      const key = trimmed.substring(0, equalIndex).trim();
      const value = trimmed.substring(equalIndex + 1).trim();

      switch (key) {
        case 'BLOOM_SCANNER_USERNAME':
          credentials.bloom_scanner_username = value;
          break;
        case 'BLOOM_SCANNER_PASSWORD':
          credentials.bloom_scanner_password = value;
          break;
        case 'BLOOM_ANON_KEY':
          credentials.bloom_anon_key = value;
          break;
      }
    }

    return credentials;
  } catch {
    return emptyCredentials;
  }
}

/**
 * Save credentials to a .env file
 *
 * @param credentials - Credentials to save
 * @param envPath - Path to .env file
 */
export function saveCredentials(
  credentials: MachineCredentials,
  envPath: string
): void {
  // Ensure parent directory exists
  const dir = path.dirname(envPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write KEY=value format
  const content = [
    `BLOOM_SCANNER_USERNAME=${credentials.bloom_scanner_username}`,
    `BLOOM_SCANNER_PASSWORD=${credentials.bloom_scanner_password}`,
    `BLOOM_ANON_KEY=${credentials.bloom_anon_key}`,
  ].join('\n');

  fs.writeFileSync(envPath, content, 'utf-8');
}

/**
 * Validate an IPv4 address
 */
function isValidIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return false;
  }

  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255 || part !== num.toString()) {
      return false;
    }
  }

  return true;
}

/**
 * Validate a URL
 */
function isValidURL(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validate configuration values
 *
 * @param config - Configuration to validate
 * @returns Validation result with field-specific errors
 */
export function validateConfig(config: MachineConfig): ValidationResult {
  const errors: ValidationResult['errors'] = {};

  // Validate scanner_name
  // Note: Dropdown in UI enforces valid scanner names from API
  // Here we only check that it's not empty
  if (!config.scanner_name || config.scanner_name.trim() === '') {
    errors.scanner_name = 'Scanner name is required';
  }

  // Validate camera_ip_address
  if (config.camera_ip_address === 'mock') {
    // "mock" is valid for development
  } else if (
    !config.camera_ip_address ||
    !isValidIPv4(config.camera_ip_address)
  ) {
    errors.camera_ip_address = 'Invalid IP address format';
  }

  // Validate scans_dir
  if (!config.scans_dir || config.scans_dir.trim() === '') {
    errors.scans_dir = 'Scans directory is required';
  }

  // Validate bloom_api_url
  if (!config.bloom_api_url || !isValidURL(config.bloom_api_url)) {
    errors.bloom_api_url = 'Invalid URL format';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

// ========================================
// UNIFIED CONFIGURATION FUNCTIONS
// ========================================

/**
 * Load unified configuration from .env file
 * Includes automatic migration from legacy config.json + .env format
 *
 * @param envPath - Path to .env file (e.g., ~/.bloom/.env)
 * @returns Unified configuration with all fields
 */
export function loadEnvConfig(envPath: string): MachineConfig {
  const defaults = getDefaultConfig();
  const emptyCredentials = {
    bloom_scanner_username: '',
    bloom_scanner_password: '',
    bloom_anon_key: '',
  };

  // Check for legacy config.json file
  const legacyConfigPath = envPath.replace('.env', 'config.json');
  let legacyConfig: Partial<MachineConfig> | null = null;

  if (fs.existsSync(legacyConfigPath)) {
    try {
      const content = fs.readFileSync(legacyConfigPath, 'utf-8');
      legacyConfig = JSON.parse(content);
    } catch {
      // Ignore errors reading legacy config
    }
  }

  // Load from .env file
  let envConfig: Partial<MachineConfig> = {};

  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      const lines = content.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          continue;
        }

        const equalIndex = trimmed.indexOf('=');
        if (equalIndex === -1) {
          continue;
        }

        const key = trimmed.substring(0, equalIndex).trim();
        const value = trimmed.substring(equalIndex + 1).trim();

        switch (key) {
          case 'SCANNER_NAME':
            envConfig.scanner_name = value;
            break;
          case 'CAMERA_IP_ADDRESS':
            envConfig.camera_ip_address = value;
            break;
          case 'SCANS_DIR':
            envConfig.scans_dir = value;
            break;
          case 'BLOOM_API_URL':
            envConfig.bloom_api_url = value;
            break;
          case 'BLOOM_SCANNER_USERNAME':
            envConfig.bloom_scanner_username = value;
            break;
          case 'BLOOM_SCANNER_PASSWORD':
            envConfig.bloom_scanner_password = value;
            break;
          case 'BLOOM_ANON_KEY':
            envConfig.bloom_anon_key = value;
            break;
        }
      }
    }
  } catch {
    // Ignore errors reading .env
  }

  // Merge: defaults < legacyConfig < envConfig
  const merged: MachineConfig = {
    ...defaults,
    ...emptyCredentials,
    ...legacyConfig,
    ...envConfig,
  };

  // If we migrated from legacy config.json, save to new format and delete old file
  if (legacyConfig && Object.keys(legacyConfig).length > 0) {
    saveEnvConfig(merged, envPath);

    try {
      fs.unlinkSync(legacyConfigPath);
    } catch {
      // Ignore errors deleting legacy config
    }
  }

  return merged;
}

/**
 * Save unified configuration to .env file
 *
 * @param config - Unified configuration to save
 * @param envPath - Path to .env file (e.g., ~/.bloom/.env)
 */
export function saveEnvConfig(config: MachineConfig, envPath: string): void {
  // Ensure parent directory exists
  const dir = path.dirname(envPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write KEY=value format with sections
  const content = [
    '# Machine Configuration',
    `SCANNER_NAME=${config.scanner_name}`,
    `CAMERA_IP_ADDRESS=${config.camera_ip_address}`,
    `SCANS_DIR=${config.scans_dir}`,
    `BLOOM_API_URL=${config.bloom_api_url}`,
    '',
    '# Bloom API Credentials (Supabase service account)',
    `BLOOM_SCANNER_USERNAME=${config.bloom_scanner_username}`,
    `BLOOM_SCANNER_PASSWORD=${config.bloom_scanner_password}`,
    `BLOOM_ANON_KEY=${config.bloom_anon_key}`,
  ].join('\n');

  fs.writeFileSync(envPath, content, 'utf-8');
}

// ========================================
// BLOOM API INTEGRATION
// ========================================

/**
 * Fetch list of valid scanners from Bloom API
 *
 * @param apiUrl - Bloom API base URL
 * @param credentials - Bloom API credentials for authentication
 * @returns Promise resolving to scanner list or error
 */
/**
 * Fetches available scanners from Bloom API using Supabase authentication
 * @param apiUrl Bloom API URL
 * @param credentials Bloom API credentials (username, password, anon key)
 * @returns Promise with success status, scanner array, or error message
 */
export async function fetchScannersFromBloom(
  apiUrl: string,
  credentials: MachineCredentials
): Promise<FetchScannersResult> {
  try {
    // Import Supabase client and SupabaseStore
    const { createClient } = await import('@supabase/supabase-js');
    const { SupabaseStore } = await import('@salk-hpi/bloom-js');

    // Create Supabase client
    const supabase = createClient(apiUrl, credentials.bloom_anon_key);

    // Authenticate with email/password
    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({
        email: credentials.bloom_scanner_username,
        password: credentials.bloom_scanner_password,
      });

    if (authError) {
      return {
        success: false,
        error: `Authentication failed: ${authError.message}`,
      };
    }

    // Create SupabaseStore instance
    const store = new SupabaseStore(supabase);

    // Query scanners from cyl_scanners table
    const { data, error } = await store.getAllCylScanners();

    if (error) {
      return {
        success: false,
        error: `Failed to fetch scanners: ${error.message}`,
      };
    }

    // Handle null data (no error but empty result)
    if (!data) {
      return {
        success: true,
        scanners: [],
      };
    }

    return {
      success: true,
      scanners: data,
    };
  } catch (error) {
    return {
      success: false,
      error: `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
