/**
 * ScannerConfig Page (GraviScan Section 9)
 *
 * Allows users to detect, configure, and validate flatbed scanners.
 * Delegates all state management to the useScannerConfig hook.
 */

import { useState } from 'react';
import { useScannerConfig } from '../hooks/useScannerConfig';
import type { ScannerPanelState } from '../../types/graviscan';
import { GRAVISCAN_RESOLUTIONS } from '../../types/graviscan';

export function ScannerConfig() {
  const [scannerStates, setScannerStates] = useState<ScannerPanelState[]>([]);

  const {
    platformInfo,
    platformLoading,
    detectedScanners,
    detectingScanner,
    detectionError,
    scannerAssignments,
    resolution,
    setResolution,
    configStatus,
    configValidationMessage,
    handleDetectScanners,
    handleScannerGridMode,
    handleToggleScannerEnabled,
  } = useScannerConfig({ setScannerStates });

  const handleSave = async () => {
    const firstAssigned = scannerAssignments.find((a) => a.scannerId !== null);
    await window.electron.gravi.saveConfig({
      grid_mode: firstAssigned?.gridMode || '2grid',
      resolution,
    });

    const scannersToSave = detectedScanners
      .filter((s) =>
        scannerAssignments.some((a) => a.scannerId === s.scanner_id)
      )
      .map((s) => {
        const assignment = scannerAssignments.find(
          (a) => a.scannerId === s.scanner_id
        );
        return {
          name: s.name,
          display_name: assignment?.slot || null,
          vendor_id: s.vendor_id,
          product_id: s.product_id,
          usb_port: s.usb_port,
          usb_bus: s.usb_bus,
          usb_device: s.usb_device,
        };
      });

    await window.electron.gravi.saveScannersToDB(scannersToSave);

    // Re-detect so that detectedScanners[].scanner_id reflects the new
    // DB UUIDs (matchDetectedToDb mutates the list on detection). Without
    // this, downstream FK-sensitive writes (plate assignments, scan
    // persistence) can use pre-DB placeholder IDs like `mock-scanner-1`.
    await handleDetectScanners();
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            Scanner Configuration
          </h1>
          <p className="text-gray-600 mt-1">
            Detect, configure, and validate your flatbed scanners
          </p>
        </div>

        {/* Platform Info Banner */}
        <div className="bg-white rounded-lg shadow-sm p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">
            Platform Info
          </h2>
          {platformLoading ? (
            <p className="text-sm text-gray-500">Loading platform info...</p>
          ) : platformInfo ? (
            <div className="flex items-center gap-4 text-sm">
              <span
                className={
                  platformInfo.supported ? 'text-green-700' : 'text-red-700'
                }
              >
                {platformInfo.supported ? 'Supported' : 'Unsupported'}
              </span>
              <span className="text-gray-600">
                Backend:{' '}
                <span className="font-medium uppercase">
                  {platformInfo.backend}
                </span>
              </span>
              {platformInfo.mock_enabled && (
                <span className="text-amber-600 text-xs">
                  (Mock mode enabled)
                </span>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500">Platform info unavailable</p>
          )}
        </div>

        {/* Validation Status Banner */}
        {configValidationMessage && (
          <div
            className={`rounded-lg p-4 text-sm ${
              configStatus === 'valid'
                ? 'bg-green-50 text-green-800 border border-green-200'
                : configStatus === 'mismatch'
                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                  : configStatus === 'error'
                    ? 'bg-red-50 text-red-800 border border-red-200'
                    : 'bg-blue-50 text-blue-800 border border-blue-200'
            }`}
          >
            {configValidationMessage}
          </div>
        )}

        {/* Detection Error */}
        {detectionError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
            {detectionError}
          </div>
        )}

        {/* Scanner List */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Detected Scanners
            </h2>
            <button
              type="button"
              onClick={handleDetectScanners}
              disabled={detectingScanner}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {detectingScanner ? 'Detecting...' : 'Detect Scanners'}
            </button>
          </div>

          {detectingScanner && detectedScanners.length === 0 ? (
            <p className="text-sm text-gray-500 py-4">Detecting scanners...</p>
          ) : detectedScanners.length === 0 ? (
            <p className="text-sm text-gray-500 py-4">
              No scanners detected. Connect your scanners and click Detect
              Scanners.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {detectedScanners.map((scanner) => (
                <li
                  key={scanner.scanner_id}
                  className="flex items-center justify-between py-3"
                >
                  <div>
                    <p className="font-medium text-gray-900">{scanner.name}</p>
                    <p className="text-xs text-gray-500">
                      USB {scanner.usb_port} &middot; {scanner.vendor_id}:
                      {scanner.product_id}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        scanner.is_available
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {scanner.is_available ? 'Available' : 'Unavailable'}
                    </span>
                    <label className="flex items-center gap-1 text-sm">
                      <input
                        type="checkbox"
                        checked={
                          scannerStates.find(
                            (s) => s.scannerId === scanner.scanner_id
                          )?.enabled ?? true
                        }
                        onChange={(e) =>
                          handleToggleScannerEnabled(
                            scanner.scanner_id,
                            e.target.checked
                          )
                        }
                        className="w-4 h-4 rounded border-gray-300"
                      />
                      Enabled
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Grid Mode & Resolution */}
        <div className="bg-white rounded-lg shadow-sm p-6 space-y-6">
          {/* Grid Mode */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">
              Grid Mode
            </h2>
            <div className="flex gap-6">
              {(['2grid', '4grid'] as const).map((mode) => (
                <label
                  key={mode}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="radio"
                    name="gridMode"
                    value={mode}
                    checked={
                      (scannerAssignments[0]?.gridMode || '2grid') === mode
                    }
                    onChange={() => handleScannerGridMode(0, mode)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    {mode === '2grid' ? '2-Grid' : '4-Grid'}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Resolution */}
          <div>
            <label
              htmlFor="resolution"
              className="block text-sm font-semibold text-gray-700 mb-1"
            >
              Resolution
            </label>
            <select
              id="resolution"
              value={resolution}
              onChange={(e) => setResolution(Number(e.target.value))}
              className="w-full max-w-xs p-2 rounded-md bg-white text-sm border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {GRAVISCAN_RESOLUTIONS.map((res) => (
                <option key={res} value={res}>
                  {res} DPI
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4">
          <button
            type="button"
            onClick={handleSave}
            className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 font-medium"
          >
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
}
