/**
 * CaptureScan Page
 *
 * Main page for capturing plant scans with metadata management.
 * Integrates camera preview, scanner control, and metadata input.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { buildScanPath, toRelativeScanPath } from '../utils/scan-path';
import {
  validateWaveNumber,
  validatePlantAgeDays,
} from '../utils/metadata-validation';

export function CaptureScan() {
  const navigate = useNavigate();

  // Metadata state - waveNumber and plantAgeDays are strings for validation
  const [metadata, setMetadata] = useState<ScanMetadata>({
    phenotyper: '',
    experimentId: '',
    waveNumber: '',
    plantAgeDays: '',
    plantQrCode: '',
    accessionName: '',
  });

  // Session state loaded flag
  const [sessionLoaded, setSessionLoaded] = useState(false);

  // Camera settings state
  const [cameraSettings, setCameraSettings] = useState<CameraSettings>(
    DEFAULT_CAMERA_SETTINGS
  );
  const [cameraConfigured, setCameraConfigured] = useState(false);
  const [showCameraSettings, setShowCameraSettings] = useState(false);

  // Machine config state
  const [scannerName, setScannerName] = useState('CaptureScan-UI');
  const [scansDir, setScansDir] = useState('~/.bloom/scans');
  const [scanNumFrames, setScanNumFrames] = useState<number | null>(null);
  const [scanSecondsPerRot, setScanSecondsPerRot] = useState<number | null>(
    null
  );

  // Scanning state
  const [isScanning, setIsScanning] = useState(false);
  // Ref so the onIdleReset closure ([] deps) can read current scan state without
  // going stale. Mirrors isScanning; updated via a separate useEffect below.
  const isScanningRef = useRef(false);
  const [scanProgress, setScanProgress] = useState<ScanProgressData | null>(
    null
  );

  // Recent scans state
  const [recentScans, setRecentScans] = useState<ScanSummary[]>([]);

  // UI state
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showIdleResetBanner, setShowIdleResetBanner] = useState(false);

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

  // Keep isScanningRef in sync with isScanning state so the onIdleReset closure
  // (which has [] deps) can read the current value without going stale.
  useEffect(() => {
    isScanningRef.current = isScanning;
  }, [isScanning]);

  // On mount: consume the one-shot flag so users who navigated away while idle
  // fired still see the notification when they return to this page.
  useEffect(() => {
    let mounted = true;
    window.electron.session
      .checkIdleReset()
      .then((wasReset) => {
        if (!mounted) return;
        if (wasReset) {
          // Mirror the live onIdleReset handler: clear fields AND show banner.
          setMetadata({
            phenotyper: '',
            experimentId: '',
            waveNumber: '',
            plantAgeDays: '',
            plantQrCode: '',
            accessionName: '',
          });
          setShowIdleResetBanner(true);
        }
      })
      .catch((err: unknown) => {
        console.error('[CaptureScan] checkIdleReset failed:', err);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Listen for idle session reset from main process
  useEffect(() => {
    const cleanup = window.electron.session.onIdleReset(() => {
      // Defense-in-depth: main process already prevents the timer from firing
      // during scans via pauseForScan(), but guard here against any in-flight
      // IPC messages that arrived just as a scan started.
      if (isScanningRef.current) return;
      // Consume the navigation-away flag so that if the user dismisses this
      // banner and later navigates away + back, checkIdleReset() on mount does
      // not show a stale second banner.
      window.electron.session.checkIdleReset().catch((err: unknown) => {
        console.error(
          '[CaptureScan] checkIdleReset (live handler) failed:',
          err
        );
      });
      setMetadata({
        phenotyper: '',
        experimentId: '',
        waveNumber: '',
        plantAgeDays: '',
        plantQrCode: '',
        accessionName: '',
      });
      setShowIdleResetBanner(true);
    });
    return cleanup;
  }, []);

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
        if (config.num_frames != null) {
          setScanNumFrames(config.num_frames);
        }
        if (config.seconds_per_rot != null) {
          setScanSecondsPerRot(config.seconds_per_rot);
        }
      } catch (error) {
        console.error('Failed to load machine config:', error);
      }
    };
    loadMachineConfig();
  }, []);

  // Load recent scans from database on mount
  useEffect(() => {
    const loadRecentScans = async () => {
      try {
        const result = await window.electron.database.scans.getRecent({
          limit: 10,
        });

        if (result.success && result.data) {
          // Convert database scans to ScanSummary format
          const dbScans: ScanSummary[] = result.data.map((scan) => ({
            id: scan.id,
            plantQrCode: scan.plant_id,
            timestamp: new Date(scan.capture_date),
            framesCaptured: scan.num_frames,
            success: true,
            outputPath: scan.path,
          }));

          setRecentScans(dbScans);
        }
      } catch (error) {
        console.error('Failed to load recent scans:', error);
      }
    };

    loadRecentScans();
  }, []);

  // Load session state on mount (persisted metadata across navigation)
  useEffect(() => {
    const loadSessionState = async () => {
      try {
        const session = await window.electron.session.get();
        // Only apply if there's any saved state
        // Use explicit null checks to allow 0 as a valid value for numeric fields
        if (
          session.phenotyperId !== null ||
          session.experimentId !== null ||
          session.waveNumber !== null ||
          session.plantAgeDays !== null
        ) {
          setMetadata((prev) => ({
            ...prev,
            phenotyper: session.phenotyperId ?? '',
            experimentId: session.experimentId ?? '',
            // Convert numbers from session to strings for form state
            waveNumber:
              session.waveNumber !== null ? String(session.waveNumber) : '',
            plantAgeDays:
              session.plantAgeDays !== null ? String(session.plantAgeDays) : '',
            accessionName: session.accessionName ?? '',
            // Note: plantQrCode is NOT restored - it's unique per scan
          }));
        }
        setSessionLoaded(true);
      } catch (error) {
        console.error('Failed to load session state:', error);
        setSessionLoaded(true);
      }
    };
    loadSessionState();
  }, []);

  // Save session state when metadata changes (debounced to avoid excessive IPC)
  useEffect(() => {
    // Don't save until session is loaded (avoid overwriting with initial empty state)
    if (!sessionLoaded) return;

    const saveTimeout = setTimeout(async () => {
      try {
        // Use explicit checks to preserve 0 as valid numeric values
        // String fields: empty string → null
        // Numeric fields: parse strings to numbers, empty string → null
        const waveNum = metadata.waveNumber.trim();
        const ageNum = metadata.plantAgeDays.trim();
        const waveValidation =
          waveNum !== '' ? validateWaveNumber(waveNum) : null;
        const ageValidation =
          ageNum !== '' ? validatePlantAgeDays(ageNum) : null;
        await window.electron.session.set({
          phenotyperId: metadata.phenotyper || null,
          experimentId: metadata.experimentId || null,
          waveNumber: waveValidation?.isValid ? waveValidation.value! : null,
          plantAgeDays: ageValidation?.isValid ? ageValidation.value! : null,
          accessionName: metadata.accessionName || null,
          // Note: plantQrCode is NOT saved - it's unique per scan
        });
      } catch (error) {
        console.error('Failed to save session state:', error);
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(saveTimeout);
  }, [
    sessionLoaded,
    metadata.phenotyper,
    metadata.experimentId,
    metadata.waveNumber,
    metadata.plantAgeDays,
    metadata.accessionName,
  ]);

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
      // Reset ref synchronously before setIsScanning(false) schedules a React update,
      // closing the window where the useEffect([isScanning]) mirror hasn't fired yet.
      isScanningRef.current = false;
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
          outputPath: toRelativeScanPath(result.output_path, scansDir),
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
      // Reset ref synchronously before setIsScanning(false) schedules a React update.
      isScanningRef.current = false;
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

    // Validate wave number using utility (allows 0, rejects decimals)
    const waveNumberResult = validateWaveNumber(metadata.waveNumber);
    if (!waveNumberResult.isValid) {
      errors.waveNumber = waveNumberResult.error;
    }

    // Validate plant age using utility (allows 0, rejects decimals)
    const plantAgeResult = validatePlantAgeDays(metadata.plantAgeDays);
    if (!plantAgeResult.isValid) {
      errors.plantAgeDays = plantAgeResult.error;
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
    // Guard against rapid re-invocation (e.g., double-click) before React
    // re-renders with the disabled button state.
    if (isScanningRef.current) return;

    // Set the ref synchronously BEFORE any await so the onIdleReset closure
    // (registered with [] deps) sees the correct scanning state immediately.
    // setIsScanning(true) below only schedules a React update; the useEffect that
    // mirrors it into isScanningRef runs after re-render, creating a window where
    // in-flight IPC messages could bypass the guard without this line.
    isScanningRef.current = true;

    try {
      setIsScanning(true);
      setErrorMessage(null);
      setShowIdleResetBanner(false);

      // Initialize scanner
      // Build pilot-compatible scan directory path: YYYY-MM-DD/<plant_qr_code>/<scan_uuid>
      const scanUuid = crypto.randomUUID();
      const relativePath = buildScanPath(metadata.plantQrCode, scanUuid);
      const outputPath = `${scansDir}/${relativePath}`;

      const numFrames = scanNumFrames ?? 72;
      const secondsPerRot = scanSecondsPerRot ?? 7.0;

      await window.electron.scanner.initialize({
        camera: cameraSettings,
        daq: {
          ...DEFAULT_DAQ_SETTINGS,
          num_frames: numFrames,
          seconds_per_rot: secondsPerRot,
        },
        num_frames: numFrames,
        output_path: outputPath,
        metadata: {
          experiment_id: metadata.experimentId,
          phenotyper_id: metadata.phenotyper,
          scanner_name: scannerName,
          plant_id: metadata.plantQrCode,
          accession_name: metadata.accessionName || undefined,
          plant_age_days: parseInt(metadata.plantAgeDays, 10),
          wave_number: parseInt(metadata.waveNumber, 10),
          scan_path: relativePath,
        },
      });

      // Start scan
      await window.electron.scanner.scan();
    } catch (error) {
      // Reset ref synchronously before setIsScanning(false) schedules a React update,
      // mirroring the synchronous-set discipline applied at scan start (isScanningRef = true).
      // This closes the window between setIsScanning(false) and the useEffect([isScanning])
      // flush, preventing the double-click guard from blocking retries and ensuring idle
      // reset IPC messages are not suppressed during error recovery.
      isScanningRef.current = false;
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

        {/* Idle Reset Notification */}
        {showIdleResetBanner && (
          <div
            className="bg-amber-50 border-2 border-amber-500 rounded-lg p-4"
            data-testid="idle-reset-notification"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <svg
                  className="h-5 w-5 text-amber-600 mr-2"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="font-medium text-amber-800">
                  Session reset after 10 minutes of inactivity. Phenotyper,
                  experiment, wave number, plant age, accession name, and plant
                  QR code have been cleared. Please re-enter all fields to
                  continue.
                </span>
              </div>
              <button
                onClick={() => setShowIdleResetBanner(false)}
                className="ml-4 text-amber-600 hover:text-amber-800"
                data-testid="idle-reset-dismiss"
                aria-label="Dismiss idle reset notification"
              >
                <svg
                  className="h-5 w-5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
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

              {/* Scan Parameters (read-only from Machine Configuration) */}
              <div className="mt-4 text-sm text-gray-500">
                {scanNumFrames ?? 72} frames, ~{scanSecondsPerRot ?? 7.0}s
                rotation
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
                {barcodeValidationError && isFormValid && (
                  <p className="text-sm text-red-600 mt-2">
                    {barcodeValidationError}
                  </p>
                )}
                {!cameraConfigured &&
                  isFormValid &&
                  !barcodeValidationError && (
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
            onViewAll={() => navigate('/browse-scans')}
          />
        </div>
      </div>
    </div>
  );
}
