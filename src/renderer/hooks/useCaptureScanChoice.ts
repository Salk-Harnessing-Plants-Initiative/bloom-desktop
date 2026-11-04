import { useEffect, useState } from 'react';

export interface CaptureScanChoice {
  experimentId: string;
  phenotyperId: string;
}

/**
 * The experiment and phenotyper chosen on Capture Scan, from the session that keeps
 * them across pages (#483): undefined while loading, null when either isn't chosen.
 */
export function useCaptureScanChoice(
  enabled: boolean
): CaptureScanChoice | null | undefined {
  const [choice, setChoice] = useState<CaptureScanChoice | null | undefined>(
    enabled ? undefined : null
  );
  useEffect(() => {
    if (!enabled) {
      setChoice(null);
      return;
    }
    let cancelled = false;
    Promise.resolve()
      .then(() => window.electron.session.get())
      .then((session) => {
        if (cancelled) return;
        setChoice(
          session?.experimentId && session?.phenotyperId
            ? {
                experimentId: session.experimentId,
                phenotyperId: session.phenotyperId,
              }
            : null
        );
      })
      .catch(() => {
        // Without the session, the station page is shown.
        if (!cancelled) setChoice(null);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return choice;
}
