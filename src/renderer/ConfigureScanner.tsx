/**
 * Configure Scanner Page
 *
 * Dedicated page for USB scanner hardware setup in GraviScan mode.
 * - "Detect Scanners" → runs lsusb → saves to GraviScanner DB table
 * - Auto-assigns labels (Scanner 1, 2, ...) sorted by usb_port
 * - Only grid mode (2grid/4grid) is user-configurable per scanner
 * - Resolution selector (global)
 * - Configuration persists across app restarts
 */

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DetectedScanner } from '../types/graviscan';
import { GRAVISCAN_RESOLUTIONS } from '../types/graviscan';

interface SavedScanner {
  scannerId: string;
  displayName: string;
  usbPort: string | null;
  gridMode: string;
  status: 'ready' | 'starting' | 'error' | 'dead' | 'disconnected';
  error?: string;
}

export function ConfigureScanner() {
  const [isScanActive, setIsScanActive] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [scanners, setScanners] = useState<SavedScanner[]>([]);
  const [resolution, setResolution] = useState(1200);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load existing scanner config from DB on mount
  const loadScannerConfig = useCallback(async () => {
    try {
      const statusResult = await window.electron.graviscan.getScannerStatus();
      if (statusResult.success && statusResult.scanners.length > 0) {
        setScanners(statusResult.scanners);
      }

      const configResult = await window.electron.graviscan.getConfig();
      if (configResult.success && configResult.config) {
        setResolution(configResult.config.resolution);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadScannerConfig();
  }, [loadScannerConfig]);

  // Check if a scan is currently active
  useEffect(() => {
    const checkScanStatus = async () => {
      try {
        const status = await window.electron.graviscan.getScanStatus();
        setIsScanActive(status?.isActive ?? false);
      } catch {
        // ignore
      }
    };
    checkScanStatus();
  }, []);

  // Check URL params for reset flag
  const [searchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('reset') === 'true') {
      setScanners([]);
      setSaveSuccess(false);
    }
  }, [searchParams]);

  // Detect scanners → auto-assign labels → save to DB
  const handleDetect = async () => {
    setDetecting(true);
    setDetectionError(null);
    setSaveSuccess(false);

    try {
      const result = await window.electron.graviscan.detectScanners();

      if (!result.success) {
        setDetectionError(result.error || 'Detection failed');
        return;
      }

      if (result.scanners.length === 0) {
        setDetectionError('No scanners detected. Check USB connections.');
        return;
      }

      // Sort by usb_port for deterministic assignment
      const sorted = [...result.scanners].sort((a, b) =>
        (a.usb_port || '').localeCompare(b.usb_port || '')
      );

      // Load existing scanners from DB to preserve grid_mode
      const existingStatus = await window.electron.graviscan.getScannerStatus();
      const existingByPort = new Map(
        (existingStatus.scanners || []).map((s: SavedScanner) => [s.usbPort, s])
      );

      // Save to DB with auto-assigned display names
      const scannersToSave = sorted.map(
        (scanner: DetectedScanner, i: number) => {
          const existing = existingByPort.get(scanner.usb_port);
          return {
            name: scanner.name,
            display_name: `Scanner ${i + 1}`,
            vendor_id: scanner.vendor_id,
            product_id: scanner.product_id,
            usb_port: scanner.usb_port,
            usb_bus: scanner.usb_bus,
            usb_device: scanner.usb_device,
            grid_mode: existing?.gridMode || '4grid',
          };
        }
      );

      const saveResult =
        await window.electron.graviscan.saveScannersDb(scannersToSave);

      if (!saveResult.success) {
        setDetectionError(saveResult.error || 'Failed to save scanners');
        return;
      }

      // Reload status to get the saved scanners with IDs
      const refreshedStatus =
        await window.electron.graviscan.getScannerStatus();
      if (refreshedStatus.success) {
        setScanners(refreshedStatus.scanners);
      }
    } catch (err) {
      setDetectionError(
        err instanceof Error ? err.message : 'Detection failed'
      );
    } finally {
      setDetecting(false);
    }
  };

  // Update grid mode for a scanner
  const handleGridModeChange = async (scannerId: string, gridMode: string) => {
    setScanners((prev) =>
      prev.map((s) => (s.scannerId === scannerId ? { ...s, gridMode } : s))
    );

    // Save updated grid mode to DB
    const scanner = scanners.find((s) => s.scannerId === scannerId);
    if (scanner) {
      // Re-save all scanners with updated grid mode
      // (save-scanners-db upserts by usb_port)
      const allToSave = scanners.map((s) => ({
        name: s.displayName,
        display_name: s.displayName,
        vendor_id: '04b8',
        product_id: '013a',
        usb_port: s.usbPort || undefined,
        grid_mode: s.scannerId === scannerId ? gridMode : s.gridMode,
      }));
      await window.electron.graviscan.saveScannersDb(allToSave);
    }
  };

  // Save resolution
  const handleSaveResolution = async () => {
    setSaving(true);
    try {
      await window.electron.graviscan.saveConfig({
        resolution,
        grid_mode: '4grid',
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <p className="text-gray-500">Loading scanner configuration...</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2 text-gray-800">
        Configure Scanner
      </h1>
      <p className="text-gray-600 mb-6">
        Detect and configure USB scanners for GraviScan. This configuration
        persists across app restarts.
      </p>

      <div className="relative">
        {isScanActive && (
          <div className="absolute inset-0 bg-gray-100 bg-opacity-75 rounded-lg flex items-center justify-center z-10">
            <div className="bg-white rounded-lg shadow-md px-6 py-4 text-center">
              <p className="text-amber-700 font-medium text-sm">
                Scanner configuration is locked while a scan is in progress.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-6">
          {/* Step 1: Detect Scanners */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-2">
              Step 1: Detect USB Scanners
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              Click to detect all connected Epson scanners. Scanners are
              automatically assigned labels by USB port order.
            </p>

            <button
              onClick={handleDetect}
              disabled={detecting || isScanActive}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {detecting ? 'Detecting...' : 'Detect Scanners'}
            </button>

            {detectionError && (
              <p className="text-red-600 text-sm mt-2">{detectionError}</p>
            )}
          </div>

          {/* Step 2: Scanner List + Grid Mode */}
          {scanners.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">
                Step 2: Configure Grid Mode
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                Set the grid mode for each scanner. Everything else is detected
                automatically.
              </p>

              <div className="space-y-3">
                {scanners.map((scanner) => (
                  <div
                    key={scanner.scannerId}
                    className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-2.5 h-2.5 rounded-full ${
                          scanner.status === 'ready'
                            ? 'bg-green-500'
                            : scanner.status === 'starting'
                              ? 'bg-yellow-400 animate-pulse'
                              : scanner.status === 'error'
                                ? 'bg-red-500'
                                : 'bg-gray-400'
                        }`}
                      />
                      <div>
                        <span className="text-sm font-medium text-gray-900">
                          {scanner.displayName}
                        </span>
                        <span className="text-xs text-gray-500 ml-2">
                          {scanner.usbPort
                            ? `Port ${scanner.usbPort}`
                            : 'Unknown port'}
                        </span>
                      </div>
                    </div>

                    <select
                      value={scanner.gridMode}
                      onChange={(e) =>
                        handleGridModeChange(scanner.scannerId, e.target.value)
                      }
                      className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="2grid">2-Grid</option>
                      <option value="4grid">4-Grid</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Resolution */}
          {scanners.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-2">
                Step 3: Scan Resolution
              </h2>
              <div className="flex items-center gap-4">
                <select
                  value={resolution}
                  onChange={(e) => setResolution(Number(e.target.value))}
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {GRAVISCAN_RESOLUTIONS.map((res) => (
                    <option key={res} value={res}>
                      {res} DPI{res === 1200 ? ' (recommended)' : ''}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleSaveResolution}
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Resolution'}
                </button>
              </div>
              {saveSuccess && (
                <p className="text-green-600 text-sm mt-2">
                  Configuration saved successfully.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
