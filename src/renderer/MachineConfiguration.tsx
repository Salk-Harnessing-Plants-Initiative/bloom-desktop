/**
 * Machine Configuration Page
 *
 * Admin-only page for configuring machine-level settings.
 * Protected by Bloom credential authentication (except on first run).
 */

import { useState, useEffect, useRef } from 'react';
import type { MachineConfig, Scanner } from '../main/config-store';
import type { DetectedCamera } from '../types/camera';
import type { HardwareStatus } from '../types/electron';

type FormState = 'loading' | 'config'; // Removed 'login' state
type CameraTestStatus = 'idle' | 'testing' | 'success' | 'error';

interface FormErrors {
  scanner_mode?: string;
  scanner_name?: string;
  camera_ip_address?: string;
  scans_dir?: string;
  bloom_api_url?: string;
  num_frames?: string;
  seconds_per_rot?: string;
  general?: string;
}

export function MachineConfiguration() {
  // Form state
  const [formState, setFormState] = useState<FormState>('loading');

  // Unified config state (includes credentials)
  const [config, setConfig] = useState<MachineConfig>({
    scanner_mode: '',
    scanner_name: '',
    camera_ip_address: 'mock',
    scans_dir: '~/.bloom/scans',
    bloom_api_url: 'https://bloom.salk.edu/api',
    bloom_scanner_username: '',
    bloom_scanner_password: '',
    bloom_anon_key: '',
    num_frames: 72,
    seconds_per_rot: 7.0,
  });
  const [originalConfig, setOriginalConfig] = useState<MachineConfig | null>(
    null
  );

  // Form state
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showRestartRequiredNotice, setShowRestartRequiredNotice] =
    useState(false);

  // Camera test state
  const [cameraTestStatus, setCameraTestStatus] =
    useState<CameraTestStatus>('idle');
  const [cameraTestError, setCameraTestError] = useState('');

  // Camera detection state (#338 — relocated from CameraSettingsForm)
  const [detectedCameras, setDetectedCameras] = useState<DetectedCamera[]>([]);
  const [showManualCameraEntry, setShowManualCameraEntry] = useState(false);
  const [isDetectingCameras, setIsDetectingCameras] = useState(false);
  const [cameraDetectionError, setCameraDetectionError] = useState('');
  const [showCameraHelp, setShowCameraHelp] = useState(false);
  const hasDetectedCamerasRef = useRef(false);

  // Hardware diagnostics state (#339 — relocated from Home's PythonStatus)
  const [hardwareStatus, setHardwareStatus] = useState<HardwareStatus | null>(
    null
  );
  const [hardwareCheckError, setHardwareCheckError] = useState('');
  const [isRestartingPython, setIsRestartingPython] = useState(false);
  const [restartError, setRestartError] = useState('');

  // Scanner list state
  const [scannerList, setScannerList] = useState<Scanner[]>([]);
  const [scannerListLoading, setScannerListLoading] = useState(false);
  const [scannerListError, setScannerListError] = useState<string | null>(null);

  // Fetch scanners from Bloom API (pass form credentials)
  const fetchScanners = async () => {
    setScannerListLoading(true);
    setScannerListError(null);

    try {
      // Pass form credentials to IPC handler
      const result = await window.electron.config.fetchScanners(
        config.bloom_api_url,
        {
          bloom_scanner_username: config.bloom_scanner_username,
          bloom_scanner_password: config.bloom_scanner_password,
          bloom_anon_key: config.bloom_anon_key,
        }
      );
      if (result.success && result.scanners) {
        setScannerList(result.scanners);
      } else {
        setScannerListError(
          result.error ||
            'Failed to fetch scanners. Check your credentials and network connection.'
        );
      }
    } catch {
      setScannerListError(
        'Failed to fetch scanners. Check your credentials and network connection.'
      );
    } finally {
      setScannerListLoading(false);
    }
  };

  // Load configuration on mount
  useEffect(() => {
    const loadConfiguration = async () => {
      try {
        const configData = await window.electron.config.get();

        // Set unified config (includes credentials)
        setConfig(configData.config);
        setOriginalConfig(configData.config);

        // Always show config form (no login screen)
        setFormState('config');
      } catch (error) {
        console.error('Failed to load configuration:', error);
        setFormState('config'); // Fall back to config form
      }
    };

    loadConfiguration();
  }, []);

  // Detect cameras — callable both automatically (once, on mount, guarded
  // by hasDetectedCamerasRef below) and manually via the "Detect Cameras"
  // retry button, which bypasses that guard so the admin can re-scan if a
  // camera is connected after the page loads or detection transiently
  // failed. Uses the latest `config` via closure at call time.
  const detectCameras = async () => {
    setIsDetectingCameras(true);
    setCameraDetectionError('');
    try {
      const result = await window.electron.camera.detectCameras();
      if (result.success && result.cameras) {
        setDetectedCameras(result.cameras);

        if (result.cameras.length === 0) {
          setShowManualCameraEntry(true);
          return;
        }

        const savedIp = config.camera_ip_address;
        const matched = result.cameras.find((c) => c.ip_address === savedIp);

        if (savedIp && matched) {
          setShowManualCameraEntry(false);
        } else if (savedIp) {
          // Saved value doesn't match any detected camera — keep it as
          // manual entry rather than silently replacing it with mock.
          setShowManualCameraEntry(true);
        } else {
          const mockCamera = result.cameras.find((c) => c.is_mock);
          if (mockCamera) {
            setConfig((prev) => ({
              ...prev,
              camera_ip_address: mockCamera.ip_address,
            }));
            setShowManualCameraEntry(false);
          } else {
            setShowManualCameraEntry(true);
          }
        }
      } else {
        setShowManualCameraEntry(true);
        setCameraDetectionError(result.error || 'Camera detection failed');
      }
    } catch (error) {
      console.error('Failed to detect cameras:', error);
      setShowManualCameraEntry(true);
      setCameraDetectionError(
        error instanceof Error ? error.message : 'Camera detection failed'
      );
    } finally {
      setIsDetectingCameras(false);
    }
  };

  // Auto-run detection once the Hardware section is known to be relevant
  // (CylinderScan mode). Runs once — a ref guards against re-firing if the
  // admin toggles scanner_mode back and forth before saving; the manual
  // "Detect Cameras" button above bypasses this guard on purpose.
  useEffect(() => {
    if (formState !== 'config') return;
    if (config.scanner_mode !== 'cylinderscan') return;
    if (hasDetectedCamerasRef.current) return;
    hasDetectedCamerasRef.current = true;

    detectCameras();
  }, [formState, config.scanner_mode]);

  // Handle selecting a camera from the detected-cameras dropdown
  const handleCameraSelect = (value: string) => {
    if (value === 'manual') {
      setShowManualCameraEntry(true);
    } else {
      setShowManualCameraEntry(false);
      setConfig((prev) => ({ ...prev, camera_ip_address: value }));
      setCameraTestStatus('idle');
    }
  };

  // Handle Check Hardware (relocated from Home's PythonStatus, #339)
  const handleCheckHardware = async () => {
    setHardwareCheckError('');
    try {
      const result = await window.electron.python.checkHardware();
      setHardwareStatus(result);
    } catch (error) {
      setHardwareCheckError(
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  // Handle Restart Python (relocated from Home's PythonStatus, #339) —
  // gated behind a confirmation since no in-progress-scan guard exists
  // anywhere in the code today; restarting mid-scan hard-fails it.
  const handleRestartPython = async () => {
    const confirmed = window.confirm(
      'Restart Python? This may interrupt an in-progress scan.'
    );
    if (!confirmed) return;

    setIsRestartingPython(true);
    setRestartError('');
    try {
      const result = await window.electron.python.restart();
      if (!result.success) {
        setRestartError(result.error || 'Failed to restart Python process');
      }
    } catch (error) {
      setRestartError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRestartingPython(false);
    }
  };

  // Handle save (unified config)
  const handleSave = async () => {
    setErrors({});
    setSaveSuccess(false);
    setIsSaving(true);

    const scannerModeChanged =
      originalConfig !== null &&
      originalConfig.scanner_mode !== config.scanner_mode;

    try {
      // Save unified config (credentials included)
      const result = await window.electron.config.set(config);

      if (result.success) {
        setOriginalConfig(config);

        if (scannerModeChanged) {
          // Scanner mode gates the entire app shell (see useAppMode/App.tsx)
          // and is only ever read once at process startup — unlike the
          // generic toast, this notice does not auto-clear on a timer; the
          // admin must explicitly dismiss it, so it isn't missed before
          // the required restart happens.
          setShowRestartRequiredNotice(true);
        } else if (!showRestartRequiredNotice) {
          // Don't stack the generic toast on top of a still-visible
          // restart-required notice from an earlier, not-yet-dismissed
          // save in this same session.
          setSaveSuccess(true);
          // Clear success message after 3 seconds
          setTimeout(() => setSaveSuccess(false), 3000);
        }

        // UX improvement: If credentials are complete, automatically fetch scanners
        if (
          config.bloom_scanner_username &&
          config.bloom_scanner_password &&
          config.bloom_anon_key &&
          config.bloom_api_url
        ) {
          await fetchScanners();
        }
      } else {
        setErrors(result.errors || { general: 'Failed to save configuration' });
      }
    } catch {
      setErrors({ general: 'Failed to save configuration' });
    } finally {
      setIsSaving(false);
    }
  };

  // Handle cancel - reset to original values
  const handleCancel = () => {
    if (originalConfig) {
      setConfig(originalConfig);
    }
    setErrors({});
    setSaveSuccess(false);
  };

  // Handle camera test
  const handleTestCamera = async () => {
    setCameraTestStatus('testing');
    setCameraTestError('');

    try {
      const result = await window.electron.config.testCamera(
        config.camera_ip_address
      );

      if (result.success) {
        setCameraTestStatus('success');
      } else {
        setCameraTestStatus('error');
        setCameraTestError(result.error || 'Connection failed');
      }
    } catch {
      setCameraTestStatus('error');
      setCameraTestError('Failed to test connection');
    }
  };

  // Handle browse directory
  const handleBrowseDirectory = async () => {
    try {
      const path = await window.electron.config.browseDirectory();
      if (path) {
        setConfig((prev) => ({ ...prev, scans_dir: path }));
      }
    } catch (error) {
      console.error('Failed to browse directory:', error);
    }
  };

  // Loading state
  if (formState === 'loading') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-600">Loading configuration...</div>
      </div>
    );
  }

  // Configuration form
  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2 text-gray-800">
        Machine Configuration
      </h1>

      <p className="text-gray-600 mb-8">
        Configure machine-level settings for this scanner station.
      </p>

      {/* Restart-required notice — persistent, dismissible, does NOT
          auto-clear on a timer like the generic save toast below, since a
          scanner_mode change requires a restart the admin must not miss. */}
      {showRestartRequiredNotice && (
        <div
          data-testid="restart-required-notice"
          className="sticky top-0 z-10 bg-yellow-50 border-2 border-yellow-500 text-yellow-900 px-4 py-3 rounded-md mb-4 flex items-center justify-between gap-4"
        >
          <span>
            Scanner Mode changed — restart the application now for this change
            to take effect. This notice won&apos;t reappear if you navigate away
            first.
          </span>
          <button
            type="button"
            onClick={() => setShowRestartRequiredNotice(false)}
            className="px-3 py-1 rounded border border-yellow-600 text-yellow-900 hover:bg-yellow-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Success message */}
      {saveSuccess && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-md mb-4">
          Configuration saved successfully!
        </div>
      )}

      {/* General error */}
      {errors.general && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-md mb-4">
          {errors.general}
        </div>
      )}

      <div className="space-y-6">
        {/* Scanner Mode Section */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold mb-4 text-gray-800">
            Scanner Mode
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            Select the type of scanner this station operates.
          </p>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="scanner_mode"
                value="cylinderscan"
                checked={config.scanner_mode === 'cylinderscan'}
                onChange={() =>
                  setConfig((prev) => ({
                    ...prev,
                    scanner_mode: 'cylinderscan',
                  }))
                }
                className="w-4 h-4 text-lime-700"
              />
              <span className="text-gray-700">CylinderScan</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="scanner_mode"
                value="graviscan"
                checked={config.scanner_mode === 'graviscan'}
                onChange={() =>
                  setConfig((prev) => ({
                    ...prev,
                    scanner_mode: 'graviscan',
                  }))
                }
                className="w-4 h-4 text-lime-700"
              />
              <span className="text-gray-700">GraviScan</span>
            </label>
          </div>
          {errors.scanner_mode && (
            <p className="text-red-600 text-sm mt-2">{errors.scanner_mode}</p>
          )}
        </div>

        {/* API Credentials Section */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold mb-4 text-gray-800">
            Bloom API Credentials
          </h2>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="api-url"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                API URL
              </label>
              <input
                id="api-url"
                type="text"
                value={config.bloom_api_url}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    bloom_api_url: e.target.value,
                  }))
                }
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-lime-500 ${
                  errors.bloom_api_url ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="https://bloom.salk.edu/api"
              />
              {errors.bloom_api_url && (
                <p className="text-red-600 text-sm mt-1">
                  {errors.bloom_api_url}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="creds-username"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Username
              </label>
              <input
                id="creds-username"
                type="email"
                value={config.bloom_scanner_username}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    bloom_scanner_username: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-lime-500"
                placeholder="scanner@salk.edu"
              />
            </div>

            <div>
              <label
                htmlFor="creds-password"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Password
              </label>
              <input
                id="creds-password"
                type="password"
                value={config.bloom_scanner_password}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    bloom_scanner_password: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-lime-500"
                placeholder="Leave blank to keep existing"
              />
            </div>

            <div>
              <label
                htmlFor="creds-anonkey"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Anon Key
              </label>
              <input
                id="creds-anonkey"
                type="text"
                value={config.bloom_anon_key}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    bloom_anon_key: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-lime-500"
                placeholder="eyJhbGci..."
              />
            </div>

            {/* Fetch Scanners Button */}
            <div className="mt-4 pt-4 border-t border-gray-200">
              <button
                onClick={fetchScanners}
                disabled={
                  !config.bloom_scanner_username ||
                  !config.bloom_scanner_password ||
                  !config.bloom_anon_key ||
                  !config.bloom_api_url ||
                  scannerListLoading
                }
                className="w-full px-4 py-2 bg-lime-700 text-white rounded-md hover:bg-lime-800 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {scannerListLoading ? (
                  <>
                    <svg
                      className="animate-spin h-5 w-5"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Fetching scanners...
                  </>
                ) : (
                  'Fetch Scanners from Bloom'
                )}
              </button>
              {scannerList.length > 0 && !scannerListLoading && (
                <p className="text-green-600 text-sm mt-2">
                  ✓ Found {scannerList.length} scanner
                  {scannerList.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Station Identity Section */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold mb-4 text-gray-800">
            Station Identity
          </h2>

          <div>
            <label
              htmlFor="scanner-name"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Scanner Name
            </label>
            {scannerListLoading ? (
              <div className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-500">
                Loading scanners...
              </div>
            ) : scannerListError ? (
              <>
                <select
                  id="scanner-name"
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-500"
                >
                  <option>Unable to load scanners</option>
                </select>
                <p className="text-red-600 text-sm mt-1">
                  ⚠️ {scannerListError}
                </p>
                <button
                  onClick={fetchScanners}
                  className="mt-2 px-4 py-2 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 text-sm"
                >
                  Retry
                </button>
              </>
            ) : scannerList.length === 0 ? (
              <>
                <select
                  id="scanner-name"
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-500"
                >
                  <option>Enter credentials first</option>
                </select>
                <p className="text-gray-500 text-sm mt-1">
                  Configure Bloom API credentials above to select a scanner.
                </p>
              </>
            ) : (
              <>
                <select
                  id="scanner-name"
                  value={config.scanner_name}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      scanner_name: e.target.value,
                    }))
                  }
                  className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-lime-500 ${
                    errors.scanner_name ? 'border-red-500' : 'border-gray-300'
                  }`}
                  disabled={scannerList.length === 0}
                >
                  <option value="">Select a scanner...</option>
                  {scannerList.map((scanner) => (
                    <option key={scanner.name} value={scanner.name}>
                      {scanner.name}
                    </option>
                  ))}
                </select>
                {errors.scanner_name && (
                  <p className="text-red-600 text-sm mt-1">
                    {errors.scanner_name}
                  </p>
                )}
                <p className="text-gray-500 text-sm mt-1">
                  Scanner station registered in Bloom database
                </p>
              </>
            )}
          </div>
        </div>

        {/* Scans Directory Section — always visible */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold mb-4 text-gray-800">
            Scans Directory
          </h2>

          <div>
            <label
              htmlFor="scans-dir"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Scans Directory
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Default location keeps scan data together with database.
              <br />
              For large datasets, configure external storage (e.g.,
              /mnt/scanner-data)
            </p>
            <div className="flex gap-2">
              <input
                id="scans-dir"
                type="text"
                value={config.scans_dir}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    scans_dir: e.target.value,
                  }))
                }
                className={`flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-lime-500 ${
                  errors.scans_dir ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="Default scans directory"
              />
              <button
                onClick={handleBrowseDirectory}
                className="px-4 py-2 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200"
              >
                Browse...
              </button>
            </div>
            {errors.scans_dir && (
              <p className="text-red-600 text-sm mt-1">{errors.scans_dir}</p>
            )}
          </div>
        </div>

        {/* Hardware Section — CylinderScan only */}
        {config.scanner_mode === 'cylinderscan' && (
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-lg font-semibold mb-4 text-gray-800">
              Hardware
            </h2>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="camera-ip"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Camera IP Address
                </label>
                <div className="flex gap-2 mb-2">
                  <button
                    type="button"
                    onClick={detectCameras}
                    disabled={isDetectingCameras}
                    className="px-4 py-2 bg-lime-700 text-white rounded hover:bg-lime-800 transition disabled:opacity-50"
                  >
                    {isDetectingCameras ? 'Detecting...' : 'Detect Cameras'}
                  </button>
                </div>
                {cameraDetectionError && (
                  <p className="text-red-600 text-sm mb-2">
                    {cameraDetectionError}
                  </p>
                )}
                <div className="flex gap-2">
                  {!showManualCameraEntry && detectedCameras.length > 0 ? (
                    <select
                      id="camera-ip"
                      value={config.camera_ip_address}
                      onChange={(e) => handleCameraSelect(e.target.value)}
                      className={`flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-lime-500 ${
                        errors.camera_ip_address
                          ? 'border-red-500'
                          : 'border-gray-300'
                      }`}
                    >
                      {detectedCameras.map((camera) => (
                        <option
                          key={camera.ip_address}
                          value={camera.ip_address}
                        >
                          {camera.friendly_name}
                        </option>
                      ))}
                      <option value="manual">Manual Entry...</option>
                    </select>
                  ) : (
                    <input
                      id="camera-ip"
                      type="text"
                      value={config.camera_ip_address}
                      onChange={(e) => {
                        setConfig((prev) => ({
                          ...prev,
                          camera_ip_address: e.target.value,
                        }));
                        setCameraTestStatus('idle');
                      }}
                      className={`flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-lime-500 ${
                        errors.camera_ip_address
                          ? 'border-red-500'
                          : 'border-gray-300'
                      }`}
                      placeholder="10.0.0.23 or mock"
                    />
                  )}
                  <button
                    onClick={handleTestCamera}
                    disabled={cameraTestStatus === 'testing'}
                    className="px-4 py-2 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 disabled:opacity-50"
                  >
                    {cameraTestStatus === 'testing'
                      ? 'Testing...'
                      : 'Test Connection'}
                  </button>
                </div>
                {errors.camera_ip_address && (
                  <p className="text-red-600 text-sm mt-1">
                    {errors.camera_ip_address}
                  </p>
                )}
                {cameraTestStatus === 'success' && (
                  <p className="text-green-600 text-sm mt-1">Connected</p>
                )}
                {cameraTestStatus === 'error' && (
                  <p className="text-red-600 text-sm mt-1">{cameraTestError}</p>
                )}

                {/* Help text (collapsible) — relocated verbatim from
                    CameraSettingsForm.tsx's camera-selection block (#338).
                    Accuracy against real Basler/Pylon Viewer hardware is
                    tracked separately in #335 (requires physical hardware
                    access this pass didn't have). */}
                <div className="border-t pt-2 mt-2">
                  <button
                    type="button"
                    onClick={() => setShowCameraHelp(!showCameraHelp)}
                    className="text-sm text-lime-700 hover:text-lime-800"
                  >
                    {showCameraHelp ? '▼' : '▶'} How to find camera IP address
                  </button>

                  {showCameraHelp && (
                    <div className="mt-2 p-3 bg-gray-50 rounded text-sm space-y-2">
                      <p className="font-medium">
                        Method 1: Basler Pylon Viewer (Recommended)
                      </p>
                      <ol className="list-decimal ml-5 space-y-1">
                        <li>Open Basler Pylon Viewer software</li>
                        <li>Right-click camera → Properties</li>
                        <li>View IP Address in properties panel</li>
                      </ol>

                      <p className="font-medium mt-3">
                        Method 2: Check Camera Label
                      </p>
                      <p>Physical label on camera may show IP address</p>

                      <p className="font-medium mt-3">
                        Method 3: Router Admin Page
                      </p>
                      <p>
                        Check connected devices in router settings (usually
                        192.168.1.1)
                      </p>

                      <p className="text-gray-600 mt-3">
                        <strong>Note:</strong> Mock camera doesn&apos;t require
                        an IP address. Detection button should show it
                        automatically.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Hardware Diagnostics — relocated from Home's Python
                  Backend Status panel (#339); Home now shows only a
                  simple status indicator. */}
              <div className="border-t pt-4">
                <div className="font-medium text-gray-700 mb-2">
                  Hardware Diagnostics
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleCheckHardware}
                    className="px-4 py-2 bg-lime-700 text-white rounded hover:bg-lime-800 transition"
                  >
                    Check Hardware
                  </button>
                  <button
                    type="button"
                    onClick={handleRestartPython}
                    disabled={isRestartingPython}
                    className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isRestartingPython ? 'Restarting...' : 'Restart Python'}
                  </button>
                </div>

                {hardwareStatus && (
                  <div className="mt-3 space-y-1 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Camera:</span>
                      {hardwareStatus.camera.available ? (
                        <span className="text-green-600 font-semibold">
                          [OK] {hardwareStatus.camera.devices_found} device(s)
                          found
                        </span>
                      ) : hardwareStatus.camera.library_available ? (
                        <span className="text-yellow-600">
                          [WARN] Library installed, no devices found
                        </span>
                      ) : (
                        <span className="text-red-600">
                          [ERROR] Library not installed.
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">DAQ:</span>
                      {hardwareStatus.daq.available ? (
                        <span className="text-green-600 font-semibold">
                          [OK] {hardwareStatus.daq.devices_found} device(s)
                          found
                        </span>
                      ) : hardwareStatus.daq.library_available ? (
                        <span className="text-yellow-600">
                          [WARN] Library installed, no devices found
                        </span>
                      ) : (
                        <span className="text-red-600">
                          [ERROR] Library not installed.
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {hardwareCheckError && (
                  <p className="text-red-600 text-sm mt-2">
                    {hardwareCheckError}
                  </p>
                )}
                {restartError && (
                  <p className="text-red-600 text-sm mt-2">{restartError}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Scan Parameters Section — CylinderScan only */}
        {config.scanner_mode === 'cylinderscan' && (
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-lg font-semibold mb-4 text-gray-800">
              Scan Parameters
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              Controls how many images are captured per rotation and how fast
              the turntable spins. More frames increase angular resolution but
              take longer; faster rotation reduces scan time but may cause
              motion blur.
            </p>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="num-frames"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Frames per rotation
                </label>
                <input
                  id="num-frames"
                  type="number"
                  min={1}
                  max={720}
                  step={1}
                  value={config.num_frames}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val)) {
                      setConfig((prev) => ({ ...prev, num_frames: val }));
                    }
                  }}
                  className={`w-full px-3 py-2 border ${errors.num_frames ? 'border-red-500' : 'border-gray-300'} rounded-md focus:outline-none focus:ring-2 focus:ring-lime-500`}
                />
                {errors.num_frames && (
                  <p className="text-red-600 text-sm mt-1">
                    {errors.num_frames}
                  </p>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  Integer 1–720. Default 72 (5° per frame). Higher values give
                  finer angular resolution but longer scans.
                </p>
              </div>

              <div>
                <label
                  htmlFor="seconds-per-rot"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Seconds per rotation
                </label>
                <input
                  id="seconds-per-rot"
                  type="number"
                  min={2.0}
                  max={120.0}
                  step={0.5}
                  value={config.seconds_per_rot}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      setConfig((prev) => ({ ...prev, seconds_per_rot: val }));
                    }
                  }}
                  className={`w-full px-3 py-2 border ${errors.seconds_per_rot ? 'border-red-500' : 'border-gray-300'} rounded-md focus:outline-none focus:ring-2 focus:ring-lime-500`}
                />
                {errors.seconds_per_rot && (
                  <p className="text-red-600 text-sm mt-1">
                    {errors.seconds_per_rot}
                  </p>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  Range 2.0–120.0 seconds. Default 7.0. Slower rotation reduces
                  motion blur; faster rotation shortens scan time.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-4">
          <button
            onClick={handleCancel}
            className="px-6 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-2 bg-lime-700 text-white rounded-md hover:bg-lime-800 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>
    </div>
  );
}
