/**
 * Vitest setup file
 * This file runs before all tests
 */

import '@testing-library/jest-dom';
import { vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock canvas getContext — happy-dom returns null for getContext('2d')
// Guard: only apply in happy-dom environment (not node environment used by some test files)
const mockDrawImage = vi.fn();
const mockClearRect = vi.fn();
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    drawImage: mockDrawImage,
    clearRect: mockClearRect,
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

// Mock createImageBitmap — happy-dom does not support it
// Guard: only apply in happy-dom environment
const mockBitmapClose = vi.fn();
if (typeof globalThis.window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).createImageBitmap = vi
    .fn()
    .mockResolvedValue({ close: mockBitmapClose, width: 2048, height: 1080 });
}

// Export for tests that need to assert on canvas/bitmap operations
export { mockDrawImage, mockClearRect, mockBitmapClose };

// Mock window.electron API for all tests
const mockPythonAPI = {
  sendCommand: vi.fn().mockResolvedValue({ success: true }),
  getVersion: vi.fn().mockResolvedValue({ version: '1.0.0' }),
  checkHardware: vi.fn().mockResolvedValue({ camera: false, daq: false }),
  restart: vi.fn().mockResolvedValue({ success: true }),
  onStatus: vi.fn(),
  onError: vi.fn(),
};

// Basic mock for database API - individual tests can override
const mockDatabaseAPI = {
  scientists: {
    list: vi.fn().mockResolvedValue({ success: true, data: [] }),
    create: vi.fn().mockResolvedValue({ success: true, data: {} }),
  },
  phenotypers: {
    list: vi.fn().mockResolvedValue({ success: true, data: [] }),
    create: vi.fn().mockResolvedValue({ success: true, data: {} }),
  },
  accessions: {
    list: vi.fn().mockResolvedValue({ success: true, data: [] }),
    create: vi.fn().mockResolvedValue({ success: true, data: {} }),
    createWithMappings: vi
      .fn()
      .mockResolvedValue({ success: true, data: { mappingCount: 0 } }),
    getMappings: vi.fn().mockResolvedValue({ success: true, data: [] }),
    update: vi.fn().mockResolvedValue({ success: true, data: {} }),
    delete: vi.fn().mockResolvedValue({ success: true, data: {} }),
  },
};

// FIX: Don't spread global.window - just add properties to preserve happy-dom's DOM constructors
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if ((global as any).window) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).window.electron = {
    python: mockPythonAPI,
    database: mockDatabaseAPI,
    config: {
      getMode: vi.fn().mockResolvedValue({ mode: 'cylinderscan' }),
    },
  };
}
