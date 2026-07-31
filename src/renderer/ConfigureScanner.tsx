/**
 * Configure Scanner Page (GraviScan)
 *
 * Hardware setup for GraviScan: detect/save scanners, a global
 * resolution + grid-mode config, USB reset, and per-scanner removal.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  GRAVISCAN_RESOLUTIONS,
  isValidResolution,
  type GridMode,
  type ScannerStatusRow,
  type DetectedScanner,
} from '../types/graviscan';

const STATUS_POLL_INTERVAL_MS = 3000;
const DEFAULT_RESOLUTION_DPI = 1200;
const SAVE_SUCCESS_MESSAGE_MS = 3000;

export function ConfigureScanner() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scanners, setScanners] = useState<ScannerStatusRow[]>([]);
  const [scanActive, setScanActive] = useState(false);

  const [resolution, setResolution] = useState<number>(DEFAULT_RESOLUTION_DPI);
  const [gridMode, setGridMode] = useState<GridMode>('2grid');
  const [legacyResolution, setLegacyResolution] = useState<number | null>(null);
  const [resolutionTouched, setResolutionTouched] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [detectError, setDetectError] = useState<string | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [resetUsbError, setResetUsbError] = useState<string | null>(null);
  const [isResettingUsb, setIsResettingUsb] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [envStatus, setEnvStatus] = useState<{
    slackConfigured: boolean;
    libusbRecoveryEnabled: boolean;
  } | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Detect Scanners and Reset All USB Connections both drive the same
  // main-process ScanCoordinator (spawn-on-discovery vs. shutdown/re-init) —
  // running them concurrently races the coordinator's subprocess map (the
  // same bug class fixed for Reset USB alone; see handleResetUsb). This
  // ref provides mutual exclusion between the two AND a reentrancy guard
  // against a rapid double-click on either one, independent of whether the
  // `disabled` prop has committed to the DOM yet.
  const actionLockRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyConfig = useCallback(
    (config: { resolution: number; grid_mode: GridMode } | null) => {
      if (!config) return;
      if (isValidResolution(config.resolution)) {
        setResolution(config.resolution);
        setLegacyResolution(null);
      } else {
        setResolution(DEFAULT_RESOLUTION_DPI);
        setLegacyResolution(config.resolution);
      }
      setResolutionTouched(false);
      setGridMode(config.grid_mode);
    },
    []
  );

  const refreshScannerStatus = useCallback(async () => {
    const result = await window.electron.gravi.getScannerStatus();
    if (result.success) {
      setScanners(result.scanners);
    }
  }, []);

  const refreshScanActive = useCallback(async () => {
    const result = await window.electron.gravi.getScanStatus();
    if (result.success) {
      setScanActive(!!result.data?.isActive);
    }
  }, []);

  /**
   * Fetches live scan status directly (bypassing the `scanActive` state
   * variable, which is only refreshed on mount, by the status-poll effect
   * below, or by a scan-event push — see the `onScanEvent`/`onScanError`
   * effect further down). Used immediately before a destructive action
   * (Reset USB, Remove) so a scan started elsewhere while this page sat
   * idle can't slip through a stale `scanActive === false`.
   */
  const isScanActiveNow = useCallback(async () => {
    const result = await window.electron.gravi.getScanStatus();
    const active = result.success && !!result.data?.isActive;
    setScanActive(active);
    return active;
  }, []);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [statusResult, configResult, scanStatusResult, envResult] =
          await Promise.all([
            window.electron.gravi.getScannerStatus(),
            window.electron.gravi.getConfig(),
            window.electron.gravi.getScanStatus(),
            window.electron.config.getGraviScanEnvStatus(),
          ]);
        if (cancelled) return;

        if (statusResult.success) {
          setScanners(statusResult.scanners);
        }
        if (configResult.success && configResult.data.success) {
          applyConfig(configResult.data.config);
        }
        if (scanStatusResult.success) {
          setScanActive(!!scanStatusResult.data?.isActive);
        }
        setEnvStatus(envResult);
      } catch (err) {
        if (cancelled) return;
        setLoadError(
          `Failed to load scanner configuration: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyConfig]);

  // Poll scanner status (and refresh the scan-active gate alongside it)
  // while any row is `starting`, stop otherwise.
  useEffect(() => {
    const anyStarting = scanners.some((s) => s.status === 'starting');
    if (anyStarting && pollRef.current === null) {
      pollRef.current = setInterval(() => {
        refreshScannerStatus();
        refreshScanActive();
      }, STATUS_POLL_INTERVAL_MS);
    } else if (!anyStarting && pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [scanners, refreshScannerStatus, refreshScanActive]);

  // Invalidate the scan-active gate and scanner-status snapshot the moment
  // any scan event fires, rather than waiting for the row-status poll
  // above (which only runs once a row is already `starting`, so it can't
  // notice a fresh idle→scanning transition on its own).
  useEffect(() => {
    const unsubscribeEvent = window.electron.gravi.onScanEvent(() => {
      refreshScanActive();
      refreshScannerStatus();
    });
    const unsubscribeError = window.electron.gravi.onScanError(() => {
      refreshScanActive();
      refreshScannerStatus();
    });
    return () => {
      unsubscribeEvent();
      unsubscribeError();
    };
  }, [refreshScanActive, refreshScannerStatus]);

  const handleDetect = useCallback(async () => {
    // Reentrancy guard (rapid double-click) AND mutual exclusion against
    // Reset USB — both mutate the same coordinator subprocess map, and
    // the `disabled` prop alone doesn't close the window between two
    // clicks dispatched before React commits the re-render.
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setDetectError(null);
    setIsDetecting(true);
    try {
      const detectResult = await window.electron.gravi.detectScanners();
      if (!mountedRef.current) return;
      if (!detectResult.success || !detectResult.data.success) {
        setDetectError(
          (!detectResult.success
            ? 'Detection failed'
            : detectResult.data.error) || 'Detection failed'
        );
        return;
      }
      const detected: DetectedScanner[] = detectResult.data.scanners;
      if (detected.length === 0) {
        setDetectError('No scanners detected. Check USB connections.');
        return;
      }

      const sorted = [...detected].sort((a, b) =>
        (a.usb_port || '').localeCompare(b.usb_port || '')
      );
      const payload = sorted.map((s, i) => ({
        name: s.name,
        display_name: `Scanner ${i + 1}`,
        vendor_id: s.vendor_id,
        product_id: s.product_id,
        usb_port: s.usb_port,
        usb_bus: s.usb_bus,
        usb_device: s.usb_device,
      }));

      const saveResult = await window.electron.gravi.saveScannersToDB(payload);
      if (!mountedRef.current) return;
      if (!saveResult.success || !saveResult.data.success) {
        setDetectError(
          (!saveResult.success ? 'Save failed' : saveResult.data.error) ||
            'Save failed'
        );
        return;
      }

      await refreshScannerStatus();
    } catch (err) {
      if (mountedRef.current) {
        setDetectError(
          `Detection failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    } finally {
      if (mountedRef.current) setIsDetecting(false);
      actionLockRef.current = false;
    }
  }, [refreshScannerStatus]);

  const handleResetUsb = useCallback(async () => {
    if (actionLockRef.current) return;
    setResetUsbError(null);
    if (scanActive) {
      setResetUsbError('Cannot reset USB while a scan is in progress.');
      return;
    }
    actionLockRef.current = true;
    setIsResettingUsb(true);
    setScanners((prev) => prev.map((s) => ({ ...s, status: 'starting' })));
    try {
      // Re-check live scan status immediately before actually resetting:
      // `scanActive` is only refreshed on mount, by the status-poll
      // effect, or by a scan-event push, so it can be stale if a scan
      // started elsewhere while this page sat idle showing an
      // all-`ready` snapshot. The optimistic "starting" markers above
      // are reverted via refreshScannerStatus() below if this catches it.
      const active = await isScanActiveNow();
      if (!mountedRef.current) return;
      if (active) {
        setResetUsbError('Cannot reset USB while a scan is in progress.');
        await refreshScannerStatus();
        return;
      }

      const result = await window.electron.gravi.resetUsb();
      if (!mountedRef.current) return;
      if (!result.success || !result.data.success) {
        setResetUsbError(
          (!result.success ? 'USB reset failed' : result.data.error) ||
            'USB reset failed'
        );
      }
      // Do NOT re-run the full detect-and-save flow here: resetUsb()
      // already shuts down, re-detects, and re-initializes the
      // coordinator internally. Calling handleDetect() (which itself
      // triggers a second, independent coordinator.addScanner() spawn
      // via saveScannersToDB's IPC handler) races the subprocess
      // resetUsb() just spawned — since that subprocess is typically
      // still `starting` (not yet ready) the instant resetUsb() resolves,
      // handleDetect()'s hasWorker() check sees no ready worker and
      // spawns a SECOND subprocess for the same scanner, orphaning the
      // first mid-init. A single status refresh here, plus this page's
      // own polling effect, is sufficient to reflect resetUsb()'s result
      // as its subprocesses finish coming up.
      await refreshScannerStatus();
      await refreshScanActive();
    } catch (err) {
      if (mountedRef.current) {
        setResetUsbError(
          `USB reset failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    } finally {
      if (mountedRef.current) setIsResettingUsb(false);
      actionLockRef.current = false;
    }
  }, [scanActive, isScanActiveNow, refreshScannerStatus, refreshScanActive]);

  const handleRemove = useCallback(
    async (scannerId: string) => {
      if (scanActive) return;
      setSaveError(null);
      try {
        // Same staleness concern as handleResetUsb: re-check live status
        // rather than trusting the (possibly stale) `scanActive` state.
        const active = await isScanActiveNow();
        if (!mountedRef.current) return;
        if (active) {
          setSaveError('Cannot remove a scanner while a scan is in progress.');
          return;
        }

        const result = await window.electron.gravi.disableScanner(scannerId);
        if (!mountedRef.current) return;
        if (result.ok) {
          setScanners((prev) => prev.filter((s) => s.scannerId !== scannerId));
        } else {
          // Manual cast: this repo's tsconfig doesn't set strictNullChecks,
          // so control-flow narrowing on the `ok` discriminant doesn't apply
          // here (matches register-handlers.ts's own workaround).
          const err = (result as { ok: false; error: string }).error;
          setSaveError(`Failed to remove scanner: ${err}`);
        }
      } catch (err) {
        if (mountedRef.current) {
          setSaveError(
            `Failed to remove scanner: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    },
    [scanActive, isScanActiveNow]
  );

  const handleSaveConfig = useCallback(async () => {
    if (legacyResolution !== null && !resolutionTouched) return;
    setSaveError(null);
    try {
      const result = await window.electron.gravi.saveConfig({
        resolution,
        grid_mode: gridMode,
      });
      if (!mountedRef.current) return;
      if (result.success && result.data.success) {
        setSaveSuccess(true);
        setLegacyResolution(null);
        setTimeout(() => setSaveSuccess(false), SAVE_SUCCESS_MESSAGE_MS);
      } else {
        setSaveError(
          (!result.success ? 'Save failed' : result.data.error) || 'Save failed'
        );
      }
    } catch (err) {
      if (mountedRef.current) {
        setSaveError(
          `Save failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }, [resolution, gridMode, legacyResolution, resolutionTouched]);

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-600">{loadError}</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-600">Loading configuration...</div>
      </div>
    );
  }

  const saveDisabled = legacyResolution !== null && !resolutionTouched;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2 text-gray-800">
        Configure Scanner
      </h1>
      <p className="text-gray-600 mb-8">
        Detect connected GraviScan scanners and configure resolution/grid mode.
      </p>

      {envStatus && (
        <div
          data-testid="graviscan-env-banner"
          className="bg-white rounded-lg shadow p-4 mb-6 flex gap-6 text-sm"
        >
          <span
            title="Sends a Slack message when repeated scan failures suggest a physical USB/scanner jam. Ask your lab lead if this should be turned on."
            className={
              envStatus.slackConfigured ? 'text-green-700' : 'text-amber-700'
            }
          >
            Slack wedge alerts:{' '}
            {envStatus.slackConfigured ? 'configured' : 'not configured'}
          </span>
          <span
            title="Automatically attempts to recover a stuck USB connection without operator action. Ask your lab lead if this should be turned on."
            className={
              envStatus.libusbRecoveryEnabled
                ? 'text-green-700'
                : 'text-amber-700'
            }
          >
            libusb recovery:{' '}
            {envStatus.libusbRecoveryEnabled ? 'enabled' : 'disabled'}
          </span>
        </div>
      )}

      {saveSuccess && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-md mb-4">
          Configuration saved. Note: this build does not yet apply the saved
          resolution/grid mode automatically when a scan is started — it has no
          effect on scans until that wiring lands.
        </div>
      )}
      {saveError && (
        <div className="bg-red-50 border-2 border-red-500 rounded-lg p-4 mb-4 text-red-800">
          {saveError}
        </div>
      )}

      <div className="space-y-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800">Scanners</h2>
            <div className="flex gap-2">
              <button
                onClick={handleDetect}
                disabled={isDetecting || isResettingUsb}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {isDetecting ? 'Detecting...' : 'Detect Scanners'}
              </button>
              <button
                onClick={handleResetUsb}
                disabled={isDetecting || isResettingUsb}
                title="Resets all connected scanners, not just one"
                className="px-4 py-2 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 disabled:opacity-50"
              >
                {isResettingUsb ? 'Resetting...' : 'Reset All USB Connections'}
              </button>
            </div>
          </div>

          {detectError && (
            <p className="text-red-600 text-sm mb-4">{detectError}</p>
          )}
          {resetUsbError && (
            <p className="text-red-600 text-sm mb-4">{resetUsbError}</p>
          )}
          <p className="text-xs text-gray-500 mb-4">
            Reset All USB Connections affects every connected scanner, not a
            single one.
          </p>

          {scanners.length === 0 ? (
            <p className="text-gray-500 text-sm">
              No scanners configured yet. Click Detect Scanners.
            </p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {scanners.map((s) => (
                  <tr key={s.scannerId} className="border-t border-gray-100">
                    <td className="py-2">{s.displayName}</td>
                    <td className="py-2 text-gray-500">{s.usbPort}</td>
                    <td className="py-2 capitalize">{s.status}</td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => handleRemove(s.scannerId)}
                        disabled={scanActive}
                        className="px-3 py-1 text-red-600 border border-red-300 rounded-md hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold mb-4 text-gray-800">
            Resolution &amp; Grid Mode
          </h2>

          {legacyResolution !== null && (
            <p className="text-amber-700 text-sm mb-4">
              Saved resolution ({legacyResolution} dpi) is no longer a supported
              option. Select a new value and Save to update it. If{' '}
              {DEFAULT_RESOLUTION_DPI} dpi (shown below) is the value you want,
              select a different option first, then switch back to{' '}
              {DEFAULT_RESOLUTION_DPI} to confirm it.
            </p>
          )}

          <div className="space-y-4">
            <div>
              <label
                htmlFor="graviscan-resolution"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Resolution
              </label>
              <select
                id="graviscan-resolution"
                value={resolution}
                onChange={(e) => {
                  setResolution(parseInt(e.target.value, 10));
                  setResolutionTouched(true);
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {GRAVISCAN_RESOLUTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r === DEFAULT_RESOLUTION_DPI
                      ? `${r} dpi (production, validated at 140×140 mm)`
                      : `${r} dpi`}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="graviscan-grid-mode"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Grid Mode
              </label>
              <select
                id="graviscan-grid-mode"
                value={gridMode}
                onChange={(e) => setGridMode(e.target.value as GridMode)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="2grid">2-grid</option>
                <option value="4grid">4-grid</option>
              </select>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleSaveConfig}
                disabled={saveDisabled}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
