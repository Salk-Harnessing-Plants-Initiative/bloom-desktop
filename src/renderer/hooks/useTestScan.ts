import { useState, useCallback } from 'react';
import type { DetectedScanner, ScannerAssignment } from '../../types/graviscan';
import { PLATE_INDICES } from '../../types/graviscan';
import { useToast } from '../contexts/ToastContext';

export type TestResult = {
  success: boolean;
  error?: string;
  scanPath?: string;
  scanTimeMs?: number;
  imageDataUri?: string;
};

interface UseTestScanParams {
  scannerAssignments: ScannerAssignment[];
  detectedScanners: DetectedScanner[];
  setScanningPlateIndex: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  setScanImageUris: React.Dispatch<
    React.SetStateAction<Record<string, Record<string, string>>>
  >;
}

interface UseTestScanReturn {
  isTesting: boolean;
  testPhase: 'idle' | 'connecting' | 'scanning' | 'starting-threads';
  testResults: Record<string, TestResult>;
  testComplete: boolean;
  handleTestAllScanners: () => Promise<void>;
  resetTestResults: () => void;
}

export function useTestScan({
  scannerAssignments,
  detectedScanners,
  setScanningPlateIndex,
  setScanImageUris,
}: UseTestScanParams): UseTestScanReturn {
  const { showToast } = useToast();
  const [isTesting, setIsTesting] = useState(false);
  const [testPhase, setTestPhase] = useState<
    'idle' | 'connecting' | 'scanning' | 'starting-threads'
  >('idle');
  const [testResults, setTestResults] = useState<Record<string, TestResult>>(
    {}
  );
  const [testComplete, setTestComplete] = useState(false);

  const resetTestResults = useCallback(() => {
    setTestResults({});
    setTestComplete(false);
  }, []);

  const handleTestAllScanners = useCallback(async () => {
    const assignedScanners = scannerAssignments
      .filter((a) => a.scannerId !== null)
      .map((a) => detectedScanners.find((s) => s.scanner_id === a.scannerId))
      .filter((s): s is DetectedScanner => s !== undefined);

    if (assignedScanners.length === 0) {
      showToast({
        type: 'error',
        message: 'No scanners assigned to test. Configure scanners first.',
      });
      return;
    }

    setIsTesting(true);
    setTestResults({});
    setTestComplete(false);

    const results: Record<string, TestResult> = {};

    try {
      // Get output directory for test scans
      const outputDirResult = await window.electron.graviscan.getOutputDir();
      const outputDir = outputDirResult.success ? outputDirResult.path : '/tmp';

      // Test via subprocess: scan all plates per scanner at low resolution
      setTestPhase('scanning');
      console.log(
        '[GraviScan] Testing scanners via subprocess with low-res test scan (all grids)'
      );

      // Set up test scan event listeners
      const testStartTime = Date.now();

      // Track pending plate count per scanner — each scanner needs N scan-complete events
      const pendingPlatesPerScanner = new Map<string, number>();
      for (const scanner of assignedScanners) {
        const assignment = scannerAssignments.find(
          (a) => a.scannerId === scanner.scanner_id
        );
        const gridMode = assignment?.gridMode || '2grid';
        const plateCount = PLATE_INDICES[gridMode].length;
        pendingPlatesPerScanner.set(scanner.scanner_id, plateCount);
      }

      // Listen for scan events during the test
      const testPromise = new Promise<void>((resolve) => {
        const checkDone = () => {
          // All scanners done when every scanner has 0 pending plates
          const allDone = Array.from(pendingPlatesPerScanner.values()).every(
            (count) => count <= 0
          );
          if (allDone) {
            cleanupTestComplete();
            cleanupTestError();
            cleanupTestStarted();
            resolve();
          }
        };

        const cleanupTestStarted = window.electron.graviscan.onScanStarted(
          (data) => {
            setScanningPlateIndex((prev) => ({
              ...prev,
              [data.scannerId]: data.plateIndex,
            }));
            results[data.scannerId] = { success: false, error: 'Scanning...' };
            setTestResults({ ...results });
          }
        );

        const cleanupTestComplete = window.electron.graviscan.onScanComplete(
          async (data) => {
            setScanningPlateIndex((prev) => {
              const next = { ...prev };
              delete next[data.scannerId];
              return next;
            });

            // Load preview image into the correct plate slot
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
              } catch {
                /* ignore preview failure */
              }
            }

            // Decrement pending count for this scanner
            const remaining =
              (pendingPlatesPerScanner.get(data.scannerId) || 1) - 1;
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
          }
        );

        const cleanupTestError = window.electron.graviscan.onScanError(
          (data) => {
            setScanningPlateIndex((prev) => {
              const next = { ...prev };
              delete next[data.scannerId];
              return next;
            });

            // Decrement pending count even on error so we don't block completion
            const remaining =
              (pendingPlatesPerScanner.get(data.scannerId) || 1) - 1;
            pendingPlatesPerScanner.set(data.scannerId, remaining);

            results[data.scannerId] = {
              success: false,
              error: data.error || 'Test scan failed',
            };
            setTestResults({ ...results });
            checkDone();
          }
        );

        // No safety timeout — SANE open can take 60s+ per scanner.
        // The test waits for actual scan-complete/scan-error events.
        // User can cancel via the UI if needed.
      });

      // Build test scan configs — all plates per scanner using its configured grid mode
      const scannerConfigs = assignedScanners.map((scanner) => {
        const assignment = scannerAssignments.find(
          (a) => a.scannerId === scanner.scanner_id
        );
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
        showToast({
          type: 'success',
          message: `All scanner tests passed (${((Date.now() - testStartTime) / 1000).toFixed(1)}s)`,
        });

        // Run post-scan QR verification on test scan images
        try {
          const status = await window.electron.graviscan.getScanStatus();
          if (status?.jobs) {
            const plates: Array<{
              scannerId: string;
              plateIndex: string;
              imagePath: string;
              assignedPlateId: string;
            }> = [];

            for (const [, job] of Object.entries(status.jobs)) {
              if (job.status !== 'complete' || !job.imagePath) continue;
              const assignment = scannerAssignments.find(
                (a) => a.scannerId === job.scannerId
              );
              if (!assignment) continue;

              // Use the scanner assignment's slot as a simple plate identifier
              const plateId = job.plantBarcode || assignment.slot || '';
              if (!plateId) continue;

              plates.push({
                scannerId: job.scannerId,
                plateIndex: job.plateIndex,
                imagePath: job.imagePath,
                assignedPlateId: plateId,
              });
            }

            if (plates.length > 0) {
              console.log(
                `[GraviScan] Running QR verification on ${plates.length} test scan plate(s)...`
              );
              await window.electron.graviscan.verifyPlates(plates);
            }
          }
        } catch (verifyErr) {
          console.warn(
            '[GraviScan] QR verification after test scan failed:',
            verifyErr
          );
        }
      } else {
        const failedNames = Object.entries(results)
          .filter(([, r]) => !r.success)
          .map(([id]) => id.slice(0, 8))
          .join(', ');
        showToast({
          type: 'error',
          message: `Some scanner tests failed: ${failedNames}`,
        });
      }
    } catch (error) {
      showToast({
        type: 'error',
        message: `Test scan failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setIsTesting(false);
      setTestPhase('idle');
    }
  }, [
    scannerAssignments,
    detectedScanners,
    setScanningPlateIndex,
    setScanImageUris,
    showToast,
  ]);

  return {
    isTesting,
    testPhase,
    testResults,
    testComplete,
    handleTestAllScanners,
    resetTestResults,
  };
}
