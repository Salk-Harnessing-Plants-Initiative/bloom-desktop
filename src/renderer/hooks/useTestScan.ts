import { useState, useCallback } from 'react';
import type { DetectedScanner, ScannerAssignment } from '../../types/graviscan';
import { PLATE_INDICES } from '../../types/graviscan';

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
      console.warn('[GraviScan] No scanners assigned to test');
      return;
    }

    setIsTesting(true);
    setTestResults({});
    setTestComplete(false);

    const results: Record<string, TestResult> = {};

    try {
      // Get output directory for test scans
      const outputDirResult = await window.electron.gravi.getOutputDir();
      const outputDir =
        outputDirResult.success && outputDirResult.data
          ? outputDirResult.data
          : '/tmp';

      // Test via subprocess: scan all plates per scanner at low resolution
      setTestPhase('scanning');

      // Track pending plate count per scanner
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
          const allDone = Array.from(pendingPlatesPerScanner.values()).every(
            (count) => count <= 0
          );
          if (allDone) {
            cleanupGridComplete();
            cleanupScanError();
            cleanupScanEvent();
            resolve();
          }
        };

        const cleanupScanEvent = window.electron.gravi.onScanEvent(
          (data: { scannerId: string; plateIndex: string }) => {
            setScanningPlateIndex((prev) => ({
              ...prev,
              [data.scannerId]: data.plateIndex,
            }));
            results[data.scannerId] = { success: false, error: 'Scanning...' };
            setTestResults({ ...results });
          }
        );

        const cleanupGridComplete = window.electron.gravi.onGridComplete(
          async (data: {
            scannerId: string;
            plateIndex: string;
            imagePath?: string;
          }) => {
            setScanningPlateIndex((prev) => {
              const next = { ...prev };
              delete next[data.scannerId];
              return next;
            });

            // Load preview image into the correct plate slot
            if (data.imagePath) {
              try {
                const imgResult = await window.electron.gravi.readScanImage(
                  data.imagePath
                );
                if (imgResult.success && imgResult.data) {
                  setScanImageUris((prev) => ({
                    ...prev,
                    [data.scannerId]: {
                      ...prev[data.scannerId],
                      [data.plateIndex]: imgResult.data,
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

        const cleanupScanError = window.electron.gravi.onScanError(
          (data: { scannerId: string; error?: string }) => {
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
      });

      // Build test scan configs
      const testStartTime = Date.now();
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
            resolution: 200, // Low resolution for test scans
            output_path: `${outputDir}/test-scan-${scanner.scanner_id.slice(0, 8)}-${plateIndex}.tif`,
          })),
        };
      });

      // Start the test scan
      const startResult = await window.electron.gravi.startScan({
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

      setTestResults({ ...results });
      setTestComplete(true);
    } catch (error) {
      console.error('[GraviScan] Test all scanners failed:', error);
    } finally {
      setIsTesting(false);
      setTestPhase('idle');
    }
  }, [
    scannerAssignments,
    detectedScanners,
    setScanningPlateIndex,
    setScanImageUris,
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
