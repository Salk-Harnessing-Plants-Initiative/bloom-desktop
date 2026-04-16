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

// Mock GraviScan IPC API — 15 invoke methods + 13 event listeners
const mockGraviAPI = {
  // Scanner operations
  detectScanners: vi.fn().mockResolvedValue({ success: true, data: [] }),
  getConfig: vi.fn().mockResolvedValue({ success: true, data: null }),
  saveConfig: vi.fn().mockResolvedValue({ success: true }),
  saveScannersToDB: vi.fn().mockResolvedValue({ success: true }),
  getPlatformInfo: vi.fn().mockResolvedValue({
    success: true,
    data: { supported: true, backend: 'sane', mock_enabled: true },
  }),
  validateScanners: vi.fn().mockResolvedValue({
    success: true,
    data: { isValidated: true, allScannersAvailable: true },
  }),
  validateConfig: vi
    .fn()
    .mockResolvedValue({ success: true, data: { status: 'valid' } }),
  // Session operations
  startScan: vi.fn().mockResolvedValue({ success: true }),
  getScanStatus: vi
    .fn()
    .mockResolvedValue({ success: true, data: { isActive: false } }),
  markJobRecorded: vi.fn().mockResolvedValue({ success: true }),
  cancelScan: vi.fn().mockResolvedValue({ success: true }),
  // Image operations
  getOutputDir: vi
    .fn()
    .mockResolvedValue({ success: true, data: '/tmp/graviscan' }),
  readScanImage: vi
    .fn()
    .mockResolvedValue({ success: true, data: 'data:image/jpeg;base64,' }),
  uploadAllScans: vi.fn().mockResolvedValue({ success: true }),
  downloadImages: vi.fn().mockResolvedValue({ success: true }),
  // Event listeners (return cleanup functions)
  onScanEvent: vi.fn().mockReturnValue(vi.fn()),
  onGridStart: vi.fn().mockReturnValue(vi.fn()),
  onGridComplete: vi.fn().mockReturnValue(vi.fn()),
  onCycleComplete: vi.fn().mockReturnValue(vi.fn()),
  onIntervalStart: vi.fn().mockReturnValue(vi.fn()),
  onIntervalWaiting: vi.fn().mockReturnValue(vi.fn()),
  onIntervalComplete: vi.fn().mockReturnValue(vi.fn()),
  onOvertime: vi.fn().mockReturnValue(vi.fn()),
  onCancelled: vi.fn().mockReturnValue(vi.fn()),
  onScanError: vi.fn().mockReturnValue(vi.fn()),
  onRenameError: vi.fn().mockReturnValue(vi.fn()),
  onUploadProgress: vi.fn().mockReturnValue(vi.fn()),
  onDownloadProgress: vi.fn().mockReturnValue(vi.fn()),
};

// Mock GraviScan DB read operations + plate assignment CRUD
const mockGraviScansDB = {
  list: vi.fn().mockResolvedValue({ success: true, data: [] }),
  getMaxWaveNumber: vi.fn().mockResolvedValue({ success: true, data: 0 }),
  checkBarcodeUniqueInWave: vi
    .fn()
    .mockResolvedValue({ success: true, data: true }),
};

const mockGraviScanPlateAssignmentsDB = {
  list: vi.fn().mockResolvedValue({ success: true, data: [] }),
  upsert: vi.fn().mockResolvedValue({ success: true, data: {} }),
  upsertMany: vi.fn().mockResolvedValue({ success: true, data: [] }),
};

const mockGraviPlateAccessionsDB = {
  list: vi.fn().mockResolvedValue({ success: true, data: [] }),
};

// FIX: Don't spread global.window - just add properties to preserve happy-dom's DOM constructors
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if ((global as any).window) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).window.electron = {
    python: mockPythonAPI,
    database: {
      ...mockDatabaseAPI,
      graviscans: mockGraviScansDB,
      graviscanPlateAssignments: mockGraviScanPlateAssignmentsDB,
      graviPlateAccessions: mockGraviPlateAccessionsDB,
    },
    config: {
      getMode: vi.fn().mockResolvedValue({ mode: 'cylinderscan' }),
    },
    gravi: mockGraviAPI,
  };
}

// Export GraviScan mocks for tests that need to assert on them
export {
  mockGraviAPI,
  mockGraviScansDB,
  mockGraviScanPlateAssignmentsDB,
  mockGraviPlateAccessionsDB,
};
