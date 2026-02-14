#!/usr/bin/env ts-node
/**
 * Reset Database Script
 *
 * Cross-platform script to delete the development database file.
 * Used by `npm run prisma:reset` to reset the database before migrations.
 *
 * This script deletes the dev database at ~/.bloom/dev.db
 */

import * as fs from 'fs';
import * as path from 'path';

// Dev database path matches the path used in src/main/database.ts
const homeDir = process.env.HOME || process.env.USERPROFILE || '';
const devDbPath = path.join(homeDir, '.bloom', 'dev.db');

console.log('=== Database Reset ===\n');
console.log(`Database path: ${devDbPath}`);

if (fs.existsSync(devDbPath)) {
  try {
    fs.unlinkSync(devDbPath);
    console.log('✓ Database deleted');

    // Also delete journal/wal files if they exist
    const journalPath = devDbPath + '-journal';
    const walPath = devDbPath + '-wal';
    const shmPath = devDbPath + '-shm';

    [journalPath, walPath, shmPath].forEach((file) => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        console.log(`✓ Deleted ${path.basename(file)}`);
      }
    });

    console.log('\nDatabase reset complete. Running migrations...\n');
  } catch (error) {
    console.error(`Error deleting database: ${(error as Error).message}`);
    process.exit(1);
  }
} else {
  console.log('Database does not exist, nothing to delete.');
  console.log('\nRunning migrations to create fresh database...\n');
}
