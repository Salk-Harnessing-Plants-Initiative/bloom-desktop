// eslint-disable-next-line import/no-unresolved
import { defineConfig } from 'vitest/config';
// eslint-disable-next-line import/no-unresolved
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./tests/unit/setup.ts'],
    passWithNoTests: true, // Don't fail when no tests found
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Only include source files in coverage
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'node_modules/',
        'tests/',
        '.webpack/',
        'out/',
        'dist/',
        'coverage/',
        'htmlcov/',
        'scripts/',
        '**/*.config.ts',
        '**/*.config.js',
        '**/*.d.ts',
        'src/main/**', // Exclude main process (hard to unit test with Electron)
        'src/types/**', // Exclude type definition files
      ],
      // Set coverage thresholds (starting lower since we're building up test coverage)
      // Currently 0% because all components use IPC which requires E2E testing
      // Will increase as we add pure components/utilities
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
