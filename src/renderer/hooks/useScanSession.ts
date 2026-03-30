import { useState, useEffect, useRef } from 'react';
import type {
  ScannerAssignment,
  ScannerPanelState,
  ScannerState,
  PlateAssignment,
  DetectedScanner,
  GraviScanPlatformInfo,
} from '../../types/graviscan';
import { useUploadStatus } from '../contexts/UploadStatusContext';
import { useToast } from '../contexts/ToastContext';

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

// ─── Helpers ─────────────────────────────────────────────────

const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 60000;
const SETTLE_DELAY_MS = 5000;

/** Poll until all pending DB writes are drained, then wait 5s for path renames to settle. */
async function drainPendingWritesAndSettle(
  pendingDbWritesRef: React.MutableRefObject<Promise<unknown>[]>
): Promise<void> {
  console.log('[GraviScan] Waiting for pending DB writes to drain...');
  let waited = 0;
  while (waited < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    waited += POLL_INTERVAL_MS;
    if (pendingDbWritesRef.current.length === 0) break;
    const pending = [...pendingDbWritesRef.current];
    pendingDbWritesRef.current = [];
    console.log(`[GraviScan] Draining ${pending.length} pending DB writes...`);
    await Promise.allSettled(pending);
  }
  console.log(
    `[GraviScan] DB writes drained after ~${waited / 1000}s, settling for ${SETTLE_DELAY_MS / 1000}s...`
  );
  await new Promise((r) => setTimeout(r, SETTLE_DELAY_MS));
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
  verificationStatus: 'idle' | 'verifying' | 'complete';
  verificationResults: Record<
    string,
    { status: string; detectedPlateId: string | null }
  >;
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
}: UseScanSessionParams): UseScanSessionReturn {
  // ── State owned by this hook ──────────────────────────────

  const { showToast } = useToast();

  // Auto-upload state (shared via context for global floating banner + nav blocking)
  const {
    autoUploadStatus,
    setAutoUploadStatus,
    autoUploadMessage,
    setAutoUploadMessage,
    setBoxBackupProgress,
  } = useUploadStatus();

  // Scan image previews - maps scanner_id → plate_index → base64 data URI
  const [scanImageUris, setScanImageUris] = useState<
    Record<string, Record<string, string>>
  >({});
  // Which plate is currently being scanned per scanner (scanner_id → plate_index)
  const [scanningPlateIndex, setScanningPlateIndex] = useState<
    Record<string, string>
  >({});

  // QR verification state
  const [verificationStatus, setVerificationStatus] = useState<
    'idle' | 'verifying' | 'complete'
  >('idle');
  // Per-plate verification results: "scannerId:plateIndex" → { status, detectedPlateId }
  const [verificationResults, setVerificationResults] = useState<
    Record<string, { status: string; detectedPlateId: string | null }>
  >({});

  // Async scan job tracking — maps job_id → job metadata
  const [pendingJobs, setPendingJobs] = useState<Map<string, ScanJobInfo>>(
    new Map()
  );
  const initialPendingCountRef = useRef(0);
  // Template of plate jobs — used by continuous mode to repopulate pendingJobs each cycle
  const pendingJobsTemplateRef = useRef<Map<string, ScanJobInfo>>(new Map());

  // ── Refs for stable event callback access ─────────────────

  const pendingJobsRef = useRef(pendingJobs);
  const selectedExperimentRef = useRef(selectedExperiment);
  const selectedPhenotyperRef = useRef(selectedPhenotyper);
  const waveNumberRef = useRef(waveNumber);
  const isScanningRef = useRef(isScanning);
  const scannerStatesRef = useRef(scannerStates);
  const sessionIdRef = useRef<string | null>(null);
  // Track GraviScan record IDs per grid index for timestamp updates on grid-complete
  const gridRecordIdsRef = useRef<Record<string, string[]>>({});
  // Track pending DB write promises so grid-complete can await them
  const pendingDbWritesRef = useRef<Promise<void>[]>([]);

  // ── Keep refs in sync ─────────────────────────────────────

  useEffect(() => {
    pendingJobsRef.current = pendingJobs;
  }, [pendingJobs]);
  useEffect(() => {
    selectedExperimentRef.current = selectedExperiment;
  }, [selectedExperiment]);
  useEffect(() => {
    selectedPhenotyperRef.current = selectedPhenotyper;
  }, [selectedPhenotyper]);
  useEffect(() => {
    waveNumberRef.current = waveNumber;
  }, [waveNumber]);
  useEffect(() => {
    isScanningRef.current = isScanning;
  }, [isScanning]);
  useEffect(() => {
    scannerStatesRef.current = scannerStates;
  }, [scannerStates]);

  // ── Post-scan QR verification ──────────────────────────────

  /**
   * Run QR verification on completed scan images.
   * Called after scan completes (single or continuous), before upload.
   * Image-first: reads QR from image → DB lookup plate_id → compare with assigned.
   * No expectedQrCodes needed from renderer.
   */
  async function runPostScanVerification() {
    // Get completed jobs from the scan session
    const status = await window.electron.graviscan.getScanStatus();
    if (!status?.jobs) return null;

    const plates: Array<{
      scannerId: string;
      plateIndex: string;
      imagePath: string;
      assignedPlateId: string;
    }> = [];

    for (const [, job] of Object.entries(status.jobs)) {
      if (job.status !== 'complete' || !job.imagePath) continue;

      const assignments =
        scannerPlateAssignmentsRef.current[job.scannerId] || [];
      const assignment = assignments.find(
        (a) => a.plateIndex === job.plateIndex
      );
      if (!assignment?.plantBarcode) continue;

      plates.push({
        scannerId: job.scannerId,
        plateIndex: job.plateIndex,
        imagePath: job.imagePath,
        assignedPlateId: assignment.plantBarcode,
      });
    }

    if (plates.length === 0) {
      console.log('[GraviScan] No plates to verify, skipping');
      return null;
    }

    console.log(
      `[GraviScan] Running QR verification on ${plates.length} plate(s)...`
    );

    setVerificationStatus('verifying');
    setVerificationResults({});

    try {
      const result = await window.electron.graviscan.verifyPlates(plates);

      if (result?.results) {
        // Update per-plate results
        const newResults: Record<
          string,
          { status: string; detectedPlateId: string | null }
        > = {};
        for (const r of result.results) {
          newResults[`${r.scannerId}:${r.plateIndex}`] = {
            status: r.status,
            detectedPlateId: r.detectedPlateId,
          };
        }
        setVerificationResults(newResults);

        // Show toast based on results
        const verifiedCount = result.results.filter(
          (r: { status: string }) => r.status === 'verified'
        ).length;
        const unreadableCount = result.results.filter(
          (r: { status: string }) => r.status === 'unreadable'
        ).length;
        const swapCount = result.swaps?.length || 0;

        if (swapCount > 0) {
          const swapDetails = result.swaps
            .map(
              (s: {
                position1: { assignedPlateId: string };
                position2: { assignedPlateId: string };
              }) =>
                `${s.position1.assignedPlateId} ↔ ${s.position2.assignedPlateId}`
            )
            .join(', ');
          showToast({
            type: 'warning',
            message: `${swapCount} plate(s) swapped — corrected automatically (${swapDetails})`,
            duration: 20000,
          });
        } else if (unreadableCount > 0) {
          showToast({
            type: 'error',
            message: `${unreadableCount} plate(s) could not be verified — QR code unreadable`,
          });
        } else if (verifiedCount === result.results.length) {
          showToast({
            type: 'success',
            message: 'All plates verified — correct positions',
          });
        }
      }

      setVerificationStatus('complete');
      return result;
    } catch (err) {
      console.error('[GraviScan] QR verification failed:', err);
      showToast({
        type: 'error',
        message: 'QR verification failed',
      });
      setVerificationStatus('complete');
      return null;
    }
  }

  // ── IPC event listeners ───────────────────────────────────

  useEffect(() => {
    const cleanupStarted = window.electron.graviscan.onScanStarted((data) => {
      console.log(
        '[GraviScan] Event: scan-started',
        data.scannerId,
        data.plateIndex
      );
      setScanningPlateIndex((prev) => ({
        ...prev,
        [data.scannerId]: data.plateIndex,
      }));
    });

    const cleanupComplete = window.electron.graviscan.onScanComplete(
      async (data) => {
        console.log(
          '[GraviScan] Event: scan-complete',
          data.scannerId,
          data.plateIndex
        );

        const plateKey = `${data.scannerId}:${data.plateIndex}`;
        const jobInfo = pendingJobsRef.current.get(plateKey);

        // --- Synchronous state updates FIRST (before any async work) ---

        // Clear scanning plate indicator for this scanner
        setScanningPlateIndex((prev) => {
          const next = { ...prev };
          delete next[data.scannerId];
          return next;
        });

        // Update per-scanner progress
        setScannerStates((prev) =>
          prev.map((s) => {
            if (s.scannerId !== data.scannerId) return s;
            const totalPlates =
              scannerPlateAssignmentsRef.current[data.scannerId]?.filter(
                (p) => p.selected
              ).length || 1;

            let completedPlates: number;
            if (scanModeRef.current === 'continuous') {
              cycleCompletedCountRef.current[data.scannerId] =
                (cycleCompletedCountRef.current[data.scannerId] || 0) + 1;
              completedPlates = cycleCompletedCountRef.current[data.scannerId];
            } else {
              let remainingForScanner = 0;
              pendingJobsRef.current.forEach((job) => {
                if (job.scannerId === data.scannerId) remainingForScanner++;
              });
              completedPlates = totalPlates - (remainingForScanner - 1);
            }
            return {
              ...s,
              progress: Math.round((completedPlates / totalPlates) * 100),
            };
          })
        );

        // Remove from pending set (single mode only)
        if (scanModeRef.current !== 'continuous') {
          setPendingJobs((prev) => {
            const next = new Map(prev);
            next.delete(plateKey);
            return next;
          });
        }

        // --- Async operations (image loading, DB writes) ---

        // Load scanned image as base64 for preview
        if (data.imagePath) {
          try {
            const imgResult = await window.electron.graviscan.readScanImage(
              data.imagePath
            );
            if (imgResult.success && imgResult.dataUri) {
              setScanImageUris((prev) => ({
                ...prev,
                [data.scannerId]: {
                  ...prev[data.scannerId],
                  [data.plateIndex]: imgResult.dataUri,
                },
              }));
            }
          } catch (err) {
            console.warn(
              '[GraviScan] Failed to load preview for',
              data.imagePath,
              err
            );
          }
        }

        // Create DB records from plate metadata
        if (
          jobInfo &&
          selectedExperimentRef.current &&
          selectedPhenotyperRef.current
        ) {
          const dbWritePromise = (async () => {
            try {
              const graviscanResult =
                await window.electron.database.graviscans.create({
                  experiment_id: selectedExperimentRef.current!,
                  phenotyper_id: selectedPhenotyperRef.current!,
                  scanner_id: data.scannerId,
                  plate_barcode: jobInfo.plantBarcode || null,
                  transplant_date: jobInfo.transplantDate || null,
                  custom_note: jobInfo.customNote || null,
                  path: data.imagePath,
                  grid_mode: jobInfo.gridMode,
                  plate_index: data.plateIndex,
                  resolution: resolutionRef.current,
                  format: 'tiff',
                  session_id: sessionIdRef.current || null,
                  cycle_number: data.cycleNumber ?? null,
                  wave_number: waveNumberRef.current,
                  scan_started_at: data.scanStartedAt || null,
                });

              if (graviscanResult.success && graviscanResult.data) {
                await window.electron.database.graviimages.create({
                  graviscan_id: graviscanResult.data.id,
                  path: data.imagePath,
                  status: 'pending',
                });

                const gridKey = data.plateIndex;
                if (!gridRecordIdsRef.current[gridKey]) {
                  gridRecordIdsRef.current[gridKey] = [];
                }
                gridRecordIdsRef.current[gridKey].push(graviscanResult.data.id);
              }

              window.electron.graviscan
                .markJobRecorded(plateKey)
                .catch(() => {});
            } catch (err) {
              console.error('[GraviScan] Failed to create DB record:', err);
            }
          })();
          pendingDbWritesRef.current.push(dbWritePromise);
        }
      }
    );

    const cleanupError = window.electron.graviscan.onScanError((data) => {
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

    // Grid complete — update all DB records for this grid with shared timestamps
    const cleanupGridComplete = window.electron.graviscan.onGridComplete(
      (data) => {
        console.log(
          '[GraviScan] Event: grid-complete',
          data.gridIndex,
          `st=${data.scanStartedAt} et=${data.scanEndedAt}`
        );

        // Snapshot pending writes before adding this one (avoids self-reference)
        const otherWrites = [...pendingDbWritesRef.current];
        const gridWritePromise: Promise<void> = (async () => {
          if (otherWrites.length > 0) {
            await Promise.allSettled(otherWrites);
          }

          const recordIds = gridRecordIdsRef.current[data.gridIndex];
          if (recordIds && recordIds.length > 0) {
            try {
              const result =
                await window.electron.database.graviscans.updateGridTimestamps({
                  ids: recordIds,
                  scan_started_at: data.scanStartedAt,
                  scan_ended_at: data.scanEndedAt,
                  renamed_files: data.renamedFiles?.map((rf) => ({
                    oldPath: rf.oldPath,
                    newPath: rf.newPath,
                  })),
                });
              if (result.success) {
                console.log(
                  `[GraviScan] Updated ${result.data?.count} records with grid timestamps for grid ${data.gridIndex}`
                );
              } else {
                console.error(
                  '[GraviScan] Failed to update grid timestamps:',
                  result.error
                );
              }
            } catch (err) {
              console.error(
                '[GraviScan] Failed to update grid timestamps:',
                err
              );
            }
            delete gridRecordIdsRef.current[data.gridIndex];
          }

          // Load preview images from renamed files
          if (data.renamedFiles && data.renamedFiles.length > 0) {
            for (const rf of data.renamedFiles) {
              const plateMatch = rf.newPath.match(/_S\d+_(\d+)\.[^.]+$/);
              if (!plateMatch || !rf.scannerId) continue;
              const plateIndex = plateMatch[1];

              try {
                const imgResult = await window.electron.graviscan.readScanImage(
                  rf.newPath
                );
                if (imgResult.success && imgResult.dataUri) {
                  setScanImageUris((prev) => {
                    if (prev[rf.scannerId]?.[plateIndex]) return prev;
                    return {
                      ...prev,
                      [rf.scannerId]: {
                        ...prev[rf.scannerId],
                        [plateIndex]: imgResult.dataUri,
                      },
                    };
                  });
                }
              } catch {
                /* ignore */
              }
            }
          }
        })();
        pendingDbWritesRef.current.push(gridWritePromise);
      }
    );

    // Continuous mode: interval started
    const cleanupIntervalStart = window.electron.graviscan.onIntervalStart?.(
      (data) => {
        console.log('[GraviScan] Event: interval-start', data);
        setTotalCycles(data.totalCycles);
      }
    );

    // Continuous mode: cycle complete
    const cleanupCycleComplete = window.electron.graviscan.onCycleComplete?.(
      (data) => {
        console.log('[GraviScan] Event: cycle-complete', data);
        setCurrentCycle(data.cycle || 0);
        setIntervalCountdown(0);

        // Drain resolved promises to prevent unbounded growth across cycles
        const pending = pendingDbWritesRef.current;
        if (pending.length > 0) {
          Promise.allSettled(pending).then(() => {
            pendingDbWritesRef.current = pendingDbWritesRef.current.filter(
              (p) => !pending.includes(p)
            );
          });
        }

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

    // Continuous mode: waiting between cycles
    const cleanupIntervalWaiting =
      window.electron.graviscan.onIntervalWaiting?.((data) => {
        console.log('[GraviScan] Event: interval-waiting', data);
        const waitMs = data.nextScanMs || 0;
        startCountdown(Math.ceil(waitMs / 1000));
      });

    // Continuous mode: overtime
    const cleanupOvertime = window.electron.graviscan.onOvertime?.((data) => {
      console.log('[GraviScan] Event: overtime', data);
      startOvertime(data.overtimeMs);
    });

    // Continuous mode: all cycles done — finalize scan
    const cleanupIntervalComplete =
      window.electron.graviscan.onIntervalComplete?.((data) => {
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

        // Mark session as complete in DB, wait for all image records, then auto-upload
        if (sessionIdRef.current) {
          const sid = sessionIdRef.current;
          sessionIdRef.current = null;
          setAutoUploadStatus('waiting');

          (async () => {
            try {
              await window.electron.database.graviscanSessions.complete({
                session_id: sid,
              });

              await drainPendingWritesAndSettle(pendingDbWritesRef);

              // Run QR verification before upload
              console.log(
                '[GraviScan] Running post-scan QR verification (continuous)...'
              );
              await runPostScanVerification();

              console.log(
                '[GraviScan] Session complete (continuous), starting Box backup...'
              );
              setAutoUploadStatus('uploading');
              const result = await window.electron.graviscan.uploadAllScans();

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
          })();
        }
      });

    return () => {
      cleanupStarted();
      cleanupComplete();
      cleanupError();
      cleanupGridComplete();
      cleanupIntervalStart?.();
      cleanupCycleComplete?.();
      cleanupIntervalWaiting?.();
      cleanupOvertime?.();
      cleanupIntervalComplete?.();
      clearAllTimers();
    };
  }, []);

  // ── Box backup progress listener ──────────────────────────

  useEffect(() => {
    const cleanup = window.electron.graviscan.onBoxBackupProgress?.(
      (progress) => {
        setBoxBackupProgress({
          totalImages: progress.totalImages,
          completedImages: progress.completedImages,
          failedImages: progress.failedImages,
          currentExperiment: progress.currentExperiment,
        });
      }
    );
    return () => {
      cleanup?.();
      setBoxBackupProgress(null);
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

      // Mark session as complete in DB, wait for all image records, then auto-upload
      if (sessionIdRef.current) {
        const sid = sessionIdRef.current;
        sessionIdRef.current = null;
        setAutoUploadStatus('waiting');

        (async () => {
          try {
            await window.electron.database.graviscanSessions.complete({
              session_id: sid,
            });

            await drainPendingWritesAndSettle(pendingDbWritesRef);

            // Run QR verification before upload
            console.log('[GraviScan] Running post-scan QR verification...');
            await runPostScanVerification();

            console.log('[GraviScan] Session complete, starting Box backup...');
            setAutoUploadStatus('uploading');
            const result = await window.electron.graviscan.uploadAllScans();

            if (result.success) {
              console.log(
                `[GraviScan] Box backup complete: ${result.uploaded} backed up, ${result.skipped} skipped`
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
        })();
      }
    }
  }, [pendingJobs]);

  // ── State restoration on mount ────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const status = await window.electron.graviscan.getScanStatus();
        if (!status.jobs) return;

        const sessionFinishedWhileAway = !status.isActive;

        console.log(
          `[GraviScan] Restoring scan session on mount (active: ${!sessionFinishedWhileAway})`
        );

        if (status.sessionId) sessionIdRef.current = status.sessionId;

        // Rebuild pendingJobs from session jobs
        const restoredPending = new Map<string, ScanJobInfo>();
        const completedJobs: Array<{
          scannerId: string;
          plateIndex: string;
          imagePath: string;
          durationMs?: number;
        }> = [];

        for (const [key, job] of Object.entries(status.jobs)) {
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
            if (job.imagePath) {
              completedJobs.push({
                scannerId: job.scannerId,
                plateIndex: job.plateIndex,
                imagePath: job.imagePath,
                durationMs: job.durationMs,
              });
            }
          } else if (job.status === 'complete' && job.imagePath) {
            completedJobs.push({
              scannerId: job.scannerId,
              plateIndex: job.plateIndex,
              imagePath: job.imagePath,
              durationMs: job.durationMs,
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
          setScannerStates((prev) =>
            prev.map((s) => {
              const hasJobs = Object.values(status.jobs!).some(
                (j) => j.scannerId === s.scannerId
              );
              if (!hasJobs) return s;
              const totalPlates = Object.values(status.jobs!).filter(
                (j) => j.scannerId === s.scannerId
              ).length;
              const donePlates = Object.values(status.jobs!).filter(
                (j) =>
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
            const imgResult = await window.electron.graviscan.readScanImage(
              job.imagePath
            );
            if (imgResult.success && imgResult.dataUri) {
              setScanImageUris((prev) => ({
                ...prev,
                [job.scannerId]: {
                  ...prev[job.scannerId],
                  [job.plateIndex]: imgResult.dataUri,
                },
              }));
            }
          } catch {
            // Image load failed — skip preview
          }
        }

        // Process completed jobs for DB records (only those not already recorded)
        for (const job of completedJobs) {
          const plateKey = `${job.scannerId}:${job.plateIndex}`;
          const jobMeta = status.jobs[plateKey];
          if (
            jobMeta &&
            !jobMeta.dbRecorded &&
            status.experimentId &&
            status.phenotyperId
          ) {
            try {
              const graviscanResult =
                await window.electron.database.graviscans.create({
                  experiment_id: status.experimentId,
                  phenotyper_id: status.phenotyperId,
                  scanner_id: job.scannerId,
                  plate_barcode: jobMeta.plantBarcode || null,
                  transplant_date: jobMeta.transplantDate || null,
                  custom_note: jobMeta.customNote || null,
                  path: job.imagePath,
                  grid_mode: jobMeta.gridMode,
                  plate_index: job.plateIndex,
                  resolution: status.resolution || 300,
                  format: 'tiff',
                  session_id: status.sessionId || null,
                  cycle_number: jobMeta.cycleNumber ?? null,
                  scan_started_at: null,
                });
              if (graviscanResult.success && graviscanResult.data) {
                await window.electron.database.graviimages.create({
                  graviscan_id: graviscanResult.data.id,
                  path: job.imagePath,
                  status: 'pending',
                });
              }
              window.electron.graviscan
                .markJobRecorded(plateKey)
                .catch(() => {});
            } catch (err) {
              console.error(
                '[GraviScan] Failed to create DB record for restored job:',
                err
              );
            }
          }
        }

        // If session finished while we were away, mark it complete in DB
        if (sessionFinishedWhileAway && sessionIdRef.current) {
          window.electron.database.graviscanSessions
            .complete({ session_id: sessionIdRef.current })
            .catch((err) =>
              console.error(
                '[GraviScan] Failed to complete session on restore:',
                err
              )
            );
          sessionIdRef.current = null;
        }

        console.log(
          `[GraviScan] Restored: ${restoredPending.size} pending, ${completedJobs.length} completed${sessionFinishedWhileAway ? ' (session already finished)' : ''}`
        );
      } catch (err) {
        console.warn('[GraviScan] Failed to restore scan status:', err);
      }
    })();
  }, []);

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

    // Save all plate assignments to database before starting scan
    try {
      for (const scannerId of assignedScannerIds) {
        const assignments = scannerPlateAssignments[scannerId] || [];
        if (assignments.length > 0) {
          const assignmentsToSave = assignments.map((a) => ({
            plate_index: a.plateIndex,
            plate_barcode: a.plantBarcode,
            selected: a.selected,
          }));
          await window.electron.database.graviscanPlateAssignments.upsertMany(
            selectedExperiment,
            scannerId,
            assignmentsToSave
          );
        }
      }
    } catch (error) {
      console.error('Failed to save plate assignments:', error);
    }

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
      const outputDirResult = await window.electron.graviscan.getOutputDir();
      const outputDir = outputDirResult.success ? outputDirResult.path : '/tmp';

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

      // Track pending plates for DB record creation on scan-complete events
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

      // Create GraviScanSession DB record
      let sessionId: string | null = null;
      try {
        const sessionResult =
          await window.electron.database.graviscanSessions.create({
            experiment_id: selectedExperiment,
            phenotyper_id: selectedPhenotyper,
            scan_mode: scanMode,
            interval_seconds:
              scanMode === 'continuous' ? scanIntervalMinutes * 60 : null,
            duration_seconds:
              scanMode === 'continuous' ? scanDurationMinutes * 60 : null,
            total_cycles:
              scanMode === 'continuous'
                ? Math.floor(scanDurationMinutes / scanIntervalMinutes)
                : 1,
          });
        if (sessionResult.success && sessionResult.data) {
          sessionId = sessionResult.data.id;
          sessionIdRef.current = sessionId;
          console.log(`[GraviScan] Created session ${sessionId} (${scanMode})`);
        }
      } catch (err) {
        console.error('[GraviScan] Failed to create session:', err);
      }

      // Single call to start parallel scanning
      const startParams: Parameters<
        typeof window.electron.graviscan.startScan
      >[0] = {
        scanners: scannerConfigs,
        metadata: {
          experimentId: selectedExperiment,
          phenotyperId: selectedPhenotyper,
          resolution,
          sessionId: sessionId || undefined,
          waveNumber,
        },
      };
      if (scanMode === 'continuous') {
        startParams.interval = {
          intervalSeconds: scanIntervalMinutes * 60,
          durationSeconds: scanDurationMinutes * 60,
        };
      }
      const result = await window.electron.graviscan.startScan(startParams);

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

      console.log(`[GraviScan] Scan started. Events will drive the rest.`);
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

    await window.electron.graviscan.cancelScan();

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

    if (sessionIdRef.current) {
      window.electron.database.graviscanSessions
        .complete({ session_id: sessionIdRef.current, cancelled: true })
        .catch((err) =>
          console.error('[GraviScan] Failed to mark session cancelled:', err)
        );
      sessionIdRef.current = null;
    }

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
    verificationStatus,
    verificationResults,
    handleStartScan,
    handleCancelScan,
    handleResetScanners,
  };
}
