/**
 * Per-scanner live status — connectivity/grid-mode from `useScannerStatus`
 * merged with real-time scan progress from `useScanSession`.
 */
import type { ScannerPanelState } from '../../../types/graviscan';

export interface ScannerStatusPanelProps {
  scanners: ScannerPanelState[];
  progressByScanner: Record<string, number>;
  isScanning: boolean;
}

export function ScannerStatusPanel({
  scanners,
  progressByScanner,
  isScanning,
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
          {isScanning && <span> · {progressByScanner[scanner.scannerId] ?? 0}%</span>}
          {scanner.lastError && <div className="text-sm text-red-700">{scanner.lastError}</div>}
        </div>
      ))}
    </div>
  );
}
