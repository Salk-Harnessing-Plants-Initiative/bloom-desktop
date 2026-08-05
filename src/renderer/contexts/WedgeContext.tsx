/**
 * Shared wedge state, lifted out of `WedgeBanner.tsx`'s own
 * `useWedgeEvents()` call so `Layout.tsx` owns exactly one subscription
 * per graviscan-mode session (design.md Decision 6).
 *
 * An earlier draft had `GraviScan.tsx` call `useWedgeEvents()` a second,
 * independent time. Review found this doesn't work: the hook only
 * subscribes going forward from whenever it mounts, with no "fetch
 * current active wedges" query to fall back on — so a wedge that occurred
 * while the operator was on a different screen would correctly show in
 * `WedgeBanner` (mounted the whole session) but be invisible to a fresh
 * `GraviScan.tsx` instance's own subscription, silently leaving
 * "Start Scan" enabled despite a real, active wedge. This context fixes
 * that by giving every consumer the same, single, already-accumulated
 * state regardless of which one mounted more recently.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { useWedgeEvents, type UseWedgeEventsResult } from '../hooks/useWedgeEvents';

const WedgeContext = createContext<UseWedgeEventsResult | null>(null);

export function WedgeProvider({ children }: { children: ReactNode }) {
  const wedgeState = useWedgeEvents();
  return (
    <WedgeContext.Provider value={wedgeState}>{children}</WedgeContext.Provider>
  );
}

export function useWedgeContext(): UseWedgeEventsResult {
  const context = useContext(WedgeContext);
  if (!context) {
    throw new Error('useWedgeContext() must be used within a <WedgeProvider>');
  }
  return context;
}
