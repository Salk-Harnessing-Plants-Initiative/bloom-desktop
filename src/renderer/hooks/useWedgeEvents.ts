import { useCallback, useEffect, useState } from 'react';
import type { GraviWedgeEvent } from '../../types/graviscan';

export interface UseWedgeEventsResult {
  /** Active, unacknowledged wedge entries keyed by scanner_id. A new wedge
   * for a scanner already present replaces its entry (design.md Decision 4). */
  entries: Record<string, GraviWedgeEvent>;
  /** Session-scoped total wedge-event count — increments on every
   * wedge-detected event, including repeats for the same scanner_id.
   * Not decremented by dismiss(). */
  totalAutoPauseEvents: number;
  /** Session-scoped count of distinct scanner_ids that have wedged at
   * least once this session. Not decremented by dismiss(). */
  totalScannersAffected: number;
  /** Hides a scanner's banner entry. No backend call — the scanner is
   * already paused by auto-pause, independent of dismissal. */
  dismiss: (scannerId: string) => void;
  /** Like dismiss(), but only removes the entry if it still matches the
   * given cycle_number/timestamp. Guards against a retryScanner() promise
   * resolving after a fresh wedge for the same scanner_id has already
   * superseded the entry it was called for — without this check, a stale
   * "retry succeeded" callback would silently discard the operator's
   * not-yet-addressed new wedge (see WedgeBanner.tsx's handleConfirmRetry). */
  dismissIfCurrent: (
    scannerId: string,
    cycleNumber: number,
    timestamp: string
  ) => void;
}

/**
 * Subscribes to wedge-detected events for the lifetime of the component
 * that calls this hook (typically Layout.tsx, so it's effectively
 * session-lifetime — see design.md Decision 4).
 */
export function useWedgeEvents(): UseWedgeEventsResult {
  const [entries, setEntries] = useState<Record<string, GraviWedgeEvent>>({});
  const [totalAutoPauseEvents, setTotalAutoPauseEvents] = useState(0);
  const [seenScannerIds, setSeenScannerIds] = useState<Set<string>>(
    () => new Set()
  );

  useEffect(() => {
    const unsubscribeWedge = window.electron.gravi.onWedgeDetected(
      (event: GraviWedgeEvent) => {
        setEntries((prev) => ({ ...prev, [event.scanner_id]: event }));
        setTotalAutoPauseEvents((prev) => prev + 1);
        setSeenScannerIds((prev) => {
          if (prev.has(event.scanner_id)) return prev;
          const next = new Set(prev);
          next.add(event.scanner_id);
          return next;
        });
      }
    );

    const clearAll = () => {
      setEntries({});
      setTotalAutoPauseEvents(0);
      setSeenScannerIds(new Set());
    };
    const unsubscribeIntervalComplete =
      window.electron.gravi.onIntervalComplete(clearAll);
    const unsubscribeCancelled = window.electron.gravi.onCancelled(clearAll);

    return () => {
      unsubscribeWedge();
      unsubscribeIntervalComplete();
      unsubscribeCancelled();
    };
  }, []);

  const dismiss = useCallback((scannerId: string) => {
    setEntries((prev) => {
      if (!(scannerId in prev)) return prev;
      const next = { ...prev };
      delete next[scannerId];
      return next;
    });
  }, []);

  const dismissIfCurrent = useCallback(
    (scannerId: string, cycleNumber: number, timestamp: string) => {
      setEntries((prev) => {
        const current = prev[scannerId];
        if (
          !current ||
          current.cycle_number !== cycleNumber ||
          current.timestamp !== timestamp
        ) {
          return prev;
        }
        const next = { ...prev };
        delete next[scannerId];
        return next;
      });
    },
    []
  );

  return {
    entries,
    totalAutoPauseEvents,
    totalScannersAffected: seenScannerIds.size,
    dismiss,
    dismissIfCurrent,
  };
}
