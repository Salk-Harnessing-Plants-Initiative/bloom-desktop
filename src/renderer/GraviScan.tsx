/**
 * GraviScan Component
 *
 * UI for GraviScan flatbed scanner functionality including:
 * - Scanner detection and configuration
 * - Grid mode and resolution settings
 * - Plate scanning with progress tracking
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  DetectedScanner,
  GraviConfig,
  GraviScanner,
  GridMode,
  GraviScanPlatformInfo,
  ScannerPanelState,
  ScannerAssignment,
  ScannerState,
  PlateAssignment,
} from '../types/graviscan';
import {
  MIN_SCAN_INTERVAL_MINUTES,
  GRAVISCAN_RESOLUTIONS,
  PLATE_INDICES,
  DEFAULT_SCANNER_SLOTS,
  MAX_SCANNER_SLOTS,
  generateScannerSlots,
  createEmptyScannerAssignment,
  createPlateAssignments,
  getPlateLabel,
  formatPlateIndex,
  AvailablePlate,
} from '../types/graviscan';
import { ScannerPanel } from './components/ScannerPanel';
import { ScanPreview } from './components/ScanPreview';
import { ImageLightbox } from './components/ImageLightbox';

// Simple type for experiment/phenotyper list items
interface ListItem {
  id: string;
  name: string;
}

// LocalStorage keys for persistence (plate assignments now stored in database)
// Note: gridMode is now per-scanner, stored in scannerAssignments
const STORAGE_KEYS = {
  detectedScanners: 'graviscan:detectedScanners',
  scannerAssignments: 'graviscan:scannerAssignments',
  resolution: 'graviscan:resolution',
  configCollapsed: 'graviscan:configCollapsed',
  isConfigured: 'graviscan:isConfigured',
  sessionValidated: 'graviscan:sessionValidated',
  scanMode: 'graviscan:scanMode',
  scanInterval: 'graviscan:scanInterval',
  scanDuration: 'graviscan:scanDuration',
};

// Helper functions for localStorage
function loadFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.warn(`Failed to load ${key} from localStorage:`, error);
  }
  return defaultValue;
}

function saveToStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Failed to save ${key} to localStorage:`, error);
  }
}

export function GraviScan() {
  // Platform support
  const [platformInfo, setPlatformInfo] = useState<GraviScanPlatformInfo | null>(null);
  const [platformLoading, setPlatformLoading] = useState(true);

  // Scanner detection - initialize from localStorage
  const [detectedScanners, setDetectedScanners] = useState<DetectedScanner[]>(() =>
    loadFromStorage(STORAGE_KEYS.detectedScanners, [])
  );
  const [detectingScanner, setDetectingScanner] = useState(false);
  const [detectionError, setDetectionError] = useState<string | null>(null);

  // Scanner assignments - maps slot names to detected scanners
  const [scannerAssignments, setScannerAssignments] = useState<ScannerAssignment[]>(() => {
    const stored = loadFromStorage<ScannerAssignment[]>(STORAGE_KEYS.scannerAssignments, []);
    if (stored.length > 0) {
      return stored;
    }
    // Initialize with default slots
    return generateScannerSlots(DEFAULT_SCANNER_SLOTS).map((slot, index) =>
      createEmptyScannerAssignment(index)
    );
  });

  // Configuration - initialize from localStorage
  const [config, setConfig] = useState<GraviConfig | null>(null);
  // Note: gridMode is now per-scanner, stored in ScannerAssignment.gridMode
  const [resolution, setResolution] = useState<number>(() =>
    loadFromStorage(STORAGE_KEYS.resolution, 1200)
  );
  // Note: savingConfig removed - auto-save is now handled by effect
  const [configSaved, setConfigSaved] = useState(() =>
    loadFromStorage(STORAGE_KEYS.isConfigured, false)
  );

  // Collapsible Configure Scanners section - auto-collapse if already configured
  const [isConfigCollapsed, setIsConfigCollapsed] = useState(() => {
    const savedCollapsed = loadFromStorage(STORAGE_KEYS.configCollapsed, false);
    const isAlreadyConfigured = loadFromStorage(STORAGE_KEYS.isConfigured, false);
    // Auto-collapse if already configured, otherwise use saved state
    return isAlreadyConfigured || savedCollapsed;
  });

  // Session validation - must detect scanners each session before scanning
  const [sessionValidated, setSessionValidated] = useState(() =>
    loadFromStorage(STORAGE_KEYS.sessionValidated, false)
  );

  // Background validation state
  const [isValidating, setIsValidating] = useState(false);
  const [validationWarning, setValidationWarning] = useState<string | null>(null);

  // Config validation state (Phase 3) - matches saved USB ports with detected scanners
  type ConfigStatus = 'loading' | 'valid' | 'mismatch' | 'no-config' | 'error';
  const [configStatus, setConfigStatus] = useState<ConfigStatus>('loading');
  const [configValidationMessage, setConfigValidationMessage] = useState<string>('Checking scanner configuration...');
  const [missingScanners, setMissingScanners] = useState<GraviScanner[]>([]);
  const [newScanners, setNewScanners] = useState<DetectedScanner[]>([]);
  const [matchedScanners, setMatchedScanners] = useState<Array<{ saved: GraviScanner; detected: DetectedScanner }>>([]);

  // Scan form state
  const [experiments, setExperiments] = useState<ListItem[]>([]);
  const [phenotypers, setPhenotypers] = useState<ListItem[]>([]);
  const [selectedExperiment, setSelectedExperiment] = useState<string>('');
  const [selectedPhenotyper, setSelectedPhenotyper] = useState<string>('');

  // Wave tracking
  const [waveNumber, setWaveNumber] = useState<number>(0);
  const [suggestedWaveNumber, setSuggestedWaveNumber] = useState<number | null>(null);
  const waveRestoredRef = useRef(false); // true when wave was restored from coordinator status
  const [barcodeWaveConflicts, setBarcodeWaveConflicts] = useState<Record<string, string>>({}); // plateIndex → conflict message
  const [scanCompletionCounter, setScanCompletionCounter] = useState(0); // bumped after each scan to re-check conflicts

  // Plant barcodes from the selected experiment's accession
  const [availableBarcodes, setAvailableBarcodes] = useState<string[]>([]);
  const [loadingBarcodes, setLoadingBarcodes] = useState(false);
  // Map of barcode -> accession_name for display
  const [barcodeGenotypes, setBarcodeGenotypes] = useState<Record<string, string | null>>({});
  // Whether the current experiment uses GraviScan plate-level metadata (vs CylScan barcodes)
  const [isGraviMetadata, setIsGraviMetadata] = useState(false);
  // Available plates from GraviScan metadata (used when isGraviMetadata is true)
  const [availablePlates, setAvailablePlates] = useState<AvailablePlate[]>([]);

  // Plate assignments per scanner - each scanner has its own plate assignments (stored in database)
  // Key is scanner_id, value is array of plate assignments for that scanner
  const [scannerPlateAssignments, setScannerPlateAssignments] = useState<Record<string, PlateAssignment[]>>({});
  const [loadingPlateAssignments, setLoadingPlateAssignments] = useState(false);

  // Get assigned scanner IDs (scanners that have been assigned to slots)
  const assignedScannerIds = scannerAssignments
    .filter((a) => a.scannerId !== null)
    .map((a) => a.scannerId as string);

  // Legacy - kept for compatibility, now aggregates across all scanners
  const selectedPlates = Object.values(scannerPlateAssignments)
    .flat()
    .filter((p) => p.selected)
    .map((p) => p.plateIndex);
  const plantBarcode = ''; // No longer used directly - each plate has its own barcode

  // Scanner panel states
  const [scannerStates, setScannerStates] = useState<ScannerPanelState[]>([]);

  // Scan operation state
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanSuccess, setScanSuccess] = useState<string | null>(null);

  // Auto-upload state
  const [autoUploadStatus, setAutoUploadStatus] = useState<'idle' | 'waiting' | 'uploading' | 'done' | 'error'>('idle');
  const [autoUploadMessage, setAutoUploadMessage] = useState<string | null>(null);

  // Test All Scanners state (Phase 3)
  const [isTesting, setIsTesting] = useState(false);
  const [testPhase, setTestPhase] = useState<'idle' | 'connecting' | 'scanning' | 'starting-threads'>('idle');
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; error?: string; scanPath?: string; scanTimeMs?: number; imageDataUri?: string }>>({});
  const [testComplete, setTestComplete] = useState(false);

  // Scan image previews - maps scanner_id → plate_index → base64 data URI
  const [scanImageUris, setScanImageUris] = useState<Record<string, Record<string, string>>>({});
  // Which plate is currently being scanned per scanner (scanner_id → plate_index)
  const [scanningPlateIndex, setScanningPlateIndex] = useState<Record<string, string>>({});

  // Lightbox state for viewing scan images fullscreen
  const [lightboxImage, setLightboxImage] = useState<{ src: string; caption: string } | null>(null);

  // Async scan job tracking — maps job_id → job metadata
  const [pendingJobs, setPendingJobs] = useState<Map<string, {
    scannerId: string; plateIndex: string; outputPath: string;
    plantBarcode: string | null; transplantDate: string | null; customNote: string | null; gridMode: string;
  }>>(new Map());
  const initialPendingCountRef = useRef(0);
  // Template of plate jobs — used by continuous mode to repopulate pendingJobs each cycle
  const pendingJobsTemplateRef = useRef<Map<string, {
    scannerId: string; plateIndex: string; outputPath: string;
    plantBarcode: string | null; transplantDate: string | null; customNote: string | null; gridMode: string;
  }>>(new Map());

  // Continuous scan mode state
  type ScanMode = 'single' | 'continuous';
  const [scanMode, setScanMode] = useState<ScanMode>(() =>
    loadFromStorage(STORAGE_KEYS.scanMode, 'single') as ScanMode
  );
  const [scanIntervalMinutes, setScanIntervalMinutes] = useState<number>(() =>
    loadFromStorage(STORAGE_KEYS.scanInterval, 5)
  );
  const [scanDurationMinutes, setScanDurationMinutes] = useState<number>(() =>
    loadFromStorage(STORAGE_KEYS.scanDuration, 60)
  );
  // Cycle progress tracking for continuous mode
  const [currentCycle, setCurrentCycle] = useState(0);
  const [totalCycles, setTotalCycles] = useState(0);
  const [intervalCountdown, setIntervalCountdown] = useState<number | null>(null);
  const intervalCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [overtimeMs, setOvertimeMs] = useState<number | null>(null);
  const overtimeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const overtimeStartRef = useRef<number | null>(null);
  // Elapsed time tracking for scan sessions
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const scanStartedAtMsRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Refs for stable event callback access (avoid stale closures in useEffect listeners)
  const pendingJobsRef = useRef(pendingJobs);
  const selectedExperimentRef = useRef(selectedExperiment);
  const selectedPhenotyperRef = useRef(selectedPhenotyper);
  const waveNumberRef = useRef(waveNumber);
  const resolutionRef = useRef(resolution);
  const scannerPlateAssignmentsRef = useRef(scannerPlateAssignments);
  const isScanningRef = useRef(isScanning);
  const scannerStatesRef = useRef(scannerStates);
  const sessionIdRef = useRef<string | null>(null);
  const scanModeRef = useRef(scanMode);
  // Per-scanner completed count for the current cycle (continuous mode progress tracking)
  const cycleCompletedCountRef = useRef<Record<string, number>>({});
  // Track GraviScan record IDs per grid index for timestamp updates on grid-complete
  const gridRecordIdsRef = useRef<Record<string, string[]>>({});
  // Track pending DB write promises so grid-complete can await them
  const pendingDbWritesRef = useRef<Promise<void>[]>([]);

  // Load platform info and data on mount
  useEffect(() => {
    loadPlatformInfo();
    loadConfig();
    loadExperiments();
    loadPhenotypers();
    // Validate scanner config on page load (Phase 3)
    validateScannerConfig();
  }, []);

  // Keep refs in sync with state for event callback access
  useEffect(() => { pendingJobsRef.current = pendingJobs; }, [pendingJobs]);
  useEffect(() => { selectedExperimentRef.current = selectedExperiment; }, [selectedExperiment]);
  useEffect(() => { selectedPhenotyperRef.current = selectedPhenotyper; }, [selectedPhenotyper]);
  useEffect(() => { waveNumberRef.current = waveNumber; }, [waveNumber]);
  useEffect(() => { resolutionRef.current = resolution; }, [resolution]);
  useEffect(() => { scannerPlateAssignmentsRef.current = scannerPlateAssignments; }, [scannerPlateAssignments]);
  useEffect(() => { isScanningRef.current = isScanning; }, [isScanning]);
  useEffect(() => { scannerStatesRef.current = scannerStates; }, [scannerStates]);
  useEffect(() => { scanModeRef.current = scanMode; }, [scanMode]);
  // Auto-suggest wave number when experiment changes
  useEffect(() => {
    if (!selectedExperiment) {
      setSuggestedWaveNumber(null);
      setWaveNumber(0);
      setBarcodeWaveConflicts({});
      return;
    }
    // Skip auto-suggest if wave was restored from coordinator (active scan navigated away and back)
    if (waveRestoredRef.current) {
      waveRestoredRef.current = false;
      // Still fetch suggestion for the "Suggested: N" hint, but don't override current wave
      (async () => {
        try {
          const result = await window.electron.database.graviscans.getMaxWaveNumber(selectedExperiment);
          if (result.success && result.data !== undefined) {
            setSuggestedWaveNumber((result.data as number) + 1);
          }
        } catch { /* ignore */ }
      })();
      return;
    }
    (async () => {
      try {
        const result = await window.electron.database.graviscans.getMaxWaveNumber(selectedExperiment);
        if (result.success && result.data !== undefined) {
          const next = (result.data as number) + 1;
          setSuggestedWaveNumber(next);
          setWaveNumber(next);
        } else {
          setSuggestedWaveNumber(0);
          setWaveNumber(0);
        }
      } catch (err) {
        console.warn('[GraviScan] Failed to get max wave number:', err);
        setSuggestedWaveNumber(0);
        setWaveNumber(0);
      }
    })();
  }, [selectedExperiment]);

  // Validate barcode uniqueness per wave per experiment
  useEffect(() => {
    if (!selectedExperiment) {
      setBarcodeWaveConflicts({});
      return;
    }
    const allAssignments = Object.values(scannerPlateAssignments).flat();
    const assignedBarcodes = allAssignments.filter((a) => a.selected && a.plantBarcode);
    if (assignedBarcodes.length === 0) {
      setBarcodeWaveConflicts({});
      return;
    }

    let cancelled = false;
    (async () => {
      const conflicts: Record<string, string> = {};
      for (const assignment of assignedBarcodes) {
        try {
          const result = await window.electron.database.graviscans.checkBarcodeUniqueInWave({
            experiment_id: selectedExperiment,
            wave_number: waveNumber,
            plate_barcode: assignment.plantBarcode!,
          });
          if (result.success && result.data?.isDuplicate) {
            conflicts[assignment.plateIndex] = `Barcode "${assignment.plantBarcode}" already scanned in wave ${waveNumber}`;
          }
        } catch (err) {
          console.warn('[GraviScan] Barcode uniqueness check failed:', err);
        }
      }
      if (!cancelled) {
        setBarcodeWaveConflicts(conflicts);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedExperiment, waveNumber, scannerPlateAssignments, scanCompletionCounter]);

  // Stop elapsed timer when scanning ends
  useEffect(() => {
    if (!isScanning && elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, [isScanning]);

  // Async scan event listeners — push-based updates from scanner subprocesses
  useEffect(() => {
    const cleanupStarted = window.electron.graviscan.onScanStarted((data) => {
      console.log('[GraviScan] Event: scan-started', data.scannerId, data.plateIndex);
      setScanningPlateIndex((prev) => ({ ...prev, [data.scannerId]: data.plateIndex }));
    });

    const cleanupComplete = window.electron.graviscan.onScanComplete(async (data) => {
      console.log('[GraviScan] Event: scan-complete', data.scannerId, data.plateIndex);

      const plateKey = `${data.scannerId}:${data.plateIndex}`;
      const jobInfo = pendingJobsRef.current.get(plateKey);

      // --- Synchronous state updates FIRST (before any async work) ---
      // This prevents race conditions with onCycleComplete which resets counters synchronously.

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
          const totalPlates = scannerPlateAssignmentsRef.current[data.scannerId]?.filter((p) => p.selected).length || 1;

          let completedPlates: number;
          if (scanModeRef.current === 'continuous') {
            // In continuous mode, pendingJobs isn't drained per plate — use a per-cycle counter
            cycleCompletedCountRef.current[data.scannerId] = (cycleCompletedCountRef.current[data.scannerId] || 0) + 1;
            completedPlates = cycleCompletedCountRef.current[data.scannerId];
          } else {
            // Single mode: count remaining in pendingJobs
            let remainingForScanner = 0;
            pendingJobsRef.current.forEach((job) => {
              if (job.scannerId === data.scannerId) remainingForScanner++;
            });
            // -1 because this plate hasn't been removed from pending yet in this callback
            completedPlates = totalPlates - (remainingForScanner - 1);
          }
          return { ...s, progress: Math.round((completedPlates / totalPlates) * 100) };
        })
      );

      // Remove from pending set (single mode only).
      // In continuous mode, pendingJobs is repopulated wholesale on cycle-complete,
      // so deleting here would race with the repopulate and remove a just-restored entry.
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
          const imgResult = await window.electron.graviscan.readScanImage(data.imagePath);
          if (imgResult.success && imgResult.dataUri) {
            setScanImageUris((prev) => ({
              ...prev,
              [data.scannerId]: { ...prev[data.scannerId], [data.plateIndex]: imgResult.dataUri },
            }));
          }
        } catch (err) {
          console.warn('[GraviScan] Failed to load preview for', data.imagePath, err);
        }
      }

      // Create DB records from plate metadata — tracked via pendingDbWritesRef
      // so that grid-complete can await all writes before updating paths.
      if (jobInfo && selectedExperimentRef.current && selectedPhenotyperRef.current) {
        const dbWritePromise = (async () => {
          try {
            const graviscanResult = await window.electron.database.graviscans.create({
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

              // Track record ID for grid-complete timestamp update
              const gridKey = data.plateIndex;
              if (!gridRecordIdsRef.current[gridKey]) {
                gridRecordIdsRef.current[gridKey] = [];
              }
              gridRecordIdsRef.current[gridKey].push(graviscanResult.data.id);
            }

            // Mark as recorded so remount restore won't create duplicates
            window.electron.graviscan.markJobRecorded(plateKey).catch(() => {});
          } catch (err) {
            console.error('[GraviScan] Failed to create DB record:', err);
          }
        })();
        pendingDbWritesRef.current.push(dbWritePromise);
      }
    });

    const cleanupError = window.electron.graviscan.onScanError((data) => {
      console.error('[GraviScan] Event: scan-error', data.scannerId, data.error);

      // Clear scanning plate indicator
      if (data.scannerId) {
        setScanningPlateIndex((prev) => {
          const next = { ...prev };
          delete next[data.scannerId];
          return next;
        });

        // Mark scanner as errored
        setScannerStates((prev) =>
          prev.map((s) =>
            s.scannerId === data.scannerId
              ? { ...s, state: 'error' as ScannerState, lastError: data.error }
              : s
          )
        );
      }

      // Remove from pending set (if plate_index is known)
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
    const cleanupGridComplete = window.electron.graviscan.onGridComplete((data) => {
      console.log('[GraviScan] Event: grid-complete', data.gridIndex, `st=${data.scanStartedAt} et=${data.scanEndedAt}`);

      // Track grid-complete DB writes in pendingDbWritesRef so the upload trigger
      // awaits them — prevents rclone from using stale pre-rename paths.
      const gridWritePromise = (async () => {
        // Wait for all pending DB writes from scan-complete events to finish
        // before updating paths — prevents race condition where grid-complete
        // fires before scanner 2's DB records are created.
        // Filter out own promise to avoid self-deadlock.
        const otherWrites = pendingDbWritesRef.current.filter(p => p !== gridWritePromise);
        if (otherWrites.length > 0) {
          await Promise.allSettled(otherWrites);
        }

        const recordIds = gridRecordIdsRef.current[data.gridIndex];
        if (recordIds && recordIds.length > 0) {
          try {
            const result = await window.electron.database.graviscans.updateGridTimestamps({
              ids: recordIds,
              scan_started_at: data.scanStartedAt,
              scan_ended_at: data.scanEndedAt,
              renamed_files: data.renamedFiles?.map((rf) => ({ oldPath: rf.oldPath, newPath: rf.newPath })),
            });
            if (result.success) {
              console.log(`[GraviScan] Updated ${result.data?.count} records with grid timestamps for grid ${data.gridIndex}`);
            } else {
              console.error('[GraviScan] Failed to update grid timestamps:', result.error);
            }
          } catch (err) {
            console.error('[GraviScan] Failed to update grid timestamps:', err);
          }
          // Clear tracked IDs for this grid (ready for next cycle)
          delete gridRecordIdsRef.current[data.gridIndex];
        }

        // Load preview images from renamed files — fixes race condition where
        // scan-complete fires before the coordinator renames files with _et_ timestamp,
        // causing readScanImage to fail on the original path.
        if (data.renamedFiles && data.renamedFiles.length > 0) {
          for (const rf of data.renamedFiles) {
            // Extract plateIndex from filename (e.g., ..._S1_00.tif → "00")
            const plateMatch = rf.newPath.match(/_S\d+_(\d+)\.[^.]+$/);
            if (!plateMatch || !rf.scannerId) continue;
            const plateIndex = plateMatch[1];

            try {
              const imgResult = await window.electron.graviscan.readScanImage(rf.newPath);
              if (imgResult.success && imgResult.dataUri) {
                setScanImageUris((prev) => {
                  // Only update if preview is missing for this scanner+plate
                  if (prev[rf.scannerId]?.[plateIndex]) return prev;
                  return {
                    ...prev,
                    [rf.scannerId]: { ...prev[rf.scannerId], [plateIndex]: imgResult.dataUri },
                  };
                });
              }
            } catch { /* ignore */ }
          }
        }
      })();
      pendingDbWritesRef.current.push(gridWritePromise);
    });

    // Continuous mode: interval started — store timing for elapsed/remaining display
    const cleanupIntervalStart = window.electron.graviscan.onIntervalStart?.((data) => {
      console.log('[GraviScan] Event: interval-start', data);
      setTotalCycles(data.totalCycles);
    });

    // Continuous mode: cycle complete — increment cycle counter and repopulate pendingJobs
    const cleanupCycleComplete = window.electron.graviscan.onCycleComplete?.((data) => {
      console.log('[GraviScan] Event: cycle-complete', data);
      setCurrentCycle(data.cycle || 0);
      // Set countdown to 0 while next cycle is scanning (so it doesn't disappear)
      setIntervalCountdown(0);

      // Repopulate pendingJobs from template so the next cycle's scan-complete events
      // can find plate metadata for DB record creation
      if (scanModeRef.current === 'continuous' && pendingJobsTemplateRef.current.size > 0) {
        const refreshed = new Map(pendingJobsTemplateRef.current);
        setPendingJobs(refreshed);
        // Reset per-cycle progress counters and scanner progress bars
        cycleCompletedCountRef.current = {};
        setScannerStates((prev) =>
          prev.map((s) =>
            s.enabled ? { ...s, state: 'waiting' as ScannerState, progress: 0 } : s
          )
        );
      }
    });

    // Continuous mode: waiting between cycles — start countdown timer
    const cleanupIntervalWaiting = window.electron.graviscan.onIntervalWaiting?.((data) => {
      console.log('[GraviScan] Event: interval-waiting', data);
      const waitMs = data.nextScanMs || 0;
      setIntervalCountdown(Math.ceil(waitMs / 1000));

      // Tick down the countdown every second
      if (intervalCountdownRef.current) clearInterval(intervalCountdownRef.current);
      intervalCountdownRef.current = setInterval(() => {
        setIntervalCountdown((prev) => {
          if (prev === null || prev <= 1) {
            if (intervalCountdownRef.current) clearInterval(intervalCountdownRef.current);
            intervalCountdownRef.current = null;
            return 0; // Show "Scanning plates..." instead of hiding
          }
          return prev - 1;
        });
      }, 1000);
    });

    // Continuous mode: overtime — scan session exceeded original duration
    const cleanupOvertime = window.electron.graviscan.onOvertime?.((data) => {
      console.log('[GraviScan] Event: overtime', data);
      // Start the client-side overtime counter on first overtime event
      if (overtimeStartRef.current === null) {
        overtimeStartRef.current = Date.now() - data.overtimeMs;
        setOvertimeMs(data.overtimeMs);
        if (overtimeTimerRef.current) clearInterval(overtimeTimerRef.current);
        overtimeTimerRef.current = setInterval(() => {
          if (overtimeStartRef.current !== null) {
            setOvertimeMs(Date.now() - overtimeStartRef.current);
          }
        }, 1000);
      }
    });

    // Continuous mode: all cycles done — finalize scan
    const cleanupIntervalComplete = window.electron.graviscan.onIntervalComplete?.((data) => {
      console.log('[GraviScan] Event: interval-complete (all cycles done)', data);
      setIntervalCountdown(null);
      if (intervalCountdownRef.current) clearInterval(intervalCountdownRef.current);
      intervalCountdownRef.current = null;

      // Clear overtime state
      setOvertimeMs(null);
      overtimeStartRef.current = null;
      if (overtimeTimerRef.current) clearInterval(overtimeTimerRef.current);
      overtimeTimerRef.current = null;

      // Finalize continuous scan (equivalent of single-mode completion effect)
      initialPendingCountRef.current = 0;
      pendingJobsTemplateRef.current = new Map();
      setPendingJobs(new Map());
      setIsScanning(false);
      setScanCompletionCounter((c) => c + 1);
      setScannerStates((prev) =>
        prev.map((s) =>
          s.enabled && (s.state === 'scanning' || s.state === 'waiting')
            ? { ...s, state: 'complete' as ScannerState, isBusy: false, progress: 100 }
            : s
        )
      );
      const overtimeSuffix = data.overtimeMs > 0
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
            await window.electron.database.graviscanSessions.complete({ session_id: sid });

            // Settling delay: let in-flight grid-complete IPC events arrive
            console.log('[GraviScan] Waiting 45s for scan records and path renames to finalize...');
            await new Promise((r) => setTimeout(r, 45000));

            // Drain loop: await all pending DB writes, re-check for late arrivals
            while (pendingDbWritesRef.current.length > 0) {
              const pending = [...pendingDbWritesRef.current];
              pendingDbWritesRef.current = [];
              console.log(`[GraviScan] Draining ${pending.length} pending DB writes...`);
              await Promise.allSettled(pending);
            }

            console.log('[GraviScan] Session complete (continuous), starting Box backup...');
            setAutoUploadStatus('uploading');
            const result = await window.electron.graviscan.uploadAllScans();

            if (result.success) {
              console.log(`[GraviScan] Auto-upload complete: ${result.uploaded} uploaded, ${result.skipped} skipped`);
              setAutoUploadStatus('done');
              setAutoUploadMessage(`Backed up ${result.uploaded} image${result.uploaded !== 1 ? 's' : ''} to Box`);
            } else {
              console.warn('[GraviScan] Box backup finished with errors:', result.errors);
              setAutoUploadStatus('done');
              setAutoUploadMessage(`Box backup: ${result.uploaded} succeeded, ${result.failed} failed`);
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
      if (intervalCountdownRef.current) clearInterval(intervalCountdownRef.current);
      if (overtimeTimerRef.current) clearInterval(overtimeTimerRef.current);
    };
  }, []);

  // Completion detection — finalize scan when all pending jobs are drained (single mode only).
  // In continuous mode, finalization is handled by the onIntervalComplete event listener.
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
            ? { ...s, state: 'complete' as ScannerState, isBusy: false, progress: 100 }
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
            await window.electron.database.graviscanSessions.complete({ session_id: sid });

            // Settling delay: let in-flight grid-complete IPC events arrive
            // (coordinator renames files on disk between last scan-complete and grid-complete)
            console.log('[GraviScan] Waiting 45s for scan records and path renames to finalize...');
            await new Promise((r) => setTimeout(r, 45000));

            // Drain loop: await all pending DB writes, re-check for late arrivals
            while (pendingDbWritesRef.current.length > 0) {
              const pending = [...pendingDbWritesRef.current];
              pendingDbWritesRef.current = [];
              console.log(`[GraviScan] Draining ${pending.length} pending DB writes...`);
              await Promise.allSettled(pending);
            }

            console.log('[GraviScan] Session complete, starting Box backup...');
            setAutoUploadStatus('uploading');
            const result = await window.electron.graviscan.uploadAllScans();

            if (result.success) {
              console.log(`[GraviScan] Box backup complete: ${result.uploaded} backed up, ${result.skipped} skipped`);
              setAutoUploadStatus('done');
              setAutoUploadMessage(`Backed up ${result.uploaded} image${result.uploaded !== 1 ? 's' : ''} to Box`);
            } else {
              console.warn('[GraviScan] Box backup finished with errors:', result.errors);
              setAutoUploadStatus('done');
              setAutoUploadMessage(`Box backup: ${result.uploaded} succeeded, ${result.failed} failed`);
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

  // Restore scan state on mount — if user navigated away during an active scan,
  // query the main process for current session state and resume tracking.
  useEffect(() => {
    (async () => {
      try {
        const status = await window.electron.graviscan.getScanStatus();
        if (!status.jobs) return;

        // If session finished while we were away, still process DB records
        const sessionFinishedWhileAway = !status.isActive;

        console.log(`[GraviScan] Restoring scan session on mount (active: ${!sessionFinishedWhileAway})`);

        // Restore sessionId ref
        if (status.sessionId) sessionIdRef.current = status.sessionId;

        // Rebuild pendingJobs from session jobs that aren't yet complete
        const restoredPending = new Map<string, {
          scannerId: string; plateIndex: string; outputPath: string;
          plantBarcode: string | null; transplantDate: string | null; customNote: string | null; gridMode: string;
        }>();
        const completedJobs: Array<{ scannerId: string; plateIndex: string; imagePath: string; durationMs?: number }> = [];

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
            // In continuous mode, pending jobs may still have imagePath from previous cycle
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
          initialPendingCountRef.current = restoredPending.size + completedJobs.length;
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
              const hasJobs = Object.values(status.jobs!).some((j) => j.scannerId === s.scannerId);
              if (!hasJobs) return s;
              const totalPlates = Object.values(status.jobs!).filter((j) => j.scannerId === s.scannerId).length;
              const donePlates = Object.values(status.jobs!).filter(
                (j) => j.scannerId === s.scannerId && (j.status === 'complete' || j.status === 'error')
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
            scanStartedAtMsRef.current = status.scanStartedAt;
            setElapsedSeconds(Math.floor((Date.now() - status.scanStartedAt) / 1000));
            if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
            elapsedTimerRef.current = setInterval(() => {
              if (scanStartedAtMsRef.current) {
                setElapsedSeconds(Math.floor((Date.now() - scanStartedAtMsRef.current) / 1000));
              }
            }, 1000);
          }

          // Restore continuous scan timing state
          if (status.isContinuous) {
            if (status.currentCycle) setCurrentCycle(status.currentCycle);
            if (status.totalCycles) setTotalCycles(status.totalCycles);

            // Restore countdown based on coordinator state
            if (status.coordinatorState === 'waiting' && status.nextScanAt) {
              const remainingMs = status.nextScanAt - Date.now();
              if (remainingMs > 0) {
                setIntervalCountdown(Math.ceil(remainingMs / 1000));
                // Start countdown ticker
                if (intervalCountdownRef.current) clearInterval(intervalCountdownRef.current);
                intervalCountdownRef.current = setInterval(() => {
                  setIntervalCountdown((prev) => {
                    if (prev === null || prev <= 1) {
                      if (intervalCountdownRef.current) clearInterval(intervalCountdownRef.current);
                      intervalCountdownRef.current = null;
                      return 0;
                    }
                    return prev - 1;
                  });
                }, 1000);
              } else {
                // Wait period already elapsed — scanning should be starting
                setIntervalCountdown(0);
              }
            } else if (status.coordinatorState === 'scanning') {
              // Actively scanning plates — show 0
              setIntervalCountdown(0);
            }
          }
        }

        // Load completed images into preview
        for (const job of completedJobs) {
          try {
            const imgResult = await window.electron.graviscan.readScanImage(job.imagePath);
            if (imgResult.success && imgResult.dataUri) {
              setScanImageUris((prev) => ({
                ...prev,
                [job.scannerId]: { ...prev[job.scannerId], [job.plateIndex]: imgResult.dataUri },
              }));
            }
          } catch {
            // Image load failed — skip preview
          }
        }

        // Process completed jobs for DB records (only those not already recorded by live handler)
        for (const job of completedJobs) {
          const plateKey = `${job.scannerId}:${job.plateIndex}`;
          const jobMeta = status.jobs[plateKey];
          if (jobMeta && !jobMeta.dbRecorded && status.experimentId && status.phenotyperId) {
            try {
              const graviscanResult = await window.electron.database.graviscans.create({
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
                scan_started_at: null, // Not available in recovery path
              });
              if (graviscanResult.success && graviscanResult.data) {
                await window.electron.database.graviimages.create({
                  graviscan_id: graviscanResult.data.id,
                  path: job.imagePath,
                  status: 'pending',
                });
              }
              window.electron.graviscan.markJobRecorded(plateKey).catch(() => {});
            } catch (err) {
              console.error('[GraviScan] Failed to create DB record for restored job:', err);
            }
          }
        }

        // If session finished while we were away, mark it complete in DB
        if (sessionFinishedWhileAway && sessionIdRef.current) {
          window.electron.database.graviscanSessions
            .complete({ session_id: sessionIdRef.current })
            .catch((err) => console.error('[GraviScan] Failed to complete session on restore:', err));
          sessionIdRef.current = null;
        }

        console.log(`[GraviScan] Restored: ${restoredPending.size} pending, ${completedJobs.length} completed${sessionFinishedWhileAway ? ' (session already finished)' : ''}`);
      } catch (err) {
        console.warn('[GraviScan] Failed to restore scan status:', err);
      }
    })();
  }, []);

  // Persist detected scanners to localStorage
  useEffect(() => {
    saveToStorage(STORAGE_KEYS.detectedScanners, detectedScanners);
  }, [detectedScanners]);

  // Persist scanner assignments to localStorage
  useEffect(() => {
    saveToStorage(STORAGE_KEYS.scannerAssignments, scannerAssignments);
  }, [scannerAssignments]);

  // Auto-save scanner assignments to database when they change
  // This replaces the manual "Save Config" button
  useEffect(() => {
    const assignedScanners = scannerAssignments
      .filter((a) => a.scannerId !== null)
      .map((a) => detectedScanners.find((s) => s.scanner_id === a.scannerId))
      .filter((s): s is DetectedScanner => s !== undefined);

    // Only auto-save if there are assigned scanners
    if (assignedScanners.length === 0) return;

    // Debounce auto-save to avoid excessive database writes
    const timeoutId = setTimeout(async () => {
      try {
        // Save config with resolution and first assigned scanner's grid mode
        const firstAssigned = scannerAssignments.find((a) => a.scannerId !== null);
        await window.electron.graviscan.saveConfig({
          grid_mode: firstAssigned?.gridMode || '2grid',
          resolution: resolution,
        });

        // Save assigned scanners to database with USB port info
        const scannersToSave = assignedScanners.map((s) => {
          const assignment = scannerAssignments.find((a) => a.scannerId === s.scanner_id);
          return {
            name: s.name,
            display_name: assignment?.slot || null, // User-assigned name (e.g., "Scanner 1")
            vendor_id: s.vendor_id,
            product_id: s.product_id,
            usb_port: s.usb_port,
            usb_bus: s.usb_bus,
            usb_device: s.usb_device,
          };
        });

        const saveResult = await window.electron.graviscan.saveScannersDb(scannersToSave);
        if (saveResult.success && saveResult.scanners) {
          console.log('[GraviScan] Auto-saved scanner configuration');
          setConfigSaved(true);

          // Update temp IDs (new:bus:device) with real DB UUIDs
          const savedScanners = saveResult.scanners as Array<{
            id: string; usb_bus: number | null; usb_device: number | null;
            name: string;
          }>;
          const idUpdates = new Map<string, string>(); // oldId → newId
          for (const saved of savedScanners) {
            const tempId = `new:${saved.usb_bus}:${saved.usb_device}`;
            const matched = assignedScanners.find(
              (s) => s.scanner_id === tempId ||
                     (s.usb_bus === saved.usb_bus && s.usb_device === saved.usb_device)
            );
            if (matched && matched.scanner_id !== saved.id) {
              idUpdates.set(matched.scanner_id, saved.id);
            }
          }
          if (idUpdates.size > 0) {
            setDetectedScanners((prev) =>
              prev.map((s) => idUpdates.has(s.scanner_id)
                ? { ...s, scanner_id: idUpdates.get(s.scanner_id)! }
                : s
              )
            );
            setScannerAssignments((prev) =>
              prev.map((a) => a.scannerId && idUpdates.has(a.scannerId)
                ? { ...a, scannerId: idUpdates.get(a.scannerId)! }
                : a
              )
            );
          }
        }
      } catch (error) {
        console.error('[GraviScan] Auto-save failed:', error);
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timeoutId);
  // Note: detectedScanners intentionally excluded — detection alone shouldn't trigger saves.
  // The effect reads detectedScanners but only needs to re-run when assignments/resolution change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannerAssignments, resolution]);

  // Note: gridMode is now per-scanner, persisted in scannerAssignments

  // Persist resolution to localStorage
  useEffect(() => {
    saveToStorage(STORAGE_KEYS.resolution, resolution);
  }, [resolution]);

  // Persist collapsed state to localStorage
  useEffect(() => {
    saveToStorage(STORAGE_KEYS.configCollapsed, isConfigCollapsed);
  }, [isConfigCollapsed]);

  // Persist configured state to localStorage
  useEffect(() => {
    saveToStorage(STORAGE_KEYS.isConfigured, configSaved);
  }, [configSaved]);

  // Persist session validated state to localStorage
  useEffect(() => {
    saveToStorage(STORAGE_KEYS.sessionValidated, sessionValidated);
  }, [sessionValidated]);

  // Persist continuous scan settings to localStorage
  useEffect(() => {
    saveToStorage(STORAGE_KEYS.scanMode, scanMode);
  }, [scanMode]);
  useEffect(() => {
    saveToStorage(STORAGE_KEYS.scanInterval, scanIntervalMinutes);
  }, [scanIntervalMinutes]);
  useEffect(() => {
    saveToStorage(STORAGE_KEYS.scanDuration, scanDurationMinutes);
  }, [scanDurationMinutes]);

  // Reset plate assignments when scanner assignments change (including per-scanner grid mode)
  useEffect(() => {
    const newScannerAssignments: Record<string, PlateAssignment[]> = {};

    // For each assigned scanner, create plate assignments based on its grid mode
    scannerAssignments.forEach((assignment) => {
      if (assignment.scannerId) {
        const scannerGridMode = assignment.gridMode || '2grid';
        const defaultAssignments = createPlateAssignments(scannerGridMode);
        newScannerAssignments[assignment.scannerId] = [...defaultAssignments];
      }
    });

    setScannerPlateAssignments(newScannerAssignments);

    // If experiment is selected, save the new defaults to database for each scanner
    if (selectedExperiment && assignedScannerIds.length > 0) {
      scannerAssignments.forEach((assignment) => {
        if (assignment.scannerId) {
          const scannerGridMode = assignment.gridMode || '2grid';
          const defaultAssignments = createPlateAssignments(scannerGridMode);
          window.electron.database.graviscanPlateAssignments.upsertMany(
            selectedExperiment,
            assignment.scannerId,
            defaultAssignments.map((a) => ({
              plate_index: a.plateIndex,
              plate_barcode: a.plantBarcode,
              selected: a.selected,
            }))
          ).catch((err) => console.error('Failed to save plate assignments after grid mode change:', err));
        }
      });
    }
  }, [scannerAssignments, selectedExperiment]);

  // Load plant barcodes and plate assignments when experiment changes
  useEffect(() => {
    async function loadExperimentData() {
      if (!selectedExperiment) {
        setAvailableBarcodes([]);
        setBarcodeGenotypes({});
        setIsGraviMetadata(false);
        setAvailablePlates([]);
        setScannerPlateAssignments({});
        return;
      }

      setLoadingBarcodes(true);
      setLoadingPlateAssignments(true);

      try {
        // First get the experiment to find its accession
        const expResult = await window.electron.database.experiments.get(selectedExperiment);
        console.log('[GraviScan] Experiment data:', expResult.data);

        if (!expResult.success || !expResult.data || !expResult.data.accession_id) {
          console.log('[GraviScan] No accession linked to experiment');
          setAvailableBarcodes([]);
          setBarcodeGenotypes({});
          setIsGraviMetadata(false);
          setAvailablePlates([]);
        } else {
          const accessionId = expResult.data.accession_id;
          console.log('[GraviScan] Fetching mappings for accession:', accessionId);

          // Try CylScan mappings first (PlantAccessionMappings)
          const mappingsResult = await window.electron.database.accessions.getMappings(accessionId);

          if (mappingsResult.success && mappingsResult.data && mappingsResult.data.length > 0) {
            // CylScan metadata — plant_barcode + accession_name
            setIsGraviMetadata(false);
            setAvailablePlates([]);

            const barcodes = mappingsResult.data.map((m: { plant_barcode: string }) => m.plant_barcode);
            setAvailableBarcodes(barcodes);

            const genotypeMap: Record<string, string | null> = {};
            mappingsResult.data.forEach((m: { plant_barcode: string; accession_name: string | null }) => {
              genotypeMap[m.plant_barcode] = m.accession_name;
            });
            setBarcodeGenotypes(genotypeMap);
          } else {
            // Try GraviScan metadata — plate-level assignment
            const platesResult = await window.electron.database.graviPlateAccessions.list(accessionId);

            if (platesResult.success && platesResult.data && platesResult.data.length > 0) {
              setIsGraviMetadata(true);

              // Build plate metadata for dropdown
              const plates: AvailablePlate[] = platesResult.data.map((plate: any) => ({
                id: plate.id,
                plate_id: plate.plate_id,
                accession: plate.accession,
                custom_note: plate.custom_note ?? null,
                sectionCount: new Set((plate.sections || []).map((s: any) => s.plate_section_id)).size,
                plantQrCodes: (plate.sections || []).map((s: any) => s.plant_qr),
              }));
              setAvailablePlates(plates);

              // Populate availableBarcodes with plate_ids for backward compat
              // (used by selectedPlatesWithBarcodes count and handlePlateBarcode)
              const plateIds = plates.map((p) => p.plate_id);
              setAvailableBarcodes(plateIds);

              // Map plate_id → accession for genotype display slot
              const genotypeMap: Record<string, string | null> = {};
              plates.forEach((p) => {
                genotypeMap[p.plate_id] = p.accession;
              });
              setBarcodeGenotypes(genotypeMap);
            } else {
              setIsGraviMetadata(false);
              setAvailablePlates([]);
              setAvailableBarcodes([]);
              setBarcodeGenotypes({});
            }
          }
        }

        // Load plate assignments from database for each assigned scanner
        const newScannerAssignments: Record<string, PlateAssignment[]> = {};

        for (const scannerId of assignedScannerIds) {
          // Get grid mode for this scanner from assignments
          const scannerAssignment = scannerAssignments.find((a) => a.scannerId === scannerId);
          const scannerGridMode = scannerAssignment?.gridMode || '2grid';
          const defaultAssignments = createPlateAssignments(scannerGridMode);

          const assignmentsResult = await window.electron.database.graviscanPlateAssignments.list(
            selectedExperiment,
            scannerId
          );

          if (assignmentsResult.success && assignmentsResult.data && assignmentsResult.data.length > 0) {
            // Convert database records to PlateAssignment format
            const dbAssignments: PlateAssignment[] = assignmentsResult.data.map((a) => ({
              plateIndex: a.plate_index,
              plantBarcode: a.plate_barcode,
              transplantDate: a.transplant_date ? new Date(a.transplant_date).toISOString().split('T')[0] : null,
              customNote: a.custom_note ?? null,
              selected: a.selected,
            }));

            // Merge with default assignments for current grid mode (in case grid mode changed)
            const mergedAssignments = defaultAssignments.map((defaultA) => {
              const dbMatch = dbAssignments.find((db) => db.plateIndex === defaultA.plateIndex);
              return dbMatch || defaultA;
            });

            newScannerAssignments[scannerId] = mergedAssignments;
          } else {
            // No existing assignments, create defaults and save to database
            newScannerAssignments[scannerId] = [...defaultAssignments];

            // Save defaults to database
            await window.electron.database.graviscanPlateAssignments.upsertMany(
              selectedExperiment,
              scannerId,
              defaultAssignments.map((a) => ({
                plate_index: a.plateIndex,
                plate_barcode: a.plantBarcode,
                selected: a.selected,
              }))
            );
          }
        }

        setScannerPlateAssignments(newScannerAssignments);
      } catch (error) {
        console.error('Failed to load experiment data:', error);
        setAvailableBarcodes([]);
        setBarcodeGenotypes({});
        setIsGraviMetadata(false);
        setAvailablePlates([]);
        setScannerPlateAssignments({});
      } finally {
        setLoadingBarcodes(false);
        setLoadingPlateAssignments(false);
      }
    }

    loadExperimentData();
  }, [selectedExperiment, scannerAssignments]);

  // Reset scanner port info session validation when app window closes
  useEffect(() => {
    function handleBeforeUnload() {
      // Reset session validation when app closes
      localStorage.setItem(STORAGE_KEYS.sessionValidated, 'false');
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Validate cached scanners via main process on mount (background validation)
  useEffect(() => {
    async function validateCachedScanners() {
      // Skip if already validated this session
      const alreadyValidated = loadFromStorage<boolean>(STORAGE_KEYS.sessionValidated, false);
      if (alreadyValidated) {
        return;
      }

      // Get cached scanner IDs from localStorage
      const cachedScanners = loadFromStorage<DetectedScanner[]>(STORAGE_KEYS.detectedScanners, []);

      // Skip if no cached scanners (first-time user)
      if (cachedScanners.length === 0) {
        return;
      }

      const cachedScannerIds = cachedScanners
        .filter((s) => s.is_available)
        .map((s) => s.scanner_id);

      setIsValidating(true);
      setValidationWarning(null);

      try {
        // Call main process to validate scanners
        const result = await window.electron.graviscan.validateScanners(cachedScannerIds);

        if (result.isValidated) {
          // Validation success - IDs matched
          setDetectedScanners(result.detectedScanners);
          setSessionValidated(true);
        } else if (result.detectedScanners.length > 0) {
          // IDs didn't match but scanners were detected - try matching by name
          // This happens when scanner IDs change between sessions (e.g., mock mode)
          const cachedAssignments = loadFromStorage<ScannerAssignment[]>(STORAGE_KEYS.scannerAssignments, []);
          let allMatched = true;

          // Use freshly detected scanner data (with current usb_bus/usb_device/sane_name),
          // but map cached assignment scanner_ids to the new IDs
          const updatedAssignments = [...cachedAssignments];

          for (const cached of cachedScanners) {
            const matchByName = result.detectedScanners.find((d) => d.name === cached.name);
            if (matchByName) {
              // Update assignments to point to the fresh scanner's ID
              for (let i = 0; i < updatedAssignments.length; i++) {
                if (updatedAssignments[i].scannerId === cached.scanner_id) {
                  updatedAssignments[i] = { ...updatedAssignments[i], scannerId: matchByName.scanner_id };
                }
              }
            } else {
              allMatched = false;
            }
          }

          if (allMatched) {
            // All scanners matched by name — use fresh detected data (current bus/device/port)
            setDetectedScanners(result.detectedScanners);
            setScannerAssignments(updatedAssignments);
            setSessionValidated(true);
          } else {
            // Some scanners missing
            setValidationWarning(result.validationError || 'Some scanners are no longer available');
            setDetectedScanners(result.detectedScanners);
            setIsConfigCollapsed(false);
            setConfigSaved(false);
            setSessionValidated(false);
          }
        } else {
          // No scanners found at all
          setIsConfigCollapsed(false);
          setSessionValidated(false);
        }
      } catch (error) {
        setValidationWarning('Scanner validation error. Please reconfigure.');
        setIsConfigCollapsed(false);
        setSessionValidated(false);
      } finally {
        setIsValidating(false);
      }
    }

    validateCachedScanners();
  }, []); // Run once on mount

  // Initialize scanner states from assigned scanners (not all detected)
  useEffect(() => {
    // Only show scanners that are assigned to a slot
    const assignedScanners = scannerAssignments
      .filter((assignment) => assignment.scannerId !== null)
      .map((assignment) => {
        const scanner = detectedScanners.find((s) => s.scanner_id === assignment.scannerId);
        return scanner ? { scanner, slot: assignment.slot } : null;
      })
      .filter((item): item is { scanner: DetectedScanner; slot: string } => item !== null);

    const states: ScannerPanelState[] = assignedScanners.map(({ scanner, slot }) => ({
      scannerId: scanner.scanner_id,
      name: slot, // Use slot name (e.g., "Scanner 1") instead of device name
      enabled: true,
      isOnline: scanner.is_available,
      isBusy: false,
      state: 'idle',
      progress: 0,
      outputFilename: '',
    }));
    setScannerStates(states);
  }, [detectedScanners, scannerAssignments]);

  async function loadPlatformInfo() {
    try {
      setPlatformLoading(true);
      const result = await window.electron.graviscan.getPlatformInfo();
      if (result.success) {
        setPlatformInfo({
          supported: result.supported,
          backend: result.backend,
          mock_enabled: result.mock_enabled,
        });
      }
    } catch (error) {
      console.error('Failed to load platform info:', error);
    } finally {
      setPlatformLoading(false);
    }
  }

  async function loadConfig() {
    try {
      const result = await window.electron.graviscan.getConfig();
      if (result.success && result.config) {
        setConfig(result.config);
        // Note: gridMode is now per-scanner, stored in scannerAssignments
        setResolution(result.config.resolution);
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  }

  /**
   * Validate scanner configuration by matching saved USB ports with detected scanners.
   * Called on page load to determine if we can skip config setup or need reconfiguration.
   */
  async function validateScannerConfig() {
    try {
      setConfigStatus('loading');
      setConfigValidationMessage('Loading scanner configuration...');

      // Step 1: Load saved config
      setConfigValidationMessage('Detecting connected scanners...');

      // Step 2 & 3: Validate config (loads saved scanners, detects connected, matches by usb_port)
      const result = await window.electron.graviscan.validateConfig();

      if (!result.success) {
        setConfigStatus('error');
        setConfigValidationMessage(result.error || 'Configuration validation failed');
        return;
      }

      // Update state based on validation result
      setMatchedScanners(result.matched);
      setMissingScanners(result.missing);
      setNewScanners(result.new);

      switch (result.status) {
        case 'valid':
          setConfigStatus('valid');
          setConfigValidationMessage('Scanners ready');
          // Update detected scanners with matched scanners
          setDetectedScanners(result.detectedScanners);
          // Update scanner assignments from matched scanners
          if (result.matched.length > 0) {
            console.log("The Cached Scanner:",result)
            const newAssignments: ScannerAssignment[] = result.matched.map((m, index) => {
              // Preserve user's gridMode from localStorage-restored state, fallback to '2grid'
              const existing = scannerAssignments.find((a) => a.scannerId === m.saved.id);
              return {
                slot: `Scanner ${index + 1}`,
                scannerId: m.saved.id,
                usbPort: m.detected.usb_port,
                gridMode: existing?.gridMode || '2grid',
              };
            });
            setScannerAssignments(newAssignments);
            setConfigSaved(true);
            setIsConfigCollapsed(true);
            setSessionValidated(true);
          }
          break;

        case 'mismatch':
          setConfigStatus('mismatch');
          const missingNames = result.missing.map(s => s.name).join(', ');
          const newPorts = result.new.map(s => s.usb_port).join(', ');
          let message = 'Scanner configuration has changed. ';
          if (result.missing.length > 0) {
            message += `Missing: ${missingNames}. `;
          }
          if (result.new.length > 0) {
            message += `New scanners on ports: ${newPorts}.`;
          }
          setConfigValidationMessage(message);
          // Update detected scanners for reconfiguration
          setDetectedScanners(result.detectedScanners);
          setIsConfigCollapsed(false);
          break;

        case 'no-config':
          setConfigStatus('no-config');
          setConfigValidationMessage('No scanner configuration found. Please configure scanners.');
          setIsConfigCollapsed(false);
          break;

        default:
          setConfigStatus('error');
          setConfigValidationMessage('Unknown validation status');
      }
    } catch (error) {
      console.error('Failed to validate scanner config:', error);
      setConfigStatus('error');
      setConfigValidationMessage(error instanceof Error ? error.message : 'Validation failed');
    }
  }

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
      setExperiments(graviscanExperiments.map((exp: { id: string; name: string }) => ({
        id: exp.id,
        name: exp.name,
      })));
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
      setPhenotypers(result.data.map((p: { id: string; name: string }) => ({
        id: p.id,
        name: p.name,
      })));
    } catch (error) {
      console.error('Failed to load phenotypers:', error);
    }
  }

  const handleToggleScannerEnabled = useCallback((scannerId: string, enabled: boolean) => {
    setScannerStates((prev) =>
      prev.map((s) => (s.scannerId === scannerId ? { ...s, enabled } : s))
    );
  }, []);

  // Toggle plate selection and save to database (per scanner)
  const handleTogglePlate = useCallback((scannerId: string, plateIndex: string) => {
    setScannerPlateAssignments((prev) => {
      const scannerAssignments = prev[scannerId] || [];
      const updated = scannerAssignments.map((p) =>
        p.plateIndex === plateIndex ? { ...p, selected: !p.selected } : p
      );

      // Save to database if experiment is selected
      if (selectedExperiment) {
        const assignment = updated.find((p) => p.plateIndex === plateIndex);
        if (assignment) {
          window.electron.database.graviscanPlateAssignments.upsert(
            selectedExperiment,
            scannerId,
            plateIndex,
            { selected: assignment.selected }
          ).catch((err) => console.error('Failed to save plate selection:', err));
        }
      }

      return { ...prev, [scannerId]: updated };
    });
  }, [selectedExperiment]);

  // Assign plant barcode to a plate and save to database (per scanner)
  const handlePlateBarcode = useCallback((scannerId: string, plateIndex: string, barcode: string | null) => {
    // Prevent assigning the same barcode to multiple slots
    if (barcode) {
      const allAssignments = Object.entries(scannerPlateAssignments).flatMap(
        ([sid, plates]) => plates.map((p) => ({ scannerId: sid, ...p }))
      );
      const existing = allAssignments.find(
        (a) => a.plantBarcode === barcode && !(a.scannerId === scannerId && a.plateIndex === plateIndex)
      );
      if (existing) {
        setScanError(`Barcode "${barcode}" is already assigned to plate ${existing.plateIndex}`);
        return;
      }
    }

    setScannerPlateAssignments((prev) => {
      const scannerAssignments = prev[scannerId] || [];
      const updated = scannerAssignments.map((p) =>
        p.plateIndex === plateIndex ? { ...p, plantBarcode: barcode } : p
      );

      // Save to database if experiment is selected
      if (selectedExperiment) {
        window.electron.database.graviscanPlateAssignments.upsert(
          selectedExperiment,
          scannerId,
          plateIndex,
          { plate_barcode: barcode }
        ).then((result) => {
          console.log('[GraviScan] Upsert response:', result);
        }).catch((err) => console.error('Failed to save plate barcode:', err));
      }

      return { ...prev, [scannerId]: updated };
    });
  }, [selectedExperiment, scannerPlateAssignments]);

  // Handle scanner assignment change (with auto-save)
  const handleScannerAssignment = useCallback((slotIndex: number, scannerId: string | null) => {
    setScannerAssignments((prev) => {
      const updated = [...prev];
      const scanner = scannerId ? detectedScanners.find((s) => s.scanner_id === scannerId) : null;
      updated[slotIndex] = {
        ...updated[slotIndex],
        scannerId,
        usbPort: scanner?.usb_port || null,
      };
      return updated;
    });
    // Auto-save when scanner is assigned
    if (scannerId) {
      setConfigSaved(true);
    }
  }, [detectedScanners]);

  // Handle grid mode change per scanner (with auto-save)
  const handleScannerGridMode = useCallback((slotIndex: number, gridMode: '2grid' | '4grid') => {
    setScannerAssignments((prev) => {
      const updated = [...prev];
      updated[slotIndex] = {
        ...updated[slotIndex],
        gridMode,
      };
      return updated;
    });
  }, []);

  // Add a new scanner slot
  const handleAddScannerSlot = useCallback(() => {
    setScannerAssignments((prev) => {
      if (prev.length >= MAX_SCANNER_SLOTS) return prev;
      return [...prev, createEmptyScannerAssignment(prev.length)];
    });
  }, []);

  // Remove a scanner slot
  const handleRemoveScannerSlot = useCallback((slotIndex: number) => {
    setScannerAssignments((prev) => {
      if (prev.length <= 1) return prev;
      const updated = prev.filter((_, i) => i !== slotIndex);
      // Re-number the slots
      return updated.map((assignment, i) => ({
        ...assignment,
        slot: `Scanner ${i + 1}`,
      }));
    });
  }, []);

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
    scanStartedAtMsRef.current = Date.now();
    setElapsedSeconds(0);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = setInterval(() => {
      if (scanStartedAtMsRef.current) {
        setElapsedSeconds(Math.floor((Date.now() - scanStartedAtMsRef.current) / 1000));
      }
    }, 1000);

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
      // Continue with scan even if save fails - assignments are already saved in real-time
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

      // Generate filename base — keep T separator (YYYYMMDDTHHMMSS, 15 chars)
      // so the coordinator's per-wave timestamp regex can match and replace it.
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
      const expName = experiments.find((e) => e.id === selectedExperiment)?.name || 'scan';
      const sanitizedExpName = expName.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20);

      // Track pending plates for DB record creation on scan-complete events
      const newPendingPlates = new Map<string, {
        scannerId: string; plateIndex: string; outputPath: string;
        plantBarcode: string | null; transplantDate: string | null; customNote: string | null; gridMode: string;
      }>();

      // Build scan config for each scanner — plates with output paths
      const scannerConfigs = enabledScanners.map((scanner, scannerIdx) => {
        const scannerAssignmentsList = scannerPlateAssignments[scanner.scannerId] || [];
        const selectedPlatesForScanner = scannerAssignmentsList.filter((p) => p.selected);
        const scannerAssignment = scannerAssignments.find((a) => a.scannerId === scanner.scannerId);
        const scannerGridMode = scannerAssignment?.gridMode || '2grid';

        const detected = detectedScanners.find((d) => d.scanner_id === scanner.scannerId);
        const saneName = detected?.sane_name || '';

        const plates = selectedPlatesForScanner.map((plate) => {
          const systemTag = platformInfo?.system_name || `S${scannerIdx + 1}`;
          const filename = `${sanitizedExpName}_st_${timestamp}_cy1_${systemTag}_${plate.plateIndex}.tif`;
          const outputPath = `${outputDir}/${filename}`;

          // Track plate metadata for DB record creation when scan-complete arrives
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

      // newPendingPlates already built in the map closure above

      if (scannerConfigs.every((c) => c.plates.length === 0)) {
        setScanError('No plates selected for scanning');
        setIsScanning(false);
        return;
      }

      console.log(`[GraviScan] Starting scan with ${scannerConfigs.length} scanner(s), ${newPendingPlates.size} plates total`);

      // Store pending plates for event handler reference
      initialPendingCountRef.current = newPendingPlates.size;
      setPendingJobs(newPendingPlates);
      // Save template for continuous mode — repopulate pendingJobs each cycle
      pendingJobsTemplateRef.current = new Map(newPendingPlates);

      // Set up cycle tracking for continuous mode
      if (scanMode === 'continuous') {
        const estimatedCycles = Math.floor(scanDurationMinutes / scanIntervalMinutes);
        setTotalCycles(estimatedCycles);
        setCurrentCycle(1);
        setIntervalCountdown(0); // Show "Scanning plates..." immediately
      } else {
        setTotalCycles(0);
        setCurrentCycle(0);
      }

      // Create GraviScanSession DB record to group all scans from this click
      let sessionId: string | null = null;
      try {
        const sessionResult = await window.electron.database.graviscanSessions.create({
          experiment_id: selectedExperiment,
          phenotyper_id: selectedPhenotyper,
          scan_mode: scanMode,
          interval_seconds: scanMode === 'continuous' ? scanIntervalMinutes * 60 : null,
          duration_seconds: scanMode === 'continuous' ? scanDurationMinutes * 60 : null,
          total_cycles: scanMode === 'continuous' ? Math.floor(scanDurationMinutes / scanIntervalMinutes) : 1,
        });
        if (sessionResult.success && sessionResult.data) {
          sessionId = sessionResult.data.id;
          sessionIdRef.current = sessionId;
          console.log(`[GraviScan] Created session ${sessionId} (${scanMode})`);
        }
      } catch (err) {
        console.error('[GraviScan] Failed to create session:', err);
        // Continue without session — scans will have null session_id
      }

      // Single call to start parallel scanning via per-scanner subprocesses
      const startParams: Parameters<typeof window.electron.graviscan.startScan>[0] = {
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
              ? { ...s, state: 'error' as const, isBusy: false, lastError: result.error || 'Start failed' }
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
            ? { ...s, state: 'error' as const, isBusy: false, lastError: 'Scan failed' }
            : s
        )
      );
      setIsScanning(false);
    }
    // NOTE: No finally { setIsScanning(false) } — the completion detection useEffect
    // handles that when all pending jobs have resolved via events.
  }

  async function handleCancelScan() {
    console.log('[GraviScan] Cancelling scan...');

    // Single call to cancel — coordinator handles all subprocesses
    await window.electron.graviscan.cancelScan();

    // Reset state
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
    setIntervalCountdown(null);
    if (intervalCountdownRef.current) {
      clearInterval(intervalCountdownRef.current);
      intervalCountdownRef.current = null;
    }
    setOvertimeMs(null);
    overtimeStartRef.current = null;
    if (overtimeTimerRef.current) {
      clearInterval(overtimeTimerRef.current);
      overtimeTimerRef.current = null;
    }

    // Mark session as cancelled in DB
    if (sessionIdRef.current) {
      window.electron.database.graviscanSessions
        .complete({ session_id: sessionIdRef.current, cancelled: true })
        .catch((err) => console.error('[GraviScan] Failed to mark session cancelled:', err));
      sessionIdRef.current = null;
    }

    console.log('[GraviScan] Scan cancelled');
  }

  function handleResetScanners() {
    setScannerStates((prev) =>
      prev.map((s): ScannerPanelState => ({
        scannerId: s.scannerId,
        name: s.name,
        enabled: s.enabled,
        isOnline: s.isOnline,
        isBusy: false,
        state: 'idle',
        progress: 0,
        outputFilename: '',
        lastError: undefined,
      }))
    );
    setScanSuccess(null);
    setScanError(null);
  }

  async function handleDetectScanners() {
    setDetectingScanner(true);
    setDetectionError(null);
    setValidationWarning(null); // Clear any previous validation warning
    setConfigStatus('valid'); // Clear any mismatch/error banner
    setConfigValidationMessage('');

    try {
      const result = await window.electron.graviscan.detectScanners();
      if (result.success) {
        setDetectedScanners(result.scanners);
        if (result.scanners.length === 0) {
          setDetectionError('No scanners detected. Check USB connections.');
          setSessionValidated(false);
        } else {
          // Mark session as validated when scanners are found
          setSessionValidated(true);
        }
      } else {
        setDetectionError(result.error || 'Detection failed');
        setSessionValidated(false);
      }
    } catch (error) {
      setDetectionError(error instanceof Error ? error.message : 'Detection failed');
      setSessionValidated(false);
    } finally {
      setDetectingScanner(false);
    }
  }

  // Note: handleSaveConfig removed - auto-save is now handled by effect

  // Toggle collapse state
  function handleToggleConfigCollapse() {
    setIsConfigCollapsed((prev) => !prev);
  }

  /**
   * Test all assigned scanners: connect, perform a test scan, then start threads.
   * Three phases with status messages so the user sees progress.
   */
  async function handleTestAllScanners() {
    const assignedScanners = scannerAssignments
      .filter((a) => a.scannerId !== null)
      .map((a) => detectedScanners.find((s) => s.scanner_id === a.scannerId))
      .filter((s): s is DetectedScanner => s !== undefined);

    if (assignedScanners.length === 0) {
      console.warn('[GraviScan] No scanners assigned to test');
      return;
    }

    setIsTesting(true);
    setTestResults({});
    setTestComplete(false);

    const results: Record<string, { success: boolean; error?: string; scanPath?: string; scanTimeMs?: number; imageDataUri?: string }> = {};

    try {
      // Get output directory for test scans
      const outputDirResult = await window.electron.graviscan.getOutputDir();
      const outputDir = outputDirResult.success ? outputDirResult.path : '/tmp';

      // Test via subprocess: scan all plates per scanner at low resolution
      setTestPhase('scanning');
      console.log('[GraviScan] Testing scanners via subprocess with low-res test scan (all grids)');

      // Set up test scan event listeners
      const testStartTime = Date.now();

      // Track pending plate count per scanner — each scanner needs N scan-complete events
      const pendingPlatesPerScanner = new Map<string, number>();
      for (const scanner of assignedScanners) {
        const assignment = scannerAssignments.find((a) => a.scannerId === scanner.scanner_id);
        const gridMode = assignment?.gridMode || '2grid';
        const plateCount = PLATE_INDICES[gridMode].length;
        pendingPlatesPerScanner.set(scanner.scanner_id, plateCount);
      }

      // Listen for scan events during the test
      const testPromise = new Promise<void>((resolve) => {
        const checkDone = () => {
          // All scanners done when every scanner has 0 pending plates
          const allDone = Array.from(pendingPlatesPerScanner.values()).every((count) => count <= 0);
          if (allDone) {
            cleanupTestComplete();
            cleanupTestError();
            cleanupTestStarted();
            resolve();
          }
        };

        const cleanupTestStarted = window.electron.graviscan.onScanStarted((data) => {
          setScanningPlateIndex((prev) => ({ ...prev, [data.scannerId]: data.plateIndex }));
          results[data.scannerId] = { success: false, error: 'Scanning...' };
          setTestResults({ ...results });
        });

        const cleanupTestComplete = window.electron.graviscan.onScanComplete(async (data) => {
          setScanningPlateIndex((prev) => {
            const next = { ...prev };
            delete next[data.scannerId];
            return next;
          });

          // Load preview image into the correct plate slot
          if (data.imagePath) {
            try {
              const imgResult = await window.electron.graviscan.readScanImage(data.imagePath);
              if (imgResult.success && imgResult.dataUri) {
                setScanImageUris((prev) => ({
                  ...prev,
                  [data.scannerId]: { ...prev[data.scannerId], [data.plateIndex]: imgResult.dataUri },
                }));
              }
            } catch { /* ignore preview failure */ }
          }

          // Decrement pending count for this scanner
          const remaining = (pendingPlatesPerScanner.get(data.scannerId) || 1) - 1;
          pendingPlatesPerScanner.set(data.scannerId, remaining);

          // Mark scanner success only when all its plates are done
          if (remaining <= 0) {
            results[data.scannerId] = {
              success: true,
              scanTimeMs: Date.now() - testStartTime,
            };
          }
          setTestResults({ ...results });
          checkDone();
        });

        const cleanupTestError = window.electron.graviscan.onScanError((data) => {
          setScanningPlateIndex((prev) => {
            const next = { ...prev };
            delete next[data.scannerId];
            return next;
          });

          // Decrement pending count even on error so we don't block completion
          const remaining = (pendingPlatesPerScanner.get(data.scannerId) || 1) - 1;
          pendingPlatesPerScanner.set(data.scannerId, remaining);

          results[data.scannerId] = {
            success: false,
            error: data.error || 'Test scan failed',
          };
          setTestResults({ ...results });
          checkDone();
        });

        // No safety timeout — SANE open can take 60s+ per scanner.
        // The test waits for actual scan-complete/scan-error events.
        // User can cancel via the UI if needed.
      });

      // Build test scan configs — all plates per scanner using its configured grid mode
      const scannerConfigs = assignedScanners.map((scanner) => {
        const assignment = scannerAssignments.find((a) => a.scannerId === scanner.scanner_id);
        const gridMode = assignment?.gridMode || '2grid';
        const plateIndices = PLATE_INDICES[gridMode];

        return {
          scannerId: scanner.scanner_id,
          saneName: scanner.sane_name || '',
          plates: plateIndices.map((plateIndex) => ({
            plate_index: plateIndex,
            grid_mode: gridMode,
            resolution: 200, // Minimum resolution accepted by epkowa without rounding
            output_path: `${outputDir}/test-scan-${scanner.scanner_id.slice(0, 8)}-${plateIndex}.tif`,
          })),
        };
      });

      // Start the test scan
      const startResult = await window.electron.graviscan.startScan({
        scanners: scannerConfigs,
      });

      if (!startResult.success) {
        for (const scanner of assignedScanners) {
          results[scanner.scanner_id] = {
            success: false,
            error: startResult.error || 'Failed to start test scan',
          };
        }
        setTestResults({ ...results });
        setTestComplete(true);
        return;
      }

      // Wait for all test scans to complete
      await testPromise;

      console.log('[GraviScan] All scanner tests complete:', results);
      setTestResults({ ...results });
      setTestComplete(true);

      const allPassed = Object.values(results).every((r) => r.success);
      if (allPassed) {
        console.log(`[GraviScan] All scanner tests passed (${Date.now() - testStartTime}ms)`);
      } else {
        console.warn('[GraviScan] Some scanner tests failed:', results);
      }
    } catch (error) {
      console.error('[GraviScan] Test all scanners failed:', error);
    } finally {
      setIsTesting(false);
      setTestPhase('idle');
    }
  }

  // Reset scanner configuration - clears all localStorage data and resets state
  async function handleResetScannerConfig(e: React.MouseEvent) {
    e.stopPropagation(); // Prevent collapsible toggle

    // Clear scanner-related localStorage
    localStorage.removeItem(STORAGE_KEYS.detectedScanners);
    localStorage.removeItem(STORAGE_KEYS.scannerAssignments);
    localStorage.removeItem(STORAGE_KEYS.sessionValidated);
    localStorage.removeItem(STORAGE_KEYS.isConfigured);
    localStorage.removeItem(STORAGE_KEYS.configCollapsed);

    // Reset state
    setDetectedScanners([]);
    setScannerAssignments(
      Array.from({ length: DEFAULT_SCANNER_SLOTS }, (_, index) =>
        createEmptyScannerAssignment(index)
      )
    );
    setScannerStates([]);
    setSessionValidated(false);
    setConfigSaved(false);
    setIsConfigCollapsed(false);
    setValidationWarning(null);
    setDetectionError(null);

    // Cancel any active scans and shut down scanner subprocesses
    try {
      await window.electron.graviscan.cancelScan();
    } catch (error) {
      console.warn('Failed to cancel scan during reset:', error);
    }

    console.log('[GraviScan] Scanner configuration reset');
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
  const canScan = sessionValidated && configSaved && detectedScanners.length > 0;

  // Count selected plates with assigned barcodes (across all scanners)
  const selectedPlatesWithBarcodes = Object.values(scannerPlateAssignments)
    .flat()
    .filter((p) => p.selected && p.plantBarcode);

  // Form validation - check if all required fields are filled
  const hasBarcodeConflicts = Object.keys(barcodeWaveConflicts).length > 0;
  const isFormValid = selectedExperiment !== '' && selectedPhenotyper !== '' && selectedPlates.length > 0 && !hasBarcodeConflicts;
  const canStartScan = canScan && isFormValid && scannerStates.some((s) => s.enabled);

  // Build validation messages for missing fields
  const validationMessages: string[] = [];
  if (!selectedExperiment) validationMessages.push('Experiment');
  if (!selectedPhenotyper) validationMessages.push('Phenotyper');
  // if (!plantBarcode.trim()) validationMessages.push('Plant Barcode');

  return (
    <div className="space-y-6">
      {/* Config Validation Status Banner (Phase 3) */}
      {configStatus === 'loading' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center">
            <svg className="animate-spin h-5 w-5 text-blue-500 mr-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="text-blue-700 text-sm font-medium">
              {configValidationMessage}
            </span>
          </div>
        </div>
      )}

      {configStatus === 'valid' && configValidationMessage && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <svg className="h-5 w-5 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span className="text-green-700 text-sm font-medium">
                {configValidationMessage} - {matchedScanners.length} scanner{matchedScanners.length > 1 ? 's' : ''} configured
              </span>
            </div>
          </div>
        </div>
      )}

      {configStatus === 'mismatch' && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-start">
            <svg className="h-5 w-5 text-amber-500 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div className="flex-1">
              <p className="text-amber-700 text-sm font-medium">
                {configValidationMessage}
              </p>
              {missingScanners.length > 0 && (
                <ul className="mt-1 text-amber-600 text-xs">
                  {missingScanners.map((s) => (
                    <li key={s.id}>• {s.name} (was on port {s.usb_port}) - not detected</li>
                  ))}
                </ul>
              )}
              {newScanners.length > 0 && (
                <ul className="mt-1 text-amber-600 text-xs">
                  {newScanners.map((s) => (
                    <li key={s.usb_port}>• New scanner on port {s.usb_port} - {s.name}</li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-amber-600 text-xs">
                Please reconfigure scanners below.
              </p>
            </div>
          </div>
        </div>
      )}

      {configStatus === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center">
            <svg className="h-5 w-5 text-red-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <span className="text-red-700 text-sm font-medium">
              {configValidationMessage}
            </span>
          </div>
        </div>
      )}

      {/* Mock Mode Banner */}
      {platformInfo?.mock_enabled && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <div className="flex items-center">
            <svg className="h-4 w-4 text-yellow-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span className="text-yellow-700 text-xs font-medium">
              Mock Mode - Simulated scanners
            </span>
          </div>
        </div>
      )}

      {/* Scanner Preview Section - Main visual display */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <ScanPreview
          scanners={scannerAssignments
            .filter((a) => a.scannerId !== null)
            .map((assignment) => {
              const scannerId = assignment.scannerId!;
              const result = testResults[scannerId];
              const scanningInProgress = result?.error === 'Scanning...';
              const scannerState = scannerStates.find((s) => s.scannerId === scannerId);
              const isScanningProduction = scannerState?.state === 'scanning' && scannerState?.isBusy;
              // Show scanning state during test if this scanner hasn't completed yet
              const isTestingThisScanner = isTesting && !result?.success;
              return {
                assignment,
                plateAssignments: scannerPlateAssignments[scannerId] ||
                  createPlateAssignments(assignment.gridMode || '2grid'),
                testResult: result,
                plateImages: scanImageUris[scannerId] || {},
                scanningPlateIndex: scanningPlateIndex[scannerId],
                isScanning: scanningInProgress || isScanningProduction || isTestingThisScanner,
                scanProgress: isScanningProduction ? scannerState?.progress : undefined,
              };
            })}
          onImageClick={(imageUri, plateIndex) =>
            setLightboxImage({ src: imageUri, caption: `Plate ${formatPlateIndex(plateIndex)}` })
          }
        />
      </div>

      {/* Image Lightbox */}
      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage.src}
          caption={lightboxImage.caption}
          onClose={() => setLightboxImage(null)}
        />
      )}

      {/* Configure Scanners Section - Collapsible */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {/* Collapsible Header */}
        <div
          className={`px-6 py-4 flex items-center justify-between cursor-pointer transition-colors ${
            isConfigCollapsed ? 'hover:bg-gray-50' : 'bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100'
          }`}
          onClick={handleToggleConfigCollapse}
        >
          <div className="flex items-center">
            {/* Scanner Icon */}
            <div className={`p-2 rounded-lg mr-3 ${isConfigCollapsed ? 'bg-gray-100' : 'bg-blue-100'}`}>
              <svg className={`h-5 w-5 ${isConfigCollapsed ? 'text-gray-500' : 'text-blue-600'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Configure Scanners</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {isConfigCollapsed && configSaved
                  ? 'Click to modify scanner settings'
                  : 'Detect and assign scanners to slots'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {/* Configuration Summary Badge (shown when collapsed and configured) */}
            {isConfigCollapsed && configSaved && scannerAssignments.some((a) => a.scannerId !== null) && (
              <div className="flex items-center space-x-2">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 border border-green-200">
                  <svg className="h-3.5 w-3.5 mr-1.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  {scannerAssignments.filter((a) => a.scannerId !== null).length} scanner{scannerAssignments.filter((a) => a.scannerId !== null).length > 1 ? 's' : ''}
                </span>
                {/* Show grid modes for each scanner */}
                {scannerAssignments.filter((a) => a.scannerId !== null).map((a, idx) => (
                  <span key={idx} className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                    {a.slot.replace('Scanner ', 'S')}: {a.gridMode === '4grid' ? '4-grid' : '2-grid'}
                  </span>
                ))}
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                  {resolution} DPI
                </span>
              </div>
            )}

            {/* Reset Scanner Config Button */}
            <button
              onClick={(e) => { e.stopPropagation(); handleResetScannerConfig(e); }}
              disabled={isScanning}
              className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-red-600 hover:border-red-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Reset all scanner configuration"
            >
              <svg className="h-3.5 w-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Reset
            </button>

            {/* Chevron Icon */}
            <svg
              className={`h-5 w-5 text-gray-400 transition-transform duration-200 ${
                isConfigCollapsed ? '' : 'transform rotate-180'
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {/* Collapsible Content */}
        {!isConfigCollapsed && (
          <div className="p-6 space-y-6">
            {/* Validation Warning Banner */}
            {validationWarning && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <div className="flex items-start">
                  <div className="flex-shrink-0 p-1 bg-amber-100 rounded-lg">
                    <svg className="h-5 w-5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3 flex-1">
                    <p className="text-sm font-medium text-amber-800">{validationWarning}</p>
                  </div>
                  <button
                    onClick={() => setValidationWarning(null)}
                    className="ml-3 p-1 text-amber-400 hover:text-amber-600 hover:bg-amber-100 rounded-lg transition-colors"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            )}

            {/* Step 1: Detect Scanners */}
            <div className="space-y-3">
              <div className="flex items-center">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs font-bold mr-2">1</span>
                <h3 className="text-sm font-semibold text-gray-900">Detect USB Scanners</h3>
              </div>
              <div className="ml-8">
                <button
                  onClick={handleDetectScanners}
                  disabled={detectingScanner}
                  className="inline-flex items-center px-4 py-2.5 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {detectingScanner ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Scanning USB ports...
                    </>
                  ) : (
                    <>
                      <svg className="-ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      Detect Scanners
                    </>
                  )}
                </button>
                {detectingScanner && (
                  <span className="ml-3 text-sm text-gray-500 italic">Please wait, this might take a while.</span>
                )}
                {detectedScanners.length === 0 && !detectingScanner && !detectionError && (
                  <p className="mt-2 text-xs text-gray-500">Click to scan for connected USB flatbed scanners</p>
                )}
              </div>
            </div>

            {/* Detection Error */}
            {detectionError && (
              <div className="ml-8 p-4 bg-red-50 border border-red-200 rounded-xl">
                <div className="flex">
                  <div className="flex-shrink-0 p-1 bg-red-100 rounded-lg">
                    <svg className="h-5 w-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <p className="text-sm font-medium text-red-800">{detectionError}</p>
                    <p className="text-xs text-red-600 mt-1">
                      Check USB connections and ensure scanner drivers are installed.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Detected Scanners List */}
            {detectedScanners.length > 0 && (
              <div className="ml-8 bg-gray-50 rounded-xl p-4 border border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Found {detectedScanners.length} Scanner{detectedScanners.length > 1 ? 's' : ''}
                  </h4>
                  <button
                    onClick={handleDetectScanners}
                    disabled={detectingScanner}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Refresh
                  </button>
                </div>
                <div className="space-y-2">
                  {detectedScanners.map((scanner, index) => (
                    <div
                      key={scanner.scanner_id || index}
                      className="flex items-center justify-between bg-white px-4 py-3 rounded-lg border border-gray-200"
                    >
                      <div className="flex items-center">
                        <div className={`w-2.5 h-2.5 rounded-full mr-3 ${
                          scanner.is_available ? 'bg-green-500 shadow-sm shadow-green-200' : 'bg-red-500'
                        }`} />
                        <div>
                          <p className="text-sm font-medium text-gray-900">{scanner.name}</p>
                          <p className="text-xs text-gray-500">
                            Port: {scanner.usb_port || '?'} | Bus {scanner.usb_bus} Dev {scanner.usb_device}
                          </p>
                        </div>
                      </div>
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                        scanner.is_available
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        {scanner.is_available ? 'Ready' : 'Unavailable'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step 2: Assign Scanners + Grid Mode */}
            {detectedScanners.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs font-bold mr-2">2</span>
                  <h3 className="text-sm font-semibold text-gray-900">Assign Scanners & Grid Mode</h3>
                </div>
                <div className="ml-8 bg-gray-50 rounded-xl p-4 border border-gray-200">
                  <div className="space-y-3">
                    {scannerAssignments.map((assignment, index) => {
                      const assignedScannerIds = scannerAssignments
                        .filter((_, i) => i !== index)
                        .map((a) => a.scannerId)
                        .filter((id): id is string => id !== null);
                      const isAssigned = assignment.scannerId !== null;

                      return (
                        <div
                          key={assignment.slot}
                          className={`flex items-center space-x-3 p-3 rounded-lg border transition-colors ${
                            isAssigned
                              ? 'bg-blue-50 border-blue-200'
                              : 'bg-white border-gray-200'
                          }`}
                        >
                          <div className={`flex items-center justify-center w-8 h-8 rounded-lg text-sm font-bold ${
                            isAssigned
                              ? 'bg-blue-100 text-blue-600'
                              : 'bg-gray-100 text-gray-400'
                          }`}>
                            {index + 1}
                          </div>
                          <div className="flex-1">
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                              {assignment.slot}
                            </label>
                            <select
                              value={assignment.scannerId || ''}
                              onChange={(e) => handleScannerAssignment(index, e.target.value || null)}
                              className={`block w-full px-3 py-2 text-sm border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                                isAssigned
                                  ? 'border-blue-300 bg-white'
                                  : 'border-gray-300 bg-white'
                              }`}
                            >
                              <option value="">Select a scanner...</option>
                              {detectedScanners.map((scanner) => {
                                const isAssignedElsewhere = assignedScannerIds.includes(scanner.scanner_id);
                                return (
                                  <option
                                    key={scanner.scanner_id}
                                    value={scanner.scanner_id}
                                    disabled={isAssignedElsewhere || !scanner.is_available}
                                  >
                                    {scanner.name} (Port {scanner.usb_port || '?'}, Bus {scanner.usb_bus} Dev {scanner.usb_device})
                                    {!scanner.is_available && ' - Unavailable'}
                                    {isAssignedElsewhere && ' - Already assigned'}
                                  </option>
                                );
                              })}
                            </select>
                          </div>
                          {/* Grid Mode per scanner */}
                          <div className="w-28">
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                              Grid
                            </label>
                            <select
                              value={assignment.gridMode || '2grid'}
                              onChange={(e) => handleScannerGridMode(index, e.target.value as '2grid' | '4grid')}
                              disabled={!isAssigned}
                              className={`block w-full px-2 py-2 text-sm border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                                isAssigned
                                  ? 'border-blue-300 bg-white'
                                  : 'border-gray-200 bg-gray-100 text-gray-400'
                              }`}
                            >
                              <option value="2grid">2-grid</option>
                              <option value="4grid">4-grid</option>
                            </select>
                          </div>
                          {scannerAssignments.length > 1 && (
                            <button
                              onClick={() => handleRemoveScannerSlot(index)}
                              className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                              title="Remove slot"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {scannerAssignments.length < MAX_SCANNER_SLOTS && (
                    <button
                      onClick={handleAddScannerSlot}
                      className="mt-3 w-full flex items-center justify-center px-4 py-2.5 border-2 border-dashed border-gray-300 rounded-lg text-sm font-medium text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                    >
                      <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add Another Scanner Slot
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Step 3: Resolution (Global Setting) */}
            {detectedScanners.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs font-bold mr-2">3</span>
                  <h3 className="text-sm font-semibold text-gray-900">Scan Resolution</h3>
                </div>
                <div className="ml-8">
                  <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                    <select
                      id="resolution"
                      value={resolution}
                      onChange={(e) => setResolution(Number(e.target.value))}
                      className="block w-full px-4 py-3 text-sm border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                    >
                      {GRAVISCAN_RESOLUTIONS.map((res) => (
                        <option key={res} value={res}>
                          {res} DPI {res === 1200 && '(Recommended)'}
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-xs text-gray-500">Higher DPI = better quality, larger files. Applied to all scanners.</p>
                  </div>
                </div>
              </div>
            )}

            {/* Step 4: Test All Scanners - Auto-save is now handled by effect */}
            {scannerAssignments.some((a) => a.scannerId !== null) && (
              <div className="pt-4 border-t border-gray-200 space-y-4">
                <div className="flex items-center">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-100 text-purple-600 text-xs font-bold mr-2">4</span>
                  <h3 className="text-sm font-semibold text-gray-900">Test All Scanners</h3>
                </div>
                <div className="ml-8">
                  <p className="text-xs text-gray-500 mb-3">
                    This step might take 2-3 minutes, please wait.
                  </p>
                  <button
                    onClick={handleTestAllScanners}
                    disabled={isTesting || isScanning}
                    className="inline-flex items-center px-5 py-2.5 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {isTesting ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        {testPhase === 'connecting'
                          ? 'Connecting to Scanners...'
                          : testPhase === 'scanning'
                            ? 'Test Scanning...'
                            : 'Starting Scanner Threads...'}
                      </>
                    ) : (
                      <>
                        <svg className="-ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Test All Scanners
                      </>
                    )}
                  </button>

                  {/* Test Results - show during test and after completion */}
                  {(isTesting || testComplete) && Object.keys(testResults).length > 0 && (
                    <div className="mt-4 space-y-2">
                      {scannerAssignments
                        .filter((a) => a.scannerId !== null)
                        .map((assignment) => {
                          const result = testResults[assignment.scannerId!];
                          const scanner = detectedScanners.find((s) => s.scanner_id === assignment.scannerId);
                          if (!result) return null;

                          const isInProgress = result.error === 'Scanning...';

                          return (
                            <div
                              key={assignment.scannerId}
                              className={`flex items-center justify-between p-3 rounded-lg border ${
                                isInProgress
                                  ? 'bg-blue-50 border-blue-200'
                                  : result.success
                                    ? 'bg-green-50 border-green-200'
                                    : 'bg-red-50 border-red-200'
                              }`}
                            >
                              <div className="flex items-center">
                                {isInProgress ? (
                                  <svg className="animate-spin h-5 w-5 text-blue-500 mr-2" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                ) : result.success ? (
                                  <svg className="h-5 w-5 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                  </svg>
                                ) : (
                                  <svg className="h-5 w-5 text-red-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                  </svg>
                                )}
                                <div>
                                  <span className="text-sm font-medium text-gray-900">
                                    {assignment.slot}: {scanner?.name || assignment.scannerId}
                                  </span>
                                  {isInProgress && (
                                    <p className="text-xs text-blue-600 mt-0.5">Performing test scan...</p>
                                  )}
                                  {!isInProgress && result.success && result.scanTimeMs && (
                                    <p className="text-xs text-green-600 mt-0.5">Test scan completed in {(result.scanTimeMs / 1000).toFixed(1)}s</p>
                                  )}
                                  {!isInProgress && !result.success && result.error && (
                                    <p className="text-xs text-red-600 mt-0.5">{result.error}</p>
                                  )}
                                </div>
                              </div>
                              <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                                isInProgress
                                  ? 'bg-blue-100 text-blue-700'
                                  : result.success
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-red-100 text-red-700'
                              }`}>
                                {isInProgress ? 'Scanning...' : result.success ? 'Scanner Ready' : 'Failed'}
                              </span>
                            </div>
                          );
                        })}

                      {/* All Tests Passed Summary */}
                      {Object.values(testResults).every((r) => r.success) && (
                        <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                          <div className="flex items-center">
                            <svg className="h-5 w-5 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            <span className="text-sm font-medium text-green-700">
                              All scanners are ready for scanning!
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

              </div>
            )}
          </div>
        )}
      </div>

      {/* Scan Section */}
      <div className={`bg-white rounded-lg shadow-sm p-6 relative ${!canScan || isValidating ? 'opacity-50' : ''}`}>
        {(!canScan || isValidating) && (
          <div className="absolute inset-0 bg-gray-100 bg-opacity-75 rounded-lg flex items-center justify-center z-10">
            <div className="text-center">
              {isValidating ? (
                <>
                  {/* Spinner for validation in progress */}
                  <svg className="animate-spin mx-auto h-12 w-12 text-blue-500" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
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
                  <svg className="mx-auto h-12 w-12 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
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
                  <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
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
        <div className="grid grid-cols-1 md:grid-cols-1 gap-4 mb-6">
          {/* Experiment Selector */}
          <div>
            <label htmlFor="experiment" className="block text-sm font-medium text-gray-700 mb-1">
              Experiment
            </label>
            <select
              id="experiment"
              value={selectedExperiment}
              onChange={(e) => setSelectedExperiment(e.target.value)}
              disabled={isScanning}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:bg-gray-100"
            >
              <option value="">Select experiment...</option>
              {experiments.map((exp) => (
                <option key={exp.id} value={exp.id}>
                  {exp.name}
                </option>
              ))}
            </select>
          </div>

          {/* Phenotyper Selector */}
          <div>
            <label htmlFor="phenotyper" className="block text-sm font-medium text-gray-700 mb-1">
              Phenotyper
            </label>
            <select
              id="phenotyper"
              value={selectedPhenotyper}
              onChange={(e) => setSelectedPhenotyper(e.target.value)}
              disabled={isScanning}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:bg-gray-100"
            >
              <option value="">Select phenotyper...</option>
              {phenotypers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Wave Number Spinner */}
          <div>
            <label htmlFor="waveNumber" className="block text-sm font-medium text-gray-700 mb-1">
              Wave Number
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setWaveNumber((prev) => Math.max(0, prev - 1))}
                disabled={isScanning || waveNumber <= 0}
                className="px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400"
              >
                -
              </button>
              <input
                id="waveNumber"
                type="number"
                min={0}
                value={waveNumber}
                onChange={(e) => setWaveNumber(Math.max(0, parseInt(e.target.value) || 0))}
                disabled={isScanning}
                className="w-20 text-center px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:bg-gray-100"
              />
              <button
                type="button"
                onClick={() => setWaveNumber((prev) => prev + 1)}
                disabled={isScanning}
                className="px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400"
              >
                +
              </button>
              {suggestedWaveNumber !== null && waveNumber !== suggestedWaveNumber && (
                <button
                  type="button"
                  onClick={() => setWaveNumber(suggestedWaveNumber)}
                  className="text-xs text-blue-600 hover:text-blue-800 underline"
                >
                  Suggested: {suggestedWaveNumber}
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-gray-500">Experimental phase (0 = baseline)</p>
            {hasBarcodeConflicts && (
              <div className="mt-2 space-y-1">
                {Object.entries(barcodeWaveConflicts).map(([plateIndex, message]) => (
                  <p key={plateIndex} className="text-xs text-amber-600">
                    Plate {formatPlateIndex(plateIndex)}: {message}
                  </p>
                ))}
              </div>
            )}
          </div>

          {/* Plate Selection — Per Scanner */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Plates to Scan ({selectedPlates.length} selected)
              </label>
              {availableBarcodes.length === 0 && selectedExperiment && !loadingBarcodes && (
                <span className="text-xs text-amber-600">
                  {isGraviMetadata ? 'No plates found for this experiment' : 'No plant barcodes found for this experiment'}
                </span>
              )}
              {loadingBarcodes && (
                <span className="text-xs text-gray-500">
                  {isGraviMetadata ? 'Loading plates...' : 'Loading barcodes...'}
                </span>
              )}
            </div>

            {/* Show message if no scanners are assigned */}
            {assignedScannerIds.length === 0 && (
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg text-center">
                <p className="text-sm text-gray-500">
                  No scanners assigned. Configure scanners above to assign plates.
                </p>
              </div>
            )}

            {/* Plate assignments grouped by scanner */}
            <div className="space-y-4">
              {assignedScannerIds.map((scannerId) => {
                const scanner = detectedScanners.find((s) => s.scanner_id === scannerId);
                const scannerAssignment = scannerAssignments.find((a) => a.scannerId === scannerId);
                const plateAssignments = scannerPlateAssignments[scannerId] || [];

                return (
                  <div key={scannerId} className="border border-gray-200 rounded-lg overflow-hidden">
                    {/* Scanner Header */}
                    <div className="bg-gray-100 px-3 py-2 border-b border-gray-200 flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">
                        {scannerAssignment?.slot || 'Scanner'}: {scanner?.name || scannerId}
                      </span>
                      <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded">
                        {scannerAssignment?.gridMode === '4grid' ? '4-grid' : '2-grid'}
                      </span>
                    </div>

                    {/* Plate Assignments for this Scanner */}
                    <div className="p-2 space-y-2">
                      {plateAssignments.map((assignment) => (
                        <div
                          key={`${scannerId}-${assignment.plateIndex}`}
                          className={`p-2 rounded-lg border transition-colors space-y-1 ${
                            assignment.selected
                              ? 'bg-blue-50 border-blue-200'
                              : 'bg-gray-50 border-gray-200'
                          } ${isScanning ? 'opacity-50' : ''}`}
                        >
                        <div className="flex items-center gap-2">
                          {/* Checkbox */}
                          <input
                            type="checkbox"
                            id={`plate-${scannerId}-${assignment.plateIndex}`}
                            checked={assignment.selected}
                            onChange={() => handleTogglePlate(scannerId, assignment.plateIndex)}
                            disabled={isScanning}
                            className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                          />

                          {/* Plate Label */}
                          <label
                            htmlFor={`plate-${scannerId}-${assignment.plateIndex}`}
                            className="text-sm font-medium text-gray-700 w-12 cursor-pointer"
                          >
                            {getPlateLabel(assignment.plateIndex, scannerAssignment?.gridMode || '2grid')}
                          </label>

                          {isGraviMetadata ? (
                            /* Plate ID Dropdown for GraviScan metadata */
                            <select
                              value={assignment.plantBarcode || ''}
                              onChange={(e) => handlePlateBarcode(scannerId, assignment.plateIndex, e.target.value || null)}
                              disabled={isScanning || !assignment.selected}
                              className={`flex-1 px-3 py-1.5 text-sm border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                                !assignment.selected
                                  ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                                  : 'bg-white border-gray-300'
                              }`}
                            >
                              <option value="">Select plate...</option>
                              {availablePlates.map((plate) => (
                                <option key={plate.plate_id} value={plate.plate_id}>
                                  {plate.plate_id} — {plate.accession}{plate.custom_note ? ` — ${plate.custom_note}` : ''}
                                </option>
                              ))}
                            </select>
                          ) : (
                            /* Plant Barcode Dropdown for CylScan metadata */
                            <select
                              value={assignment.plantBarcode || ''}
                              onChange={(e) => handlePlateBarcode(scannerId, assignment.plateIndex, e.target.value || null)}
                              disabled={isScanning || !assignment.selected}
                              className={`flex-1 px-3 py-1.5 text-sm border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                                !assignment.selected
                                  ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                                  : 'bg-white border-gray-300'
                              }`}
                            >
                              <option value="">Select plant barcode...</option>
                              {availableBarcodes.map((barcode) => (
                                <option key={barcode} value={barcode}>
                                  {barcode}
                                </option>
                              ))}
                            </select>
                          )}

                          {/* Plate summary for GraviScan */}
                          {assignment.selected && assignment.plantBarcode && isGraviMetadata && (() => {
                            const plateInfo = availablePlates.find((p) => p.plate_id === assignment.plantBarcode);
                            return plateInfo ? (
                              <div className="flex items-center gap-3 text-xs min-w-[200px]">
                                <span className="text-gray-500">Sections: <span className="font-medium text-gray-700">{plateInfo.sectionCount}</span></span>
                                <span className="text-gray-500">Plants: <span className="font-medium text-gray-700">{plateInfo.plantQrCodes.length}</span></span>
                                <span className="text-gray-500">Accession: <span className="font-medium text-gray-700">{plateInfo.accession}</span></span>
                              </div>
                            ) : null;
                          })()}

                          {/* Genotype display for CylScan */}
                          {assignment.selected && assignment.plantBarcode && !isGraviMetadata && (
                            <span className="text-xs text-gray-600 min-w-[80px]">
                              {barcodeGenotypes[assignment.plantBarcode] || '-'}
                            </span>
                          )}

                          {/* Status indicator */}
                          {assignment.selected && assignment.plantBarcode && (
                            <svg className="h-5 w-5 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>

                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Summary */}
            {selectedPlates.length > 0 && (
              <p className="mt-2 text-xs text-gray-500">
                {selectedPlatesWithBarcodes.length} of {selectedPlates.length} selected plate(s) have {isGraviMetadata ? 'plates' : 'barcodes'} assigned
              </p>
            )}
          </div>
        </div>

        {/* Error/Success Messages */}
        {scanError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">{scanError}</p>
          </div>
        )}
        {scanSuccess && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-700">{scanSuccess}</p>
          </div>
        )}
        {autoUploadStatus !== 'idle' && (
          <div className={`mb-4 p-3 rounded-lg border ${
            autoUploadStatus === 'waiting' ? 'bg-amber-50 border-amber-200' :
            autoUploadStatus === 'uploading' ? 'bg-blue-50 border-blue-200' :
            autoUploadStatus === 'error' ? 'bg-red-50 border-red-200' :
            'bg-green-50 border-green-200'
          }`}>
            <p className={`text-sm ${
              autoUploadStatus === 'waiting' ? 'text-amber-700' :
              autoUploadStatus === 'uploading' ? 'text-blue-700' :
              autoUploadStatus === 'error' ? 'text-red-700' :
              'text-green-700'
            }`}>
              {autoUploadStatus === 'waiting' ? 'Saving scan records...' :
               autoUploadStatus === 'uploading' ? 'Backing up to Box...' : autoUploadMessage}
            </p>
          </div>
        )}

        {/* Scanner Connection Status - shown after validation succeeds */}
        {sessionValidated && scannerStates.length > 0 && !isScanning && scannerStates.every((s) => s.state === 'idle') && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center">
              <svg className="h-5 w-5 text-green-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span className="text-sm text-green-700">
                {scannerStates.length} scanner{scannerStates.length > 1 ? 's' : ''} connected and ready
              </span>
            </div>
          </div>
        )}

        {/* Scanner Panels */}
        {scannerStates.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Scanners</h3>
            <div className="space-y-3">
              {scannerStates.map((scanner) => (
                <ScannerPanel
                  key={scanner.scannerId}
                  scanner={scanner}
                  onToggleEnabled={handleToggleScannerEnabled}
                  disabled={isScanning}
                />
              ))}
            </div>
          </div>
        )}

        {/* Form Validation Warning */}
        {canScan && !isFormValid && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-center">
              <svg className="h-5 w-5 text-yellow-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span className="text-sm text-yellow-700">
                Please fill in required fields: {validationMessages.join(', ')}
              </span>
            </div>
          </div>
        )}

        {/* Scan Mode Selector */}
        <div className="mb-4">
          <div className="flex items-center space-x-4 mb-3">
            <label className="text-sm font-medium text-gray-700">Scan Mode:</label>
            <div className="flex items-center space-x-3">
              <label className="inline-flex items-center cursor-pointer">
                <input
                  type="radio"
                  name="scanMode"
                  value="single"
                  checked={scanMode === 'single'}
                  onChange={() => setScanMode('single')}
                  disabled={isScanning}
                  className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                />
                <span className="ml-1.5 text-sm text-gray-700">Single Scan</span>
              </label>
              <label className="inline-flex items-center cursor-pointer">
                <input
                  type="radio"
                  name="scanMode"
                  value="continuous"
                  checked={scanMode === 'continuous'}
                  onChange={() => setScanMode('continuous')}
                  disabled={isScanning}
                  className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                />
                <span className="ml-1.5 text-sm text-gray-700">Continuous Scan</span>
              </label>
            </div>
          </div>

          {/* Continuous Scan Settings */}
          {scanMode === 'continuous' && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
              <div className="flex items-center space-x-6">
                <div className="flex items-center space-x-2">
                  <label className="text-sm text-gray-700 whitespace-nowrap">Interval:</label>
                  <input
                    type="number"
                    min={MIN_SCAN_INTERVAL_MINUTES}
                    max={120}
                    value={scanIntervalMinutes}
                    onChange={(e) => setScanIntervalMinutes(Math.max(MIN_SCAN_INTERVAL_MINUTES, parseInt(e.target.value) || MIN_SCAN_INTERVAL_MINUTES))}
                    disabled={isScanning}
                    className="w-20 px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                  />
                  <span className="text-sm text-gray-500">min</span>
                </div>
                <div className="flex items-center space-x-2">
                  <label className="text-sm text-gray-700 whitespace-nowrap">Duration:</label>
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={scanDurationMinutes}
                    onChange={(e) => setScanDurationMinutes(Math.max(1, parseInt(e.target.value) || 1))}
                    disabled={isScanning}
                    className="w-20 px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                  />
                  <span className="text-sm text-gray-500">min</span>
                </div>
              </div>
              <div className="text-xs text-blue-700">
                {scanDurationMinutes >= scanIntervalMinutes
                  ? `~${Math.floor(scanDurationMinutes / scanIntervalMinutes)} cycles over ${scanDurationMinutes >= 60 ? `${Math.floor(scanDurationMinutes / 60)}h ${scanDurationMinutes % 60}m` : `${scanDurationMinutes}m`}`
                  : 'Duration must be greater than or equal to interval'}
              </div>
            </div>
          )}

          {/* Cycle Progress (shown during continuous scanning) */}
          {isScanning && scanMode === 'continuous' && (
            <div className="mt-3 p-3 bg-indigo-50 border border-indigo-200 rounded-lg space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-indigo-700 font-medium">
                  Cycle {currentCycle}/{totalCycles}
                </span>
                <span className="text-indigo-600">
                  {intervalCountdown !== null && intervalCountdown > 0
                    ? `Next scan in ${String(Math.floor(intervalCountdown / 3600)).padStart(2, '0')}:${String(Math.floor((intervalCountdown % 3600) / 60)).padStart(2, '0')}:${String(intervalCountdown % 60).padStart(2, '0')}`
                    : 'Scanning plates...'}
                </span>
              </div>
              {/* Elapsed time and estimated remaining — only shown between scans */}
              {intervalCountdown !== null && intervalCountdown > 0 && (
                <div className="flex items-center justify-between text-xs text-indigo-500">
                  <span>
                    Elapsed: {String(Math.floor(elapsedSeconds / 3600)).padStart(2, '0')}:{String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, '0')}:{String(elapsedSeconds % 60).padStart(2, '0')}
                  </span>
                  {currentCycle > 0 && totalCycles > currentCycle && (
                    <span>
                      {(() => {
                        const avgCycleSeconds = elapsedSeconds / currentCycle;
                        const remainingSeconds = Math.round((totalCycles - currentCycle) * avgCycleSeconds);
                        return `~${String(Math.floor(remainingSeconds / 3600)).padStart(2, '0')}:${String(Math.floor((remainingSeconds % 3600) / 60)).padStart(2, '0')}:${String(remainingSeconds % 60).padStart(2, '0')} remaining`;
                      })()}
                    </span>
                  )}
                </div>
              )}
              {/* Overtime banner */}
              {overtimeMs !== null && (
                <div className="mt-2 p-2 bg-amber-50 border border-amber-300 rounded text-sm text-amber-800">
                  Scans need additional time beyond the set duration (+{Math.floor(overtimeMs / 60000)}m {Math.floor((overtimeMs % 60000) / 1000)}s)
                </div>
              )}
            </div>
          )}

          {/* Elapsed time for single mode */}
          {isScanning && scanMode === 'single' && (
            <div className="mt-3 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
              <div className="text-sm text-indigo-600">
                Elapsed: {String(Math.floor(elapsedSeconds / 3600)).padStart(2, '0')}:{String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, '0')}:{String(elapsedSeconds % 60).padStart(2, '0')}
              </div>
            </div>
          )}
        </div>

        {/* Scan Controls */}
        <div className="flex items-center space-x-4">
          <button
            onClick={handleStartScan}
            disabled={isScanning || !canStartScan}
            className="inline-flex items-center px-6 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isScanning ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Scanning...
              </>
            ) : (
              <>
                <svg className="-ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Start Scan
              </>
            )}
          </button>

          {isScanning && (
            <button
              onClick={handleCancelScan}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
              <svg className="-ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Cancel Scan
            </button>
          )}

          {(scanSuccess || scannerStates.some((s) => s.state !== 'idle')) && (
            <button
              onClick={handleResetScanners}
              disabled={isScanning}
              className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              Reset
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
