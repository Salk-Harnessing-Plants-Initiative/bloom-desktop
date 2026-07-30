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
export type ScannerMode = 'cylinderscan' | 'graviscan';

export interface MachineConfig {
  /** Scanner mode — determines which hardware and UI features are available */
  scanner_mode: ScannerMode | '';

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

  /** Number of frames per scan rotation (integer, 1-720) */
  num_frames: number;

  /** Seconds per rotation (2.0-120.0) */
  seconds_per_rot: number;

  /**
   * Slack webhook URL for V600 wedge notifications (#236).
   * Loaded from BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL in ~/.bloom/.env.
   * Absent or empty ⇒ Slack notifier is disabled.
   * SECRET — never log or expose.
   */
  slack_webhook_url?: string;

  /**
   * libusb endpoint-recovery shim toggle (#228).
   * Loaded from LIBUSB_ENDPOINT_RECOVERY in ~/.bloom/.env.
   * Default true (wrapper active). Set "false" (case-insensitive) to
   * disable the libusb_clear_halt-on-bulk-timeout wrapper.
   */
  libusb_endpoint_recovery?: boolean;

  /**
   * GraviScan system name for uploads and Box backup attribution
   * (production parity gap #6 — see
   * openspec/changes/add-graviscan-system-name-config).
   * Loaded from GRAVISCAN_SYSTEM_NAME in ~/.bloom/.env.
   * Absent or empty ⇒ undefined; hydrated into
   * process.env.GRAVISCAN_SYSTEM_NAME at startup (main.ts), read by
   * box-backup.ts, graviscan/scanner-handlers.ts, and
   * graviscan-upload.ts to attribute uploads/backups to a physical
   * rig in multi-rig fleets.
   */
  graviscan_system_name?: string;
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
    scanner_mode?: string;
    scanner_name?: string;
    camera_ip_address?: string;
    scans_dir?: string;
    bloom_api_url?: string;
    num_frames?: string;
    seconds_per_rot?: string;
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

  // Use environment-specific scans directory defaults
  // Development: ~/.bloom/dev-scans (separate from production)
  // Production: ~/.bloom/scans (unchanged)
  const isDev = process.env.NODE_ENV === 'development';
  const scansDir = isDev
    ? path.join(homeDir, '.bloom', 'dev-scans')
    : path.join(homeDir, '.bloom', 'scans');

  return {
    scanner_mode: '', // Empty forces first-run mode selection
    scanner_name: '',
    camera_ip_address: 'mock',
    scans_dir: scansDir,
    bloom_api_url: 'https://api.bloom.salk.edu/proxy',
    bloom_scanner_username: '',
    bloom_scanner_password: '',
    bloom_anon_key: '',
    num_frames: 72,
    seconds_per_rot: 7.0,
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
  // Auto-create scans directory if it doesn't exist
  // This eliminates the UX issue where users must manually create the directory
  if (config.scans_dir && !fs.existsSync(config.scans_dir)) {
    try {
      console.log('[Config] Creating scans directory:', config.scans_dir);
      fs.mkdirSync(config.scans_dir, { recursive: true });
      console.log('[Config] Scans directory created successfully');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to create scans directory: ${errorMessage}`);
    }
  }

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

  // Validate scanner_mode
  if (!config.scanner_mode) {
    errors.scanner_mode = 'Scanner mode is required';
  } else if (
    config.scanner_mode !== 'cylinderscan' &&
    config.scanner_mode !== 'graviscan'
  ) {
    errors.scanner_mode = 'Scanner mode must be "cylinderscan" or "graviscan"';
  }

  // Validate scanner_name
  // Note: Dropdown in UI enforces valid scanner names from API
  // Here we only check that it's not empty
  if (!config.scanner_name || config.scanner_name.trim() === '') {
    errors.scanner_name = 'Scanner name is required';
  }

  // CylinderScan-specific field validation (skip for GraviScan)
  const isCylinderScan = config.scanner_mode !== 'graviscan';

  // Validate camera_ip_address (CylinderScan only)
  if (isCylinderScan) {
    if (config.camera_ip_address === 'mock') {
      // "mock" is valid for development
    } else if (
      !config.camera_ip_address ||
      !isValidIPv4(config.camera_ip_address)
    ) {
      errors.camera_ip_address = 'Invalid IP address format';
    }
  }

  // Validate scans_dir
  if (!config.scans_dir || config.scans_dir.trim() === '') {
    errors.scans_dir = 'Scans directory is required';
  } else {
    // Validate directory exists and is writable, OR parent is writable (for auto-creation)
    try {
      if (fs.existsSync(config.scans_dir)) {
        // Directory exists - check if writable
        fs.accessSync(config.scans_dir, fs.constants.W_OK);
      } else {
        // Directory doesn't exist - find first existing ancestor and check writability
        // This allows auto-creation with recursive: true
        const checkPath = config.scans_dir;
        let parentPath = path.dirname(checkPath);

        // Walk up directory tree until we find an existing directory
        while (
          !fs.existsSync(parentPath) &&
          parentPath !== path.dirname(parentPath)
        ) {
          parentPath = path.dirname(parentPath);
        }

        // Check if the first existing ancestor is writable
        if (fs.existsSync(parentPath)) {
          fs.accessSync(parentPath, fs.constants.W_OK);
        } else {
          // No existing ancestor found (invalid path)
          errors.scans_dir = `Cannot create directory - invalid path: ${config.scans_dir}`;
        }
      }
    } catch {
      // Permission denied or other error
      if (fs.existsSync(config.scans_dir)) {
        errors.scans_dir = 'Directory is not writable';
      } else {
        // Find parent for error message
        let parentPath = path.dirname(config.scans_dir);
        while (
          !fs.existsSync(parentPath) &&
          parentPath !== path.dirname(parentPath)
        ) {
          parentPath = path.dirname(parentPath);
        }
        errors.scans_dir = `Cannot create directory - parent is not writable: ${parentPath}`;
      }
    }
  }

  // Validate bloom_api_url
  if (!config.bloom_api_url || !isValidURL(config.bloom_api_url)) {
    errors.bloom_api_url = 'Invalid URL format';
  }

  // Validate num_frames: integer in 1-720 (CylinderScan only)
  if (isCylinderScan) {
    if (
      config.num_frames == null ||
      !Number.isInteger(config.num_frames) ||
      config.num_frames < 1 ||
      config.num_frames > 720
    ) {
      errors.num_frames =
        'Number of frames must be an integer between 1 and 720';
    }
  }

  // Validate seconds_per_rot: number in 2.0-120.0 (CylinderScan only)
  if (isCylinderScan) {
    if (
      config.seconds_per_rot == null ||
      typeof config.seconds_per_rot !== 'number' ||
      isNaN(config.seconds_per_rot) ||
      config.seconds_per_rot < 2.0 ||
      config.seconds_per_rot > 120.0
    ) {
      errors.seconds_per_rot =
        'Seconds per rotation must be between 2.0 and 120.0';
    }
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
 * Parse the KEY=value lines of a `.env` file into a partial
 * `MachineConfig`. Pure/side-effect-free — no legacy-config migration,
 * no writes, no `SCANNER_MODE` backward-compat fallback (that's
 * `loadEnvConfig`'s job). Shared by `loadEnvConfig()` and
 * `saveEnvConfig()`'s read-merge-write step (final-review fix #2) so
 * the latter can't recurse into `loadEnvConfig()`'s migration side
 * effect (which itself calls `saveEnvConfig()` when migrating a legacy
 * `config.json`).
 *
 * @param envPath - Path to `.env` file
 * @returns Whatever fields were present in the file; missing/invalid
 *   fields are simply absent from the returned object.
 */
function parseEnvFile(envPath: string): Partial<MachineConfig> {
  const envConfig: Partial<MachineConfig> = {};

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
          case 'SCANNER_MODE':
            if (value === 'cylinderscan' || value === 'graviscan') {
              envConfig.scanner_mode = value;
            }
            break;
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
          case 'NUM_FRAMES': {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed)) {
              envConfig.num_frames = parsed;
            }
            break;
          }
          case 'SECONDS_PER_ROT': {
            const parsed = parseFloat(value);
            if (!isNaN(parsed)) {
              envConfig.seconds_per_rot = parsed;
            }
            break;
          }
          case 'BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL':
            // Empty string ⇒ feature disabled (treat as undefined).
            if (value !== '') {
              envConfig.slack_webhook_url = value;
            }
            break;
          case 'LIBUSB_ENDPOINT_RECOVERY':
            // Default ON. Only the case-insensitive string "false" disables.
            envConfig.libusb_endpoint_recovery =
              value.toLowerCase() !== 'false';
            break;
          case 'GRAVISCAN_SYSTEM_NAME':
            // Empty string ⇒ not configured (treat as undefined),
            // mirroring BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL's precedent.
            if (value !== '') {
              envConfig.graviscan_system_name = value;
            }
            break;
        }
      }
    }
  } catch {
    // Ignore errors reading .env
  }

  return envConfig;
}

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
  const envConfig = parseEnvFile(envPath);

  // Merge: defaults < legacyConfig < envConfig
  const merged: MachineConfig = {
    ...defaults,
    ...emptyCredentials,
    ...legacyConfig,
    ...envConfig,
  };

  // Backward compatibility: existing .env files without SCANNER_MODE are CylinderScan
  // (bloom-desktop only supported CylinderScan before this field was added)
  if (!merged.scanner_mode && fs.existsSync(envPath)) {
    merged.scanner_mode = 'cylinderscan';
  }

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
 * Save unified configuration to .env file.
 *
 * Final-review fix #2: read-merge-write. Any field that is `undefined`
 * on the incoming `config` object falls back to whatever is currently
 * persisted in `envPath` (or the schema default if the file doesn't
 * exist / doesn't have that field either). Without this, a caller that
 * round-trips a partial config object — e.g. `config:get`'s IPC handler
 * returns a hand-picked whitelist of fields that does NOT include
 * `slack_webhook_url`/`libusb_endpoint_recovery` (or, pre-existing,
 * `scanner_mode`), and the renderer saves that exact object straight
 * back — would otherwise silently ERASE whichever fields it doesn't
 * carry on every save. The running process still has the old values in
 * `process.env` (hydrated at startup), so this was invisible until the
 * next launch.
 *
 * This makes `undefined` mean "leave unchanged" rather than "clear it",
 * for every field. A field explicitly set to `''`/`0`/`false` (not
 * `undefined`) still overwrites normally — only a genuinely missing key
 * is treated as "no opinion".
 *
 * @param config - Unified configuration to save (fields may be
 *   `undefined` to mean "preserve whatever is currently on disk")
 * @param envPath - Path to .env file (e.g., ~/.bloom/.env)
 */
export function saveEnvConfig(config: MachineConfig, envPath: string): void {
  // Ensure parent directory exists
  const dir = path.dirname(envPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Read-merge-write: existing file's values < schema defaults <
  // incoming config's explicitly-set (non-undefined) fields. Uses the
  // side-effect-free `parseEnvFile()` rather than `loadEnvConfig()` to
  // avoid recursing into the latter's legacy config.json migration
  // (which itself calls `saveEnvConfig()`).
  const existing = parseEnvFile(envPath);
  const incoming = Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined)
  ) as Partial<MachineConfig>;
  const merged: MachineConfig = {
    ...getDefaultConfig(),
    ...existing,
    ...incoming,
  };

  // Auto-create scans directory if it doesn't exist
  // This eliminates the UX issue where users must manually create the directory
  if (merged.scans_dir && !fs.existsSync(merged.scans_dir)) {
    try {
      console.log('[Config] Creating scans directory:', merged.scans_dir);
      fs.mkdirSync(merged.scans_dir, { recursive: true });
      console.log('[Config] Scans directory created successfully');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error('[Config] Failed to create scans directory:', errorMessage);
    }
  }

  // Write KEY=value format with sections. The V600 wedge-followups
  // section is appended only when the values are actually configured —
  // otherwise an empty assignment (e.g., `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL=`)
  // would semantically mean "feature disabled" but also clutter the file.
  const lines: string[] = [
    '# Machine Configuration',
    `SCANNER_MODE=${merged.scanner_mode}`,
    `SCANNER_NAME=${merged.scanner_name}`,
    `CAMERA_IP_ADDRESS=${merged.camera_ip_address}`,
    `SCANS_DIR=${merged.scans_dir}`,
    `BLOOM_API_URL=${merged.bloom_api_url}`,
    '',
    '# Scan Parameters',
    `NUM_FRAMES=${merged.num_frames}`,
    `SECONDS_PER_ROT=${merged.seconds_per_rot}`,
    '',
    '# Bloom API Credentials (Supabase service account)',
    `BLOOM_SCANNER_USERNAME=${merged.bloom_scanner_username}`,
    `BLOOM_SCANNER_PASSWORD=${merged.bloom_scanner_password}`,
    `BLOOM_ANON_KEY=${merged.bloom_anon_key}`,
  ];

  // V600 wedge-followups section (#228 + #236). Only write the lines
  // for values that are explicitly configured.
  if (
    merged.slack_webhook_url !== undefined ||
    merged.libusb_endpoint_recovery !== undefined
  ) {
    lines.push('', '# GraviScan V600 wedge follow-ups (#228 + #236)');
    if (merged.slack_webhook_url !== undefined) {
      lines.push(
        `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL=${merged.slack_webhook_url}`
      );
    }
    if (merged.libusb_endpoint_recovery !== undefined) {
      lines.push(`LIBUSB_ENDPOINT_RECOVERY=${merged.libusb_endpoint_recovery}`);
    }
  }

  // GraviScan system name (production parity gap #6). Optional — like
  // slack_webhook_url, only written when explicitly configured, so an
  // unconfigured field is omitted entirely rather than written as an
  // empty assignment.
  if (merged.graviscan_system_name !== undefined) {
    lines.push('', '# GraviScan System');
    lines.push(`GRAVISCAN_SYSTEM_NAME=${merged.graviscan_system_name}`);
  }

  fs.writeFileSync(envPath, lines.join('\n'), 'utf-8');
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
    const { error: authError } = await supabase.auth.signInWithPassword({
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
