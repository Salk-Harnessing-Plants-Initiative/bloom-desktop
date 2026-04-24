import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
  createDetectedScanner,
  createGraviConfig,
  createGraviScanner,
  createPlatformInfo,
  resetFixtureCounters,
} from '../../fixtures/graviscan';
// Grab the global mock from setup.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gravi = () => (window as any).electron.gravi;

// Re-import after mocks are wired
let useScannerConfig: typeof import('../../../src/renderer/hooks/useScannerConfig').useScannerConfig;

beforeEach(async () => {
  vi.clearAllMocks();
  resetFixtureCounters();
  localStorage.clear();

  // Reset all gravi mocks to sensible defaults
  const g = gravi();
  g.getPlatformInfo.mockResolvedValue({
    success: true,
    supported: true,
    backend: 'sane',
    mock_enabled: false,
  });
  g.getConfig.mockResolvedValue({ success: true, config: null });
  g.validateConfig.mockResolvedValue({
    success: true,
    status: 'no-config',
    matched: [],
    missing: [],
    new: [],
    detectedScanners: [],
  });
  g.detectScanners.mockResolvedValue({ success: true, scanners: [] });
  g.validateScanners.mockResolvedValue({
    isValidated: false,
    detectedScanners: [],
  });
  g.saveConfig.mockResolvedValue({ success: true });
  g.saveScannersToDB.mockResolvedValue({ success: true });
  g.cancelScan.mockResolvedValue({ success: true });

  // Dynamic import to pick up fresh mocks each time
  const mod = await import('../../../src/renderer/hooks/useScannerConfig');
  useScannerConfig = mod.useScannerConfig;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * Helper: render the hook.
 *
 * After fix-scanner-config-save-flow (Task 2.4 BREAKING), `setScannerStates`
 * is removed from the hook's params. This helper calls `useScannerConfig()`
 * with no arguments. Existing tests that assert on `setScannerStates` have
 * been migrated to assert on `scannerAssignments` directly.
 */
function renderScannerConfig() {
  const hook = renderHook(() => useScannerConfig());
  return hook;
}

// =============================================================================
// Platform info loading
// =============================================================================

describe('useScannerConfig', () => {
  describe('platform info loading', () => {
    it('calls getPlatformInfo on mount and populates platformInfo', async () => {
      const platformData = createPlatformInfo({ backend: 'sane' });
      gravi().getPlatformInfo.mockResolvedValue({
        success: true,
        supported: platformData.supported,
        backend: platformData.backend,
        mock_enabled: platformData.mock_enabled,
      });

      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.platformLoading).toBe(false);
      });

      expect(gravi().getPlatformInfo).toHaveBeenCalledOnce();
      expect(result.current.platformInfo).toEqual({
        supported: true,
        backend: 'sane',
        mock_enabled: platformData.mock_enabled,
      });
    });

    it('shows platformLoading true initially', () => {
      gravi().getPlatformInfo.mockReturnValue(new Promise(() => {}));
      gravi().validateConfig.mockReturnValue(new Promise(() => {}));

      const { result } = renderScannerConfig();

      expect(result.current.platformLoading).toBe(true);
    });
  });

  // ===========================================================================
  // Scanner detection with 0 scanners
  // ===========================================================================

  describe('scanner detection with 0 scanners', () => {
    it('sets empty array and shows detection error', async () => {
      gravi().detectScanners.mockResolvedValue({
        success: true,
        scanners: [],
      });

      const { result } = renderScannerConfig();

      // Wait for mount effects to settle
      await waitFor(() => {
        expect(result.current.platformLoading).toBe(false);
      });

      // Trigger detection
      await act(async () => {
        await result.current.handleDetectScanners();
      });

      expect(result.current.detectedScanners).toEqual([]);
      expect(result.current.detectionError).toBe(
        'No scanners detected. Check USB connections.'
      );
      expect(result.current.sessionValidated).toBe(false);
    });
  });

  // ===========================================================================
  // Scanner detection with 1+ scanners
  // ===========================================================================

  describe('scanner detection with 1+ scanners', () => {
    it('populates detected scanners list', async () => {
      const scanner1 = createDetectedScanner({ name: 'Epson V600 #1' });
      const scanner2 = createDetectedScanner({ name: 'Epson V600 #2' });

      gravi().detectScanners.mockResolvedValue({
        success: true,
        scanners: [scanner1, scanner2],
      });

      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.platformLoading).toBe(false);
      });

      await act(async () => {
        await result.current.handleDetectScanners();
      });

      expect(result.current.detectedScanners).toHaveLength(2);
      expect(result.current.detectedScanners[0].name).toBe('Epson V600 #1');
      expect(result.current.detectedScanners[1].name).toBe('Epson V600 #2');
      expect(result.current.detectionError).toBeNull();
      expect(result.current.sessionValidated).toBe(true);
    });

    it('sets detectingScanner while detection is in-flight', async () => {
      let resolveDetect!: (val: unknown) => void;
      gravi().detectScanners.mockReturnValue(
        new Promise((resolve) => {
          resolveDetect = resolve;
        })
      );

      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.platformLoading).toBe(false);
      });

      // Start detection but don't resolve yet
      let detectPromise!: Promise<void>;
      act(() => {
        detectPromise = result.current.handleDetectScanners();
      });

      expect(result.current.detectingScanner).toBe(true);

      // Resolve detection
      await act(async () => {
        resolveDetect({ success: true, scanners: [createDetectedScanner()] });
        await detectPromise;
      });

      expect(result.current.detectingScanner).toBe(false);
    });
  });

  // ===========================================================================
  // Detection error/timeout
  // ===========================================================================

  describe('detection error/timeout', () => {
    it('sets error state when detection fails', async () => {
      gravi().detectScanners.mockResolvedValue({
        success: false,
        error: 'Scanner timeout',
      });

      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.platformLoading).toBe(false);
      });

      await act(async () => {
        await result.current.handleDetectScanners();
      });

      expect(result.current.detectionError).toBe('Scanner timeout');
      expect(result.current.sessionValidated).toBe(false);
    });

    it('sets error state when detection throws', async () => {
      gravi().detectScanners.mockRejectedValue(new Error('USB failure'));

      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.platformLoading).toBe(false);
      });

      await act(async () => {
        await result.current.handleDetectScanners();
      });

      expect(result.current.detectionError).toBe('USB failure');
      expect(result.current.sessionValidated).toBe(false);
    });
  });

  // ===========================================================================
  // Config load from DB
  // ===========================================================================

  describe('config load from DB', () => {
    it('calls getConfig on mount and populates resolution/config', async () => {
      const config = createGraviConfig({
        resolution: 600,
        grid_mode: '4grid',
      });
      gravi().getConfig.mockResolvedValue({ success: true, config });

      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.config).not.toBeNull();
      });

      expect(gravi().getConfig).toHaveBeenCalledOnce();
      expect(result.current.config!.grid_mode).toBe('4grid');
      expect(result.current.resolution).toBe(600);
    });
  });

  // ===========================================================================
  // Config save
  // ===========================================================================

  describe('config save', () => {
    it('auto-saves config when scanner is assigned', async () => {
      const scanner = createDetectedScanner({
        scanner_id: 'scanner-abc',
        usb_port: '1-2',
      });
      gravi().detectScanners.mockResolvedValue({
        success: true,
        scanners: [scanner],
      });
      gravi().saveScannersToDB.mockResolvedValue({
        success: true,
        scanners: [],
      });

      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.platformLoading).toBe(false);
      });

      // Detect scanners first
      await act(async () => {
        await result.current.handleDetectScanners();
      });

      // Assign scanner to slot 0
      act(() => {
        result.current.handleScannerAssignment(0, 'scanner-abc');
      });

      // Wait for the 500ms debounced auto-save to fire
      await waitFor(
        () => {
          expect(gravi().saveConfig).toHaveBeenCalledWith(
            expect.objectContaining({
              grid_mode: '2grid',
              resolution: expect.any(Number),
            })
          );
        },
        { timeout: 2000 }
      );
      expect(gravi().saveScannersToDB).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Validation state transitions
  // ===========================================================================

  describe('validation state transitions', () => {
    it('starts in loading configStatus and transitions to no-config', async () => {
      const { result } = renderScannerConfig();

      // Initially loading
      expect(result.current.configStatus).toBe('loading');

      // After mount effects settle, should be no-config (default mock)
      await waitFor(() => {
        expect(result.current.configStatus).toBe('no-config');
      });
    });

    it('transitions to valid when validateConfig returns valid with matches', async () => {
      const scanner = createDetectedScanner();
      const savedScanner = createGraviScanner({
        id: scanner.scanner_id,
        usb_port: scanner.usb_port,
      });

      gravi().validateConfig.mockResolvedValue({
        success: true,
        status: 'valid',
        matched: [{ saved: savedScanner, detected: scanner }],
        missing: [],
        new: [],
        detectedScanners: [scanner],
      });

      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.configStatus).toBe('valid');
      });

      expect(result.current.sessionValidated).toBe(true);
      expect(result.current.isConfigCollapsed).toBe(true);
    });

    it('transitions to mismatch when scanners do not match', async () => {
      const missingScan = createGraviScanner({ name: 'Missing Scanner' });

      gravi().validateConfig.mockResolvedValue({
        success: true,
        status: 'mismatch',
        matched: [],
        missing: [missingScan],
        new: [],
        detectedScanners: [],
      });

      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.configStatus).toBe('mismatch');
      });

      expect(result.current.missingScanners).toHaveLength(1);
      expect(result.current.configValidationMessage).toContain('Missing');
    });

    it('transitions to error when validateConfig fails', async () => {
      gravi().validateConfig.mockResolvedValue({
        success: false,
        error: 'DB connection lost',
      });

      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.configStatus).toBe('error');
      });

      expect(result.current.configValidationMessage).toBe('DB connection lost');
    });
  });

  // ===========================================================================
  // Re-detect flow
  // ===========================================================================

  describe('re-detect flow', () => {
    it('clears previous errors and re-runs detection', async () => {
      // validateScannerConfig returns 'no-config' on first render, which
      // triggers an auto-detect. Set that call to succeed with no scanners
      // so handleDetectScanners() below can drive the error path.
      gravi().detectScanners.mockResolvedValueOnce({
        success: true,
        scanners: [],
      });

      // Manual detection fails
      gravi().detectScanners.mockResolvedValueOnce({
        success: false,
        error: 'USB failure',
      });

      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.platformLoading).toBe(false);
      });

      await act(async () => {
        await result.current.handleDetectScanners();
      });
      expect(result.current.detectionError).toBe('USB failure');

      // Second detection succeeds
      const scanner = createDetectedScanner();
      gravi().detectScanners.mockResolvedValueOnce({
        success: true,
        scanners: [scanner],
      });

      await act(async () => {
        await result.current.handleDetectScanners();
      });

      expect(result.current.detectionError).toBeNull();
      expect(result.current.detectedScanners).toHaveLength(1);
      expect(result.current.sessionValidated).toBe(true);
    });
  });

  // ===========================================================================
  // Stale scanner indicators
  // ===========================================================================

  describe('stale scanner indicators', () => {
    it('reports missing scanners when saved scanner not in detection results', async () => {
      const savedScanner = createGraviScanner({
        name: 'Unplugged Scanner',
        usb_port: '1-5',
      });

      gravi().validateConfig.mockResolvedValue({
        success: true,
        status: 'mismatch',
        matched: [],
        missing: [savedScanner],
        new: [],
        detectedScanners: [],
      });

      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.configStatus).toBe('mismatch');
      });

      expect(result.current.missingScanners).toHaveLength(1);
      expect(result.current.missingScanners[0].name).toBe('Unplugged Scanner');
    });

    it('reports new scanners that were not in saved config', async () => {
      const newScanner = createDetectedScanner({
        name: 'Brand New Scanner',
        usb_port: '2-1',
      });

      gravi().validateConfig.mockResolvedValue({
        success: true,
        status: 'mismatch',
        matched: [],
        missing: [],
        new: [newScanner],
        detectedScanners: [newScanner],
      });

      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.configStatus).toBe('mismatch');
      });

      expect(result.current.newScanners).toHaveLength(1);
      expect(result.current.newScanners[0].name).toBe('Brand New Scanner');
    });
  });

  // ===========================================================================
  // Reset config handler
  // ===========================================================================

  describe('handleResetScannerConfig', () => {
    it('clears state and localStorage on reset', async () => {
      const scanner = createDetectedScanner();
      gravi().detectScanners.mockResolvedValue({
        success: true,
        scanners: [scanner],
      });

      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.platformLoading).toBe(false);
      });

      // Detect a scanner first
      await act(async () => {
        await result.current.handleDetectScanners();
      });
      expect(result.current.detectedScanners).toHaveLength(1);

      // Reset
      const mockEvent = {
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent;

      await act(async () => {
        await result.current.handleResetScannerConfig(mockEvent);
      });

      expect(result.current.detectedScanners).toEqual([]);
      expect(result.current.sessionValidated).toBe(false);
      expect(result.current.configSaved).toBe(false);
      // After Task 2.4, reset clears scannerAssignments directly instead of
      // calling setScannerStates on the host component.
      expect(result.current.scannerAssignments).toEqual([]);
      expect(mockEvent.stopPropagation).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Scanner slot management
  // ===========================================================================

  describe('scanner slot management', () => {
    it('adds a scanner slot', async () => {
      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.platformLoading).toBe(false);
      });

      const initialLength = result.current.scannerAssignments.length;

      act(() => {
        result.current.handleAddScannerSlot();
      });

      expect(result.current.scannerAssignments.length).toBe(initialLength + 1);
    });

    it('removes a scanner slot', async () => {
      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.platformLoading).toBe(false);
      });

      // Add one so we have 2 (can't remove below 1)
      act(() => {
        result.current.handleAddScannerSlot();
      });
      expect(result.current.scannerAssignments.length).toBe(2);

      act(() => {
        result.current.handleRemoveScannerSlot(1);
      });

      expect(result.current.scannerAssignments.length).toBe(1);
    });

    it('sets grid mode on a slot', async () => {
      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.platformLoading).toBe(false);
      });

      act(() => {
        result.current.handleScannerGridMode(0, '4grid');
      });

      expect(result.current.scannerAssignments[0].gridMode).toBe('4grid');
    });
  });

  // ===========================================================================
  // Config collapse toggle
  // ===========================================================================

  describe('config collapse toggle', () => {
    it('toggles isConfigCollapsed', async () => {
      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.platformLoading).toBe(false);
      });

      const initial = result.current.isConfigCollapsed;

      act(() => {
        result.current.handleToggleConfigCollapse();
      });

      expect(result.current.isConfigCollapsed).toBe(!initial);
    });
  });

  // ===========================================================================
  // Section 1.2: fix-scanner-config-save-flow tests
  // ===========================================================================

  describe('(k) detection populates scannerAssignments', () => {
    it('populates scannerAssignments with N non-null entries on detection', async () => {
      const s1 = createDetectedScanner({ scanner_id: 's1', usb_port: '1-1' });
      const s2 = createDetectedScanner({ scanner_id: 's2', usb_port: '1-2' });
      gravi().detectScanners.mockResolvedValue({
        success: true,
        scanners: [s1, s2],
      });

      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.platformLoading).toBe(false);
      });

      await act(async () => {
        await result.current.handleDetectScanners();
      });

      expect(result.current.scannerAssignments).toHaveLength(2);
      expect(result.current.scannerAssignments[0].scannerId).toBe('s1');
      expect(result.current.scannerAssignments[1].scannerId).toBe('s2');
    });
  });

  describe('(l) auto-save writes non-empty scanner payload on resolution change', () => {
    it('sends N entries on resolution change', async () => {
      const s1 = createDetectedScanner({ scanner_id: 's1', usb_port: '1-1' });
      const s2 = createDetectedScanner({ scanner_id: 's2', usb_port: '1-2' });
      gravi().detectScanners.mockResolvedValue({
        success: true,
        scanners: [s1, s2],
      });
      gravi().saveScannersToDB.mockResolvedValue({
        success: true,
        scanners: [],
      });

      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.platformLoading).toBe(false);
      });

      await act(async () => {
        await result.current.handleDetectScanners();
      });

      // Reset call counts from the initial auto-save after detection
      gravi().saveScannersToDB.mockClear();
      gravi().saveConfig.mockClear();

      // Change resolution
      act(() => {
        result.current.setResolution(600);
      });

      await waitFor(
        () => {
          expect(gravi().saveScannersToDB).toHaveBeenCalled();
        },
        { timeout: 2000 }
      );

      const payload = gravi().saveScannersToDB.mock.calls[0][0];
      expect(payload).toHaveLength(2);
      expect(gravi().saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({ resolution: 600 })
      );
    });
  });

  describe('(m/n/n2) unchecked state persistence', () => {
    it('(m) unchecked state persists across re-detect with same usb_port', async () => {
      const s1 = createDetectedScanner({ scanner_id: 's1', usb_port: '1-1' });
      const s2 = createDetectedScanner({ scanner_id: 's2', usb_port: '1-2' });
      gravi().detectScanners.mockResolvedValue({
        success: true,
        scanners: [s1, s2],
      });

      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.platformLoading).toBe(false);
      });

      await act(async () => {
        await result.current.handleDetectScanners();
      });

      // Uncheck s1
      act(() => {
        result.current.handleScannerAssignment(0, null);
      });
      expect(result.current.scannerAssignments[0].scannerId).toBeNull();

      // Re-detect returns same physical scanners with new DB-issued scanner_ids
      const s1refresh = createDetectedScanner({
        scanner_id: 's1-new',
        usb_port: '1-1',
      });
      const s2refresh = createDetectedScanner({
        scanner_id: 's2-new',
        usb_port: '1-2',
      });
      gravi().detectScanners.mockResolvedValueOnce({
        success: true,
        scanners: [s1refresh, s2refresh],
      });

      await act(async () => {
        await result.current.handleDetectScanners();
      });

      // s1 (first scanner, unchecked by usb_port key) stays null
      expect(result.current.scannerAssignments[0].scannerId).toBeNull();
      // s2 gets the new id
      expect(result.current.scannerAssignments[1].scannerId).toBe('s2-new');
    });

    it('(n) unchecked state persists when usb_device changes but usb_port is stable (#182)', async () => {
      const s1 = createDetectedScanner({
        scanner_id: 's1',
        usb_port: '1-1',
        usb_bus: 1,
        usb_device: 4,
      });
      gravi().detectScanners.mockResolvedValue({
        success: true,
        scanners: [s1],
      });

      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.platformLoading).toBe(false);
      });

      await act(async () => {
        await result.current.handleDetectScanners();
      });

      // Uncheck
      act(() => {
        result.current.handleScannerAssignment(0, null);
      });

      // Re-detect: same usb_port, different usb_device (OS reassignment)
      const s1reconnect = createDetectedScanner({
        scanner_id: 's1-reconn',
        usb_port: '1-1',
        usb_bus: 1,
        usb_device: 8, // Changed!
      });
      gravi().detectScanners.mockResolvedValueOnce({
        success: true,
        scanners: [s1reconnect],
      });

      await act(async () => {
        await result.current.handleDetectScanners();
      });

      expect(result.current.scannerAssignments[0].scannerId).toBeNull();
    });

    it('(n2) unchecked state survives hook remount via localStorage', async () => {
      const s1 = createDetectedScanner({ scanner_id: 's1', usb_port: '1-1' });
      const s2 = createDetectedScanner({ scanner_id: 's2', usb_port: '1-2' });
      gravi().detectScanners.mockResolvedValue({
        success: true,
        scanners: [s1, s2],
      });

      // First mount
      {
        const { result, unmount } = renderScannerConfig();

        await waitFor(() => {
          expect(result.current.platformLoading).toBe(false);
        });

        await act(async () => {
          await result.current.handleDetectScanners();
        });

        // Uncheck s1
        act(() => {
          result.current.handleScannerAssignment(0, null);
        });

        expect(result.current.scannerAssignments[0].scannerId).toBeNull();

        unmount();
      }

      // Second mount — should restore unchecked state from localStorage
      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.platformLoading).toBe(false);
      });

      // Re-detect the same physical scanners with fresh IDs
      const s1refresh = createDetectedScanner({
        scanner_id: 's1-new',
        usb_port: '1-1',
      });
      const s2refresh = createDetectedScanner({
        scanner_id: 's2-new',
        usb_port: '1-2',
      });
      gravi().detectScanners.mockResolvedValueOnce({
        success: true,
        scanners: [s1refresh, s2refresh],
      });

      await act(async () => {
        await result.current.handleDetectScanners();
      });

      expect(result.current.scannerAssignments[0].scannerId).toBeNull();
      expect(result.current.scannerAssignments[1].scannerId).toBe('s2-new');
    });

    it('(n3) two scanners with usb_port="" do not collide (composite fallback distinguishes)', async () => {
      const s1 = createDetectedScanner({
        scanner_id: 's1',
        usb_port: '', // empty — no port info
        usb_bus: 1,
        usb_device: 4,
        vendor_id: '04b8',
        product_id: '013a',
        name: 'Epson V850',
      });
      const s2 = createDetectedScanner({
        scanner_id: 's2',
        usb_port: '', // same empty
        usb_bus: 1,
        usb_device: 5, // DIFFERENT bus+device
        vendor_id: '04b8',
        product_id: '013a',
        name: 'Epson V850', // SAME name (identical model)
      });
      gravi().detectScanners.mockResolvedValue({
        success: true,
        scanners: [s1, s2],
      });

      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.platformLoading).toBe(false);
      });

      await act(async () => {
        await result.current.handleDetectScanners();
      });

      // Uncheck s1 (first one)
      act(() => {
        result.current.handleScannerAssignment(0, null);
      });

      // s2 must still be enabled — composite key distinguishes them
      expect(result.current.scannerAssignments[0].scannerId).toBeNull();
      expect(result.current.scannerAssignments[1].scannerId).toBe('s2');
    });
  });

  describe('(o/o2/o3) auto-save additional behaviors', () => {
    it('(o) auto-save uses the currently-selected grid_mode, not 2grid fallback', async () => {
      const scanner = createDetectedScanner({
        scanner_id: 's1',
        usb_port: '1-1',
      });
      gravi().detectScanners.mockResolvedValue({
        success: true,
        scanners: [scanner],
      });
      gravi().saveScannersToDB.mockResolvedValue({
        success: true,
        scanners: [],
      });

      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.platformLoading).toBe(false);
      });

      await act(async () => {
        await result.current.handleDetectScanners();
      });

      gravi().saveConfig.mockClear();

      // Select 4grid
      act(() => {
        result.current.handleScannerGridMode(0, '4grid');
      });

      await waitFor(
        () => {
          expect(gravi().saveConfig).toHaveBeenCalledWith(
            expect.objectContaining({ grid_mode: '4grid' })
          );
        },
        { timeout: 2000 }
      );
    });

    it('(o2) auto-save calls disableMissingScanners with enabled scanner identities', async () => {
      const s1 = createDetectedScanner({ scanner_id: 's1', usb_port: '1-1' });
      gravi().detectScanners.mockResolvedValue({
        success: true,
        scanners: [s1],
      });
      gravi().saveScannersToDB.mockResolvedValue({
        success: true,
        scanners: [],
      });
      // disableMissingScanners may not exist on the mock yet — set it
      gravi().disableMissingScanners = vi.fn().mockResolvedValue({
        success: true,
        disabled: 0,
      });

      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.platformLoading).toBe(false);
      });

      await act(async () => {
        await result.current.handleDetectScanners();
      });

      await waitFor(
        () => {
          expect(gravi().disableMissingScanners).toHaveBeenCalled();
        },
        { timeout: 2000 }
      );

      const identities =
        gravi().disableMissingScanners.mock.calls.slice(-1)[0][0];
      expect(Array.isArray(identities)).toBe(true);
      expect(identities[0]).toHaveProperty('usb_port');
      expect(identities[0]).toHaveProperty('vendor_id');
      expect(identities[0]).toHaveProperty('product_id');
    });

    it('(o3) checkbox toggle writes to localStorage synchronously in the same event', async () => {
      const s1 = createDetectedScanner({ scanner_id: 's1', usb_port: '1-1' });
      gravi().detectScanners.mockResolvedValue({
        success: true,
        scanners: [s1],
      });

      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.platformLoading).toBe(false);
      });

      await act(async () => {
        await result.current.handleDetectScanners();
      });

      // Confirm detection populated assignments before spying
      expect(result.current.scannerAssignments).toHaveLength(1);
      expect(result.current.scannerAssignments[0].scannerId).toBe('s1');

      const setItemSpy = vi.spyOn(window.localStorage, 'setItem');

      // The synchronous-write spec: setItem must be called DURING the
      // handleScannerAssignment call, not in a later microtask/effect.
      act(() => {
        result.current.handleScannerAssignment(0, null);
      });

      // Verify a setItem call with the uncheckedScannerKeys key occurred
      const uncheckedCall = setItemSpy.mock.calls.find((c) =>
        String(c[0]).includes('uncheckedScannerKeys')
      );
      expect(uncheckedCall).toBeDefined();
      // Also verify the value contains our stable key
      expect(uncheckedCall?.[1]).toContain('1-1');

      setItemSpy.mockRestore();
    });
  });

  describe('(o4) display_name sentinel preserves admin values on re-save', () => {
    it('sends display_name: undefined when admin override exists in DB', async () => {
      const scanner = createDetectedScanner({
        scanner_id: 's1',
        usb_port: '1-1',
        name: 'Epson V850',
      });
      // validateConfig returns a matched row with admin-set display_name
      const savedScanner = createGraviScanner({
        id: 's1',
        name: 'Epson V850',
        display_name: 'Bench 3 Scanner', // admin override
        usb_port: '1-1',
      });
      gravi().validateConfig.mockResolvedValue({
        success: true,
        status: 'valid',
        matched: [{ saved: savedScanner, detected: scanner }],
        missing: [],
        new: [],
        detectedScanners: [scanner],
      });
      gravi().saveScannersToDB.mockResolvedValue({
        success: true,
        scanners: [],
      });

      const { result } = renderScannerConfig();

      await waitFor(() => {
        expect(result.current.configStatus).toBe('valid');
      });

      gravi().saveScannersToDB.mockClear();

      // Trigger auto-save via resolution change
      act(() => {
        result.current.setResolution(600);
      });

      await waitFor(
        () => {
          expect(gravi().saveScannersToDB).toHaveBeenCalled();
        },
        { timeout: 2000 }
      );

      const payload = gravi().saveScannersToDB.mock.calls.slice(-1)[0][0];
      expect(payload).toHaveLength(1);
      // Sentinel: display_name is undefined when admin override exists
      // so the main-process upsert's `?? existing.display_name` fallback preserves "Bench 3 Scanner"
      expect(payload[0].display_name).toBeUndefined();
    });
  });
});
