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
} from '../types/graviscan';

const STATUS_POLL_INTERVAL_MS = 3000;

interface ScannerRow {
  scannerId: string;
  displayName: string;
  usbPort: string | null;
  gridMode: string;
  status: 'ready' | 'starting' | 'error' | 'dead' | 'disconnected';
  error?: string;
}

export function ConfigureScanner() {
  const [loading, setLoading] = useState(true);
  const [scanners, setScanners] = useState<ScannerRow[]>([]);
  const [scanActive, setScanActive] = useState(false);

  const [resolution, setResolution] = useState<number>(1200);
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

  const applyConfig = useCallback(
    (config: { resolution: number; grid_mode: GridMode } | null) => {
      if (!config) return;
      if (isValidResolution(config.resolution)) {
        setResolution(config.resolution);
        setLegacyResolution(null);
      } else {
        setResolution(1200);
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
      setScanners(result.scanners as ScannerRow[]);
    }
  }, []);

  const refreshScanActive = useCallback(async () => {
    const result = await window.electron.gravi.getScanStatus();
    if (result.success) {
      setScanActive(!!result.data?.isActive);
    }
  }, []);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [statusResult, configResult, scanStatusResult, envResult] =
        await Promise.all([
          window.electron.gravi.getScannerStatus(),
          window.electron.gravi.getConfig(),
          window.electron.gravi.getScanStatus(),
          window.electron.config.getGraviScanEnvStatus(),
        ]);
      if (cancelled) return;

      if (statusResult.success) {
        setScanners(statusResult.scanners as ScannerRow[]);
      }
      if (configResult.success && configResult.data.success) {
        applyConfig(configResult.data.config);
      }
      if (scanStatusResult.success) {
        setScanActive(!!scanStatusResult.data?.isActive);
      }
      setEnvStatus(envResult);
      setLoading(false);
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

  const handleDetect = useCallback(async () => {
    setDetectError(null);
    setIsDetecting(true);
    try {
      const detectResult = await window.electron.gravi.detectScanners();
      if (!detectResult.success || !detectResult.data.success) {
        setDetectError(
          (!detectResult.success
            ? 'Detection failed'
            : detectResult.data.error) || 'Detection failed'
        );
        return;
      }
      const detected = detectResult.data.scanners;
      if (detected.length === 0) {
        setDetectError('No scanners detected. Check USB connections.');
        return;
      }

      const sorted = [...detected].sort((a, b) =>
        (a.usb_port || '').localeCompare(b.usb_port || '')
      );
      const payload = sorted.map(
        (
          s: {
            name: string;
            vendor_id: string;
            product_id: string;
            usb_port?: string;
            usb_bus?: number;
            usb_device?: number;
          },
          i: number
        ) => ({
          name: s.name,
          display_name: `Scanner ${i + 1}`,
          vendor_id: s.vendor_id,
          product_id: s.product_id,
          usb_port: s.usb_port,
          usb_bus: s.usb_bus,
          usb_device: s.usb_device,
        })
      );

      const saveResult = await window.electron.gravi.saveScannersToDB(payload);
      if (!saveResult.success || !saveResult.data.success) {
        setDetectError(
          (!saveResult.success ? 'Save failed' : saveResult.data.error) ||
            'Save failed'
        );
        return;
      }

      await refreshScannerStatus();
    } finally {
      setIsDetecting(false);
    }
  }, [refreshScannerStatus]);

  const handleResetUsb = useCallback(async () => {
    setResetUsbError(null);
    if (scanActive) {
      setResetUsbError('Cannot reset USB while a scan is in progress.');
      return;
    }
    setIsResettingUsb(true);
    setScanners((prev) => prev.map((s) => ({ ...s, status: 'starting' })));
    try {
      const result = await window.electron.gravi.resetUsb();
      if (!result.success || !result.data.success) {
        setResetUsbError(
          (!result.success ? 'USB reset failed' : result.data.error) ||
            'USB reset failed'
        );
      }
      await handleDetect();
    } finally {
      setIsResettingUsb(false);
    }
  }, [scanActive, handleDetect]);

  const handleRemove = useCallback(
    async (scannerId: string) => {
      if (scanActive) return;
      setSaveError(null);
      const result = await window.electron.gravi.disableScanner(scannerId);
      if (result.ok) {
        setScanners((prev) => prev.filter((s) => s.scannerId !== scannerId));
      } else {
        // Manual cast: this repo's tsconfig doesn't set strictNullChecks,
        // so control-flow narrowing on the `ok` discriminant doesn't apply
        // here (matches register-handlers.ts's own workaround).
        const err = (result as { ok: false; error: string }).error;
        setSaveError(`Failed to remove scanner: ${err}`);
      }
    },
    [scanActive]
  );

  const handleSaveConfig = useCallback(async () => {
    if (legacyResolution !== null && !resolutionTouched) return;
    setSaveError(null);
    const result = await window.electron.gravi.saveConfig({
      resolution,
      grid_mode: gridMode,
    });
    if (result.success && result.data.success) {
      setSaveSuccess(true);
      setLegacyResolution(null);
      setTimeout(() => setSaveSuccess(false), 3000);
    } else {
      setSaveError(
        (!result.success ? 'Save failed' : result.data.error) || 'Save failed'
      );
    }
  }, [resolution, gridMode, legacyResolution, resolutionTouched]);

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
            className={
              envStatus.slackConfigured ? 'text-green-700' : 'text-amber-700'
            }
          >
            Slack wedge alerts:{' '}
            {envStatus.slackConfigured ? 'configured' : 'not configured'}
          </span>
          <span
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
          Configuration saved successfully!
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
                disabled={isDetecting}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {isDetecting ? 'Detecting...' : 'Detect Scanners'}
              </button>
              <button
                onClick={handleResetUsb}
                disabled={isResettingUsb}
                title="Resets all connected scanners, not just one"
                className="px-4 py-2 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 disabled:opacity-50"
              >
                Reset All USB Connections
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
              option. Select a new value and Save to update it.
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
                    {r === 1200
                      ? '1200 dpi (production, validated at 140×140 mm)'
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
