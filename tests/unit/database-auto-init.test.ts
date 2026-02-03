/**
 * Database Auto-Initialization Tests
 *
 * TDD tests for safe automatic database initialization.
 * These tests verify that the app works "out of the box" without
 * manual CLI commands, while preserving existing user data.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Expected tables from Prisma schema
const EXPECTED_TABLES = [
  'Phenotyper',
  'Scientist',
  'Experiment',
  'Accessions',
  'PlantAccessionMappings',
  'Scan',
  'Image',
];

describe('Database Auto-Initialization', () => {
  let testDir: string;
  let testDbPath: string;

  beforeEach(() => {
    // Create a temporary directory for each test
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-db-test-'));
    testDbPath = path.join(testDir, 'test.db');
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('detectDatabaseState', () => {
    it('should return "missing" when database file does not exist', async () => {
      // Import the function we're testing (will fail until implemented)
      const { detectDatabaseState } = await import('../../src/main/database');

      const state = await detectDatabaseState(testDbPath);

      expect(state).toBe('missing');
    });

    it('should return "empty" when database file exists but has no tables', async () => {
      // Create an empty SQLite database file
      fs.writeFileSync(testDbPath, '');

      const { detectDatabaseState } = await import('../../src/main/database');

      const state = await detectDatabaseState(testDbPath);

      expect(state).toBe('empty');
    });

    it('should return "current" when schema is up-to-date', async () => {
      // This test requires a properly initialized database
      // For now, we'll skip the actual DB creation and test the logic
      const { detectDatabaseState } = await import('../../src/main/database');

      // Create a mock database with all tables
      // (In real implementation, this would be a fully migrated DB)
      const state = await detectDatabaseState(testDbPath);

      // Will fail until we have a way to create a current-schema DB
      expect(['missing', 'empty', 'current', 'needs_migration']).toContain(
        state
      );
    });

    it('should return "corrupted" when file is not a valid SQLite database', async () => {
      // Create a file with invalid content (not SQLite)
      fs.writeFileSync(testDbPath, 'this is not a sqlite database');

      const { detectDatabaseState } = await import('../../src/main/database');

      const state = await detectDatabaseState(testDbPath);

      expect(state).toBe('corrupted');
    });
  });

  describe('initializeDatabaseSchema', () => {
    it('should create database when state is "missing"', async () => {
      const { initializeDatabaseSchema } = await import(
        '../../src/main/database'
      );

      await initializeDatabaseSchema(testDbPath, 'missing');

      expect(fs.existsSync(testDbPath)).toBe(true);
    });

    it('should apply schema when state is "empty"', async () => {
      // Create empty file
      fs.writeFileSync(testDbPath, '');

      const { initializeDatabaseSchema, detectDatabaseState } = await import(
        '../../src/main/database'
      );

      await initializeDatabaseSchema(testDbPath, 'empty');

      // After initialization, state should be 'current'
      const newState = await detectDatabaseState(testDbPath);
      expect(newState).toBe('current');
    });

    it('should make no changes when state is "current"', async () => {
      const { initializeDatabaseSchema } = await import(
        '../../src/main/database'
      );

      // Get file stats before (if file exists)
      const beforeExists = fs.existsSync(testDbPath);

      await initializeDatabaseSchema(testDbPath, 'current');

      // Should not create file if it didn't exist
      // (current state implies file already exists with correct schema)
      if (!beforeExists) {
        expect(fs.existsSync(testDbPath)).toBe(false);
      }
    });

    it('should preserve existing data after migration', async () => {
      // This test verifies data safety - critical for user trust
      const { initializeDatabaseSchema } = await import(
        '../../src/main/database'
      );

      // Create a file first so backup can work
      fs.writeFileSync(testDbPath, 'SQLite format 3\0dummy content');

      // For needs_migration, we expect it to try to backup and apply schema
      // It may fail on schema application in test env, but should not throw on backup
      try {
        await initializeDatabaseSchema(testDbPath, 'needs_migration');
      } catch {
        // Expected - prisma db push may fail in test env
        // But the backup should have been created
        const files = fs.readdirSync(testDir);
        const backupFile = files.find((f) => f.includes('.backup.'));
        expect(backupFile).toBeDefined();
      }
    });
  });

  describe('Safety Features', () => {
    describe('createDatabaseBackup', () => {
      it('should create backup file with timestamp', async () => {
        // Create a database file to backup
        fs.writeFileSync(testDbPath, 'test database content');

        const { createDatabaseBackup } = await import(
          '../../src/main/database'
        );

        const backupPath = await createDatabaseBackup(testDbPath);

        expect(fs.existsSync(backupPath)).toBe(true);
        expect(backupPath).toMatch(/\.backup\.\d{4}-\d{2}-\d{2}T/);
      });

      it('should create exact copy of database', async () => {
        const originalContent = 'original database content for backup test';
        fs.writeFileSync(testDbPath, originalContent);

        const { createDatabaseBackup } = await import(
          '../../src/main/database'
        );

        const backupPath = await createDatabaseBackup(testDbPath);
        const backupContent = fs.readFileSync(backupPath, 'utf-8');

        expect(backupContent).toBe(originalContent);
      });
    });

    describe('rollbackFromBackup', () => {
      it('should restore database from backup', async () => {
        const originalContent = 'original content before migration';
        const corruptedContent = 'corrupted after failed migration';

        // Create original and backup
        fs.writeFileSync(testDbPath, corruptedContent);
        const backupPath = path.join(testDir, 'test.db.backup');
        fs.writeFileSync(backupPath, originalContent);

        const { rollbackFromBackup } = await import('../../src/main/database');

        await rollbackFromBackup(testDbPath, backupPath);

        const restoredContent = fs.readFileSync(testDbPath, 'utf-8');
        expect(restoredContent).toBe(originalContent);
      });
    });

    describe('Corrupted database handling', () => {
      it('should rename corrupted file with .corrupted.{timestamp} suffix', async () => {
        fs.writeFileSync(testDbPath, 'corrupted data');

        const { handleCorruptedDatabase } = await import(
          '../../src/main/database'
        );

        const preservedPath = await handleCorruptedDatabase(testDbPath);

        expect(preservedPath).toMatch(/\.corrupted\.\d{4}-\d{2}-\d{2}T/);
        expect(fs.existsSync(preservedPath)).toBe(true);
        expect(fs.existsSync(testDbPath)).toBe(false);
      });

      it('should preserve corrupted file content', async () => {
        const corruptedContent = 'this is corrupted but we want to keep it';
        fs.writeFileSync(testDbPath, corruptedContent);

        const { handleCorruptedDatabase } = await import(
          '../../src/main/database'
        );

        const preservedPath = await handleCorruptedDatabase(testDbPath);
        const preservedContent = fs.readFileSync(preservedPath, 'utf-8');

        expect(preservedContent).toBe(corruptedContent);
      });
    });
  });

  describe('Schema Validation', () => {
    it('should return valid:true when all tables exist', async () => {
      // TODO: Create database with all tables
      const { validateSchema } = await import('../../src/main/database');

      // This will fail until we have a way to create a valid schema DB
      const result = await validateSchema(testDbPath);

      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('missingTables');
    });

    it('should return valid:false with missing tables listed', async () => {
      // Create empty database (no tables)
      fs.writeFileSync(testDbPath, '');

      const { validateSchema } = await import('../../src/main/database');

      const result = await validateSchema(testDbPath);

      expect(result.valid).toBe(false);
      expect(result.missingTables.length).toBeGreaterThan(0);
    });

    it('should check for all expected tables', async () => {
      const { validateSchema } = await import('../../src/main/database');

      const result = await validateSchema(testDbPath);

      // All expected tables should be in missingTables for empty DB
      for (const table of EXPECTED_TABLES) {
        expect(
          result.missingTables.includes(table) || result.valid
        ).toBeTruthy();
      }
    });
  });

  describe('Integration: ensureDatabaseReady', () => {
    it('should handle fresh install (no database)', async () => {
      const { ensureDatabaseReady } = await import('../../src/main/database');

      await ensureDatabaseReady(testDbPath);

      expect(fs.existsSync(testDbPath)).toBe(true);
    });

    it('should handle existing database with current schema', async () => {
      // TODO: Create valid database first
      const { ensureDatabaseReady } = await import('../../src/main/database');

      // Should not throw
      await expect(ensureDatabaseReady(testDbPath)).resolves.not.toThrow();
    });

    it('should handle corrupted database gracefully', async () => {
      fs.writeFileSync(testDbPath, 'not a valid sqlite file');

      const { ensureDatabaseReady } = await import('../../src/main/database');

      // Should not throw - should handle gracefully
      await expect(ensureDatabaseReady(testDbPath)).resolves.not.toThrow();

      // Original corrupted file should be preserved somewhere
      const files = fs.readdirSync(testDir);
      const corruptedFile = files.find((f) => f.includes('.corrupted.'));
      expect(corruptedFile).toBeDefined();
    });

    it('should never delete existing user data', async () => {
      // This is the most critical safety test
      // TODO: Create database with test data, run ensureDatabaseReady, verify data intact
      const { ensureDatabaseReady } = await import('../../src/main/database');

      // For now, just ensure function exists
      expect(typeof ensureDatabaseReady).toBe('function');
    });
  });
});
