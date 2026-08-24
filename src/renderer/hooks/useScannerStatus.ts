import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ScannerPanelState,
  ScannerStatusRow,
} from '../../types/graviscan';

const STATUS_POLL_INTERVAL_MS = 3000;

const OFFLINE_STATUSES: ReadonlySet<ScannerStatusRow['status']> = new Set([
  'error',
  'dead',
  'disconnected',
]);

function toScannerPanelState(row: ScannerStatusRow): ScannerPanelState {
  return {
    scannerId: row.scannerId,
    name: row.displayName,
    enabled: true,
    isOnline: !OFFLINE_STATUSES.has(row.status),
    isBusy: false,
    state: row.status === 'error' ? 'error' : 'idle',
    progress: 0,
    outputFilename: '',
    lastError: row.error,
    gridMode: row.gridMode,
    connectionStatus: row.status,
  };
}

export interface UseScannerStatusResult {
  scanners: ScannerPanelState[];
  loading: boolean;
  /**
   * Imperative refetch, for callers that need to force a status update
   * outside this hook's own polling — see the doc comment below.
   */
  refresh: () => Promise<void>;
}

/**
 * Polls `graviscan:get-scanner-status` for the Capture Scan screen's
 * pre-scan scanner list. Mirrors `ConfigureScanner.tsx`'s own established
 * "poll while any row is `starting`, stop otherwise" pattern (the fix PR
 * #213 asks for) rather than relying solely on `webContents.send` events,
 * which can fire before a fresh mount subscribes and are never replayed.
 *
 * `refresh` is exposed so a caller can force a fetch outside that loop:
 * unlike Configure Scanner (where the hook is already mounted and polling
 * while its own page drives scanner initialization, so the poll-while-
 * `starting` loop naturally observes the transition), Capture Scan's
 * `coordinator.initialize()` runs entirely inside the `startScan()` IPC
 * call, between the button click and `isScanning` becoming true — after
 * this hook's initial mount-time fetch already captured the pre-scan
 * `disconnected` snapshot. `GraviScan.tsx` calls `refresh()` on the
 * `isScanning` transition itself (see its own comment) so this hook
 * doesn't need to depend on `useScanSession`'s output, which itself
 * depends on this hook's `scanners`.
 */
export function useScannerStatus(): UseScannerStatusResult {
  const [scanners, setScanners] = useState<ScannerPanelState[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const result = await window.electron.gravi.getScannerStatus();
    if (result.success) {
      setScanners(result.scanners.map(toScannerPanelState));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refresh();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    const anyStarting = scanners.some((s) => s.connectionStatus === 'starting');
    if (anyStarting && pollRef.current === null) {
      pollRef.current = setInterval(refresh, STATUS_POLL_INTERVAL_MS);
    } else if (!anyStarting && pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [scanners, refresh]);

  return { scanners, loading, refresh };
}
