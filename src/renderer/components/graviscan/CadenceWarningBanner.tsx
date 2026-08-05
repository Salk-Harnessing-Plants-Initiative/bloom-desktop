/**
 * Predictive cadence warning — "Predictive Cadence Warning on
 * Continuous-Scan Form" (ui-management-pages/spec.md). Fires BEFORE the
 * operator clicks Start, using the real `gridMode`-derived
 * `platesPerScanner` (design.md Decision 7), not a hardcoded worst case.
 * The existing reactive `overtime` banner (fires AFTER duration is
 * exceeded) is a separate, unchanged concern — this component only
 * covers the predictive, pre-start warning.
 */
import { estimateCycleSeconds, type CadenceEstimatorInput } from '../../utils/cadenceEstimator';

export interface CadenceWarningBannerProps {
  cadenceContext: CadenceEstimatorInput;
  intervalMinutes: number;
}

export function CadenceWarningBanner({
  cadenceContext,
  intervalMinutes,
}: CadenceWarningBannerProps) {
  const estimatedSeconds = estimateCycleSeconds(cadenceContext);
  const intervalSeconds = intervalMinutes * 60;

  if (estimatedSeconds <= intervalSeconds) return null;

  const estimatedMinutes = Math.ceil(estimatedSeconds / 60);

  return (
    <div
      data-testid="cadence-warning-banner"
      className="bg-amber-50 border border-amber-300 text-amber-800 rounded p-3 text-sm"
    >
      Predicted scan time (~{estimatedMinutes} min) exceeds the configured
      interval ({intervalMinutes} min). Reduce wall time by using fewer
      plates, a lower DPI, or a smaller region — or increase the interval.
    </div>
  );
}
