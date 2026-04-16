/**
 * Configurable IPC mock helpers for GraviScan API.
 * Provides factory functions to create mock implementations
 * with customizable return values for each IPC method.
 *
 * Usage:
 *   import { createMockGraviAPI } from '../mocks/gravi-api';
 *   const mockApi = createMockGraviAPI({
 *     detectScanners: vi.fn().mockResolvedValue({
 *       success: true,
 *       data: [createDetectedScanner()],
 *     }),
 *   });
 *   (window.electron.gravi as any) = mockApi;
 */

import { vi } from 'vitest';

// =============================================================================
// GraviScan IPC API mock
// =============================================================================

export interface MockGraviAPIOverrides {
  // Scanner operations
  detectScanners?: ReturnType<typeof vi.fn>;
  getConfig?: ReturnType<typeof vi.fn>;
  saveConfig?: ReturnType<typeof vi.fn>;
  saveScannersToDB?: ReturnType<typeof vi.fn>;
  getPlatformInfo?: ReturnType<typeof vi.fn>;
  validateScanners?: ReturnType<typeof vi.fn>;
  validateConfig?: ReturnType<typeof vi.fn>;
  // Session operations
  startScan?: ReturnType<typeof vi.fn>;
  getScanStatus?: ReturnType<typeof vi.fn>;
  markJobRecorded?: ReturnType<typeof vi.fn>;
  cancelScan?: ReturnType<typeof vi.fn>;
  // Image operations
  getOutputDir?: ReturnType<typeof vi.fn>;
  readScanImage?: ReturnType<typeof vi.fn>;
  uploadAllScans?: ReturnType<typeof vi.fn>;
  downloadImages?: ReturnType<typeof vi.fn>;
  // Event listeners
  onScanEvent?: ReturnType<typeof vi.fn>;
  onGridStart?: ReturnType<typeof vi.fn>;
  onGridComplete?: ReturnType<typeof vi.fn>;
  onCycleComplete?: ReturnType<typeof vi.fn>;
  onIntervalStart?: ReturnType<typeof vi.fn>;
  onIntervalWaiting?: ReturnType<typeof vi.fn>;
  onIntervalComplete?: ReturnType<typeof vi.fn>;
  onOvertime?: ReturnType<typeof vi.fn>;
  onCancelled?: ReturnType<typeof vi.fn>;
  onScanError?: ReturnType<typeof vi.fn>;
  onRenameError?: ReturnType<typeof vi.fn>;
  onUploadProgress?: ReturnType<typeof vi.fn>;
  onDownloadProgress?: ReturnType<typeof vi.fn>;
}

export function createMockGraviAPI(overrides: MockGraviAPIOverrides = {}) {
  return {
    // Scanner operations
    detectScanners:
      overrides.detectScanners ??
      vi.fn().mockResolvedValue({ success: true, data: [] }),
    getConfig:
      overrides.getConfig ??
      vi.fn().mockResolvedValue({ success: true, data: null }),
    saveConfig:
      overrides.saveConfig ??
      vi.fn().mockResolvedValue({ success: true }),
    saveScannersToDB:
      overrides.saveScannersToDB ??
      vi.fn().mockResolvedValue({ success: true }),
    getPlatformInfo:
      overrides.getPlatformInfo ??
      vi
        .fn()
        .mockResolvedValue({
          success: true,
          data: { supported: true, backend: 'sane', mock_enabled: true },
        }),
    validateScanners:
      overrides.validateScanners ??
      vi
        .fn()
        .mockResolvedValue({
          success: true,
          data: { isValidated: true, allScannersAvailable: true },
        }),
    validateConfig:
      overrides.validateConfig ??
      vi
        .fn()
        .mockResolvedValue({ success: true, data: { status: 'valid' } }),
    // Session operations
    startScan:
      overrides.startScan ??
      vi.fn().mockResolvedValue({ success: true }),
    getScanStatus:
      overrides.getScanStatus ??
      vi
        .fn()
        .mockResolvedValue({ success: true, data: { isActive: false } }),
    markJobRecorded:
      overrides.markJobRecorded ??
      vi.fn().mockResolvedValue({ success: true }),
    cancelScan:
      overrides.cancelScan ??
      vi.fn().mockResolvedValue({ success: true }),
    // Image operations
    getOutputDir:
      overrides.getOutputDir ??
      vi
        .fn()
        .mockResolvedValue({ success: true, data: '/tmp/graviscan' }),
    readScanImage:
      overrides.readScanImage ??
      vi
        .fn()
        .mockResolvedValue({
          success: true,
          data: 'data:image/jpeg;base64,',
        }),
    uploadAllScans:
      overrides.uploadAllScans ??
      vi.fn().mockResolvedValue({ success: true }),
    downloadImages:
      overrides.downloadImages ??
      vi.fn().mockResolvedValue({ success: true }),
    // Event listeners (return cleanup functions)
    onScanEvent:
      overrides.onScanEvent ?? vi.fn().mockReturnValue(vi.fn()),
    onGridStart:
      overrides.onGridStart ?? vi.fn().mockReturnValue(vi.fn()),
    onGridComplete:
      overrides.onGridComplete ?? vi.fn().mockReturnValue(vi.fn()),
    onCycleComplete:
      overrides.onCycleComplete ?? vi.fn().mockReturnValue(vi.fn()),
    onIntervalStart:
      overrides.onIntervalStart ?? vi.fn().mockReturnValue(vi.fn()),
    onIntervalWaiting:
      overrides.onIntervalWaiting ?? vi.fn().mockReturnValue(vi.fn()),
    onIntervalComplete:
      overrides.onIntervalComplete ?? vi.fn().mockReturnValue(vi.fn()),
    onOvertime:
      overrides.onOvertime ?? vi.fn().mockReturnValue(vi.fn()),
    onCancelled:
      overrides.onCancelled ?? vi.fn().mockReturnValue(vi.fn()),
    onScanError:
      overrides.onScanError ?? vi.fn().mockReturnValue(vi.fn()),
    onRenameError:
      overrides.onRenameError ?? vi.fn().mockReturnValue(vi.fn()),
    onUploadProgress:
      overrides.onUploadProgress ?? vi.fn().mockReturnValue(vi.fn()),
    onDownloadProgress:
      overrides.onDownloadProgress ?? vi.fn().mockReturnValue(vi.fn()),
  };
}

// =============================================================================
// GraviScan Database API mock
// =============================================================================

export interface MockGraviDBOverrides {
  graviscans?: {
    list?: ReturnType<typeof vi.fn>;
    getMaxWaveNumber?: ReturnType<typeof vi.fn>;
    checkBarcodeUniqueInWave?: ReturnType<typeof vi.fn>;
  };
  graviscanPlateAssignments?: {
    list?: ReturnType<typeof vi.fn>;
    upsert?: ReturnType<typeof vi.fn>;
    upsertMany?: ReturnType<typeof vi.fn>;
  };
  graviPlateAccessions?: {
    list?: ReturnType<typeof vi.fn>;
  };
}

export function createMockGraviDB(overrides: MockGraviDBOverrides = {}) {
  return {
    graviscans: {
      list:
        overrides.graviscans?.list ??
        vi.fn().mockResolvedValue({ success: true, data: [] }),
      getMaxWaveNumber:
        overrides.graviscans?.getMaxWaveNumber ??
        vi.fn().mockResolvedValue({ success: true, data: 0 }),
      checkBarcodeUniqueInWave:
        overrides.graviscans?.checkBarcodeUniqueInWave ??
        vi.fn().mockResolvedValue({ success: true, data: true }),
    },
    graviscanPlateAssignments: {
      list:
        overrides.graviscanPlateAssignments?.list ??
        vi.fn().mockResolvedValue({ success: true, data: [] }),
      upsert:
        overrides.graviscanPlateAssignments?.upsert ??
        vi.fn().mockResolvedValue({ success: true, data: {} }),
      upsertMany:
        overrides.graviscanPlateAssignments?.upsertMany ??
        vi.fn().mockResolvedValue({ success: true, data: [] }),
    },
    graviPlateAccessions: {
      list:
        overrides.graviPlateAccessions?.list ??
        vi.fn().mockResolvedValue({ success: true, data: [] }),
    },
  };
}
