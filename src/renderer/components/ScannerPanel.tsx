/**
 * ScannerPanel Component
 *
 * Displays individual scanner status and controls including:
 * - Use Scanner checkbox
 * - Online/Busy LED indicators
 * - Progress bar
 * - Output filename display
 */

import type { ScannerPanelState } from '../../types/graviscan';

interface ScannerPanelProps {
  scanner: ScannerPanelState;
  onToggleEnabled: (scannerId: string, enabled: boolean) => void;
  disabled?: boolean;
}

export function ScannerPanel({
  scanner,
  onToggleEnabled,
  disabled = false,
}: ScannerPanelProps) {
  const isScanning = scanner.state === 'scanning';
  const isWaiting = scanner.state === 'waiting';
  const hasError = scanner.state === 'error';
  const isComplete = scanner.state === 'complete';

  return (
    <div
      className={`border rounded-lg p-4 ${
        hasError
          ? 'border-red-300 bg-red-50'
          : isComplete
            ? 'border-green-300 bg-green-50'
            : isWaiting
              ? 'border-amber-300 bg-amber-50'
              : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-3">
          {/* Use Scanner Checkbox */}
          <label className="flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={scanner.enabled}
              onChange={(e) =>
                onToggleEnabled(scanner.scannerId, e.target.checked)
              }
              disabled={disabled || isScanning}
              className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 disabled:opacity-50"
            />
            <span className="ml-2 text-sm font-medium text-gray-700">Use</span>
          </label>

          {/* Scanner Name */}
          <span className="text-sm font-semibold text-gray-900">
            {scanner.name}
          </span>
        </div>

        {/* LED Indicators */}
        <div className="flex items-center space-x-3">
          {/* Online LED */}
          <div className="flex items-center space-x-1">
            <span
              className={`h-3 w-3 rounded-full ${
                scanner.isOnline ? 'bg-green-500' : 'bg-gray-300'
              }`}
              title={scanner.isOnline ? 'Online' : 'Offline'}
            />
            <span className="text-xs text-gray-500">Online</span>
          </div>

          {/* Busy LED */}
          <div className="flex items-center space-x-1">
            <span
              className={`h-3 w-3 rounded-full ${
                scanner.isBusy ? 'bg-red-500 animate-pulse' : 'bg-gray-300'
              }`}
              title={scanner.isBusy ? 'Busy' : 'Idle'}
            />
            <span className="text-xs text-gray-500">Busy</span>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-gray-500">Progress</span>
          <span className="text-xs font-medium text-gray-700">
            {scanner.progress}%
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all duration-300 ${
              hasError
                ? 'bg-red-500'
                : isComplete
                  ? 'bg-green-500'
                  : isWaiting
                    ? 'bg-amber-400'
                    : 'bg-blue-500'
            }`}
            style={{ width: `${scanner.progress}%` }}
          />
        </div>
      </div>

      {/* Output Filename */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">Output:</span>
        <span className="text-xs font-mono text-gray-700 truncate max-w-[200px]">
          {scanner.outputFilename || '-'}
        </span>
      </div>

      {/* Error Message */}
      {hasError && scanner.lastError && (
        <div className="mt-2 p-2 bg-red-100 border border-red-200 rounded text-xs text-red-700">
          {scanner.lastError}
        </div>
      )}

      {/* Complete Message */}
      {isComplete && (
        <div className="mt-2 p-2 bg-green-100 border border-green-200 rounded text-xs text-green-700 flex items-center">
          <svg className="h-4 w-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
          Scan complete
        </div>
      )}

      {/* In Use Badge — shown during continuous mode interval wait */}
      {isWaiting && (
        <div className="mt-2 p-2 bg-amber-100 border border-amber-200 rounded text-xs text-amber-700 flex items-center">
          <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse mr-2" />
          IN USE — waiting for next cycle
        </div>
      )}
    </div>
  );
}
