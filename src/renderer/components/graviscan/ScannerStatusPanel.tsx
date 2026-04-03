import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TestResult } from '../../hooks/useTestScan';

interface ScannerStatus {
  scannerId: string;
  displayName: string;
  usbPort: string | null;
  gridMode: string;
  status: 'ready' | 'starting' | 'error' | 'dead' | 'disconnected';
  error?: string;
}

interface ScannerStatusPanelProps {
  isTesting: boolean;
  testPhase: string;
  testResults: Record<string, TestResult>;
  testComplete: boolean;
  handleTestAllScanners: () => void;
  isScanning: boolean;
}

export function ScannerStatusPanel({
  isTesting,
  testPhase,
  testResults,
  testComplete,
  handleTestAllScanners,
  isScanning,
}: ScannerStatusPanelProps) {
  const navigate = useNavigate();
  const [scanners, setScanners] = useState<ScannerStatus[]>([]);
  const [loading, setLoading] = useState(true);

  // Load scanner status on mount
  useEffect(() => {
    const loadStatus = async () => {
      try {
        const result = await window.electron.graviscan.getScannerStatus();
        if (result.success) {
          setScanners(result.scanners);
        }
      } catch {
        // graviscan may not be available
      } finally {
        setLoading(false);
      }
    };
    loadStatus();
  }, []);

  // Subscribe to real-time status updates
  useEffect(() => {
    const cleanup = window.electron.graviscan.onScannerInitStatus?.(
      (event: { scannerId: string; status: string; error?: string }) => {
        setScanners((prev) =>
          prev.map((s) =>
            s.scannerId === event.scannerId
              ? {
                  ...s,
                  status: event.status as ScannerStatus['status'],
                  error: event.error,
                }
              : s
          )
        );
      }
    );
    return cleanup;
  }, []);

  const readyScanners = scanners.filter((s) => s.status === 'ready');
  const hasAnyScanners = scanners.length > 0;

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center text-sm text-gray-500">
          <svg
            className="animate-spin h-4 w-4 mr-2 text-blue-500"
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
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          Loading scanner status...
        </div>
      </div>
    );
  }

  if (!hasAnyScanners) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
        <div className="text-center">
          <p className="text-amber-700 font-medium">No scanners configured</p>
          <p className="text-amber-600 text-sm mt-1">
            Configure scanners in{' '}
            <button
              onClick={() => navigate('/configure-scanner')}
              className="underline font-medium hover:text-amber-800"
            >
              Configure Scanner
            </button>{' '}
            to start scanning.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Scanner Status
        </h3>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/configure-scanner?reset=true')}
            className="text-xs text-blue-600 hover:text-blue-800 underline"
          >
            Reconfigure Scanners
          </button>
          <button
            onClick={handleTestAllScanners}
            disabled={isTesting || isScanning || readyScanners.length === 0}
            className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isTesting
              ? `Testing... (${testPhase})`
              : testComplete
                ? 'Re-test Scanners'
                : 'Test Scanners'}
          </button>
        </div>
      </div>

      {/* Scanner list */}
      <div className="space-y-2">
        {scanners.map((scanner) => {
          const testResult = testResults[scanner.scannerId];
          return (
            <div
              key={scanner.scannerId}
              className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-lg"
            >
              <div className="flex items-center gap-3">
                {/* Status indicator */}
                <div
                  className={`w-2.5 h-2.5 rounded-full ${
                    scanner.status === 'ready'
                      ? 'bg-green-500'
                      : scanner.status === 'starting'
                        ? 'bg-yellow-400 animate-pulse'
                        : scanner.status === 'error'
                          ? 'bg-red-500'
                          : 'bg-gray-400'
                  }`}
                />
                <div>
                  <span className="text-sm font-medium text-gray-900">
                    {scanner.displayName}
                  </span>
                  <span className="text-xs text-gray-500 ml-2">
                    {scanner.usbPort ? `Port ${scanner.usbPort}` : ''} |{' '}
                    {scanner.gridMode}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Status text */}
                <span
                  className={`text-xs font-medium ${
                    scanner.status === 'ready'
                      ? 'text-green-600'
                      : scanner.status === 'starting'
                        ? 'text-yellow-600'
                        : scanner.status === 'error'
                          ? 'text-red-600'
                          : 'text-gray-500'
                  }`}
                >
                  {scanner.status === 'ready'
                    ? 'Ready'
                    : scanner.status === 'starting'
                      ? 'Connecting...'
                      : scanner.status === 'error'
                        ? scanner.error || 'Error'
                        : scanner.status === 'disconnected'
                          ? 'Disconnected'
                          : 'Dead'}
                </span>
                {/* Test result */}
                {testResult && (
                  <span
                    className={`text-xs ${testResult.success ? 'text-green-600' : 'text-red-600'}`}
                  >
                    {testResult.success
                      ? `${testResult.scanTimeMs}ms`
                      : testResult.error}
                  </span>
                )}
              </div>
              {/* Reconnect button — always visible for force reset */}
              {scanner.status !== 'starting' && (
                <button
                  onClick={async () => {
                    setScanners((prev) =>
                      prev.map((s) =>
                        s.scannerId === scanner.scannerId
                          ? {
                              ...s,
                              status: 'starting' as const,
                              error: undefined,
                            }
                          : s
                      )
                    );
                    const result =
                      await window.electron.graviscan.reconnectScanner(
                        scanner.scannerId
                      );
                    if (!result.success) {
                      setScanners((prev) =>
                        prev.map((s) =>
                          s.scannerId === scanner.scannerId
                            ? {
                                ...s,
                                status: 'error' as const,
                                error: result.error,
                              }
                            : s
                        )
                      );
                    }
                  }}
                  className="px-2 py-1 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100"
                >
                  Reconnect
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
