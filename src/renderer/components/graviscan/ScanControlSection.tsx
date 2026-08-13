/**
 * Start/Cancel/continuous-mode controls, plus the small set of banners
 * that belong next to those controls: the unified session error (covers
 * the Cancel-rejection case, design.md Decision 1), the zero-interval
 * validation error (useContinuousMode.validate()), the predictive cadence
 * warning (design.md Decision 7), the already-accepted reactive
 * `overtime` banner, the abnormal-termination informational banner
 * (design.md Decision 5), and a non-blocking pre-start warning for an
 * unlinked, unfilled wave.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import type { UseScanSessionResult } from '../../hooks/useScanSession';
import type { UseContinuousModeResult } from '../../hooks/useContinuousMode';
import type { UseTestScanResult } from '../../hooks/useTestScan';
import { CadenceWarningBanner } from './CadenceWarningBanner';

export interface ScanControlSectionProps {
  scanSession: UseScanSessionResult;
  continuousMode: UseContinuousModeResult;
  testScan: UseTestScanResult;
  waveMissingMetadata: boolean;
  anyPlateFilled: boolean;
}

function formatOvertime(overtimeMs: number): string {
  const minutes = Math.floor(overtimeMs / 60000);
  const seconds = Math.floor((overtimeMs % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function ScanControlSection({
  scanSession,
  continuousMode,
  testScan,
  waveMissingMetadata,
  anyPlateFilled,
}: ScanControlSectionProps) {
  const [isCancelling, setIsCancelling] = useState(false);
  const [overtimeMs, setOvertimeMs] = useState<number | null>(null);

  useEffect(() => {
    const gravi = (window as any).electron.gravi;
    const cleanupOvertime = gravi.onOvertime?.(
      (data: { overtimeMs: number }) => {
        setOvertimeMs(data.overtimeMs);
      }
    );
    return () => cleanupOvertime?.();
  }, []);

  useEffect(() => {
    if (!scanSession.isScanning) setOvertimeMs(null);
  }, [scanSession.isScanning]);

  const intervalError = continuousMode.isContinuous
    ? continuousMode.validate()
    : null;

  async function handleCancel() {
    setIsCancelling(true);
    try {
      await scanSession.cancelScan();
    } finally {
      setIsCancelling(false);
    }
  }

  return (
    <div className="space-y-3">
      {scanSession.error && (
        <div
          data-testid="scan-session-error"
          className="bg-red-50 border border-red-500 text-red-800 rounded p-2 text-sm"
        >
          {scanSession.error}
        </div>
      )}

      {testScan.error && (
        <div
          data-testid="test-scan-error"
          className="bg-red-50 border border-red-500 text-red-800 rounded p-2 text-sm"
        >
          {testScan.error}
        </div>
      )}

      {intervalError && (
        <div className="bg-red-50 border border-red-500 text-red-800 rounded p-2 text-sm">
          {intervalError}
        </div>
      )}

      {waveMissingMetadata && !anyPlateFilled && (
        <div className="bg-amber-50 border border-amber-300 text-amber-800 rounded p-2 text-sm">
          No plates have been filled in for this wave yet — fill in plate info
          before starting, or proceed if this is intentional.
        </div>
      )}

      {scanSession.abnormalTermination && (
        <div
          data-testid="abnormal-termination-banner"
          className="bg-amber-50 border border-amber-300 text-amber-800 rounded p-2 text-sm"
        >
          A previous scan session for this wave did not finish cleanly — it
          expected {scanSession.abnormalTermination.expectedCycles} cycle
          {scanSession.abnormalTermination.expectedCycles === 1 ? '' : 's'}.
          Check completeness before trusting this wave&apos;s data.
        </div>
      )}

      {continuousMode.isContinuous && (
        <CadenceWarningBanner
          cadenceContext={continuousMode.cadenceContext}
          intervalMinutes={continuousMode.intervalMinutes}
        />
      )}

      {scanSession.isScanning && scanSession.totalCycles > 1 && (
        <div
          data-testid="cycle-progress"
          className="bg-blue-50 border border-blue-300 text-blue-900 rounded p-2 text-sm font-semibold"
        >
          Cycle {scanSession.currentCycle} of {scanSession.totalCycles}
        </div>
      )}

      {scanSession.isScanning && scanSession.coordinatorState === 'waiting' && (
        <div
          data-testid="waiting-next-cycle"
          className="bg-blue-50 border border-blue-300 text-blue-900 rounded p-2 text-sm font-semibold"
        >
          Waiting for next cycle...
        </div>
      )}

      {overtimeMs !== null && (
        <div
          data-testid="overtime-banner"
          className="bg-amber-50 border border-amber-300 text-amber-800 rounded p-2 text-sm"
        >
          This cycle is running over — {formatOvertime(overtimeMs)} past the
          configured duration.
        </div>
      )}

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={continuousMode.isContinuous}
            onChange={(e) => continuousMode.setIsContinuous(e.target.checked)}
          />
          Continuous scan
        </label>
        {continuousMode.isContinuous && (
          <>
            <label className="flex items-center gap-1">
              Interval (minutes)
              <input
                type="number"
                value={continuousMode.intervalMinutes}
                onChange={(e) =>
                  continuousMode.setIntervalMinutes(Number(e.target.value))
                }
              />
            </label>
            <label className="flex items-center gap-1">
              Duration (minutes)
              <input
                type="number"
                value={continuousMode.durationMinutes}
                onChange={(e) =>
                  continuousMode.setDurationMinutes(Number(e.target.value))
                }
              />
            </label>
          </>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void scanSession.startScan()}
          disabled={!scanSession.canStartScan || scanSession.isScanning}
          className={`px-6 py-2 rounded-lg font-semibold shadow-sm transition-all ${
            !scanSession.canStartScan || scanSession.isScanning
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-green-600 text-white hover:bg-green-700 hover:shadow-md'
          }`}
        >
          Start Scan
        </button>
        <button
          type="button"
          onClick={() => void handleCancel()}
          disabled={!scanSession.isScanning || isCancelling}
          className={`px-6 py-2 rounded-lg font-semibold shadow-sm transition-all ${
            !scanSession.isScanning || isCancelling
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-red-600 text-white hover:bg-red-700 hover:shadow-md'
          }`}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void testScan.testAllScanners()}
          disabled={testScan.isTesting}
          className={`px-6 py-2 rounded-lg font-semibold border transition-all ${
            testScan.isTesting
              ? 'border-gray-300 text-gray-400 cursor-not-allowed'
              : 'border-gray-400 text-gray-700 hover:bg-gray-50'
          }`}
        >
          Test Scan
        </button>
      </div>
    </div>
  );
}
