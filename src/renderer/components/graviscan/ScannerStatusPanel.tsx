/**
 * Per-scanner live status — connectivity/grid-mode from `useScannerStatus`
 * merged with real-time scan progress from `useScanSession`.
 */
import type { ScannerPanelState } from '../../../types/graviscan';
import type { TestScanResult } from '../../hooks/useTestScan';

export interface ScannerStatusPanelProps {
  scanners: ScannerPanelState[];
  progressByScanner: Record<string, number>;
  isScanning: boolean;
  /** Per-scanner Test Scan outcome (design.md Decision 11) — `useTestScan`
   * already computes these; this is where they're actually surfaced. */
  testResults?: Record<string, TestScanResult>;
}

export function ScannerStatusPanel({
  scanners,
  progressByScanner,
  isScanning,
  testResults,
}: ScannerStatusPanelProps) {
  return (
    <div className="space-y-2">
      {scanners.map((scanner) => (
        <div
          key={scanner.scannerId}
          data-testid={`scanner-status-${scanner.scannerId}`}
          className={scanner.isOnline ? '' : 'text-red-700'}
        >
          <span className="font-semibold">{scanner.name}</span>
          {' — '}
          <span>{scanner.connectionStatus}</span>
          {' · '}
          <span>{scanner.gridMode}</span>
          {isScanning && (
            <span> · {progressByScanner[scanner.scannerId] ?? 0}%</span>
          )}
          {scanner.lastError && (
            <div className="text-sm text-red-700">{scanner.lastError}</div>
          )}
          {testResults?.[scanner.scannerId] &&
            (testResults[scanner.scannerId].success ? (
              <div className="text-sm text-green-700">Test scan OK</div>
            ) : (
              <div className="text-sm text-red-700">
                Test scan failed: {testResults[scanner.scannerId].error}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
