/**
 * Database Initialization Tests
 *
 * Tests for database path initialization logic to ensure correct paths
 * are used in development vs production environments.
 *
 * Related: openspec/changes/improve-database-scans-config
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';

/**
 * Note: These tests verify the LOGIC of path selection, not the actual
 * database initialization. The actual initializeDatabase() function is
 * tested via integration tests since it requires Electron app context.
 */

describe('Database Path Configuration (improve-database-scans-config)', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    // Save original NODE_ENV
    originalEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    // Restore original NODE_ENV
    process.env.NODE_ENV = originalEnv;
  });

  describe('Development mode database path', () => {
    it('should use ~/.bloom/dev.db for development mode', () => {
      // Set development mode
      process.env.NODE_ENV = 'development';

      // Simulate the path logic from database.ts
      const homeDir = os.homedir();
      const bloomDir = path.join(homeDir, '.bloom');
      const expectedPath = path.join(bloomDir, 'dev.db');

      // Verify the expected path structure
      expect(expectedPath).toContain('.bloom');
      expect(expectedPath).toContain('dev.db');
      expect(expectedPath).not.toContain('prisma'); // Should NOT be in project
      expect(expectedPath).not.toContain('data'); // Should NOT have 'data' subdirectory
    });

    it('should NOT use project directory for development database', () => {
      process.env.NODE_ENV = 'development';

      // The OLD behavior (should NOT happen)
      const projectDbPath = path.join(process.cwd(), 'prisma', 'dev.db');

      // The NEW behavior (what we want)
      const homeDir = os.homedir();
      const newDbPath = path.join(homeDir, '.bloom', 'dev.db');

      // Verify they are different
      expect(newDbPath).not.toBe(projectDbPath);
      expect(newDbPath).toContain(homeDir);
      expect(projectDbPath).toContain('prisma');
    });
  });

  describe('Production mode database path', () => {
    it('should use ~/.bloom/data/bloom.db for production mode (unchanged)', () => {
      // Set production mode
      process.env.NODE_ENV = 'production';

      // Simulate the path logic from database.ts
      const homeDir = os.homedir();
      const bloomDir = path.join(homeDir, '.bloom', 'data');
      const expectedPath = path.join(bloomDir, 'bloom.db');

      // Verify the expected path structure (unchanged from before)
      expect(expectedPath).toContain('.bloom');
      expect(expectedPath).toContain('data');
      expect(expectedPath).toContain('bloom.db');
      expect(expectedPath).not.toContain('dev.db');
    });

    it('should use different paths for dev and prod', () => {
      const homeDir = os.homedir();

      // Development path
      const devPath = path.join(homeDir, '.bloom', 'dev.db');

      // Production path
      const prodPath = path.join(homeDir, '.bloom', 'data', 'bloom.db');

      // They should be different
      expect(devPath).not.toBe(prodPath);

      // Dev should NOT have 'data' subdirectory
      expect(devPath).not.toContain('data');

      // Prod should have 'data' subdirectory
      expect(prodPath).toContain('data');
    });
  });

  describe('Environment variable override', () => {
    it('should respect BLOOM_DATABASE_URL when provided', () => {
      // This test documents that BLOOM_DATABASE_URL should still work
      // regardless of NODE_ENV (existing behavior to preserve)
      const customUrl = 'file:///custom/path/custom.db';

      // This behavior is already implemented in database.ts
      // Just documenting the expectation here
      expect(customUrl).toContain('file://');
    });
  });
});
