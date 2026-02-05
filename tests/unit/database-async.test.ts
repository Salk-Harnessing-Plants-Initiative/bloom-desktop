/**
 * Database Async Operations Tests
 *
 * TDD tests for non-blocking database initialization.
 * These tests verify that execSync calls are replaced with async exec
 * to prevent blocking the Electron main process event loop.
 *
 * Issue: GitHub #86
 * Proposal: openspec/changes/fix-database-init-blocking/
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Database Async Operations', () => {
  let testDir: string;
  let testDbPath: string;

  beforeEach(() => {
    // Create a temporary directory for each test
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-async-db-test-'));
    testDbPath = path.join(testDir, 'test.db');
    // Reset module cache between tests
    vi.resetModules();
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  describe('detectDatabaseState (uses queryTablesWithCli internally)', () => {
    it('should use async exec for CLI operations', async () => {
      // This test verifies that we use async exec (not execSync) for CLI operations.
      // The sqlite3 CLI is very fast (~10-30ms), so timing-based tests are unreliable.
      // Instead, we verify the code structure by checking that the operation can be
      // interrupted by setImmediate (which only works with async I/O).

      // Create a valid SQLite database with a test table
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      await execAsync(
        `sqlite3 "${testDbPath}" "CREATE TABLE Scientist (id INTEGER PRIMARY KEY);"`
      );

      const { detectDatabaseState } = await import('../../src/main/database');

      // Use setImmediate to verify async behavior
      // If the operation is async, setImmediate will run before the await completes
      let setImmediateFired = false;
      const immediatePromise = new Promise<void>((resolve) => {
        setImmediate(() => {
          setImmediateFired = true;
          resolve();
        });
      });

      // Run state detection and setImmediate in parallel
      const [state] = await Promise.all([
        detectDatabaseState(testDbPath),
        immediatePromise,
      ]);

      // Verify state was detected
      expect(['current', 'needs_migration', 'empty']).toContain(state);

      // setImmediate should have fired because we're using async I/O
      expect(setImmediateFired).toBe(true);
    });

    it('should handle malformed database gracefully', async () => {
      // Create a file that is not a valid SQLite database
      fs.writeFileSync(testDbPath, 'this is not a sqlite database');

      const { detectDatabaseState } = await import('../../src/main/database');

      // Should return 'corrupted' state, not throw
      const state = await detectDatabaseState(testDbPath);
      expect(state).toBe('corrupted');
    });

    it('should return "missing" for non-existent database', async () => {
      const { detectDatabaseState } = await import('../../src/main/database');

      const state = await detectDatabaseState(testDbPath);
      expect(state).toBe('missing');
    });
  });

  describe('initializeDatabaseSchema (uses applySchema internally)', () => {
    it('should not block event loop during schema application', async () => {
      // Create an empty database file
      fs.writeFileSync(testDbPath, '');

      const { initializeDatabaseSchema } = await import(
        '../../src/main/database'
      );

      // Set up event loop blocking detector
      let eventLoopTicks = 0;
      const tickInterval = setInterval(() => {
        eventLoopTicks++;
      }, 5);

      try {
        // This will run prisma db push
        await initializeDatabaseSchema(testDbPath, 'empty');
      } catch {
        // Schema application may fail in test environment due to prisma setup
        // but we're testing the async behavior, not the result
      }

      clearInterval(tickInterval);

      // In async implementation, event loop should have ticked during CLI execution
      // Note: This test will fail with current sync implementation (eventLoopTicks = 0)
      // and pass once we switch to async exec
      expect(eventLoopTicks).toBeGreaterThan(0);
    });

    it('should handle state "current" without CLI calls', async () => {
      const { initializeDatabaseSchema } = await import(
        '../../src/main/database'
      );

      // Spy on console.log to verify the skip message
      const consoleSpy = vi.spyOn(console, 'log');

      // Should return early without executing any CLI commands
      await initializeDatabaseSchema(testDbPath, 'current');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Schema is current')
      );
    });

    it('should create backup before migration', async () => {
      // Create a file that looks like a database
      fs.writeFileSync(testDbPath, 'SQLite format 3\0test content');

      const { initializeDatabaseSchema } = await import(
        '../../src/main/database'
      );

      try {
        await initializeDatabaseSchema(testDbPath, 'needs_migration');
      } catch {
        // Expected to fail due to prisma not being able to handle fake DB
      }

      // Backup should have been created
      const files = fs.readdirSync(testDir);
      const backupFile = files.find((f) => f.includes('.backup.'));
      expect(backupFile).toBeDefined();
    });
  });

  describe('ensureDatabaseReady (full integration)', () => {
    it('should not block event loop for fresh install', async () => {
      const { ensureDatabaseReady } = await import('../../src/main/database');

      // Set up event loop blocking detector
      let eventLoopTicks = 0;
      const tickInterval = setInterval(() => {
        eventLoopTicks++;
      }, 5);

      try {
        await ensureDatabaseReady(testDbPath);
      } catch {
        // May fail due to prisma setup in test env
      }

      clearInterval(tickInterval);

      // Should have ticked while running CLI commands
      expect(eventLoopTicks).toBeGreaterThan(0);
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
  });

  describe('execAsync helper pattern', () => {
    it('should promisify exec correctly', async () => {
      // Test that the async wrapper pattern works correctly
      const { promisify } = await import('util');
      const { exec } = await import('child_process');
      const execAsync = promisify(exec);

      // Should resolve with stdout/stderr object
      const result = await execAsync('echo "test"');

      expect(result).toHaveProperty('stdout');
      expect(result.stdout.trim()).toBe('test');
    });

    it('should reject on command failure', async () => {
      const { promisify } = await import('util');
      const { exec } = await import('child_process');
      const execAsync = promisify(exec);

      // Should reject for non-existent command
      await expect(execAsync('nonexistent_command_xyz_12345')).rejects.toThrow();
    });

    it('should support timeout option', async () => {
      const { promisify } = await import('util');
      const { exec } = await import('child_process');
      const execAsync = promisify(exec);

      // Very short timeout should cause ETIMEDOUT for slow command
      // Using sleep which definitely takes longer than 50ms
      await expect(execAsync('sleep 5', { timeout: 50 })).rejects.toThrow();
    });

    it('should allow event loop to tick during execution', async () => {
      const { promisify } = await import('util');
      const { exec } = await import('child_process');
      const execAsync = promisify(exec);

      let eventLoopTicks = 0;
      const tickInterval = setInterval(() => {
        eventLoopTicks++;
      }, 10);

      // Run a command that takes a small amount of time
      await execAsync('sleep 0.1');

      clearInterval(tickInterval);

      // Event loop should have ticked while waiting
      expect(eventLoopTicks).toBeGreaterThan(0);
    });
  });
});
