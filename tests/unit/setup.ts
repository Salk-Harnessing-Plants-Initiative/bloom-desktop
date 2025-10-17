/**
 * Vitest setup file
 * This file runs before all tests
 */

import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock window.electron API for all tests
const mockPythonAPI = {
  sendCommand: vi.fn().mockResolvedValue({ success: true }),
  getVersion: vi.fn().mockResolvedValue({ version: '1.0.0' }),
  checkHardware: vi.fn().mockResolvedValue({ camera: false, daq: false }),
  restart: vi.fn().mockResolvedValue({ success: true }),
  onStatus: vi.fn(),
  onError: vi.fn(),
};

(global as any).window = {
  ...(global as any).window,
  electron: {
    python: mockPythonAPI,
  },
};
