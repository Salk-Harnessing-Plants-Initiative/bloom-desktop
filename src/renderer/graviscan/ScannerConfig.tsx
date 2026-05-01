/**
 * ScannerConfig Page (GraviScan Section 9 + fix-scanner-config-save-flow)
 *
 * Allows users to detect, configure, and validate flatbed scanners.
 * Delegates all state management to the useScannerConfig hook.
 */

import { useRef, useState } from 'react';
import { useScannerConfig } from '../hooks/useScannerConfig';
import { GRAVISCAN_RESOLUTIONS } from '../../types/graviscan';

interface SaveSuccess {
  kind: 'success';
  count: number;
  gridMode: '2grid' | '4grid';
  resolution: number;
}

interface SaveError {
  kind: 'error';
  message: string;
  configSaved: boolean; // true when partial failure (config ok, scanners failed)
}

type SaveResult = SaveSuccess | SaveError | null;

function formatGridMode(mode: '2grid' | '4grid'): string {
  return mode === '2grid' ? '2-Grid' : '4-Grid';
}

export function ScannerConfig() {
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
    handleScannerAssignment,
  } = useScannerConfig();

  const [saveResult, setSaveResult] = useState<SaveResult>(null);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);

  // Derived: how many scanners are enabled (scannerId !== null)
  const enabledCount = scannerAssignments.filter(
    (a) => a.scannerId !== null
  ).length;

  const currentGridMode: '2grid' | '4grid' =
    (scannerAssignments.find((a) => a.scannerId !== null)?.gridMode as
      | '2grid'
      | '4grid'
      | undefined) ??
    scannerAssignments[0]?.gridMode ??
    '2grid';

  async function handleSave() {
    // Re-entrancy guard (Task 2.5)
    if (savingRef.current) return;
    // Zero-enabled guard (Task 2.5)
    if (enabledCount === 0) return;

    savingRef.current = true;
    setIsSaving(true);
    setSaveResult(null);

    console.info('[ScannerConfig] handleSave', {
      action: 'save',
      count: enabledCount,
      grid_mode: currentGridMode,
      resolution,
      scanner_ids: scannerAssignments
        .filter((a) => a.scannerId !== null)
        .map((a) => a.scannerId),
    });

    try {
      const configResult = await window.electron.gravi.saveConfig({
        grid_mode: currentGridMode,
        resolution,
      });
      const configOk = configResult.success;

      // Build payload from scannerAssignments (NOT from a filter that yields [])
      const scannersToSave = scannerAssignments
        .filter((a) => a.scannerId !== null)
        .map((a) => {
          const detected = detectedScanners.find(
            (s) => s.scanner_id === a.scannerId
          );
          if (!detected) return null;
          return {
            name: detected.name,
            // display_name: undefined → main-process upsert preserves admin-chosen value
            display_name: undefined as string | undefined,
            vendor_id: detected.vendor_id,
            product_id: detected.product_id,
            usb_port: detected.usb_port,
            usb_bus: detected.usb_bus,
            usb_device: detected.usb_device,
          };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null);

      const saveResult =
        await window.electron.gravi.saveScannersToDB(scannersToSave);

      if (!saveResult.success) {
        setSaveResult({
          kind: 'error',
          message: saveResult.error || 'Unknown error',
          configSaved: configOk,
        });
        return;
      }

      // Disable missing scanners (propagate unchecked → DB)
      try {
        const enabledIdentities = scannersToSave.map((s) => ({
          usb_port: s.usb_port,
          vendor_id: s.vendor_id,
          product_id: s.product_id,
          name: s.name,
          usb_bus: s.usb_bus,
          usb_device: s.usb_device,
        }));
        await window.electron.gravi.disableMissingScanners(enabledIdentities);
      } catch (err) {
        console.error(
          '[ScannerConfig] disableMissingScanners failed (non-fatal):',
          err
        );
      }

      // Re-detect so detectedScanners[].scanner_id reflects DB UUIDs
      await handleDetectScanners();

      setSaveResult({
        kind: 'success',
        count: scannersToSave.length,
        gridMode: currentGridMode,
        resolution,
      });
    } catch (error) {
      setSaveResult({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Save failed',
        configSaved: false,
      });
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }

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

        {/* Save feedback banners */}
        {saveResult?.kind === 'success' && (
          <div
            role="status"
            className="bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 flex items-start justify-between"
          >
            <div className="text-sm">
              {saveResult.count} scanners saved ·{' '}
              {formatGridMode(saveResult.gridMode)} · {saveResult.resolution}{' '}
              DPI
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setSaveResult(null)}
              className="text-green-700 hover:text-green-900 ml-4"
            >
              ×
            </button>
          </div>
        )}
        {saveResult?.kind === 'error' && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4 flex items-start justify-between"
          >
            <div className="text-sm">
              {saveResult.configSaved
                ? `Config saved. Scanner save failed: ${saveResult.message}.`
                : saveResult.message}
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setSaveResult(null)}
              className="text-red-700 hover:text-red-900 ml-4"
            >
              ×
            </button>
          </div>
        )}

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
              {detectedScanners.map((scanner, index) => {
                const assignment = scannerAssignments[index];
                const isEnabled = assignment?.scannerId !== null;
                return (
                  <li
                    key={scanner.scanner_id}
                    className="flex items-center justify-between py-3"
                  >
                    <div>
                      <p className="font-medium text-gray-900">
                        {scanner.name}
                      </p>
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
                          checked={isEnabled}
                          onChange={(e) =>
                            handleScannerAssignment(
                              index,
                              e.target.checked ? scanner.scanner_id : null
                            )
                          }
                          className="w-4 h-4 rounded border-gray-300"
                          aria-label={`Enabled: ${scanner.name}`}
                        />
                        Enabled
                      </label>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Grid Mode & Resolution */}
        <div className="bg-white rounded-lg shadow-sm p-6 space-y-6">
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
                    checked={currentGridMode === mode}
                    onChange={() => handleScannerGridMode(0, mode)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    {formatGridMode(mode)}
                  </span>
                </label>
              ))}
            </div>
          </div>

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
        <div className="flex flex-col gap-2">
          <div className="flex gap-4 items-center">
            <button
              type="button"
              onClick={handleSave}
              disabled={enabledCount === 0 || isSaving}
              className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {isSaving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
          {enabledCount === 0 && detectedScanners.length > 0 && (
            <p className="text-sm text-gray-600">
              At least one scanner must be enabled to save.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
