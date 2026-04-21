import { useState, useEffect, useRef } from 'react';
import type {
  ScannerAssignment,
  ScannerPanelState,
  ScannerState,
  PlateAssignment,
  DetectedScanner,
  GraviScanPlatformInfo,
  ScanSessionJob,
} from '../../types/graviscan';

// ─── Local types ────────────────────────────────────────────

interface ListItem {
  id: string;
  name: string;
}

export interface ScanJobInfo {
  scannerId: string;
  plateIndex: string;
  outputPath: string;
  plantBarcode: string | null;
  transplantDate: string | null;
  customNote: string | null;
  gridMode: string;
}

// ─── Hook params ────────────────────────────────────────────

export interface UseScanSessionParams {
  // State owned by GraviScan
  scannerStates: ScannerPanelState[];
  setScannerStates: React.Dispatch<React.SetStateAction<ScannerPanelState[]>>;
  isScanning: boolean;
  setIsScanning: React.Dispatch<React.SetStateAction<boolean>>;
  setScanError: React.Dispatch<React.SetStateAction<string | null>>;
  setScanSuccess: React.Dispatch<React.SetStateAction<string | null>>;
  setScanCompletionCounter: React.Dispatch<React.SetStateAction<number>>;

  // From useScannerConfig
  scannerAssignments: ScannerAssignment[];
  detectedScanners: DetectedScanner[];
  platformInfo: GraviScanPlatformInfo | null;
  resolution: number;
  resolutionRef: React.MutableRefObject<number>;
  setResolution: React.Dispatch<React.SetStateAction<number>>;

  // From usePlateAssignments
  scannerPlateAssignments: Record<string, PlateAssignment[]>;
  scannerPlateAssignmentsRef: React.MutableRefObject<
    Record<string, PlateAssignment[]>
  >;

  // From useWaveNumber
  waveNumber: number;
  setWaveNumber: React.Dispatch<React.SetStateAction<number>>;
  waveRestoredRef: React.MutableRefObject<boolean>;

  // From useContinuousMode
  scanMode: 'single' | 'continuous';
  scanIntervalMinutes: number;
  scanDurationMinutes: number;
  scanModeRef: React.MutableRefObject<string>;
  cycleCompletedCountRef: React.MutableRefObject<Record<string, number>>;
  setCurrentCycle: React.Dispatch<React.SetStateAction<number>>;
  setTotalCycles: React.Dispatch<React.SetStateAction<number>>;
  setIntervalCountdown: React.Dispatch<React.SetStateAction<number | null>>;
  startElapsedTimer: (startTimeMs?: number) => void;
  startCountdown: (seconds: number) => void;
  startOvertime: (initialMs: number) => void;
  clearCountdownAndOvertime: () => void;
  clearAllTimers: () => void;

  // Form state
  selectedExperiment: string;
  setSelectedExperiment: React.Dispatch<React.SetStateAction<string>>;
  selectedPhenotyper: string;
  setSelectedPhenotyper: React.Dispatch<React.SetStateAction<string>>;
  experiments: ListItem[];

  // Derived
  assignedScannerIds: string[];
  selectedPlates: string[];
}

// ─── Hook return ────────────────────────────────────────────

export interface UseScanSessionReturn {
  pendingJobs: Map<string, ScanJobInfo>;
  scanImageUris: Record<string, Record<string, string>>;
  setScanImageUris: React.Dispatch<
    React.SetStateAction<Record<string, Record<string, string>>>
  >;
  scanningPlateIndex: Record<string, string>;
  setScanningPlateIndex: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  autoUploadStatus: 'idle' | 'waiting' | 'uploading' | 'done' | 'error';
  autoUploadMessage: string | null;
  canStartScan: boolean;
  handleStartScan: () => Promise<void>;
  handleCancelScan: () => Promise<void>;
  handleResetScanners: () => void;
}

// ─── Hook implementation ────────────────────────────────────

export function useScanSession({
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  resolutionRef,
  setResolution,
  scannerPlateAssignments,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  assignedScannerIds,
  selectedPlates,
}: UseScanSessionParams): UseScanSessionReturn {
  // ── State owned by this hook ──────────────────────────────

  // Upload status (local state — will migrate to context when UploadStatusContext is created)
  const [autoUploadStatus, setAutoUploadStatus] = useState<
    'idle' | 'waiting' | 'uploading' | 'done' | 'error'
  >('idle');
  const [autoUploadMessage, setAutoUploadMessage] = useState<string | null>(
    null
  );

  // Scan image previews — maps scanner_id -> plate_index -> base64 data URI
  const [scanImageUris, setScanImageUris] = useState<
    Record<string, Record<string, string>>
  >({});

  // Which plate is currently being scanned per scanner (scanner_id -> plate_index)
  const [scanningPlateIndex, setScanningPlateIndex] = useState<
    Record<string, string>
  >({});

  // Async scan job tracking — maps job_id -> job metadata
  const [pendingJobs, setPendingJobs] = useState<Map<string, ScanJobInfo>>(
    new Map()
  );
  const initialPendingCountRef = useRef(0);
  // Template of plate jobs — used by continuous mode to repopulate pendingJobs each cycle
  const pendingJobsTemplateRef = useRef<Map<string, ScanJobInfo>>(new Map());

  // ── Refs for stable event callback access ─────────────────

  const pendingJobsRef = useRef(pendingJobs);
  const isScanningRef = useRef(isScanning);
  const scannerStatesRef = useRef(scannerStates);

  // ── Keep refs in sync ─────────────────────────────────────

  useEffect(() => {
    pendingJobsRef.current = pendingJobs;
  }, [pendingJobs]);
  useEffect(() => {
    isScanningRef.current = isScanning;
  }, [isScanning]);
  useEffect(() => {
    scannerStatesRef.current = scannerStates;
  }, [scannerStates]);

  // ── Readiness gate ────────────────────────────────────────

  const canStartScan =
    !isScanning &&
    !!selectedExperiment &&
    !!selectedPhenotyper &&
    selectedPlates.length > 0 &&
    scannerStates.some((s) => s.enabled);

  // ── IPC event listeners ───────────────────────────────────

  useEffect(() => {
    // scan-event: a plate scan has started on a scanner
    const cleanupScanEvent = window.electron.gravi.onScanEvent((data) => {
      console.log(
        '[GraviScan] Event: scan-event',
        data.scannerId,
        data.plateIndex
      );
      setScanningPlateIndex((prev) => ({
        ...prev,
        [data.scannerId]: data.plateIndex,
      }));
    });

    // grid-start: a grid scan sequence has begun
    const cleanupGridStart = window.electron.gravi.onGridStart((data) => {
      console.log('[GraviScan] Event: grid-start', data.gridIndex);
    });

    // grid-complete: all plates in a grid have been scanned
    const cleanupGridComplete = window.electron.gravi.onGridComplete((data) => {
      console.log(
        '[GraviScan] Event: grid-complete',
        data.gridIndex,
        `st=${data.scanStartedAt} et=${data.scanEndedAt}`
      );

      // Load preview images from renamed files
      if (data.renamedFiles && data.renamedFiles.length > 0) {
        for (const rf of data.renamedFiles) {
          const plateMatch = rf.newPath.match(/_S\d+_(\d+)\.[^.]+$/);
          if (!plateMatch || !rf.scannerId) continue;
          const plateIndex = plateMatch[1];

          window.electron.gravi
            .readScanImage(rf.newPath)
            .then((imgResult) => {
              if (imgResult.success && imgResult.data) {
                setScanImageUris((prev) => {
                  if (prev[rf.scannerId]?.[plateIndex]) return prev;
                  return {
                    ...prev,
                    [rf.scannerId]: {
                      ...prev[rf.scannerId],
                      [plateIndex]: imgResult.data,
                    },
                  };
                });
              }
            })
            .catch(() => {
              /* ignore preview failure */
            });
        }
      }

      // Remove completed jobs from pending set (single mode)
      if (scanModeRef.current !== 'continuous') {
        const gridIndex = data.gridIndex;
        setPendingJobs((prev) => {
          const next = new Map(prev);
          // Remove all jobs matching this grid index
          for (const [key] of next) {
            if (key.endsWith(`:${gridIndex}`)) {
              next.delete(key);
            }
          }
          return next;
        });
      }
    });

    // cycle-complete: one cycle of continuous scanning done
    const cleanupCycleComplete = window.electron.gravi.onCycleComplete(
      (data) => {
        console.log('[GraviScan] Event: cycle-complete', data);
        setCurrentCycle(data.cycle || 0);
        setIntervalCountdown(0);

        if (
          scanModeRef.current === 'continuous' &&
          pendingJobsTemplateRef.current.size > 0
        ) {
          const refreshed = new Map(pendingJobsTemplateRef.current);
          setPendingJobs(refreshed);
          cycleCompletedCountRef.current = {};
          setScannerStates((prev) =>
            prev.map((s) =>
              s.enabled
                ? { ...s, state: 'waiting' as ScannerState, progress: 0 }
                : s
            )
          );
        }
      }
    );

    // interval-start: continuous mode beginning
    const cleanupIntervalStart = window.electron.gravi.onIntervalStart(
      (data) => {
        console.log('[GraviScan] Event: interval-start', data);
        setTotalCycles(data.totalCycles);
      }
    );

    // interval-waiting: waiting between cycles
    const cleanupIntervalWaiting = window.electron.gravi.onIntervalWaiting(
      (data) => {
        console.log('[GraviScan] Event: interval-waiting', data);
        const waitMs = data.nextScanMs || 0;
        startCountdown(Math.ceil(waitMs / 1000));
      }
    );

    // interval-complete: all cycles done
    const cleanupIntervalComplete = window.electron.gravi.onIntervalComplete(
      (data) => {
        console.log(
          '[GraviScan] Event: interval-complete (all cycles done)',
          data
        );
        clearCountdownAndOvertime();

        initialPendingCountRef.current = 0;
        pendingJobsTemplateRef.current = new Map();
        setPendingJobs(new Map());
        setIsScanning(false);
        setScanCompletionCounter((c) => c + 1);
        setScannerStates((prev) =>
          prev.map((s) =>
            s.enabled && (s.state === 'scanning' || s.state === 'waiting')
              ? {
                  ...s,
                  state: 'complete' as ScannerState,
                  isBusy: false,
                  progress: 100,
                }
              : s
          )
        );
        const overtimeSuffix =
          data.overtimeMs > 0
            ? ` (+${Math.floor(data.overtimeMs / 60000)}m ${Math.floor((data.overtimeMs % 60000) / 1000)}s overtime)`
            : '';
        setScanSuccess(
          data.cancelled
            ? `Scan cancelled after ${data.cyclesCompleted}/${data.totalCycles} cycles${overtimeSuffix}`
            : `Continuous scan complete! ${data.cyclesCompleted} cycles finished${overtimeSuffix}`
        );
        setCurrentCycle(0);
        setTotalCycles(0);

        // Auto-upload after continuous scan completes
        triggerAutoUpload();
      }
    );

    // overtime: scan cycle took longer than interval
    const cleanupOvertime = window.electron.gravi.onOvertime((data) => {
      console.log('[GraviScan] Event: overtime', data);
      startOvertime(data.overtimeMs);
    });

    // cancelled: scan was cancelled
    const cleanupCancelled = window.electron.gravi.onCancelled(() => {
      console.log('[GraviScan] Event: cancelled');
    });

    // scan-error: error on a specific scanner/plate
    const cleanupScanError = window.electron.gravi.onScanError((data) => {
      console.error(
        '[GraviScan] Event: scan-error',
        data.scannerId,
        data.error
      );

      if (data.scannerId) {
        setScanningPlateIndex((prev) => {
          const next = { ...prev };
          delete next[data.scannerId];
          return next;
        });

        setScannerStates((prev) =>
          prev.map((s) =>
            s.scannerId === data.scannerId
              ? { ...s, state: 'error' as ScannerState, lastError: data.error }
              : s
          )
        );
      }

      if (data.plateIndex) {
        const plateKey = `${data.scannerId}:${data.plateIndex}`;
        setPendingJobs((prev) => {
          const next = new Map(prev);
          next.delete(plateKey);
          return next;
        });
      }
    });

    // rename-error: file rename failed after scan
    const cleanupRenameError = window.electron.gravi.onRenameError((data) => {
      console.warn('[GraviScan] Event: rename-error', data);
    });

    // upload-progress: Box backup progress
    const cleanupUploadProgress = window.electron.gravi.onUploadProgress(
      (progress) => {
        console.log('[GraviScan] Event: upload-progress', progress);
      }
    );

    // download-progress: image download progress
    const cleanupDownloadProgress = window.electron.gravi.onDownloadProgress(
      (progress) => {
        console.log('[GraviScan] Event: download-progress', progress);
      }
    );

    return () => {
      cleanupScanEvent();
      cleanupGridStart();
      cleanupGridComplete();
      cleanupCycleComplete();
      cleanupIntervalStart();
      cleanupIntervalWaiting();
      cleanupIntervalComplete();
      cleanupOvertime();
      cleanupCancelled();
      cleanupScanError();
      cleanupRenameError();
      cleanupUploadProgress();
      cleanupDownloadProgress();
      clearAllTimers();
    };
  }, []);

  // ── Completion detection (single mode) ────────────────────

  useEffect(() => {
    if (
      isScanningRef.current &&
      pendingJobs.size === 0 &&
      initialPendingCountRef.current > 0 &&
      scanModeRef.current === 'single'
    ) {
      console.log('[GraviScan] All scan jobs complete (single mode)');
      initialPendingCountRef.current = 0;
      pendingJobsTemplateRef.current = new Map();
      setIsScanning(false);
      setScanCompletionCounter((c) => c + 1);
      setScannerStates((prev) =>
        prev.map((s) =>
          s.enabled && (s.state as string) === 'scanning'
            ? {
                ...s,
                state: 'complete' as ScannerState,
                isBusy: false,
                progress: 100,
              }
            : s
        )
      );
      setScanSuccess('Scan complete!');
      setCurrentCycle(0);
      setTotalCycles(0);
      setIntervalCountdown(null);

      // Auto-upload after single scan completes
      triggerAutoUpload();
    }
  }, [pendingJobs]);

  // ── State restoration on mount ────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const status = await window.electron.gravi.getScanStatus();
        if (!status.jobs) return;

        const sessionFinishedWhileAway = !status.isActive;

        console.log(
          `[GraviScan] Restoring scan session on mount (active: ${!sessionFinishedWhileAway})`
        );

        // Rebuild pendingJobs from session jobs
        const restoredPending = new Map<string, ScanJobInfo>();
        const completedJobs: Array<{
          scannerId: string;
          plateIndex: string;
          imagePath: string;
        }> = [];

        for (const [key, job] of Object.entries(status.jobs) as [
          string,
          ScanSessionJob,
        ][]) {
          if (job.status === 'pending' || job.status === 'scanning') {
            restoredPending.set(key, {
              scannerId: job.scannerId,
              plateIndex: job.plateIndex,
              outputPath: job.outputPath,
              plantBarcode: job.plantBarcode,
              transplantDate: job.transplantDate ?? null,
              customNote: job.customNote ?? null,
              gridMode: job.gridMode,
            });
          } else if (job.status === 'complete' && job.imagePath) {
            completedJobs.push({
              scannerId: job.scannerId,
              plateIndex: job.plateIndex,
              imagePath: job.imagePath,
            });
          }
        }

        // Only restore active scanning state if session is still running
        if (!sessionFinishedWhileAway) {
          setIsScanning(true);
          initialPendingCountRef.current =
            restoredPending.size + completedJobs.length;
          setPendingJobs(restoredPending);

          if (status.experimentId) setSelectedExperiment(status.experimentId);
          if (status.phenotyperId) setSelectedPhenotyper(status.phenotyperId);
          if (status.resolution) setResolution(status.resolution);
          if (status.waveNumber !== undefined) {
            setWaveNumber(status.waveNumber);
            waveRestoredRef.current = true;
          }

          // Mark enabled scanners as scanning
          /* eslint-disable @typescript-eslint/no-explicit-any */
          setScannerStates((prev) =>
            prev.map((s) => {
              const hasJobs = Object.values(status.jobs!).some(
                (j: any) => j.scannerId === s.scannerId
              );
              if (!hasJobs) return s;
              const totalPlates = Object.values(status.jobs!).filter(
                (j: any) => j.scannerId === s.scannerId
              ).length;
              const donePlates = Object.values(status.jobs!).filter(
                (j: any) =>
                  j.scannerId === s.scannerId &&
                  (j.status === 'complete' || j.status === 'error')
              ).length;
              return {
                ...s,
                enabled: true,
                state: 'scanning' as ScannerState,
                isBusy: true,
                progress: Math.round((donePlates / totalPlates) * 100),
              };
            })
          );
          /* eslint-enable @typescript-eslint/no-explicit-any */

          // Restore elapsed timer from session start time
          if (status.scanStartedAt) {
            startElapsedTimer(status.scanStartedAt);
          }

          // Restore continuous scan timing state
          if (status.isContinuous) {
            if (status.currentCycle) setCurrentCycle(status.currentCycle);
            if (status.totalCycles) setTotalCycles(status.totalCycles);

            if (status.coordinatorState === 'waiting' && status.nextScanAt) {
              const remainingMs = status.nextScanAt - Date.now();
              if (remainingMs > 0) {
                startCountdown(Math.ceil(remainingMs / 1000));
              } else {
                setIntervalCountdown(0);
              }
            } else if (status.coordinatorState === 'scanning') {
              setIntervalCountdown(0);
            }
          }
        }

        // Load completed images into preview
        for (const job of completedJobs) {
          try {
            const imgResult = await window.electron.gravi.readScanImage(
              job.imagePath
            );
            if (imgResult.success && imgResult.data) {
              setScanImageUris((prev) => ({
                ...prev,
                [job.scannerId]: {
                  ...prev[job.scannerId],
                  [job.plateIndex]: imgResult.data,
                },
              }));
            }
          } catch {
            // Image load failed — skip preview
          }
        }

        console.log(
          `[GraviScan] Restored: ${restoredPending.size} pending, ${completedJobs.length} completed${sessionFinishedWhileAway ? ' (session already finished)' : ''}`
        );
      } catch (err) {
        console.warn('[GraviScan] Failed to restore scan status:', err);
      }
    })();
  }, []);

  // ── Auto-upload helper ────────────────────────────────────

  async function triggerAutoUpload() {
    setAutoUploadStatus('waiting');
    try {
      console.log('[GraviScan] Session complete, starting Box backup...');
      setAutoUploadStatus('uploading');
      const result = await window.electron.gravi.uploadAllScans();

      if (result.success) {
        console.log(
          `[GraviScan] Auto-upload complete: ${result.uploaded} uploaded, ${result.skipped} skipped`
        );
        setAutoUploadStatus('done');
        setAutoUploadMessage(
          `Backed up ${result.uploaded} image${result.uploaded !== 1 ? 's' : ''} to Box`
        );
      } else {
        console.warn(
          '[GraviScan] Box backup finished with errors:',
          result.errors
        );
        setAutoUploadStatus('done');
        setAutoUploadMessage(
          `Box backup: ${result.uploaded} succeeded, ${result.failed} failed`
        );
      }
    } catch (err) {
      console.error('[GraviScan] Box backup failed:', err);
      setAutoUploadStatus('error');
      setAutoUploadMessage('Box backup failed');
    }
  }

  // ── Scan control functions ────────────────────────────────

  async function handleStartScan() {
    // Validate form
    if (!selectedExperiment) {
      setScanError('Please select an experiment');
      return;
    }
    if (!selectedPhenotyper) {
      setScanError('Please select a phenotyper');
      return;
    }
    if (selectedPlates.length === 0) {
      setScanError('Please select at least one plate');
      return;
    }

    const enabledScanners = scannerStates.filter((s) => s.enabled);
    if (enabledScanners.length === 0) {
      setScanError('Please enable at least one scanner');
      return;
    }

    setScanError(null);
    setScanSuccess(null);
    setIsScanning(true);

    // Start elapsed timer
    startElapsedTimer();

    // Clear previous scan/test images so preview starts fresh
    setScanImageUris({});
    setScanningPlateIndex({});

    // Update scanner states to scanning
    setScannerStates((prev) =>
      prev.map((s) =>
        s.enabled
          ? { ...s, state: 'scanning' as const, isBusy: true, progress: 0 }
          : s
      )
    );

    try {
      // Get output directory
      const outputDirResult = await window.electron.gravi.getOutputDir();
      const outputDir =
        outputDirResult.success && outputDirResult.data
          ? outputDirResult.data
          : '/tmp';

      // Generate filename base
      const timestamp = new Date()
        .toISOString()
        .replace(/[-:]/g, '')
        .slice(0, 15);
      const expName =
        experiments.find((e) => e.id === selectedExperiment)?.name || 'scan';
      const sanitizedExpName = expName
        .replace(/[^a-zA-Z0-9]/g, '_')
        .slice(0, 20);

      // Track pending plates
      const newPendingPlates = new Map<string, ScanJobInfo>();

      // Build scan config for each scanner
      const scannerConfigs = enabledScanners.map((scanner, scannerIdx) => {
        const scannerAssignmentsList =
          scannerPlateAssignments[scanner.scannerId] || [];
        const selectedPlatesForScanner = scannerAssignmentsList.filter(
          (p) => p.selected
        );
        const scannerAssignment = scannerAssignments.find(
          (a) => a.scannerId === scanner.scannerId
        );
        const scannerGridMode = scannerAssignment?.gridMode || '2grid';

        const detected = detectedScanners.find(
          (d) => d.scanner_id === scanner.scannerId
        );
        const saneName = detected?.sane_name || '';

        const plates = selectedPlatesForScanner.map((plate) => {
          const systemTag = platformInfo?.system_name || `S${scannerIdx + 1}`;
          const filename = `${sanitizedExpName}_st_${timestamp}_cy1_${systemTag}_${plate.plateIndex}.tif`;
          const outputPath = `${outputDir}/${filename}`;

          const jobKey = `${scanner.scannerId}:${plate.plateIndex}`;
          newPendingPlates.set(jobKey, {
            scannerId: scanner.scannerId,
            plateIndex: plate.plateIndex,
            outputPath,
            plantBarcode: plate.plantBarcode || null,
            transplantDate: plate.transplantDate || null,
            customNote: plate.customNote || null,
            gridMode: scannerGridMode,
          });

          return {
            plate_index: plate.plateIndex,
            grid_mode: scannerGridMode,
            resolution: resolution,
            output_path: outputPath,
            plate_barcode: plate.plantBarcode || null,
            // Fixes B3 from PR #196 review: these were silently dropped,
            // so every GraviScan row had NULL transplant_date/custom_note
            // despite the Metadata page collecting them from the user.
            transplant_date: plate.transplantDate || null,
            custom_note: plate.customNote || null,
          };
        });

        return { scannerId: scanner.scannerId, saneName, plates };
      });

      if (scannerConfigs.every((c) => c.plates.length === 0)) {
        setScanError('No plates selected for scanning');
        setIsScanning(false);
        return;
      }

      console.log(
        `[GraviScan] Starting scan with ${scannerConfigs.length} scanner(s), ${newPendingPlates.size} plates total`
      );

      initialPendingCountRef.current = newPendingPlates.size;
      setPendingJobs(newPendingPlates);
      pendingJobsTemplateRef.current = new Map(newPendingPlates);

      // Set up cycle tracking for continuous mode
      if (scanMode === 'continuous') {
        const estimatedCycles = Math.floor(
          scanDurationMinutes / scanIntervalMinutes
        );
        setTotalCycles(estimatedCycles);
        setCurrentCycle(1);
        setIntervalCountdown(0);
      } else {
        setTotalCycles(0);
        setCurrentCycle(0);
      }

      // Start the scan — DB session creation is handled by main process
      const startParams: {
        scanners: typeof scannerConfigs;
        metadata: {
          experimentId: string;
          phenotyperId: string;
          resolution: number;
          waveNumber: number;
        };
        interval?: {
          intervalSeconds: number;
          durationSeconds: number;
        };
      } = {
        scanners: scannerConfigs,
        metadata: {
          experimentId: selectedExperiment,
          phenotyperId: selectedPhenotyper,
          resolution,
          waveNumber,
        },
      };
      if (scanMode === 'continuous') {
        startParams.interval = {
          intervalSeconds: scanIntervalMinutes * 60,
          durationSeconds: scanDurationMinutes * 60,
        };
      }
      const result = await window.electron.gravi.startScan(startParams);

      if (!result.success) {
        setScanError(result.error || 'Failed to start scan');
        setScannerStates((prev) =>
          prev.map((s) =>
            s.enabled
              ? {
                  ...s,
                  state: 'error' as const,
                  isBusy: false,
                  lastError: result.error || 'Start failed',
                }
              : s
          )
        );
        setIsScanning(false);
        setPendingJobs(new Map());
        initialPendingCountRef.current = 0;
        return;
      }

      console.log('[GraviScan] Scan started. Events will drive the rest.');
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'Scan failed');
      setScannerStates((prev) =>
        prev.map((s) =>
          s.enabled
            ? {
                ...s,
                state: 'error' as const,
                isBusy: false,
                lastError: 'Scan failed',
              }
            : s
        )
      );
      setIsScanning(false);
    }
  }

  async function handleCancelScan() {
    console.log('[GraviScan] Cancelling scan...');

    await window.electron.gravi.cancelScan();

    setPendingJobs(new Map());
    initialPendingCountRef.current = 0;
    setIsScanning(false);
    setScanningPlateIndex({});
    setScannerStates((prev) =>
      prev.map((s) =>
        s.enabled
          ? { ...s, state: 'idle' as const, isBusy: false, progress: 0 }
          : s
      )
    );
    setScanError('Scan cancelled by user');
    setCurrentCycle(0);
    setTotalCycles(0);
    clearCountdownAndOvertime();

    console.log('[GraviScan] Scan cancelled');
  }

  function handleResetScanners() {
    setScannerStates((prev) =>
      prev.map(
        (s): ScannerPanelState => ({
          scannerId: s.scannerId,
          name: s.name,
          enabled: s.enabled,
          isOnline: s.isOnline,
          isBusy: false,
          state: 'idle',
          progress: 0,
          outputFilename: '',
          lastError: undefined,
        })
      )
    );
    setScanSuccess(null);
    setScanError(null);
  }

  // ── Return ────────────────────────────────────────────────

  return {
    pendingJobs,
    scanImageUris,
    setScanImageUris,
    scanningPlateIndex,
    setScanningPlateIndex,
    autoUploadStatus,
    autoUploadMessage,
    canStartScan,
    handleStartScan,
    handleCancelScan,
    handleResetScanners,
  };
}
