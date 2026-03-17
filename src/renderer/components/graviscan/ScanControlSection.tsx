import type { ScannerPanelState } from '../../../types/graviscan';
import { MIN_SCAN_INTERVAL_MINUTES } from '../../../types/graviscan';
import { ScannerPanel } from '../ScannerPanel';

interface ScanControlSectionProps {
  // Error/success messages
  scanError: string | null;
  scanSuccess: string | null;

  // Scanner state
  sessionValidated: boolean;
  scannerStates: ScannerPanelState[];
  handleToggleScannerEnabled: (scannerId: string, enabled: boolean) => void;

  // Scan state
  isScanning: boolean;
  canScan: boolean;
  isFormValid: boolean;
  canStartScan: boolean;
  validationMessages: string[];

  // Scan mode
  scanMode: 'single' | 'continuous';
  setScanMode: (mode: 'single' | 'continuous') => void;

  // Continuous mode settings
  scanIntervalMinutes: number;
  setScanIntervalMinutes: (value: number) => void;
  scanDurationMinutes: number;
  setScanDurationMinutes: (value: number) => void;

  // Continuous mode progress
  currentCycle: number;
  totalCycles: number;
  intervalCountdown: number | null;
  elapsedSeconds: number;
  overtimeMs: number | null;

  // Handlers
  handleStartScan: () => void;
  handleCancelScan: () => void;
  handleResetScanners: () => void;
}

export function ScanControlSection({
  scanError,
  scanSuccess,
  sessionValidated,
  scannerStates,
  handleToggleScannerEnabled,
  isScanning,
  canScan,
  isFormValid,
  canStartScan,
  validationMessages,
  scanMode,
  setScanMode,
  scanIntervalMinutes,
  setScanIntervalMinutes,
  scanDurationMinutes,
  setScanDurationMinutes,
  currentCycle,
  totalCycles,
  intervalCountdown,
  elapsedSeconds,
  overtimeMs,
  handleStartScan,
  handleCancelScan,
  handleResetScanners,
}: ScanControlSectionProps) {
  return (
    <>
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
    </>
  );
}
