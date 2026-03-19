import type {
  DetectedScanner,
  ScannerAssignment,
} from '../../../types/graviscan';
import {
  GRAVISCAN_RESOLUTIONS,
  MAX_SCANNER_SLOTS,
} from '../../../types/graviscan';
import type { TestResult } from '../../hooks/useTestScan';

interface ScannerConfigSectionProps {
  // Scanner config state
  isConfigCollapsed: boolean;
  configSaved: boolean;
  scannerAssignments: ScannerAssignment[];
  resolution: number;
  setResolution: React.Dispatch<React.SetStateAction<number>>;
  validationWarning: string | null;

  // Scanner detection
  detectedScanners: DetectedScanner[];
  detectingScanner: boolean;
  detectionError: string | null;

  // Test state
  isTesting: boolean;
  testPhase: string;
  testResults: Record<string, TestResult>;
  testComplete: boolean;

  // Scanning state
  isScanning: boolean;

  // Handlers
  handleToggleConfigCollapse: () => void;
  handleResetScannerConfig: (e: React.MouseEvent) => Promise<void>;
  handleDetectScanners: () => Promise<void>;
  handleScannerAssignment: (
    slotIndex: number,
    scannerId: string | null
  ) => void;
  handleScannerGridMode: (
    slotIndex: number,
    gridMode: '2grid' | '4grid'
  ) => void;
  handleAddScannerSlot: () => void;
  handleRemoveScannerSlot: (slotIndex: number) => void;
  clearValidationWarning: () => void;
  handleTestAllScanners: () => void;
}

export function ScannerConfigSection({
  isConfigCollapsed,
  configSaved,
  scannerAssignments,
  resolution,
  setResolution,
  validationWarning,
  detectedScanners,
  detectingScanner,
  detectionError,
  isTesting,
  testPhase,
  testResults,
  testComplete,
  isScanning,
  handleToggleConfigCollapse,
  handleResetScannerConfig,
  handleDetectScanners,
  handleScannerAssignment,
  handleScannerGridMode,
  handleAddScannerSlot,
  handleRemoveScannerSlot,
  clearValidationWarning,
  handleTestAllScanners,
}: ScannerConfigSectionProps) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Collapsible Header */}
      <div
        className={`px-6 py-4 flex items-center justify-between cursor-pointer transition-colors ${
          isConfigCollapsed
            ? 'hover:bg-gray-50'
            : 'bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100'
        }`}
        onClick={handleToggleConfigCollapse}
      >
        <div className="flex items-center">
          {/* Scanner Icon */}
          <div
            className={`p-2 rounded-lg mr-3 ${isConfigCollapsed ? 'bg-gray-100' : 'bg-blue-100'}`}
          >
            <svg
              className={`h-5 w-5 ${isConfigCollapsed ? 'text-gray-500' : 'text-blue-600'}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
              />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Configure Scanners
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {isConfigCollapsed && configSaved
                ? 'Click to modify scanner settings'
                : 'Detect and assign scanners to slots'}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {/* Configuration Summary Badge (shown when collapsed and configured) */}
          {isConfigCollapsed &&
            configSaved &&
            scannerAssignments.some((a) => a.scannerId !== null) && (
              <div className="flex items-center space-x-2">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 border border-green-200">
                  <svg
                    className="h-3.5 w-3.5 mr-1.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {
                    scannerAssignments.filter((a) => a.scannerId !== null)
                      .length
                  }{' '}
                  scanner
                  {scannerAssignments.filter((a) => a.scannerId !== null)
                    .length > 1
                    ? 's'
                    : ''}
                </span>
                {/* Show grid modes for each scanner */}
                {scannerAssignments
                  .filter((a) => a.scannerId !== null)
                  .map((a, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600"
                    >
                      {a.slot.replace('Scanner ', 'S')}:{' '}
                      {a.gridMode === '4grid' ? '4-grid' : '2-grid'}
                    </span>
                  ))}
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                  {resolution} DPI
                </span>
              </div>
            )}

          {/* Reset Scanner Config Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleResetScannerConfig(e);
            }}
            disabled={isScanning}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-red-600 hover:border-red-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Reset all scanner configuration"
          >
            <svg
              className="h-3.5 w-3.5 mr-1"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
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
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
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
                  <svg
                    className="h-5 w-5 text-amber-500"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div className="ml-3 flex-1">
                  <p className="text-sm font-medium text-amber-800">
                    {validationWarning}
                  </p>
                </div>
                <button
                  onClick={() => clearValidationWarning()}
                  className="ml-3 p-1 text-amber-400 hover:text-amber-600 hover:bg-amber-100 rounded-lg transition-colors"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Step 1: Detect Scanners */}
          <div className="space-y-3">
            <div className="flex items-center">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs font-bold mr-2">
                1
              </span>
              <h3 className="text-sm font-semibold text-gray-900">
                Detect USB Scanners
              </h3>
            </div>
            <div className="ml-8">
              <button
                onClick={handleDetectScanners}
                disabled={detectingScanner}
                className="inline-flex items-center px-4 py-2.5 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {detectingScanner ? (
                  <>
                    <svg
                      className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    Scanning USB ports...
                  </>
                ) : (
                  <>
                    <svg
                      className="-ml-1 mr-2 h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                    Detect Scanners
                  </>
                )}
              </button>
              {detectingScanner && (
                <span className="ml-3 text-sm text-gray-500 italic">
                  Please wait, this might take a while.
                </span>
              )}
              {detectedScanners.length === 0 &&
                !detectingScanner &&
                !detectionError && (
                  <p className="mt-2 text-xs text-gray-500">
                    Click to scan for connected USB flatbed scanners
                  </p>
                )}
            </div>
          </div>

          {/* Detection Error */}
          {detectionError && (
            <div className="ml-8 p-4 bg-red-50 border border-red-200 rounded-xl">
              <div className="flex">
                <div className="flex-shrink-0 p-1 bg-red-100 rounded-lg">
                  <svg
                    className="h-5 w-5 text-red-500"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-red-800">
                    {detectionError}
                  </p>
                  <p className="text-xs text-red-600 mt-1">
                    Check USB connections and ensure scanner drivers are
                    installed.
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
                  Found {detectedScanners.length} Scanner
                  {detectedScanners.length > 1 ? 's' : ''}
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
                      <div
                        className={`w-2.5 h-2.5 rounded-full mr-3 ${
                          scanner.is_available
                            ? 'bg-green-500 shadow-sm shadow-green-200'
                            : 'bg-red-500'
                        }`}
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {scanner.name}
                        </p>
                        <p className="text-xs text-gray-500">
                          Port: {scanner.usb_port || '?'} | Bus{' '}
                          {scanner.usb_bus} Dev {scanner.usb_device}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                        scanner.is_available
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
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
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs font-bold mr-2">
                  2
                </span>
                <h3 className="text-sm font-semibold text-gray-900">
                  Assign Scanners & Grid Mode
                </h3>
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
                        <div
                          className={`flex items-center justify-center w-8 h-8 rounded-lg text-sm font-bold ${
                            isAssigned
                              ? 'bg-blue-100 text-blue-600'
                              : 'bg-gray-100 text-gray-400'
                          }`}
                        >
                          {index + 1}
                        </div>
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-gray-500 mb-1">
                            {assignment.slot}
                          </label>
                          <select
                            value={assignment.scannerId || ''}
                            onChange={(e) =>
                              handleScannerAssignment(
                                index,
                                e.target.value || null
                              )
                            }
                            className={`block w-full px-3 py-2 text-sm border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                              isAssigned
                                ? 'border-blue-300 bg-white'
                                : 'border-gray-300 bg-white'
                            }`}
                          >
                            <option value="">Select a scanner...</option>
                            {detectedScanners.map((scanner) => {
                              const isAssignedElsewhere =
                                assignedScannerIds.includes(scanner.scanner_id);
                              return (
                                <option
                                  key={scanner.scanner_id}
                                  value={scanner.scanner_id}
                                  disabled={
                                    isAssignedElsewhere || !scanner.is_available
                                  }
                                >
                                  {scanner.name} (Port {scanner.usb_port || '?'}
                                  , Bus {scanner.usb_bus} Dev{' '}
                                  {scanner.usb_device})
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
                            onChange={(e) =>
                              handleScannerGridMode(
                                index,
                                e.target.value as '2grid' | '4grid'
                              )
                            }
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
                            <svg
                              className="h-4 w-4"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M6 18L18 6M6 6l12 12"
                              />
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
                    <svg
                      className="h-4 w-4 mr-2"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 4v16m8-8H4"
                      />
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
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs font-bold mr-2">
                  3
                </span>
                <h3 className="text-sm font-semibold text-gray-900">
                  Scan Resolution
                </h3>
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
                  <p className="mt-2 text-xs text-gray-500">
                    Higher DPI = better quality, larger files. Applied to all
                    scanners.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Test All Scanners - Auto-save is now handled by effect */}
          {scannerAssignments.some((a) => a.scannerId !== null) && (
            <div className="pt-4 border-t border-gray-200 space-y-4">
              <div className="flex items-center">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-100 text-purple-600 text-xs font-bold mr-2">
                  4
                </span>
                <h3 className="text-sm font-semibold text-gray-900">
                  Test All Scanners
                </h3>
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
                      <svg
                        className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      {testPhase === 'connecting'
                        ? 'Connecting to Scanners...'
                        : testPhase === 'scanning'
                          ? 'Test Scanning...'
                          : 'Starting Scanner Threads...'}
                    </>
                  ) : (
                    <>
                      <svg
                        className="-ml-1 mr-2 h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      Test All Scanners
                    </>
                  )}
                </button>

                {/* Test Results - show during test and after completion */}
                {(isTesting || testComplete) &&
                  Object.keys(testResults).length > 0 && (
                    <div className="mt-4 space-y-2">
                      {scannerAssignments
                        .filter((a) => a.scannerId !== null)
                        .map((assignment) => {
                          const result = testResults[assignment.scannerId!];
                          const scanner = detectedScanners.find(
                            (s) => s.scanner_id === assignment.scannerId
                          );
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
                                  <svg
                                    className="animate-spin h-5 w-5 text-blue-500 mr-2"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                  >
                                    <circle
                                      className="opacity-25"
                                      cx="12"
                                      cy="12"
                                      r="10"
                                      stroke="currentColor"
                                      strokeWidth="4"
                                    ></circle>
                                    <path
                                      className="opacity-75"
                                      fill="currentColor"
                                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                    ></path>
                                  </svg>
                                ) : result.success ? (
                                  <svg
                                    className="h-5 w-5 text-green-500 mr-2"
                                    fill="currentColor"
                                    viewBox="0 0 20 20"
                                  >
                                    <path
                                      fillRule="evenodd"
                                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                      clipRule="evenodd"
                                    />
                                  </svg>
                                ) : (
                                  <svg
                                    className="h-5 w-5 text-red-500 mr-2"
                                    fill="currentColor"
                                    viewBox="0 0 20 20"
                                  >
                                    <path
                                      fillRule="evenodd"
                                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                                      clipRule="evenodd"
                                    />
                                  </svg>
                                )}
                                <div>
                                  <span className="text-sm font-medium text-gray-900">
                                    {assignment.slot}:{' '}
                                    {scanner?.name || assignment.scannerId}
                                  </span>
                                  {isInProgress && (
                                    <p className="text-xs text-blue-600 mt-0.5">
                                      Performing test scan...
                                    </p>
                                  )}
                                  {!isInProgress &&
                                    result.success &&
                                    result.scanTimeMs && (
                                      <p className="text-xs text-green-600 mt-0.5">
                                        Test scan completed in{' '}
                                        {(result.scanTimeMs / 1000).toFixed(1)}s
                                      </p>
                                    )}
                                  {!isInProgress &&
                                    !result.success &&
                                    result.error && (
                                      <p className="text-xs text-red-600 mt-0.5">
                                        {result.error}
                                      </p>
                                    )}
                                </div>
                              </div>
                              <span
                                className={`text-xs font-medium px-2 py-1 rounded-full ${
                                  isInProgress
                                    ? 'bg-blue-100 text-blue-700'
                                    : result.success
                                      ? 'bg-green-100 text-green-700'
                                      : 'bg-red-100 text-red-700'
                                }`}
                              >
                                {isInProgress
                                  ? 'Scanning...'
                                  : result.success
                                    ? 'Scanner Ready'
                                    : 'Failed'}
                              </span>
                            </div>
                          );
                        })}

                      {/* All Tests Passed Summary */}
                      {Object.values(testResults).every((r) => r.success) && (
                        <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                          <div className="flex items-center">
                            <svg
                              className="h-5 w-5 text-green-500 mr-2"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                clipRule="evenodd"
                              />
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
  );
}
