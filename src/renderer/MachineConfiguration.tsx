/**
 * Machine Configuration Page
 *
 * Admin-only page for configuring machine-level settings.
 * Protected by Bloom credential authentication (except on first run).
 */

import { useState, useEffect } from 'react';
import type { MachineConfig, Scanner } from '../main/config-store';

type FormState = 'loading' | 'config'; // Removed 'login' state
type CameraTestStatus = 'idle' | 'testing' | 'success' | 'error';

interface FormErrors {
  scanner_name?: string;
  camera_ip_address?: string;
  scans_dir?: string;
  bloom_api_url?: string;
  general?: string;
}

export function MachineConfiguration() {
  // Form state
  const [formState, setFormState] = useState<FormState>('loading');

  // Unified config state (includes credentials)
  const [config, setConfig] = useState<MachineConfig>({
    scanner_name: '',
    camera_ip_address: 'mock',
    scans_dir: '~/.bloom/scans',
    bloom_api_url: 'https://api.bloom.salk.edu/proxy',
    bloom_scanner_username: '',
    bloom_scanner_password: '',
    bloom_anon_key: '',
  });
  const [originalConfig, setOriginalConfig] = useState<MachineConfig | null>(
    null
  );

  // Form state
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Camera test state
  const [cameraTestStatus, setCameraTestStatus] =
    useState<CameraTestStatus>('idle');
  const [cameraTestError, setCameraTestError] = useState('');

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

  // Handle save (unified config)
  const handleSave = async () => {
    setErrors({});
    setSaveSuccess(false);
    setIsSaving(true);

    try {
      // Save unified config (credentials included)
      const result = await window.electron.config.set(config);

      if (result.success) {
        setSaveSuccess(true);
        setOriginalConfig(config);

        // Clear success message after 3 seconds
        setTimeout(() => setSaveSuccess(false), 3000);

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
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  errors.bloom_api_url ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="https://api.bloom.salk.edu/proxy"
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
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
                  className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
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

        {/* Hardware Section */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold mb-4 text-gray-800">Hardware</h2>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="camera-ip"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Camera IP Address
              </label>
              <div className="flex gap-2">
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
                  className={`flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    errors.camera_ip_address
                      ? 'border-red-500'
                      : 'border-gray-300'
                  }`}
                  placeholder="10.0.0.23 or mock"
                />
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
            </div>

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
                  className={`flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
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
        </div>

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
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>
    </div>
  );
}
