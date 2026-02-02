/**
 * Database Module
 *
 * Manages Prisma Client initialization and lifecycle for SQLite database.
 * Database is stored at ~/.bloom/data/bloom.db by default.
 */

import type { PrismaClient as PrismaClientType } from '@prisma/client';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

/**
 * Load Prisma Client from the correct location based on environment.
 *
 * **CRITICAL PACKAGING CONFIGURATION**
 *
 * In production, Prisma cannot be bundled inside app.asar because:
 * 1. Binary query engines cannot execute from read-only archives
 * 2. Node.js require() can't resolve dynamic paths in ASAR
 * 3. Prisma's internal path resolution breaks when bundled
 *
 * Solution: forge.config.ts uses extraResource to copy .prisma/ to Resources/
 * directory (outside ASAR). This function dynamically loads Prisma from the
 * correct location based on whether we're in development or production.
 *
 * Development: Loads from node_modules/.prisma/client/
 * Production:  Loads from process.resourcesPath/.prisma/client/
 *
 * Multiple fallback paths are checked to handle different Electron Forge
 * configurations and versions. Detailed logging helps diagnose packaging issues.
 *
 * @see {@link /docs/PACKAGING.md} for complete packaging documentation
 * @returns PrismaClient constructor
 * @throws Error if Prisma Client cannot be found (with diagnostic paths)
 */
function loadPrismaClient(): typeof PrismaClientType {
  const isDev = process.env.NODE_ENV === 'development';
  const isPackaged = process.resourcesPath !== undefined;

  if (isDev || !isPackaged) {
    // Development or non-Electron context (e.g., tests): normal import
    console.log(
      '[Database] Development mode - using standard @prisma/client import'
    );
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaClient } = require('@prisma/client');
    return PrismaClient;
  } else {
    // Production packaged app: load from Resources directory (outside asar)
    const resourcesPath = process.resourcesPath;
    console.log('[Database] Production mode - resourcesPath:', resourcesPath);

    // Try multiple possible locations
    const possiblePaths = [
      path.join(resourcesPath, '.prisma', 'client', 'index.js'),
      path.join(resourcesPath, 'node_modules', '.prisma', 'client', 'index.js'),
      path.join(
        resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        '.prisma',
        'client',
        'index.js'
      ),
    ];

    let prismaPath: string | null = null;
    for (const testPath of possiblePaths) {
      console.log('[Database] Checking for Prisma at:', testPath);
      if (fs.existsSync(testPath)) {
        prismaPath = testPath;
        console.log('[Database] Found Prisma at:', prismaPath);
        break;
      }
    }

    if (!prismaPath) {
      const error = `Prisma Client not found. Tried:\n${possiblePaths.join('\n')}`;
      console.error('[Database]', error);
      throw new Error(error);
    }

    // CRITICAL: Set up module resolution for Prisma's internal requires
    // Prisma's index.js requires '@prisma/client/runtime/library.js'
    // In production, this is at Resources/client/runtime/library.js
    //
    // Solution: Create node_modules symlink structure so Node.js can resolve modules
    // When Prisma's index.js does require('@prisma/client/...'), Node.js searches
    // for node_modules directories. We create Resources/node_modules/@prisma/client
    // pointing to Resources/client so the resolution works.
    const nodeModulesDir = path.join(resourcesPath, 'node_modules');
    const prismaModuleDir = path.join(nodeModulesDir, '@prisma');
    const prismaClientSymlink = path.join(prismaModuleDir, 'client');
    const prismaClientActual = path.join(resourcesPath, 'client');

    if (!fs.existsSync(prismaClientSymlink)) {
      try {
        // Create node_modules/@prisma directories if they don't exist
        if (!fs.existsSync(prismaModuleDir)) {
          fs.mkdirSync(prismaModuleDir, { recursive: true });
          console.log('[Database] Created directory:', prismaModuleDir);
        }

        // Create symlink from node_modules/@prisma/client -> client
        fs.symlinkSync(prismaClientActual, prismaClientSymlink, 'dir');
        console.log(
          '[Database] Created symlink:',
          prismaClientSymlink,
          '->',
          prismaClientActual
        );
      } catch (error) {
        console.error('[Database] Failed to create symlink:', error);
        // Continue anyway - might still work
      }
    }

    // Use createRequire to bypass webpack's require and load from absolute path
    // This is necessary because webpack's bundled require() can't load modules
    // from paths outside the bundle.
    // IMPORTANT: Create require relative to Prisma's location, not our bundled location
    // This ensures when Prisma's index.js does require('@prisma/client/runtime/library.js'),
    // it can find it via the node_modules structure we created above.
    const nodeRequire = createRequire(prismaPath);
    const { PrismaClient } = nodeRequire(prismaPath);
    return PrismaClient;
  }
}

let prisma: InstanceType<typeof PrismaClientType> | null = null;

/**
 * Get the database path based on configuration.
 *
 * Priority:
 * 1. Custom path (for testing)
 * 2. BLOOM_DATABASE_URL environment variable
 * 3. NODE_ENV-based defaults (dev: ~/.bloom/dev.db, prod: ~/.bloom/data/bloom.db)
 *
 * @param customPath - Optional custom database path
 * @returns The resolved database path
 */
export function getDatabasePath(customPath?: string): string {
  if (customPath) {
    console.log('[Database] Using custom path:', customPath);
    return customPath;
  }

  if (process.env.BLOOM_DATABASE_URL) {
    const envUrl = process.env.BLOOM_DATABASE_URL;

    // Check for relative path format: file:./path or file:../path
    const relativeMatch = envUrl.match(/^file:(\.\.?\/.*)$/);
    if (relativeMatch) {
      const relativePath = relativeMatch[1];
      const resolvedPath = path.resolve(app.getAppPath(), relativePath);
      console.log(
        '[Database] Using BLOOM_DATABASE_URL (relative):',
        relativePath,
        '->',
        resolvedPath
      );
      return resolvedPath;
    }

    // Properly parse file:// URLs
    try {
      const url = new URL(envUrl);
      if (url.protocol !== 'file:') {
        throw new Error(
          `BLOOM_DATABASE_URL must use file: protocol, got: ${url.protocol}`
        );
      }
      let dbPath = decodeURIComponent(url.pathname);
      // On Windows, file: URLs produce paths like "/C:/path"
      if (
        process.platform === 'win32' &&
        dbPath.startsWith('/') &&
        dbPath[2] === ':'
      ) {
        dbPath = dbPath.slice(1);
      }
      console.log('[Database] Using BLOOM_DATABASE_URL:', dbPath);
      return dbPath;
    } catch {
      // Fallback for legacy format
      const dbPath = process.env.BLOOM_DATABASE_URL.replace(/^file:\/?\/?/, '');
      console.log('[Database] Using BLOOM_DATABASE_URL (legacy format):', dbPath);
      return dbPath;
    }
  }

  // NODE_ENV-based defaults
  const isDev = process.env.NODE_ENV === 'development';
  const homeDir = app.getPath('home');

  if (isDev) {
    const bloomDir = path.join(homeDir, '.bloom');
    if (!fs.existsSync(bloomDir)) {
      console.log('[Database] Creating ~/.bloom directory:', bloomDir);
      fs.mkdirSync(bloomDir, { recursive: true });
    }
    const dbPath = path.join(bloomDir, 'dev.db');
    console.log('[Database] Development mode - using:', dbPath);
    return dbPath;
  } else {
    const bloomDir = path.join(homeDir, '.bloom', 'data');
    if (!fs.existsSync(bloomDir)) {
      console.log('[Database] Creating data directory:', bloomDir);
      fs.mkdirSync(bloomDir, { recursive: true });
    }
    const dbPath = path.join(bloomDir, 'bloom.db');
    console.log('[Database] Production mode - using:', dbPath);
    return dbPath;
  }
}

/**
 * Initialize the database with auto-schema setup (async version).
 *
 * This is the recommended way to initialize the database as it:
 * 1. Detects database state (missing, empty, current, needs_migration, corrupted)
 * 2. Automatically creates schema if needed
 * 3. Safely migrates existing databases
 * 4. Preserves user data
 *
 * @param customPath - Optional custom database path (for testing)
 * @returns PrismaClient instance
 */
export async function initializeDatabaseAsync(
  customPath?: string
): Promise<InstanceType<typeof PrismaClientType>> {
  if (prisma) {
    console.log('[Database] Already initialized');
    return prisma;
  }

  const dbPath = getDatabasePath(customPath);

  // Ensure database is ready with correct schema
  await ensureDatabaseReady(dbPath);

  // Now create Prisma Client
  const PrismaClient = loadPrismaClient();
  const dbUrl = `file:${dbPath}`;

  prisma = new PrismaClient({
    datasources: {
      db: { url: dbUrl },
    },
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

  console.log('[Database] Initialized at:', dbPath);
  return prisma;
}

/**
 * Initialize the database and ensure data directory exists (sync version).
 *
 * NOTE: This is the legacy synchronous version. For new code, prefer
 * initializeDatabaseAsync() which includes auto-schema setup.
 *
 * Creates the database directory if it doesn't exist and initializes
 * the Prisma Client. In production, database is stored at:
 * - macOS: ~/.bloom/data/bloom.db
 * - Linux: ~/.bloom/data/bloom.db
 * - Windows: %USERPROFILE%/.bloom/data/bloom.db
 *
 * @param customPath - Optional custom database path (for testing)
 * @returns PrismaClient instance
 */
export function initializeDatabase(
  customPath?: string
): InstanceType<typeof PrismaClientType> {
  if (prisma) {
    console.log('[Database] Already initialized');
    return prisma;
  }

  // Load Prisma Client constructor
  const PrismaClient = loadPrismaClient();

  // Determine database path
  let dbPath: string;

  if (customPath) {
    // Use custom path (for testing)
    dbPath = customPath;
    console.log('[Database] Using custom path:', dbPath);
  } else if (process.env.BLOOM_DATABASE_URL) {
    // Use environment variable if set (takes precedence over NODE_ENV logic)
    const envUrl = process.env.BLOOM_DATABASE_URL;

    // Check for relative path format: file:./path or file:../path
    // This is a common developer-friendly format but file:// URLs only support absolute paths
    const relativeMatch = envUrl.match(/^file:(\.\.?\/.*)$/);
    if (relativeMatch) {
      const relativePath = relativeMatch[1]; // "./prisma/dev.db"
      dbPath = path.resolve(app.getAppPath(), relativePath);
      console.log(
        '[Database] Using BLOOM_DATABASE_URL (relative):',
        relativePath,
        '->',
        dbPath
      );
    } else {
      // Properly parse file:// URLs to handle Windows paths and URL encoding
      try {
        const url = new URL(envUrl);
        if (url.protocol !== 'file:') {
          throw new Error(
            `BLOOM_DATABASE_URL must use file: protocol, got: ${url.protocol}`
          );
        }
        // URL.pathname is already decoded (handles %20 → space, etc.)
        dbPath = decodeURIComponent(url.pathname);
        // On Windows, file: URLs produce paths like "/C:/path" - remove leading slash
        if (
          process.platform === 'win32' &&
          dbPath.startsWith('/') &&
          dbPath[2] === ':'
        ) {
          dbPath = dbPath.slice(1); // "/C:/path" → "C:/path"
        }
        console.log('[Database] Using BLOOM_DATABASE_URL:', dbPath);
      } catch (error) {
        // Fallback for legacy format without proper file:// URL
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn(
          '[Database] Failed to parse BLOOM_DATABASE_URL as URL (error: %s), falling back to legacy format',
          errorMsg
        );

        // Defensive check: ensure env var exists before using
        if (!process.env.BLOOM_DATABASE_URL) {
          throw new Error('BLOOM_DATABASE_URL environment variable is not set');
        }

        dbPath = process.env.BLOOM_DATABASE_URL.replace(/^file:\/?\/?/, '');
        console.log(
          '[Database] Using BLOOM_DATABASE_URL (legacy format):',
          dbPath
        );
      }
    }
  } else {
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
      // Development: use dev.db in ~/.bloom/ (not in project directory)
      // This keeps development data separate from production and out of the project
      const homeDir = app.getPath('home');
      const bloomDir = path.join(homeDir, '.bloom');

      // Ensure ~/.bloom directory exists
      if (!fs.existsSync(bloomDir)) {
        console.log('[Database] Creating ~/.bloom directory:', bloomDir);
        fs.mkdirSync(bloomDir, { recursive: true });
      }

      dbPath = path.join(bloomDir, 'dev.db');
      console.log('[Database] Development mode - using:', dbPath);
    } else {
      // Production: use ~/.bloom/data/bloom.db (unchanged)
      const homeDir = app.getPath('home');
      const bloomDir = path.join(homeDir, '.bloom', 'data');

      // Create directory if it doesn't exist
      if (!fs.existsSync(bloomDir)) {
        console.log('[Database] Creating data directory:', bloomDir);
        fs.mkdirSync(bloomDir, { recursive: true });
      }

      dbPath = path.join(bloomDir, 'bloom.db');
      console.log('[Database] Production mode - using:', dbPath);
    }
  }

  // Create Prisma Client with database path
  const dbUrl = `file:${dbPath}`;

  prisma = new PrismaClient({
    datasources: {
      db: { url: dbUrl },
    },
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

  console.log('[Database] Initialized at:', dbPath);

  return prisma;
}

/**
 * Get the current database instance.
 *
 * @throws Error if database has not been initialized
 * @returns PrismaClient instance
 */
export function getDatabase(): InstanceType<typeof PrismaClientType> {
  if (!prisma) {
    throw new Error(
      'Database not initialized. Call initializeDatabase() first.'
    );
  }
  return prisma;
}

/**
 * Close the database connection gracefully.
 *
 * Should be called when the application is shutting down.
 */
export async function closeDatabase(): Promise<void> {
  if (prisma) {
    console.log('[Database] Closing connection...');
    await prisma.$disconnect();
    prisma = null;
    console.log('[Database] Connection closed');
  }
}

/**
 * Check if database is initialized and connected.
 *
 * @returns true if database is ready, false otherwise
 */
export function isDatabaseReady(): boolean {
  return prisma !== null;
}

// ============================================
// Database Auto-Initialization
// ============================================

/**
 * Database state types for auto-initialization
 */
export type DatabaseState =
  | 'missing'
  | 'empty'
  | 'current'
  | 'needs_migration'
  | 'corrupted';

/**
 * Result of schema validation
 */
export interface ValidationResult {
  valid: boolean;
  missingTables: string[];
  errors: string[];
}

/**
 * Expected tables from Prisma schema
 */
const EXPECTED_TABLES = [
  'Phenotyper',
  'Scientist',
  'Experiment',
  'Accessions',
  'PlantAccessionMappings',
  'Scan',
  'Image',
];

/**
 * Detect the current state of the database file.
 *
 * @param dbPath - Path to the database file
 * @returns The detected database state
 */
export async function detectDatabaseState(
  dbPath: string
): Promise<DatabaseState> {
  // Check if file exists
  if (!fs.existsSync(dbPath)) {
    console.log('[Database] State: missing - file does not exist');
    return 'missing';
  }

  // Check if file is empty
  const stats = fs.statSync(dbPath);
  if (stats.size === 0) {
    console.log('[Database] State: empty - file exists but is empty');
    return 'empty';
  }

  // Check if file is a valid SQLite database by reading the header
  try {
    const buffer = Buffer.alloc(16);
    const fd = fs.openSync(dbPath, 'r');
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);

    const header = buffer.toString('utf-8');
    if (!header.startsWith('SQLite format 3')) {
      console.log('[Database] State: corrupted - not a valid SQLite file');
      return 'corrupted';
    }
  } catch (error) {
    console.log('[Database] State: corrupted - error reading file:', error);
    return 'corrupted';
  }

  // Check if tables exist using sqlite3 CLI
  try {
    const tables = await queryTablesWithCli(dbPath);

    if (tables.length === 0) {
      console.log('[Database] State: empty - no tables found');
      return 'empty';
    }

    // Check if all expected tables exist
    const missingTables = EXPECTED_TABLES.filter((t) => !tables.includes(t));

    if (missingTables.length > 0) {
      console.log(
        '[Database] State: needs_migration - missing tables:',
        missingTables
      );
      return 'needs_migration';
    }

    console.log('[Database] State: current - all tables present');
    return 'current';
  } catch (error) {
    console.log('[Database] State: corrupted - error querying tables:', error);
    return 'corrupted';
  }
}

/**
 * Query table names using sqlite3 CLI.
 * This avoids needing native module dependencies like better-sqlite3.
 *
 * @param dbPath - Path to the database file
 * @returns Array of table names
 */
async function queryTablesWithCli(dbPath: string): Promise<string[]> {
  const { execSync } = await import('child_process');

  try {
    const result = execSync(
      `sqlite3 "${dbPath}" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%';"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );

    return result
      .trim()
      .split('\n')
      .filter((name) => name.length > 0);
  } catch (error) {
    // If sqlite3 CLI is not available, try to detect tables another way
    console.warn('[Database] sqlite3 CLI not available, falling back');
    throw error;
  }
}

/**
 * Generate ISO timestamp for backup filenames
 */
function generateTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Create a backup of the database file.
 *
 * @param dbPath - Path to the database file
 * @returns Path to the backup file
 */
export async function createDatabaseBackup(dbPath: string): Promise<string> {
  const timestamp = generateTimestamp();
  const backupPath = `${dbPath}.backup.${timestamp}`;

  console.log('[Database] Creating backup:', backupPath);
  fs.copyFileSync(dbPath, backupPath);

  // Verify backup was created
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Failed to create backup at ${backupPath}`);
  }

  console.log('[Database] Backup created successfully');
  return backupPath;
}

/**
 * Restore database from a backup file.
 *
 * @param dbPath - Path to the database file to restore
 * @param backupPath - Path to the backup file
 */
export async function rollbackFromBackup(
  dbPath: string,
  backupPath: string
): Promise<void> {
  console.log('[Database] Rolling back from backup:', backupPath);

  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup file not found: ${backupPath}`);
  }

  fs.copyFileSync(backupPath, dbPath);
  console.log('[Database] Rollback complete');
}

/**
 * Handle a corrupted database file by preserving it and allowing creation of a new one.
 *
 * @param dbPath - Path to the corrupted database file
 * @returns Path to the preserved corrupted file
 */
export async function handleCorruptedDatabase(dbPath: string): Promise<string> {
  const timestamp = generateTimestamp();
  const preservedPath = `${dbPath}.corrupted.${timestamp}`;

  console.log('[Database] Preserving corrupted database:', preservedPath);
  fs.renameSync(dbPath, preservedPath);

  console.log(
    '[Database] Corrupted database preserved. A new database will be created.'
  );
  return preservedPath;
}

/**
 * Validate that the database schema matches expected structure.
 *
 * @param dbPath - Path to the database file
 * @returns Validation result with details
 */
export async function validateSchema(dbPath: string): Promise<ValidationResult> {
  const result: ValidationResult = {
    valid: true,
    missingTables: [],
    errors: [],
  };

  if (!fs.existsSync(dbPath)) {
    result.valid = false;
    result.errors.push('Database file does not exist');
    result.missingTables = [...EXPECTED_TABLES];
    return result;
  }

  try {
    const tableNames = await queryTablesWithCli(dbPath);

    for (const expectedTable of EXPECTED_TABLES) {
      if (!tableNames.includes(expectedTable)) {
        result.missingTables.push(expectedTable);
      }
    }

    if (result.missingTables.length > 0) {
      result.valid = false;
    }
  } catch (error) {
    result.valid = false;
    result.errors.push(
      `Error reading database: ${error instanceof Error ? error.message : String(error)}`
    );
    result.missingTables = [...EXPECTED_TABLES];
  }

  return result;
}

/**
 * Apply database schema using Prisma.
 *
 * This creates all tables defined in the Prisma schema.
 * Uses prisma db push internally via child_process.
 *
 * @param dbPath - Path to the database file
 */
async function applySchema(dbPath: string): Promise<void> {
  console.log('[Database] Applying schema to:', dbPath);

  const { execSync } = await import('child_process');

  // Use prisma db push to apply schema
  // This is safe for SQLite and handles fresh databases
  try {
    const env = {
      ...process.env,
      BLOOM_DATABASE_URL: `file:${dbPath}`,
    };

    // Determine working directory - use app.getAppPath() in Electron,
    // or process.cwd() in test/non-Electron environments
    let cwd: string;
    try {
      cwd = app.getAppPath();
    } catch {
      // Not in Electron context (e.g., unit tests)
      cwd = process.cwd();
    }

    execSync('npx prisma db push --skip-generate --accept-data-loss', {
      env,
      cwd,
      stdio: 'pipe',
    });

    console.log('[Database] Schema applied successfully');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[Database] Failed to apply schema:', errorMsg);
    throw new Error(`Failed to apply database schema: ${errorMsg}`);
  }
}

/**
 * Initialize database schema based on detected state.
 *
 * @param dbPath - Path to the database file
 * @param state - The detected database state
 */
export async function initializeDatabaseSchema(
  dbPath: string,
  state: DatabaseState
): Promise<void> {
  console.log(`[Database] Initializing schema for state: ${state}`);

  switch (state) {
    case 'missing': {
      // Create directory if needed
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Apply schema (this will create the file)
      await applySchema(dbPath);
      console.log('[Database] Created and initialized new database');
      break;
    }

    case 'empty':
      await applySchema(dbPath);
      console.log('[Database] Schema applied to empty database');
      break;

    case 'current':
      console.log('[Database] Schema is current, no action needed');
      break;

    case 'needs_migration': {
      // Create backup before migration
      const backupPath = await createDatabaseBackup(dbPath);

      try {
        await applySchema(dbPath);
        console.log('[Database] Migration applied successfully');
      } catch (error) {
        // Rollback on failure
        console.error('[Database] Migration failed, rolling back...');
        await rollbackFromBackup(dbPath, backupPath);
        throw error;
      }
      break;
    }

    case 'corrupted': {
      // Preserve corrupted file and create new database
      await handleCorruptedDatabase(dbPath);
      await applySchema(dbPath);
      console.log('[Database] New database created after handling corrupted file');
      break;
    }
  }
}

/**
 * Ensure the database is ready for use.
 *
 * This is the main entry point for database auto-initialization.
 * It detects the current state and takes appropriate action to ensure
 * the database is ready with the correct schema.
 *
 * @param dbPath - Path to the database file
 */
export async function ensureDatabaseReady(dbPath: string): Promise<void> {
  console.log('[Database] Ensuring database is ready at:', dbPath);

  const startTime = Date.now();

  try {
    // Detect current state
    const state = await detectDatabaseState(dbPath);

    // Initialize based on state
    await initializeDatabaseSchema(dbPath, state);

    // Validate schema after initialization
    const validation = await validateSchema(dbPath);
    if (!validation.valid) {
      console.error(
        '[Database] Schema validation failed after initialization:',
        validation
      );
      throw new Error(
        `Database schema validation failed: missing tables: ${validation.missingTables.join(', ')}`
      );
    }

    const elapsed = Date.now() - startTime;
    console.log(`[Database] Ready in ${elapsed}ms`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[Database] Failed to ensure database ready:', errorMsg);
    throw error;
  }
}
