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
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 50,
        statements: 50,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
