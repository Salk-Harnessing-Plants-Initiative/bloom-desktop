/**
 * GraviScan Component
 *
 * UI for GraviScan flatbed scanner functionality including:
 * - Scanner detection and configuration
 * - Grid mode and resolution settings
 * - Plate scanning with progress tracking
 */

import { useState, useEffect } from 'react';
import type { DetectedScanner, ScannerPanelState } from '../types/graviscan';
import { createPlateAssignments, formatPlateIndex } from '../types/graviscan';
import { ScanPreview } from './components/ScanPreview';
import { ImageLightbox } from './components/ImageLightbox';
import { useWaveNumber } from './hooks/useWaveNumber';
import { useContinuousMode } from './hooks/useContinuousMode';
import { useTestScan } from './hooks/useTestScan';
import { useScannerStatus } from './hooks/useScannerStatus';
import { usePlateAssignments } from './hooks/usePlateAssignments';
import { useScanSession } from './hooks/useScanSession';
import { ScannerStatusPanel } from './components/graviscan/ScannerStatusPanel';
import { ScanFileBrowser } from './components/graviscan/ScanFileBrowser';
import {
  ScanFormSection,
  type ListItem,
} from './components/graviscan/ScanFormSection';
import { ScanControlSection } from './components/graviscan/ScanControlSection';

export function GraviScan() {
  // Scanner panel states
  const [scannerStates, setScannerStates] = useState<ScannerPanelState[]>([]);

  // File browser state
  const [showFileBrowser, setShowFileBrowser] = useState(true);
  const [fileBrowserWidth, setFileBrowserWidth] = useState(() => {
    try {
      return parseInt(
        localStorage.getItem('graviscan:fileBrowserWidth') || '300',
        10
      );
    } catch {
      return 300;
    }
  });
  const [writingFiles, setWritingFiles] = useState<Set<string>>(new Set());
  // Map plateKey → imagePath for completed scans (used to link verification results to files)
  const [completedFilePaths, setCompletedFilePaths] = useState<
    Record<string, string>
  >({});

  // Track which files are currently being written
  useEffect(() => {
    const cleanupStarted = window.electron.graviscan.onScanStarted((data) => {
      // File path comes from the session jobs — get it from scan status
      window.electron.graviscan.getScanStatus().then((status) => {
        if (!status?.jobs) return;
        const jobKey = `${data.scannerId}:${data.plateIndex}`;
        const job = status.jobs[jobKey];
        if (job?.outputPath) {
          setWritingFiles((prev) => new Set([...prev, job.outputPath]));
        }
      });
    });

    const cleanupComplete = window.electron.graviscan.onScanComplete((data) => {
      if (data.imagePath) {
        const plateKey = `${data.scannerId}:${data.plateIndex}`;
        setCompletedFilePaths((prev) => ({
          ...prev,
          [plateKey]: data.imagePath,
        }));
        setWritingFiles((prev) => {
          const next = new Set(prev);
          next.delete(data.imagePath);
          return next;
        });
      }
    });

    return () => {
      cleanupStarted();
      cleanupComplete();
    };
  }, []);

  // Scanner configuration (extracted hook)
  const {
    platformInfo,
    detectedScanners,
    scannerAssignments,
    resolution,
    setResolution,
    configSaved,
    sessionValidated,
    isValidating,
    resolutionRef,
    isLoading: platformLoading,
    scannerStatuses,
  } = useScannerStatus();

  // Scan form state
  const [experiments, setExperiments] = useState<ListItem[]>([]);
  const [phenotypers, setPhenotypers] = useState<ListItem[]>([]);
  const [selectedExperiment, setSelectedExperiment] = useState<string>('');
  const [selectedPhenotyper, setSelectedPhenotyper] = useState<string>('');

  // Scan completion counter — bumped after each scan to re-check barcode conflicts
  const [scanCompletionCounter, setScanCompletionCounter] = useState(0);

  // Scan operation state
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanSuccess, setScanSuccess] = useState<string | null>(null);

  // Plate assignments (extracted hook)
  const {
    scannerPlateAssignments,
    scannerPlateAssignmentsRef,
    availableBarcodes,
    loadingBarcodes,
    barcodeGenotypes,
    isGraviMetadata,
    availablePlates,
    handleTogglePlate,
    handlePlateBarcode,
  } = usePlateAssignments({
    selectedExperiment,
    scannerAssignments,
    setScanError,
  });

  // Wave tracking (extracted hook)
  const {
    waveNumber,
    setWaveNumber,
    suggestedWaveNumber,
    barcodeWaveConflicts,
    waveRestoredRef,
  } = useWaveNumber({
    selectedExperiment,
    scannerPlateAssignments,
    scanCompletionCounter,
  });

  // Get assigned scanner IDs (scanners that have been assigned to slots)
  const assignedScannerIds = scannerAssignments
    .filter((a) => a.scannerId !== null)
    .map((a) => a.scannerId as string);

  // Legacy - kept for compatibility, now aggregates across all scanners
  const selectedPlates = Object.values(scannerPlateAssignments)
    .flat()
    .filter((p) => p.selected)
    .map((p) => p.plateIndex);

  // Continuous scan mode (extracted hook)
  const {
    scanMode,
    setScanMode,
    scanIntervalMinutes,
    setScanIntervalMinutes,
    scanDurationMinutes,
    setScanDurationMinutes,
    currentCycle,
    setCurrentCycle,
    totalCycles,
    setTotalCycles,
    intervalCountdown,
    setIntervalCountdown,
    overtimeMs,
    elapsedSeconds,
    scanModeRef,
    cycleCompletedCountRef,
    startElapsedTimer,
    startCountdown,
    startOvertime,
    clearCountdownAndOvertime,
    clearAllTimers,
  } = useContinuousMode(isScanning);

  // Scan session (extracted hook)
  const {
    scanImageUris,
    setScanImageUris,
    scanningPlateIndex,
    setScanningPlateIndex,
    handleStartScan,
    handleCancelScan,
    handleResetScanners,
    verificationStatus,
    verificationResults,
  } = useScanSession({
    scannerStates,
    setScannerStates,
    isScanning,
    setIsScanning,
    setScanError,
    setScanSuccess,
    setScanCompletionCounter,
    scannerAssignments,
    detectedScanners,
    platformInfo,
    resolution,
    resolutionRef,
    setResolution,
    scannerPlateAssignments,
    scannerPlateAssignmentsRef,
    waveNumber,
    setWaveNumber,
    waveRestoredRef,
    scanMode,
    scanIntervalMinutes,
    scanDurationMinutes,
    scanModeRef,
    cycleCompletedCountRef,
    setCurrentCycle,
    setTotalCycles,
    setIntervalCountdown,
    startElapsedTimer,
    startCountdown,
    startOvertime,
    clearCountdownAndOvertime,
    clearAllTimers,
    selectedExperiment,
    setSelectedExperiment,
    selectedPhenotyper,
    setSelectedPhenotyper,
    experiments,
    assignedScannerIds,
    selectedPlates,
  });

  // Test scanning (extracted hook)
  const {
    isTesting,
    testPhase,
    testResults,
    testComplete,
    handleTestAllScanners,
  } = useTestScan({
    scannerAssignments,
    detectedScanners,
    setScanningPlateIndex,
    setScanImageUris,
  });

  // Lightbox state for viewing scan images fullscreen
  const [lightboxImage, setLightboxImage] = useState<{
    src: string;
    caption: string;
  } | null>(null);

  // Load form data on mount
  useEffect(() => {
    loadExperiments();
    loadPhenotypers();
  }, []);

  // Initialize scanner states from assigned scanners (not all detected)
  useEffect(() => {
    // Only show scanners that are assigned to a slot
    const assignedScanners = scannerAssignments
      .filter((assignment) => assignment.scannerId !== null)
      .map((assignment) => {
        const scanner = detectedScanners.find(
          (s) => s.scanner_id === assignment.scannerId
        );
        return scanner ? { scanner, slot: assignment.slot } : null;
      })
      .filter(
        (item): item is { scanner: DetectedScanner; slot: string } =>
          item !== null
      );

    const states: ScannerPanelState[] = assignedScanners.map(
      ({ scanner, slot }) => ({
        scannerId: scanner.scanner_id,
        name: slot, // Use slot name (e.g., "Scanner 1") instead of device name
        enabled: true,
        isOnline: scanner.is_available,
        isBusy: false,
        state: 'idle',
        progress: 0,
        outputFilename: '',
      })
    );
    setScannerStates(states);
  }, [detectedScanners, scannerAssignments]);

  async function loadExperiments() {
    try {
      const result = await window.electron.database.experiments.list();
      if (!result.success || !result.data) {
        console.error('Failed to load experiments:', result.error);
        return;
      }
      // Filter to only graviscan experiments
      const graviscanExperiments = result.data.filter(
        (exp: { experiment_type?: string }) =>
          exp.experiment_type === 'graviscan'
      );
      setExperiments(
        graviscanExperiments.map((exp: { id: string; name: string }) => ({
          id: exp.id,
          name: exp.name,
        }))
      );
    } catch (error) {
      console.error('Failed to load experiments:', error);
    }
  }

  async function loadPhenotypers() {
    try {
      const result = await window.electron.database.phenotypers.list();
      if (!result.success || !result.data) {
        console.error('Failed to load phenotypers:', result.error);
        return;
      }
      setPhenotypers(
        result.data.map((p: { id: string; name: string }) => ({
          id: p.id,
          name: p.name,
        }))
      );
    } catch (error) {
      console.error('Failed to load phenotypers:', error);
    }
  }

  // Show loading state
  if (platformLoading) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
        <p className="text-gray-500 mt-4">Loading GraviScan...</p>
      </div>
    );
  }

  // Show unsupported platform message
  if (platformInfo && !platformInfo.supported) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-12 text-center">
        <svg
          className="mx-auto h-16 w-16 text-yellow-500 mb-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          GraviScan Not Supported
        </h3>
        <p className="text-gray-500">
          GraviScan is only available on Linux and Windows.
          <br />
          macOS is not supported due to scanner driver limitations.
        </p>
      </div>
    );
  }

  // Can scan only if session is validated, config is saved, and scanners detected
  const canScan =
    sessionValidated && configSaved && detectedScanners.length > 0;

  // Count selected plates with assigned barcodes (across all scanners)
  const selectedPlatesWithBarcodes = Object.values(scannerPlateAssignments)
    .flat()
    .filter((p) => p.selected && p.plantBarcode);

  // Form validation - check if all required fields are filled
  const hasBarcodeConflicts = Object.keys(barcodeWaveConflicts).length > 0;
  const isFormValid =
    selectedExperiment !== '' &&
    selectedPhenotyper !== '' &&
    selectedPlates.length > 0 &&
    !hasBarcodeConflicts;
  const scannersReady = scannerStatuses.some((s) => s.status === 'ready');
  const canStartScan = canScan && isFormValid && scannersReady;

  // Build validation messages for missing fields
  const validationMessages: string[] = [];
  if (!selectedExperiment) validationMessages.push('Experiment');
  if (!selectedPhenotyper) validationMessages.push('Phenotyper');

  return (
    <div className="space-y-6">
      {isScanning && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 sticky top-0 z-40">
          <div className="flex items-center">
            <svg
              className="animate-spin h-5 w-5 text-blue-500 mr-3"
              fill="none"
              viewBox="0 0 24 24"
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
            <span className="text-blue-700 text-sm font-medium">
              Scan in Progress
            </span>
          </div>
        </div>
      )}

      {verificationStatus === 'verifying' && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 sticky top-0 z-40">
          <div className="flex items-center">
            <svg
              className="animate-spin h-5 w-5 text-purple-500 mr-3"
              fill="none"
              viewBox="0 0 24 24"
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
            <span className="text-purple-700 text-sm font-medium">
              QR Verification in Progress...
            </span>
          </div>
        </div>
      )}

      {verificationStatus === 'complete' &&
        (() => {
          const needsReview = Object.entries(verificationResults).filter(
            ([, r]) => r.status === 'needs_review'
          );
          const duplicates = Object.entries(verificationResults).filter(
            ([, r]) => r.status === 'duplicate_qr'
          );
          const hasIssues = needsReview.length > 0 || duplicates.length > 0;

          return (
            <div
              className={`rounded-lg p-4 ${
                hasIssues
                  ? duplicates.length > 0
                    ? 'bg-red-50 border border-red-200'
                    : 'bg-amber-50 border border-amber-200'
                  : 'bg-green-50 border border-green-200'
              }`}
            >
              <span
                className={`text-sm font-medium ${
                  hasIssues
                    ? duplicates.length > 0
                      ? 'text-red-700'
                      : 'text-amber-700'
                    : 'text-green-700'
                }`}
              >
                {duplicates.length > 0
                  ? 'QR Verification — Duplicate QR Codes Detected'
                  : needsReview.length > 0
                    ? 'QR Verification — Manual Review Needed'
                    : 'QR Verification Complete'}
              </span>
              {duplicates.length > 0 && (
                <div className="mt-2 text-xs text-red-600 space-y-1">
                  {duplicates.map(([key, r]) => (
                    <div key={key}>
                      Grid {key.split(':')[1]}: duplicate QR code
                      {r.duplicateQrCodes && (
                        <span className="ml-1">
                          ({r.duplicateQrCodes.join(', ')})
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {needsReview.length > 0 && (
                <div className="mt-2 text-xs text-amber-600 space-y-1">
                  {needsReview.map(([key, r]) => (
                    <div key={key}>
                      Grid {key.split(':')[1]}: QR codes map to different plates
                      {r.inconsistentMappings && (
                        <span className="ml-1">
                          (
                          {Object.entries(r.inconsistentMappings)
                            .map(([pid, codes]) => `${pid}: ${codes.length} QR`)
                            .join(', ')}
                          )
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

      <ScannerStatusPanel
        isTesting={isTesting}
        testPhase={testPhase}
        testResults={testResults}
        testComplete={testComplete}
        handleTestAllScanners={handleTestAllScanners}
        isScanning={isScanning}
      />

      {/* Scanner Preview + File Browser — Split Layout */}
      <div className="flex pr-2" style={{ maxHeight: '500px' }}>
        {/* Scanner Preview Section */}
        <div
          className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 overflow-auto"
          style={{ flex: showFileBrowser ? '1 1 0' : '1 1 100%' }}
        >
          <ScanPreview
            scanners={scannerAssignments
              .filter((a) => a.scannerId !== null)
              .map((assignment) => {
                const scannerId = assignment.scannerId!;
                const result = testResults[scannerId];
                const scanningInProgress = result?.error === 'Scanning...';
                const scannerState = scannerStates.find(
                  (s) => s.scannerId === scannerId
                );
                const isScanningProduction =
                  scannerState?.state === 'scanning' && scannerState?.isBusy;
                const isTestingThisScanner = isTesting && !result?.success;
                return {
                  assignment,
                  plateAssignments:
                    scannerPlateAssignments[scannerId] ||
                    createPlateAssignments(assignment.gridMode || '2grid'),
                  testResult: result,
                  plateImages: scanImageUris[scannerId] || {},
                  scanningPlateIndex: scanningPlateIndex[scannerId],
                  isScanning:
                    scanningInProgress ||
                    isScanningProduction ||
                    isTestingThisScanner,
                  scanProgress: isScanningProduction
                    ? scannerState?.progress
                    : undefined,
                };
              })}
            onImageClick={(imageUri, plateIndex) =>
              setLightboxImage({
                src: imageUri,
                caption: `Plate ${formatPlateIndex(plateIndex)}`,
              })
            }
          />
        </div>

        {/* Draggable Divider + Arrow Toggle */}
        <div className="flex flex-col items-center flex-shrink-0 select-none">
          {/* Arrow toggle button */}
          <button
            onClick={() => {
              const next = !showFileBrowser;
              setShowFileBrowser(next);
              localStorage.setItem(
                'graviscan:fileBrowserVisible',
                String(next)
              );
            }}
            className="p-1 text-gray-600 hover:text-gray-900 transition-colors"
            title={
              showFileBrowser ? 'Collapse file browser' : 'Expand file browser'
            }
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={showFileBrowser ? 'M9 5l7 7-7 7' : 'M15 19l-7-7 7-7'}
              />
            </svg>
          </button>

          {/* Visible draggable divider line */}
          {showFileBrowser && (
            <div
              className="flex-1 w-1 bg-gray-200 hover:bg-blue-400 rounded cursor-col-resize transition-colors"
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startWidth = fileBrowserWidth;
                const onMouseMove = (moveE: MouseEvent) => {
                  const delta = startX - moveE.clientX;
                  const newWidth = Math.max(
                    200,
                    Math.min(500, startWidth + delta)
                  );
                  setFileBrowserWidth(newWidth);
                };
                const onMouseUp = () => {
                  document.removeEventListener('mousemove', onMouseMove);
                  document.removeEventListener('mouseup', onMouseUp);
                  localStorage.setItem(
                    'graviscan:fileBrowserWidth',
                    String(fileBrowserWidth)
                  );
                };
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
              }}
            />
          )}
        </div>

        {/* File Browser Panel */}
        {showFileBrowser && (
          <div
            className="bg-white rounded-xl shadow-sm border border-gray-200 flex-shrink-0 flex flex-col overflow-hidden"
            style={{
              width: fileBrowserWidth,
              minWidth: 200,
              maxWidth: 500,
              maxHeight: '500px',
            }}
          >
            {/* Header */}
            <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 rounded-t-xl flex-shrink-0">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Scan Files
              </span>
            </div>

            {/* File list */}
            <div className="flex-1 overflow-hidden">
              <ScanFileBrowser
                isScanning={isScanning}
                writingFiles={writingFiles}
                needsReviewFiles={
                  new Set(
                    Object.entries(verificationResults)
                      .filter(([, r]) => r.status === 'needs_review')
                      .map(([key]) => completedFilePaths[key])
                      .filter(Boolean)
                  )
                }
              />
            </div>
          </div>
        )}
      </div>

      {/* Image Lightbox */}
      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage.src}
          caption={lightboxImage.caption}
          onClose={() => setLightboxImage(null)}
        />
      )}

      {/* Scanner config section removed — configure scanners in Machine Config */}

      {/* Scan Section */}
      <div
        className={`bg-white rounded-lg shadow-sm p-6 relative ${!canScan || isValidating ? 'opacity-50' : ''}`}
      >
        {(!canScan || isValidating) && (
          <div className="absolute inset-0 bg-gray-100 bg-opacity-75 rounded-lg flex items-center justify-center z-10">
            <div className="text-center">
              {isValidating ? (
                <>
                  {/* Spinner for validation in progress */}
                  <svg
                    className="animate-spin mx-auto h-12 w-12 text-blue-500"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  <p className="mt-2 text-sm font-medium text-gray-600">
                    Scanner Connection Validation in Progress...
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    Checking if previously configured scanners are available
                  </p>
                </>
              ) : !sessionValidated ? (
                <>
                  {/* Refresh/Detect icon for session validation */}
                  <svg
                    className="mx-auto h-12 w-12 text-blue-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  <p className="mt-2 text-sm font-medium text-gray-600">
                    Detect scanners to enable scanning
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    Scanner validation required each session
                  </p>
                </>
              ) : (
                <>
                  {/* Lock icon for configuration needed */}
                  <svg
                    className="mx-auto h-12 w-12 text-gray-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                  <p className="mt-2 text-sm font-medium text-gray-600">
                    Save configuration to enable scanning
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        <h2 className="text-lg font-semibold text-gray-900 mb-4">Scan</h2>

        {/* Scan Form */}
        <ScanFormSection
          experiments={experiments}
          selectedExperiment={selectedExperiment}
          setSelectedExperiment={setSelectedExperiment}
          phenotypers={phenotypers}
          selectedPhenotyper={selectedPhenotyper}
          setSelectedPhenotyper={setSelectedPhenotyper}
          waveNumber={waveNumber}
          setWaveNumber={setWaveNumber}
          suggestedWaveNumber={suggestedWaveNumber}
          barcodeWaveConflicts={barcodeWaveConflicts}
          hasBarcodeConflicts={hasBarcodeConflicts}
          scannerPlateAssignments={scannerPlateAssignments}
          scannerAssignments={scannerAssignments}
          detectedScanners={detectedScanners}
          assignedScannerIds={assignedScannerIds}
          selectedPlates={selectedPlates}
          selectedPlatesWithBarcodes={selectedPlatesWithBarcodes}
          availableBarcodes={availableBarcodes}
          loadingBarcodes={loadingBarcodes}
          availablePlates={availablePlates}
          barcodeGenotypes={barcodeGenotypes}
          isGraviMetadata={isGraviMetadata}
          handleTogglePlate={handleTogglePlate}
          handlePlateBarcode={handlePlateBarcode}
          isScanning={isScanning}
          verificationResults={verificationResults}
        />

        <ScanControlSection
          scanError={scanError}
          scanSuccess={scanSuccess}
          sessionValidated={sessionValidated}
          scannerStates={scannerStates}
          handleToggleScannerEnabled={() => {}}
          isScanning={isScanning}
          canScan={canScan}
          isFormValid={isFormValid}
          canStartScan={canStartScan}
          validationMessages={validationMessages}
          scanMode={scanMode}
          setScanMode={setScanMode}
          scanIntervalMinutes={scanIntervalMinutes}
          setScanIntervalMinutes={setScanIntervalMinutes}
          scanDurationMinutes={scanDurationMinutes}
          setScanDurationMinutes={setScanDurationMinutes}
          currentCycle={currentCycle}
          totalCycles={totalCycles}
          intervalCountdown={intervalCountdown}
          elapsedSeconds={elapsedSeconds}
          overtimeMs={overtimeMs}
          handleStartScan={handleStartScan}
          handleCancelScan={handleCancelScan}
          handleResetScanners={handleResetScanners}
        />
      </div>
    </div>
  );
}
