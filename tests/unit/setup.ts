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
};

// FIX: Don't spread global.window - just add properties to preserve happy-dom's DOM constructors
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if ((global as any).window) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).window.electron = {
    python: mockPythonAPI,
    database: mockDatabaseAPI,
  };
}
