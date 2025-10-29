/**
 * Database Module
 *
 * Manages Prisma Client initialization and lifecycle for SQLite database.
 * Database is stored at ~/.bloom/data/bloom.db by default.
 */

import { PrismaClient } from '@prisma/client';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

let prisma: PrismaClient | null = null;

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
export function initializeDatabase(customPath?: string): PrismaClient {
  if (prisma) {
    console.log('[Database] Already initialized');
    return prisma;
  }

  // Determine database path
  let dbPath: string;

  if (customPath) {
    // Use custom path (for testing)
    dbPath = customPath;
    console.log('[Database] Using custom path:', dbPath);
  } else {
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
      // Development: use dev.db in project root
      dbPath = path.join(process.cwd(), 'prisma', 'dev.db');
      console.log('[Database] Development mode - using dev.db');
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
export function getDatabase(): PrismaClient {
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
