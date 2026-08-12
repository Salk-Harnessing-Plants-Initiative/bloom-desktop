/**
 * GraviScan Capture Scan screen — composes Sections 7-14 into the
 * operator-facing capture workflow: experiment/phenotyper/wave selection,
 * scanner status, plate assignment (auto-fill with override), session
 * control (start/cancel/continuous/test-scan), and QR verification
 * results.
 */
import { useEffect, useMemo, useState } from 'react';
import { ExperimentChooser } from './components/ExperimentChooser';
import { PhenotyperChooser } from './components/PhenotyperChooser';
import { ScanFormSection } from './components/graviscan/ScanFormSection';
import { ScanControlSection } from './components/graviscan/ScanControlSection';
import { ScannerStatusPanel } from './components/graviscan/ScannerStatusPanel';
import { QRVerificationBanner } from './components/graviscan/QRVerificationBanner';
import { useScannerStatus } from './hooks/useScannerStatus';
import { useWaveNumber } from './hooks/useWaveNumber';
import { usePlateAssignments } from './hooks/usePlateAssignments';
import { useContinuousMode } from './hooks/useContinuousMode';
import { useScanSession } from './hooks/useScanSession';
import { useTestScan } from './hooks/useTestScan';
import { unwrapGraviResult } from './utils/graviIpc';
import type { GridMode } from '../types/graviscan';

/** V600 physical bed region used for the cadence estimate's calibration
 * basis (matches cadenceEstimator.ts's own BASE_REGION_HEIGHT_MM). No
 * per-scanner variation exists in this hardware today. */
const SCAN_REGION_MM = { width: 140, height: 140 };
const DEFAULT_RESOLUTION_DPI = 1200;

export function GraviScan() {
  const [experimentId, setExperimentId] = useState<string | null>(null);
  const [phenotyperId, setPhenotyperId] = useState<string | null>(null);
  const [resolution, setResolution] = useState<number>(DEFAULT_RESOLUTION_DPI);
  const [saneNames, setSaneNames] = useState<Record<string, string>>({});
  const [sessionLoaded, setSessionLoaded] = useState(false);

  const { waveNumber, setWaveNumber, suggestedNextWave } =
    useWaveNumber(experimentId);
  const { scanners } = useScannerStatus();

  // Restore experiment/phenotyper/wave on mount so they survive navigating
  // away from this screen and back (CaptureScan.tsx uses the same
  // window.electron.session mechanism for this exact purpose).
  useEffect(() => {
    (async () => {
      try {
        const session = await window.electron.session.get();
        if (session.experimentId !== null)
          setExperimentId(session.experimentId);
        if (session.phenotyperId !== null)
          setPhenotyperId(session.phenotyperId);
        if (session.waveNumber !== null) setWaveNumber(session.waveNumber);
      } catch (error) {
        console.error('Failed to load session state:', error);
      } finally {
        setSessionLoaded(true);
      }
    })();
  }, [setWaveNumber]);

  // Persist experiment/phenotyper/wave selections (debounced) once the
  // initial restore above has completed, so a fresh mount never clobbers
  // a previously saved selection with this screen's blank initial state.
  useEffect(() => {
    if (!sessionLoaded) return;
    const saveTimeout = setTimeout(() => {
      window.electron.session
        .set({ experimentId, phenotyperId, waveNumber })
        .catch((error) => {
          console.error('Failed to save session state:', error);
        });
    }, 300);
    return () => clearTimeout(saveTimeout);
  }, [sessionLoaded, experimentId, phenotyperId, waveNumber]);

  const scannerIds = useMemo(
    () => scanners.map((s) => s.scannerId),
    [scanners]
  );
  const gridModes = useMemo(
    () =>
      Object.fromEntries(
        scanners.map((s) => [s.scannerId, s.gridMode as GridMode])
      ),
    [scanners]
  );
  const scannerLabels = useMemo(
    () => Object.fromEntries(scanners.map((s) => [s.scannerId, s.name])),
    [scanners]
  );

  // Global resolution comes from the Configure Scanner page's saved
  // GraviConfig — this screen does not re-expose a resolution selector
  // (design.md: no ScannerConfigSection port).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = unwrapGraviResult<{
        success: boolean;
        config?: { resolution?: number } | null;
      }>(await window.electron.gravi.getConfig());
      if (cancelled) return;
      if (result?.success && result.config?.resolution) {
        setResolution(result.config.resolution);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Scanner sane_names are only needed to build the startScan() payload —
  // fetched once, independent of the live getScannerStatus() poll.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = unwrapGraviResult<{
        success: boolean;
        scanners?: Array<{ scanner_id: string; sane_name?: string }>;
      }>(await window.electron.gravi.detectScanners());
      if (cancelled) return;
      if (result?.success && result.scanners) {
        setSaneNames(
          Object.fromEntries(
            result.scanners.map((s) => [s.scanner_id, s.sane_name ?? ''])
          )
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const plateAssignments = usePlateAssignments({
    experimentId,
    waveNumber,
    scannerIds,
    gridModes,
  });

  const continuousMode = useContinuousMode({
    scannerStates: scanners,
    dpi: resolution,
    regionMm: SCAN_REGION_MM,
  });

  const scanSession = useScanSession({
    experimentId,
    phenotyperId,
    waveNumber,
    resolution,
    scannerIds,
    gridModes,
    saneNames,
    assignmentsByScanner: plateAssignments.assignmentsByScanner,
    isContinuous: continuousMode.isContinuous,
    intervalMinutes: continuousMode.intervalMinutes,
    durationMinutes: continuousMode.durationMinutes,
    onRestoreWaveNumber: setWaveNumber,
  });

  const testScan = useTestScan({ scannerIds, gridModes, saneNames });

  const anyPlateFilled = useMemo(
    () =>
      Object.values(plateAssignments.assignmentsByScanner)
        .flat()
        .some((a) => !!a.plantBarcode),
    [plateAssignments.assignmentsByScanner]
  );

  const verificationResults = useMemo(
    () => Object.values(scanSession.verificationResults),
    [scanSession.verificationResults]
  );

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold">Capture Scan</h1>

      <div className="flex gap-3 items-center">
        <ExperimentChooser
          value={experimentId}
          onExperimentChange={setExperimentId}
        />
        <PhenotyperChooser
          value={phenotyperId}
          onPhenotyperChange={setPhenotyperId}
        />
        <label className="flex items-center gap-1">
          Wave
          <input
            type="number"
            value={waveNumber}
            onChange={(e) => setWaveNumber(Number(e.target.value))}
          />
        </label>
        {suggestedNextWave !== null && (
          <span className="text-sm text-gray-500">
            Suggested next wave: {suggestedNextWave}
          </span>
        )}
      </div>

      <ScannerStatusPanel
        scanners={scanners}
        progressByScanner={scanSession.progressByScanner}
        isScanning={scanSession.isScanning}
        testResults={testScan.testResults}
      />

      <ScanFormSection
        scannerIds={scannerIds}
        scannerLabels={scannerLabels}
        assignmentsByScanner={plateAssignments.assignmentsByScanner}
        isGraviMetadata={plateAssignments.isGraviMetadata}
        waveMissingMetadata={plateAssignments.waveMissingMetadata}
        waveLinkedButEmpty={plateAssignments.waveLinkedButEmpty}
        loadError={plateAssignments.loadError}
        saveError={plateAssignments.saveError}
        updateField={plateAssignments.updateField}
        toggleSelected={plateAssignments.toggleSelected}
      />

      <ScanControlSection
        scanSession={scanSession}
        continuousMode={continuousMode}
        testScan={testScan}
        waveMissingMetadata={plateAssignments.waveMissingMetadata}
        anyPlateFilled={anyPlateFilled}
      />

      <QRVerificationBanner results={verificationResults} />
    </div>
  );
}
