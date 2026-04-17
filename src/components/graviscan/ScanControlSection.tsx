/**
 * ScanControlSection — Start/Cancel buttons, progress, event log, interval controls
 *
 * Keeps scan control UI under 150 lines, delegating state to parent hooks.
 */

import type { ScanJobInfo } from '../../renderer/hooks/useScanSession';

interface ScanControlSectionProps {
  // Scan state
  canStartScan: boolean;
  isScanning: boolean;
  pendingJobs: Map<string, ScanJobInfo>;

  // Continuous mode
  scanMode: 'single' | 'continuous';
  scanIntervalMinutes: number;
  scanDurationMinutes: number;
  currentCycle: number;
  totalCycles: number;
  intervalCountdown: number | null;
  elapsedSeconds: number;
  setScanMode: (mode: 'single' | 'continuous') => void;
  setScanIntervalMinutes: (val: number) => void;
  setScanDurationMinutes: (val: number) => void;

  // Scanner progress
  scannerStates: Array<{
    scannerId: string;
    name: string;
    enabled: boolean;
    state: string;
    progress: number;
    lastError?: string;
  }>;

  // Event log
  eventLog: string[];

  // Handlers
  onStartScan: () => void;
  onCancelScan: () => void;

  // Errors/success
  scanError: string | null;
  scanSuccess: string | null;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ScanControlSection({
  canStartScan,
  isScanning,
  pendingJobs,
  scanMode,
  scanIntervalMinutes,
  scanDurationMinutes,
  currentCycle,
  totalCycles,
  intervalCountdown,
  elapsedSeconds,
  setScanMode,
  setScanIntervalMinutes,
  setScanDurationMinutes,
  scannerStates,
  eventLog,
  onStartScan,
  onCancelScan,
  scanError,
  scanSuccess,
}: ScanControlSectionProps) {
  const hasPendingJobs = pendingJobs.size > 0;

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700">Mode:</span>
        <button
          type="button"
          onClick={() => setScanMode('single')}
          className={`px-3 py-1 text-sm rounded-l-md border ${
            scanMode === 'single'
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
          }`}
          disabled={isScanning}
        >
          Single
        </button>
        <button
          type="button"
          onClick={() => setScanMode('continuous')}
          className={`px-3 py-1 text-sm rounded-r-md border-t border-b border-r ${
            scanMode === 'continuous'
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
          }`}
          disabled={isScanning}
        >
          Continuous
        </button>
      </div>

      {/* Interval controls (continuous mode only) */}
      {scanMode === 'continuous' && (
        <div className="flex gap-4">
          <div>
            <label
              htmlFor="scan-interval"
              className="block text-xs font-bold mb-1"
            >
              Interval (min)
            </label>
            <input
              id="scan-interval"
              type="number"
              min={1}
              value={scanIntervalMinutes}
              onChange={(e) => setScanIntervalMinutes(Number(e.target.value))}
              disabled={isScanning}
              className="w-24 p-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
          <div>
            <label
              htmlFor="scan-duration"
              className="block text-xs font-bold mb-1"
            >
              Duration (min)
            </label>
            <input
              id="scan-duration"
              type="number"
              min={1}
              value={scanDurationMinutes}
              onChange={(e) => setScanDurationMinutes(Number(e.target.value))}
              disabled={isScanning}
              className="w-24 p-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
        </div>
      )}

      {/* Start / Cancel buttons */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onStartScan}
          disabled={!canStartScan}
          className="px-6 py-2 bg-green-600 text-white font-medium rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Start Scan
        </button>
        {hasPendingJobs && (
          <button
            type="button"
            onClick={onCancelScan}
            className="px-6 py-2 bg-red-600 text-white font-medium rounded-md hover:bg-red-700"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Error / success messages */}
      {scanError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {scanError}
        </div>
      )}
      {scanSuccess && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-md text-sm text-green-700">
          {scanSuccess}
        </div>
      )}

      {/* Progress per scanner */}
      {scannerStates.some((s) => s.enabled && s.state !== 'idle') && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700">
            Scanner Progress
          </h3>
          {scannerStates
            .filter((s) => s.enabled)
            .map((scanner) => (
              <div key={scanner.scannerId} className="flex items-center gap-3">
                <span className="text-sm w-24 truncate">{scanner.name}</span>
                <div className="flex-1 bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${
                      scanner.state === 'error'
                        ? 'bg-red-500'
                        : scanner.state === 'complete'
                          ? 'bg-green-500'
                          : 'bg-blue-500'
                    }`}
                    style={{ width: `${scanner.progress}%` }}
                  />
                </div>
                <span className="text-xs text-gray-500 w-12 text-right">
                  {scanner.progress}%
                </span>
              </div>
            ))}
          {/* Continuous mode stats */}
          {scanMode === 'continuous' && totalCycles > 0 && (
            <div className="text-xs text-gray-500">
              Cycle {currentCycle}/{totalCycles}
              {intervalCountdown !== null &&
                intervalCountdown > 0 &&
                ` | Next in ${formatElapsed(intervalCountdown)}`}
            </div>
          )}
          {/* Elapsed time */}
          {elapsedSeconds > 0 && (
            <div className="text-xs text-gray-500">
              Elapsed: {formatElapsed(elapsedSeconds)}
            </div>
          )}
        </div>
      )}

      {/* Event log */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Event Log</h3>
        <div className="h-32 overflow-y-auto bg-gray-50 border border-gray-200 rounded-md p-2 text-xs font-mono">
          {eventLog.length === 0 ? (
            <span className="text-gray-400">No events yet</span>
          ) : (
            eventLog.map((entry, i) => (
              <div key={i} className="text-gray-600">
                {entry}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
