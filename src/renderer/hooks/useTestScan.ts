/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useRef, useState } from 'react';
import { createPlateAssignments, type GridMode } from '../../types/graviscan';
import { unwrapGraviResult } from '../utils/graviIpc';

export interface UseTestScanParams {
  scannerIds: string[];
  gridModes: Record<string, GridMode>;
  saneNames: Record<string, string>;
}

export interface TestScanResult {
  success: boolean;
  error?: string;
  imagePath?: string;
}

export interface UseTestScanResult {
  isTesting: boolean;
  testResults: Record<string, TestScanResult>;
  error: string | null;
  testAllScanners: () => Promise<void>;
}

/** Low resolution deliberately used for one-shot connectivity tests — not
 * a real capture, just proof the scanner responds (matches the reference
 * implementation's own choice of the epkowa driver's minimum accepted
 * value). */
const TEST_SCAN_RESOLUTION = 200;

function resolveScannerId(event: Record<string, unknown>): string {
  return (event.scanner_id as string) ?? (event.scannerId as string) ?? '';
}

/**
 * One-shot per-scanner test capture (tasks.md Section 13), independent of
 * `useScanSession`'s own reducer state — a different hook instance, no
 * shared state, so testing scanners never perturbs an in-progress
 * capture session's own `pendingJobs`/`currentCycle`/etc.
 */
export function useTestScan(params: UseTestScanParams): UseTestScanResult {
  const { scannerIds, gridModes, saneNames } = params;

  const [isTesting, setIsTesting] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, TestScanResult>>({});
  const [error, setError] = useState<string | null>(null);

  const pendingRef = useRef<Map<string, number>>(new Map());
  const resultsRef = useRef<Record<string, TestScanResult>>({});
  const resolveRef = useRef<(() => void) | null>(null);

  const checkDone = useCallback(() => {
    const allDone = Array.from(pendingRef.current.values()).every((n) => n <= 0);
    if (allDone) {
      resolveRef.current?.();
      resolveRef.current = null;
    }
  }, []);

  const testAllScanners = useCallback(async () => {
    if (scannerIds.length === 0) {
      setError('No scanners assigned to test.');
      return;
    }

    setError(null);
    setIsTesting(true);
    resultsRef.current = {};
    setTestResults({});

    const outputDirResult = unwrapGraviResult<{
      success: boolean;
      path?: string;
      error?: string;
    }>(await (window as any).electron.gravi.getOutputDir());
    if (!outputDirResult?.success || !outputDirResult.path) {
      setError(outputDirResult?.error ?? 'Could not determine the scan output directory.');
      setIsTesting(false);
      return;
    }
    const outputDir = outputDirResult.path;
    const timestamp = Date.now();

    pendingRef.current = new Map(
      scannerIds.map((id) => [id, createPlateAssignments(gridModes[id]).length])
    );

    const scanners = scannerIds.map((scannerId) => {
      const plateIndices = createPlateAssignments(gridModes[scannerId]);
      return {
        scannerId,
        saneName: saneNames[scannerId] ?? '',
        plates: plateIndices.map((p) => ({
          plate_index: p.plateIndex,
          grid_mode: gridModes[scannerId],
          resolution: TEST_SCAN_RESOLUTION,
          output_path: `${outputDir}/test/${scannerId}/${p.plateIndex}_${timestamp}.tiff`,
        })),
      };
    });

    const gravi = (window as any).electron.gravi;
    const donePromise = new Promise<void>((resolve) => {
      resolveRef.current = resolve;
    });

    const cleanupComplete = gravi.onScanComplete((data: Record<string, unknown>) => {
      const scannerId = resolveScannerId(data);
      if (!pendingRef.current.has(scannerId)) return;
      const remaining = (pendingRef.current.get(scannerId) ?? 1) - 1;
      pendingRef.current.set(scannerId, remaining);
      if (remaining <= 0) {
        resultsRef.current = {
          ...resultsRef.current,
          [scannerId]: { success: true, imagePath: data.imagePath as string },
        };
        setTestResults({ ...resultsRef.current });
      }
      checkDone();
    });

    const cleanupError = gravi.onScanError((data: Record<string, unknown>) => {
      const scannerId = resolveScannerId(data);
      if (!pendingRef.current.has(scannerId)) return;
      const remaining = (pendingRef.current.get(scannerId) ?? 1) - 1;
      pendingRef.current.set(scannerId, remaining);
      resultsRef.current = {
        ...resultsRef.current,
        [scannerId]: { success: false, error: (data.error as string) ?? 'Test scan failed' },
      };
      setTestResults({ ...resultsRef.current });
      checkDone();
    });

    try {
      const startResult = unwrapGraviResult<{ success: boolean; error?: string }>(
        await gravi.startScan({ scanners })
      );
      if (!startResult?.success) {
        resolveRef.current = null;
        resultsRef.current = Object.fromEntries(
          scannerIds.map((id) => [
            id,
            { success: false, error: startResult?.error ?? 'Failed to start test scan.' },
          ])
        );
        setTestResults({ ...resultsRef.current });
        return;
      }
      await donePromise;
    } finally {
      cleanupComplete();
      cleanupError();
      setIsTesting(false);
    }
  }, [scannerIds, gridModes, saneNames, checkDone]);

  return { isTesting, testResults, error, testAllScanners };
}
