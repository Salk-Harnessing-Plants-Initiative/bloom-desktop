/**
 * CaptureScan Page
 *
 * Main page for capturing plant scans with metadata management.
 * Integrates camera preview, scanner control, and metadata input.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  MetadataForm,
  ScanMetadata,
  ScanProgress,
  RecentScansPreview,
  ScanSummary,
  Streamer,
  CameraSettingsForm,
} from '../components';
import type { CameraSettings } from '../types/camera';
import type { ScanProgress as ScanProgressData } from '../types/scanner';
import { DEFAULT_CAMERA_SETTINGS } from '../types/camera';
import { DEFAULT_DAQ_SETTINGS } from '../types/daq';
import { sanitizePath } from '../utils/path-sanitizer';

export function CaptureScan() {
  // Metadata state
  const [metadata, setMetadata] = useState<ScanMetadata>({
    phenotyper: '',
    experimentId: '',
    waveNumber: 0,
    plantAgeDays: 0,
    plantQrCode: '',
    accessionName: '',
  });

  // Camera settings state
  const [cameraSettings, setCameraSettings] = useState<CameraSettings>(
    DEFAULT_CAMERA_SETTINGS
  );
  const [cameraConfigured, setCameraConfigured] = useState(false);
  const [showCameraSettings, setShowCameraSettings] = useState(false);

  // Machine config state
  const [scannerName, setScannerName] = useState('CaptureScan-UI');
  const [scansDir, setScansDir] = useState('~/.bloom/scans');

  // Scanning state
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgressData | null>(
    null
  );

  // Recent scans state
  const [recentScans, setRecentScans] = useState<ScanSummary[]>([]);

  // UI state
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Barcode validation state
  const [barcodeValidationError, setBarcodeValidationError] = useState<
    string | null
  >(null);

  // Duplicate scan prevention state
  const [duplicateScanWarning, setDuplicateScanWarning] = useState<
    string | null
  >(null);

  // Handle barcode validation changes from MetadataForm
  const handleBarcodeValidationChange = useCallback(
    (isValid: boolean, error?: string) => {
      setBarcodeValidationError(isValid ? null : error || null);
    },
    []
  );

  // Check for duplicate scans (same plant + experiment + today)
  useEffect(() => {
    const checkDuplicateScan = async () => {
      if (!metadata.plantQrCode.trim() || !metadata.experimentId.trim()) {
        setDuplicateScanWarning(null);
        return;
      }

      try {
        const result =
          await window.electron.database.scans.getMostRecentScanDate(
            metadata.plantQrCode,
            metadata.experimentId
          );

        if (result.success && result.data) {
          // Compare dates (ignoring time)
          const scanDate = new Date(result.data);
          const today = new Date();

          const isSameDay =
            scanDate.getFullYear() === today.getFullYear() &&
            scanDate.getMonth() === today.getMonth() &&
            scanDate.getDate() === today.getDate();

          if (isSameDay) {
            setDuplicateScanWarning('This plant was already scanned today');
          } else {
            setDuplicateScanWarning(null);
          }
        } else {
          setDuplicateScanWarning(null);
        }
      } catch (error) {
        console.error('Failed to check for duplicate scan:', error);
        setDuplicateScanWarning(null);
      }
    };

    // Initial check
    checkDuplicateScan();

    // Poll every 2 seconds
    const intervalId = setInterval(checkDuplicateScan, 2000);

    return () => clearInterval(intervalId);
  }, [metadata.plantQrCode, metadata.experimentId]);

  // Load machine config on mount
  useEffect(() => {
    const loadMachineConfig = async () => {
      try {
        const { config } = await window.electron.config.get();
        if (config.scanner_name) {
          setScannerName(config.scanner_name);
        }
        if (config.scans_dir) {
          setScansDir(config.scans_dir);
        }
      } catch (error) {
        console.error('Failed to load machine config:', error);
      }
    };
    loadMachineConfig();
  }, []);

  // Check camera configuration on mount
  useEffect(() => {
    const checkCameraStatus = async () => {
      try {
        const status = await window.electron.camera.getStatus();
        console.log('[CaptureScan] Camera status:', status);

        // Get current camera settings from main process
        const settings = await window.electron.camera.getSettings();
        console.log('[CaptureScan] Got settings:', settings);

        if (settings) {
          // Use settings that were configured on Camera Settings page
          setCameraSettings(settings);
          setCameraConfigured(true);
        } else {
          // No settings configured yet, use defaults
          setCameraSettings(DEFAULT_CAMERA_SETTINGS);
          setCameraConfigured(status.connected || false);
        }
      } catch (error) {
        console.error('Failed to check camera status:', error);
      }
    };

    checkCameraStatus();
  }, []);

  // Scanner progress event listener
  useEffect(() => {
    if (!isScanning) return;

    const handleProgress = (progress: ScanProgressData) => {
      setScanProgress(progress);
    };

    const handleComplete = (result: {
      success: boolean;
      frames_captured: number;
      output_path: string;
      error?: string;
    }) => {
      setIsScanning(false);
      setScanProgress(null);

      if (result.success) {
        // Add to recent scans
        const newScan: ScanSummary = {
          id: `scan-${Date.now()}`,
          plantQrCode: metadata.plantQrCode,
          timestamp: new Date(),
          framesCaptured: result.frames_captured,
          success: true,
          outputPath: result.output_path,
        };
        setRecentScans((prev) => [newScan, ...prev].slice(0, 10)); // Keep last 10

        // Show success message
        setShowSuccessMessage(true);
        setTimeout(() => setShowSuccessMessage(false), 5000);

        // Reset metadata for next scan (optional)
        // For now, keep the same experiment/phenotyper but increment plant
      } else {
        setErrorMessage(result.error || 'Scan failed');
        setTimeout(() => setErrorMessage(null), 5000);
      }
    };

    const handleError = (error: string) => {
      setIsScanning(false);
      setScanProgress(null);
      setErrorMessage(error);
      setTimeout(() => setErrorMessage(null), 5000);
    };

    // Register listeners and get cleanup functions
    const cleanupProgress = window.electron.scanner.onProgress(handleProgress);
    const cleanupComplete = window.electron.scanner.onComplete(handleComplete);
    const cleanupError = window.electron.scanner.onError(handleError);

    // Cleanup function removes all listeners
    return () => {
      cleanupProgress();
      cleanupComplete();
      cleanupError();
    };
  }, [isScanning]); // Removed metadata.plantQrCode - barcode captured in closure when scan starts

  // Validation
  const validateMetadata = (): Partial<Record<keyof ScanMetadata, string>> => {
    const errors: Partial<Record<keyof ScanMetadata, string>> = {};

    if (!metadata.phenotyper.trim()) {
      errors.phenotyper = 'Phenotyper is required';
    }
    if (!metadata.experimentId.trim()) {
      errors.experimentId = 'Experiment ID is required';
    }
    if (metadata.waveNumber <= 0) {
      errors.waveNumber = 'Wave number must be greater than 0';
    }
    if (metadata.plantAgeDays < 0) {
      errors.plantAgeDays = 'Plant age must be 0 or greater';
    }
    if (!metadata.plantQrCode.trim()) {
      errors.plantQrCode = 'Plant ID is required';
    }
    // accession_id is optional (matches pilot schema)
    // No validation needed - empty string will be converted to undefined

    return errors;
  };

  const errors = validateMetadata();
  const isFormValid = Object.keys(errors).length === 0;
  const canStartScan =
    isFormValid &&
    cameraConfigured &&
    !isScanning &&
    !barcodeValidationError &&
    !duplicateScanWarning;

  // Start scan handler
  const handleStartScan = async () => {
    if (!canStartScan) return;

    try {
      setIsScanning(true);
      setErrorMessage(null);

      // Initialize scanner
      // Build output path from config scans_dir
      // Sanitize user input to prevent path traversal attacks
      const sanitizedPath = sanitizePath([
        metadata.experimentId,
        `${metadata.plantQrCode}_${Date.now()}`,
      ]);
      const outputPath = `${scansDir}/${sanitizedPath}`;

      await window.electron.scanner.initialize({
        camera: cameraSettings,
        daq: DEFAULT_DAQ_SETTINGS,
        num_frames: 72,
        output_path: outputPath,
        metadata: {
          experiment_id: metadata.experimentId,
          phenotyper_id: metadata.phenotyper,
          scanner_name: scannerName,
          plant_id: metadata.plantQrCode,
          accession_name: metadata.accessionName || undefined,
          plant_age_days: metadata.plantAgeDays,
          wave_number: metadata.waveNumber,
        },
      });

      // Start scan
      await window.electron.scanner.scan();
    } catch (error) {
      console.error('Failed to start scan:', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to start scan'
      );
      setIsScanning(false);
      setTimeout(() => setErrorMessage(null), 5000);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Capture Scan</h1>
          <p className="text-gray-600 mt-1">
            Enter metadata and capture a full plant scan
          </p>
        </div>

        {/* Success Message */}
        {showSuccessMessage && (
          <div className="bg-green-50 border-2 border-green-500 rounded-lg p-4">
            <div className="flex items-center">
              <svg
                className="h-5 w-5 text-green-600 mr-2"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="font-medium text-green-800">
                Scan completed successfully!
              </span>
            </div>
          </div>
        )}

        {/* Error Message */}
        {errorMessage && (
          <div className="bg-red-50 border-2 border-red-500 rounded-lg p-4">
            <div className="flex items-center">
              <svg
                className="h-5 w-5 text-red-600 mr-2"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="font-medium text-red-800">{errorMessage}</span>
            </div>
          </div>
        )}

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Sidebar: Metadata Form */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <MetadataForm
                values={metadata}
                onChange={setMetadata}
                disabled={isScanning}
                errors={errors}
                onBarcodeValidationChange={handleBarcodeValidationChange}
              />

              {/* Duplicate Scan Warning */}
              {duplicateScanWarning && (
                <div
                  className="mt-4 bg-amber-50 border-2 border-amber-400 rounded-lg p-3"
                  data-testid="duplicate-scan-warning"
                >
                  <div className="flex items-center">
                    <svg
                      className="h-5 w-5 text-amber-600 mr-2"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span className="font-medium text-amber-800">
                      {duplicateScanWarning}
                    </span>
                  </div>
                </div>
              )}

              {/* Camera Settings Review Panel (Collapsible) */}
              <div className="mt-6 pt-6 border-t border-gray-200">
                <button
                  onClick={() => setShowCameraSettings(!showCameraSettings)}
                  className="flex items-center justify-between w-full text-left"
                >
                  <span className="text-sm font-medium text-gray-700">
                    Camera Settings{' '}
                    {cameraConfigured ? (
                      <span className="text-green-600">✓</span>
                    ) : (
                      <span className="text-red-600">⚠</span>
                    )}
                  </span>
                  <svg
                    className={`h-5 w-5 text-gray-400 transform transition-transform ${
                      showCameraSettings ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>

                {showCameraSettings && (
                  <div className="mt-4">
                    {cameraConfigured ? (
                      <CameraSettingsForm
                        settings={cameraSettings}
                        onChange={(partial) =>
                          setCameraSettings((prev) => ({ ...prev, ...partial }))
                        }
                        readOnly={true}
                        showActions={false}
                      />
                    ) : (
                      <div className="text-sm text-gray-600">
                        <p className="mb-2">
                          Camera not configured. Please configure camera
                          settings first.
                        </p>
                        <a
                          href="#/camera-settings"
                          className="text-blue-600 hover:text-blue-800 font-medium"
                        >
                          Go to Camera Settings →
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Start Scan Button */}
              <div className="mt-6">
                <button
                  onClick={handleStartScan}
                  disabled={!canStartScan}
                  className={`w-full px-6 py-3 rounded-lg font-semibold text-lg shadow-md transition-all ${
                    canStartScan
                      ? 'bg-green-600 text-white hover:bg-green-700 hover:shadow-lg'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  {isScanning ? 'Scanning...' : 'Start Scan'}
                </button>
                {!isFormValid && (
                  <p className="text-sm text-red-600 mt-2">
                    Please fill in all required fields
                  </p>
                )}
                {!cameraConfigured && isFormValid && (
                  <p className="text-sm text-red-600 mt-2">
                    Camera not configured
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Right Panel: Preview / Progress */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-sm p-6">
              {isScanning && scanProgress ? (
                <ScanProgress
                  currentFrame={scanProgress.frame_number}
                  totalFrames={scanProgress.total_frames}
                />
              ) : cameraConfigured ? (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Live Preview
                  </h3>
                  <Streamer
                    settings={cameraSettings}
                    width={800}
                    height={600}
                    showFps={true}
                  />
                </div>
              ) : (
                <div
                  className="flex items-center justify-center bg-gray-100 rounded-lg"
                  style={{ width: 800, height: 600 }}
                >
                  <div className="text-center p-8">
                    <svg
                      className="mx-auto h-16 w-16 text-gray-400 mb-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                    <p className="text-lg font-medium text-gray-700 mb-2">
                      Camera Not Configured
                    </p>
                    <p className="text-sm text-gray-500 mb-4">
                      Configure camera settings to see live preview
                    </p>
                    <a
                      href="#/camera-settings"
                      className="inline-block px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
                    >
                      Configure Camera
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Recent Scans Preview */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <RecentScansPreview
            scans={recentScans}
            onViewAll={() => {
              // Future: Navigate to BrowseScans page
              console.log('View all scans (future feature)');
            }}
          />
        </div>
      </div>
    </div>
  );
}
