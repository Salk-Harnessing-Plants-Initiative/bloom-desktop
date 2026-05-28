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

/**
 * Compute the maximum platesPerScanner across enabled scanner panels.
 *
 * The cadence-warning banner (#235) needs to know the slowest cycle —
 * since all scanners run in parallel, the cycle takes as long as the
 * scanner with the most plates. Today `ScannerPanelState` does not
 * carry per-scanner gridMode, so this helper falls back to 4 (the
 * worst-case production default) to avoid masking the back-to-back
 * behavior we filed #235 against. When ScannerPanelState gains a
 * gridMode field, change the body to read from it.
 *
 * Returns 4 (worst-case) when no enabled scanners are present so the
 * banner can still evaluate sensibly at form-fill time.
 */
function cadenceFallbackPlatesPerScanner(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _states: ScannerPanelState[]
): number {
  // Honest naming: this is a worst-case fallback, not a real
  // computation. ScannerPanelState doesn't expose gridMode yet, so we
  // can't compute the actual max across enabled panels. Always returns
  // 4 (production default + worst case), which makes the cadence
  // warning conservative: it fires whenever ANY grid_mode would
  // back-to-back at the operator's interval. Per Copilot PR #237
  // review (the previous "computeMax" name promised computation it
  // didn't deliver).
  //
  // When ScannerPanelState gains a gridMode field (see follow-up
  // #239 / future task), replace the body with:
  //   _states.filter(s => s.enabled).reduce(
  //     (m, s) => Math.max(m, s.gridMode === '4grid' ? 4 : 2), 0
  //   ) || 4
  return 4;
}

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
  // Map plateKey → imagePath for completed scans (used to link verification results to files)
  const [completedFilePaths, setCompletedFilePaths] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    const cleanupComplete = window.electron.graviscan.onScanComplete((data) => {
      if (data.imagePath) {
        const plateKey = `${data.scannerId}:${data.plateIndex}`;
        setCompletedFilePaths((prev) => ({
          ...prev,
          [plateKey]: data.imagePath,
        }));
      }
    });

    return () => {
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

  // Wave state — lifted here so usePlateAssignments can read the current
  // wave to look up GraviExperimentWaveMetadata for graviscan experiments.
  const [waveNumber, setWaveNumber] = useState<number>(0);

  // Plate assignments (extracted hook)
  const {
    scannerPlateAssignments,
    scannerPlateAssignmentsRef,
    availableBarcodes,
    loadingBarcodes,
    barcodeGenotypes,
    isGraviMetadata,
    availablePlates,
    waveMissingMetadata,
    handleTogglePlate,
    handlePlateBarcode,
  } = usePlateAssignments({
    selectedExperiment,
    scannerAssignments,
    setScanError,
    waveNumber,
  });

  // Wave tracking (extracted hook — auto-suggest, conflict detection)
  const { suggestedWaveNumber, barcodeWaveConflicts, waveRestoredRef } =
    useWaveNumber({
      selectedExperiment,
      scannerPlateAssignments,
      scanCompletionCounter,
      waveNumber,
      setWaveNumber,
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
    currentSessionDir,
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
    phenotypers,
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
  const canStartScan =
    canScan && isFormValid && scannersReady && !waveMissingMetadata;

  // Build validation messages for missing fields
  const validationMessages: string[] = [];
  if (!selectedExperiment) validationMessages.push('Experiment');
  if (!selectedPhenotyper) validationMessages.push('Phenotyper');
  if (waveMissingMetadata)
    validationMessages.push(`Metadata for wave ${waveNumber}`);

  return (
    <div className="space-y-6">
      {/*
        Mock-mode banner — visible when GRAVISCAN_MOCK=true so the
        operator (or E2E harness) can see at a glance that no real
        scanners are involved. Wired here rather than via the dead-
        code `ConfigStatusBanner` component (which is currently
        unused on this page). Asserted by
        tests/e2e/graviscan-workflow.e2e.ts:132.
      */}
      {platformInfo?.mock_enabled && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <div className="flex items-center">
            <svg
              className="h-4 w-4 text-yellow-400 mr-2"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-yellow-700 text-xs font-medium">
              Mock Mode - Simulated scanners
            </span>
          </div>
        </div>
      )}
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

      {waveMissingMetadata && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start">
            <svg
              className="h-5 w-5 text-red-500 mr-3 flex-shrink-0 mt-0.5"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a1 1 0 011 1v3a1 1 0 11-2 0V7a1 1 0 011-1zm0 8a1 1 0 100-2 1 1 0 000 2z"
                clipRule="evenodd"
              />
            </svg>
            <div className="flex-1">
              <p className="text-red-800 text-sm font-medium">
                You cannot scan without adding metadata for wave {waveNumber}
              </p>
              <p className="text-red-700 text-xs mt-1">
                Link a metadata file to wave {waveNumber} on the Experiments
                page before scanning.
              </p>
            </div>
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
                needsReviewFiles={
                  new Set(
                    Object.entries(verificationResults)
                      .filter(([, r]) => r.status === 'needs_review')
                      .map(([key]) => completedFilePaths[key])
                      .filter(Boolean)
                  )
                }
                sessionDir={currentSessionDir}
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
          cadenceContext={{
            // Compute the maximum platesPerScanner across enabled
            // scanner panels. Each panel's gridMode is "2grid" (2
            // plates) or "4grid" (4 plates); the cycle is bounded by
            // the slowest scanner so we take the MAX (per design.md
            // Decision 7 and the per-cycle parallelism note).
            //
            // If gridMode info isn't surfaced on ScannerPanelState
            // yet, falls back to 4 (worst case) to avoid masking the
            // back-to-back behavior we filed #235 against.
            platesPerScanner: cadenceFallbackPlatesPerScanner(scannerStates),
            dpi: resolution,
          }}
        />
      </div>
    </div>
  );
}
