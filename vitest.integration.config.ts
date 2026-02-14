// eslint-disable-next-line import/no-unresolved
import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Vitest configuration for integration tests.
 * Separate from the main config to allow running integration tests independently.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node', // Integration tests don't need DOM
    testTimeout: 30000, // Longer timeout for database operations
    // Only include integration tests
    include: ['**/tests/integration/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/tests/e2e/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
