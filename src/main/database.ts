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
    // Properly parse file:// URLs to handle Windows paths and URL encoding
    try {
      const url = new URL(process.env.BLOOM_DATABASE_URL);
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
  } else {
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
      // Development: use dev.db in project root
      // Use app.getAppPath() instead of process.cwd() because webpack runs from .webpack/main
      dbPath = path.join(app.getAppPath(), 'prisma', 'dev.db');
      console.log('[Database] Development mode - using dev.db at:', dbPath);
    } else {
      // Production: use ~/.bloom/data/bloom.db
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
