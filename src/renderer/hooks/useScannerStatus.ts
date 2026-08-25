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

/**
 * `ScannerPanelState` is `ConfigureScanner.tsx`'s type, reused here rather
 * than duplicated. `enabled`/`isBusy`/`progress`/`outputFilename`/`state`
 * are Configure-Scanner-specific fields this hook has no data source for
 * and always sets to a fixed stub value — none of the current consumers
 * (`ScannerStatusPanel.tsx`, `useContinuousMode.ts`) read them (real
 * progress comes from a separate `progressByScanner` prop). A future
 * caller trusting these fields' values from this hook would get a
 * constant, not live data.
 */
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
 *
 * `refresh()` discards a response that resolves after a *newer* `refresh()`
 * call was already issued (found in round-3 `/review-pr`): rapid Start/
 * Cancel/Start cycles, plus `GraviScan.tsx`'s own isScanning-triggered
 * call, can have two `getScannerStatus()` IPC round-trips in flight at
 * once, and their real SANE/USB-query timing gives no guarantee they
 * resolve in request order. Applying an older response after a newer one
 * would silently revert the panel to outdated status — exactly the bug
 * this hook's `refresh()` exists to fix, reintroduced via concurrency.
 *
 * `refresh()` also catches a genuine promise rejection from
 * `getScannerStatus()` (found in round-4 `/review-pr`), distinct from the
 * already-handled `{success: false}` path: an uncaught rejection here
 * previously left `loading` stuck `true` forever (never read by any
 * consumer, so no error UI either) and `scanners` stuck `[]`, which keeps
 * the poll-while-`starting` effect below from ever starting — no retry
 * short of an app restart, strictly worse than the PR #213 bug this hook
 * exists to fix. Logged via `console.error`, falling through to
 * `setLoading(false)` rather than leaving the UI silently stuck.
 */
export function useScannerStatus(): UseScannerStatusResult {
  const [scanners, setScanners] = useState<ScannerPanelState[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestRequestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++latestRequestIdRef.current;
    try {
      const result = await window.electron.gravi.getScannerStatus();
      if (requestId !== latestRequestIdRef.current) {
        return;
      }
      if (result.success) {
        setScanners(result.scanners.map(toScannerPanelState));
      }
    } catch (error) {
      if (requestId !== latestRequestIdRef.current) {
        return;
      }
      console.error('[useScannerStatus] getScannerStatus() failed:', error);
    } finally {
      if (requestId === latestRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    refresh();
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
