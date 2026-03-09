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
 * Run pending migrations on the database.
 *
 * Reads migration SQL files from the bundled migrations directory and
 * executes any that haven't been applied yet. Uses a _prisma_migrations
 * table to track which migrations have run (matching Prisma's own format).
 *
 * This is needed because the packaged app doesn't include the Prisma CLI
 * or migration engine — only the query engine for runtime queries.
 */
async function runMigrations(
  client: InstanceType<typeof PrismaClientType>
): Promise<void> {
  // Find migrations directory
  const migrationsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'migrations')
    : path.join(app.getAppPath(), 'prisma', 'migrations');

  if (!fs.existsSync(migrationsDir)) {
    console.log('[Database] No migrations directory found at:', migrationsDir);
    return;
  }

  // Ensure _prisma_migrations table exists
  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "checksum" TEXT NOT NULL,
      "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL UNIQUE,
      "logs" TEXT,
      "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Get already-applied migrations
  const applied: Array<{ migration_name: string }> = await client.$queryRawUnsafe(
    'SELECT migration_name FROM "_prisma_migrations" WHERE rolled_back_at IS NULL'
  );
  const appliedSet = new Set(applied.map((m) => m.migration_name));

  // Read migration directories (sorted alphabetically = chronological order)
  const entries = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  let migrationsRun = 0;

  for (const entry of entries) {
    if (appliedSet.has(entry.name)) continue;

    const sqlPath = path.join(migrationsDir, entry.name, 'migration.sql');
    if (!fs.existsSync(sqlPath)) continue;

    const sql = fs.readFileSync(sqlPath, 'utf-8');
    console.log(`[Database] Applying migration: ${entry.name}`);

    try {
      // Split on semicolons, strip SQL comments, and execute each statement
      const statements = sql
        .split(';')
        .map((s) =>
          s
            .split('\n')
            .filter((line) => !line.trimStart().startsWith('--'))
            .join('\n')
            .trim()
        )
        .filter((s) => s.length > 0);

      for (const stmt of statements) {
        await client.$executeRawUnsafe(stmt);
      }

      // Record migration as applied
      const { randomUUID } = require('crypto');
      const id = randomUUID();
      await client.$executeRawUnsafe(
        `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count)
         VALUES (?, ?, datetime('now'), ?, 1)`,
        id,
        'bundled',
        entry.name
      );

      migrationsRun++;
      console.log(`[Database] Applied migration: ${entry.name}`);
    } catch (error) {
      console.error(`[Database] Migration ${entry.name} failed:`, error);
      throw error;
    }
  }

  if (migrationsRun > 0) {
    console.log(`[Database] Applied ${migrationsRun} migration(s)`);
  } else {
    console.log('[Database] All migrations already applied');
  }
}

/**
 * Initialize the database and ensure data directory exists.
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
export async function initializeDatabase(
  customPath?: string
): Promise<InstanceType<typeof PrismaClientType>> {
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
      const relativePath = relativeMatch[1]; // "./dev.db"
      // Prisma CLI resolves relative paths from the schema directory (prisma/),
      // so we must do the same to ensure both use the same database file
      const prismaDir = path.resolve(app.getAppPath(), 'prisma');
      dbPath = path.resolve(prismaDir, relativePath);
      console.log(
        '[Database] Using BLOOM_DATABASE_URL (relative to prisma/):',
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

  // Run pending migrations (creates tables on fresh install)
  await runMigrations(prisma);

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
