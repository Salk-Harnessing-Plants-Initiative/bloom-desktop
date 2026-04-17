/**
 * GraviScan scanning page
 *
 * Orchestrates scanner configuration, plate assignments, scan session,
 * continuous mode, and test scans. Renders scanner status panel,
 * scan form with mode toggle, scan controls, and session summary.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useScannerConfig } from '../hooks/useScannerConfig';
import { usePlateAssignments } from '../hooks/usePlateAssignments';
import { useContinuousMode } from '../hooks/useContinuousMode';
import { useScanSession } from '../hooks/useScanSession';
import { useTestScan } from '../hooks/useTestScan';
import { useWaveNumber } from '../hooks/useWaveNumber';
import { ScanControlSection } from '../../components/graviscan/ScanControlSection';
import type { ScannerPanelState } from '../../types/graviscan';

// ─── Local types ────────────────────────────────────────────

interface ListItem {
  id: string;
  name: string;
}

// ─── Component ──────────────────────────────────────────────

export function GraviScan() {
  // ── Form state ────────────────────────────────────────────

  const [selectedExperiment, setSelectedExperiment] = useState('');
  const [selectedPhenotyper, setSelectedPhenotyper] = useState('');
  const [experiments, setExperiments] = useState<ListItem[]>([]);
  const [phenotypers, setPhenotypers] = useState<ListItem[]>([]);

  // ── Scan state ────────────────────────────────────────────

  const [scannerStates, setScannerStates] = useState<ScannerPanelState[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanSuccess, setScanSuccess] = useState<string | null>(null);
  const [scanCompletionCounter, setScanCompletionCounter] = useState(0);
  const [eventLog, setEventLog] = useState<string[]>([]);

  // ── Hooks ─────────────────────────────────────────────────

  const scannerConfig = useScannerConfig({ setScannerStates });

  const continuousMode = useContinuousMode(isScanning);

  const plateAssignments = usePlateAssignments({
    selectedExperiment,
    scannerAssignments: scannerConfig.scannerAssignments,
    setScanError,
  });

  const waveNumber = useWaveNumber({
    selectedExperiment,
    scannerPlateAssignments: plateAssignments.scannerPlateAssignments,
    scanCompletionCounter,
  });

  // Derived values
  const assignedScannerIds = useMemo(
    () =>
      scannerConfig.scannerAssignments
        .filter((a) => a.scannerId !== null)
        .map((a) => a.scannerId as string),
    [scannerConfig.scannerAssignments]
  );

  const selectedPlates = useMemo(() => {
    const plates: string[] = [];
    for (const [, assignments] of Object.entries(
      plateAssignments.scannerPlateAssignments
    )) {
      for (const plate of assignments) {
        if (plate.selected) {
          plates.push(plate.plateIndex);
        }
      }
    }
    return plates;
  }, [plateAssignments.scannerPlateAssignments]);

  const scanSession = useScanSession({
    scannerStates,
    setScannerStates,
    isScanning,
    setIsScanning,
    setScanError,
    setScanSuccess,
    setScanCompletionCounter,
    scannerAssignments: scannerConfig.scannerAssignments,
    detectedScanners: scannerConfig.detectedScanners,
    platformInfo: scannerConfig.platformInfo,
    resolution: scannerConfig.resolution,
    resolutionRef: scannerConfig.resolutionRef,
    setResolution: scannerConfig.setResolution,
    scannerPlateAssignments: plateAssignments.scannerPlateAssignments,
    scannerPlateAssignmentsRef: plateAssignments.scannerPlateAssignmentsRef,
    waveNumber: waveNumber.waveNumber,
    setWaveNumber: waveNumber.setWaveNumber,
    waveRestoredRef: waveNumber.waveRestoredRef,
    scanMode: continuousMode.scanMode,
    scanIntervalMinutes: continuousMode.scanIntervalMinutes,
    scanDurationMinutes: continuousMode.scanDurationMinutes,
    scanModeRef: continuousMode.scanModeRef,
    cycleCompletedCountRef: continuousMode.cycleCompletedCountRef,
    setCurrentCycle: continuousMode.setCurrentCycle,
    setTotalCycles: continuousMode.setTotalCycles,
    setIntervalCountdown: continuousMode.setIntervalCountdown,
    startElapsedTimer: continuousMode.startElapsedTimer,
    startCountdown: continuousMode.startCountdown,
    startOvertime: continuousMode.startOvertime,
    clearCountdownAndOvertime: continuousMode.clearCountdownAndOvertime,
    clearAllTimers: continuousMode.clearAllTimers,
    selectedExperiment,
    setSelectedExperiment,
    selectedPhenotyper,
    setSelectedPhenotyper,
    experiments,
    assignedScannerIds,
    selectedPlates,
  });

  const testScan = useTestScan({
    scannerAssignments: scannerConfig.scannerAssignments,
    detectedScanners: scannerConfig.detectedScanners,
    setScanningPlateIndex: scanSession.setScanningPlateIndex,
    setScanImageUris: scanSession.setScanImageUris,
  });

  // ── Event log capture ─────────────────────────────────────

  const addLogEntry = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setEventLog((prev) => [`[${timestamp}] ${message}`, ...prev].slice(0, 200));
  }, []);

  // Log scan state changes
  useEffect(() => {
    if (isScanning) {
      addLogEntry('Scan started');
    }
  }, [isScanning, addLogEntry]);

  useEffect(() => {
    if (scanError) {
      addLogEntry(`Error: ${scanError}`);
    }
  }, [scanError, addLogEntry]);

  useEffect(() => {
    if (scanSuccess) {
      addLogEntry(`Success: ${scanSuccess}`);
    }
  }, [scanSuccess, addLogEntry]);

  // ── Load form data ────────────────────────────────────────

  useEffect(() => {
    async function loadFormData() {
      try {
        const expResult = await window.electron.database.experiments.list();
        if (expResult.success && expResult.data) {
          const data = expResult.data as Array<{
            id: string;
            name: string;
            species: string;
          }>;
          setExperiments(
            data.map((e) => ({ id: e.id, name: `${e.species} - ${e.name}` }))
          );
        }

        const phenResult = await window.electron.database.phenotypers.list();
        if (phenResult.success && phenResult.data) {
          const data = phenResult.data as Array<{ id: string; name: string }>;
          setPhenotypers(data.map((p) => ({ id: p.id, name: p.name })));
        }
      } catch (err) {
        console.error('[GraviScan] Failed to load form data:', err);
      }
    }
    loadFormData();
  }, []);

  // ── Initialize scanner panel states from assignments ──────

  useEffect(() => {
    const newStates: ScannerPanelState[] = scannerConfig.scannerAssignments
      .filter((a) => a.scannerId !== null)
      .map((a) => {
        const detected = scannerConfig.detectedScanners.find(
          (d) => d.scanner_id === a.scannerId
        );
        const existing = scannerStates.find((s) => s.scannerId === a.scannerId);
        if (existing) return existing;
        return {
          scannerId: a.scannerId!,
          name: detected?.name || a.slot,
          enabled: true,
          isOnline: detected?.is_available ?? false,
          isBusy: false,
          state: 'idle' as const,
          progress: 0,
          outputFilename: '',
        };
      });
    setScannerStates(newStates);
  }, [scannerConfig.scannerAssignments, scannerConfig.detectedScanners]);

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">GraviScan</h1>

      {/* Platform status */}
      {scannerConfig.platformLoading && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-700">
          Checking platform support...
        </div>
      )}

      {scannerConfig.validationWarning && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md text-sm text-yellow-700">
          {scannerConfig.validationWarning}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left column: Scanner status + form ── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Scanner status panel */}
          <div className="bg-white border rounded-lg shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Scanners</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={scannerConfig.handleDetectScanners}
                  disabled={scannerConfig.detectingScanner || isScanning}
                  className="px-3 py-1 text-sm border rounded-md hover:bg-gray-50 disabled:opacity-50"
                >
                  {scannerConfig.detectingScanner
                    ? 'Detecting...'
                    : 'Detect Scanners'}
                </button>
                {testScan.isTesting ? (
                  <span className="px-3 py-1 text-sm text-blue-600">
                    Testing...
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={testScan.handleTestAllScanners}
                    disabled={assignedScannerIds.length === 0 || isScanning}
                    className="px-3 py-1 text-sm border rounded-md hover:bg-gray-50 disabled:opacity-50"
                  >
                    Test All
                  </button>
                )}
              </div>
            </div>

            {scannerConfig.detectionError && (
              <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-600">
                {scannerConfig.detectionError}
              </div>
            )}

            {/* Scanner list */}
            <div className="space-y-2">
              {scannerStates.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No scanners configured. Click &quot;Detect Scanners&quot; to
                  get started.
                </p>
              ) : (
                scannerStates.map((scanner, idx) => (
                  <div
                    key={scanner.scannerId}
                    className="flex items-center gap-3 p-2 border rounded-md"
                  >
                    <input
                      type="checkbox"
                      checked={scanner.enabled}
                      onChange={(e) =>
                        scannerConfig.handleToggleScannerEnabled(
                          scanner.scannerId,
                          e.target.checked
                        )
                      }
                      disabled={isScanning}
                      className="w-4 h-4"
                    />
                    <span className="text-sm font-medium flex-1">
                      Scanner {idx + 1}: {scanner.name}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        scanner.state === 'scanning'
                          ? 'bg-blue-100 text-blue-700'
                          : scanner.state === 'complete'
                            ? 'bg-green-100 text-green-700'
                            : scanner.state === 'error'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {scanner.state}
                    </span>
                    {testScan.testResults[scanner.scannerId] && (
                      <span
                        className={`text-xs ${
                          testScan.testResults[scanner.scannerId].success
                            ? 'text-green-600'
                            : 'text-red-600'
                        }`}
                      >
                        {testScan.testResults[scanner.scannerId].success
                          ? 'Test OK'
                          : testScan.testResults[scanner.scannerId].error}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Scan form */}
          <div className="bg-white border rounded-lg shadow-sm p-4">
            <h2 className="text-lg font-semibold mb-3">Scan Configuration</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Experiment */}
              <div>
                <label
                  htmlFor="experiment-select"
                  className="block text-xs font-bold mb-1"
                >
                  Experiment
                </label>
                <select
                  id="experiment-select"
                  value={selectedExperiment}
                  onChange={(e) => setSelectedExperiment(e.target.value)}
                  disabled={isScanning}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">Select experiment...</option>
                  {experiments.map((exp) => (
                    <option key={exp.id} value={exp.id}>
                      {exp.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Phenotyper */}
              <div>
                <label
                  htmlFor="phenotyper-select"
                  className="block text-xs font-bold mb-1"
                >
                  Phenotyper
                </label>
                <select
                  id="phenotyper-select"
                  value={selectedPhenotyper}
                  onChange={(e) => setSelectedPhenotyper(e.target.value)}
                  disabled={isScanning}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">Select phenotyper...</option>
                  {phenotypers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Wave number */}
              <div>
                <label
                  htmlFor="wave-number"
                  className="block text-xs font-bold mb-1"
                >
                  Wave Number
                </label>
                <input
                  id="wave-number"
                  type="number"
                  min={0}
                  value={waveNumber.waveNumber}
                  onChange={(e) =>
                    waveNumber.setWaveNumber(Number(e.target.value))
                  }
                  disabled={isScanning}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm"
                />
                {waveNumber.suggestedWaveNumber !== null && (
                  <p className="text-xs text-gray-500 mt-1">
                    Suggested: {waveNumber.suggestedWaveNumber}
                  </p>
                )}
              </div>

              {/* Resolution */}
              <div>
                <label
                  htmlFor="resolution"
                  className="block text-xs font-bold mb-1"
                >
                  Resolution (DPI)
                </label>
                <select
                  id="resolution"
                  value={scannerConfig.resolution}
                  onChange={(e) =>
                    scannerConfig.setResolution(Number(e.target.value))
                  }
                  disabled={isScanning}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value={200}>200</option>
                  <option value={300}>300</option>
                  <option value={600}>600</option>
                  <option value={1200}>1200</option>
                  <option value={2400}>2400</option>
                </select>
              </div>
            </div>

            {/* Plate assignments summary */}
            {assignedScannerIds.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">
                  Plate Assignments
                </h3>
                <div className="text-sm text-gray-600">
                  {selectedPlates.length} plate(s) selected across{' '}
                  {assignedScannerIds.length} scanner(s)
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Right column: Scan controls ── */}
        <div className="space-y-6">
          <div className="bg-white border rounded-lg shadow-sm p-4">
            <h2 className="text-lg font-semibold mb-3">Scan Controls</h2>
            <ScanControlSection
              canStartScan={scanSession.canStartScan}
              isScanning={isScanning}
              pendingJobs={scanSession.pendingJobs}
              scanMode={continuousMode.scanMode}
              scanIntervalMinutes={continuousMode.scanIntervalMinutes}
              scanDurationMinutes={continuousMode.scanDurationMinutes}
              currentCycle={continuousMode.currentCycle}
              totalCycles={continuousMode.totalCycles}
              intervalCountdown={continuousMode.intervalCountdown}
              elapsedSeconds={continuousMode.elapsedSeconds}
              setScanMode={continuousMode.setScanMode}
              setScanIntervalMinutes={continuousMode.setScanIntervalMinutes}
              setScanDurationMinutes={continuousMode.setScanDurationMinutes}
              scannerStates={scannerStates}
              eventLog={eventLog}
              onStartScan={scanSession.handleStartScan}
              onCancelScan={scanSession.handleCancelScan}
              scanError={scanError}
              scanSuccess={scanSuccess}
            />
          </div>

          {/* Auto-upload status */}
          {scanSession.autoUploadStatus !== 'idle' && (
            <div
              className={`p-3 border rounded-md text-sm ${
                scanSession.autoUploadStatus === 'error'
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : scanSession.autoUploadStatus === 'done'
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'bg-blue-50 border-blue-200 text-blue-700'
              }`}
            >
              {scanSession.autoUploadStatus === 'waiting' &&
                'Preparing Box backup...'}
              {scanSession.autoUploadStatus === 'uploading' &&
                'Uploading to Box...'}
              {scanSession.autoUploadMessage}
            </div>
          )}

          {/* Scan preview thumbnails */}
          {Object.keys(scanSession.scanImageUris).length > 0 && (
            <div className="bg-white border rounded-lg shadow-sm p-4">
              <h2 className="text-lg font-semibold mb-3">Scan Previews</h2>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(scanSession.scanImageUris).map(
                  ([scannerId, plates]) =>
                    Object.entries(plates).map(([plateIndex, dataUri]) => (
                      <div
                        key={`${scannerId}-${plateIndex}`}
                        className="border rounded overflow-hidden"
                      >
                        <img
                          src={dataUri}
                          alt={`Scanner ${scannerId} plate ${plateIndex}`}
                          className="w-full h-auto"
                        />
                        <div className="text-xs text-center text-gray-500 py-1">
                          Plate {plateIndex}
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>
          )}

          {/* Session summary after completion */}
          {scanSuccess && !isScanning && (
            <div className="bg-white border rounded-lg shadow-sm p-4">
              <h2 className="text-lg font-semibold mb-2">Session Complete</h2>
              <p className="text-sm text-gray-600">{scanSuccess}</p>
              <button
                type="button"
                onClick={scanSession.handleResetScanners}
                className="mt-3 px-4 py-2 text-sm border rounded-md hover:bg-gray-50"
              >
                Reset for Next Scan
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
