/**
 * Predictive cadence-won't-be-honored warning banner (#235).
 *
 * Renders an amber warning BEFORE the operator starts a continuous
 * scan when the estimated per-cycle wall time exceeds the configured
 * interval. The estimate is a *mean* (±15% expected variance per
 * design.md Decision 7) — its job is to flag order-of-magnitude
 * mismatches, not enforce a deadline.
 *
 * Reactive: re-evaluates as platesPerScanner, scannerCount, dpi, and
 * regionMm change.
 */

import { estimateCycleSeconds } from '../../utils/cadenceEstimator';

export interface CadenceWarningBannerProps {
  /** Maximum plates a single scanner will do per cycle (2 or 4 in
   *  current production). Drives the cycle-time estimate. */
  platesPerScanner: number;
  /** Number of enabled scanners. Display-only; does NOT scale the
   *  estimate (scanners run in parallel). */
  scannerCount: number;
  /** Selected scan DPI. */
  dpi: number;
  /** Configured interval in minutes (operator's target cadence). */
  intervalMinutes: number;
  /** Scan region in millimeters. Default 140×140 mm (the
   *  empirically-validated production size). */
  regionMm?: { w: number; h: number };
}

const DEFAULT_REGION = { w: 140, h: 140 };

export function CadenceWarningBanner({
  platesPerScanner,
  scannerCount,
  dpi,
  intervalMinutes,
  regionMm = DEFAULT_REGION,
}: CadenceWarningBannerProps) {
  const estimateSec = estimateCycleSeconds({
    platesPerScanner,
    scannerCount,
    dpi,
    regionMm,
  });
  const intervalSec = intervalMinutes * 60;
  if (estimateSec <= intervalSec) return null;

  const estimateMin = Math.round(estimateSec / 60);
  return (
    <div
      className="mb-3 p-3 bg-amber-50 border border-amber-300 rounded-lg"
      role="alert"
      data-testid="cadence-warning-banner"
    >
      <div className="text-sm text-amber-800">
        <strong>Configured cadence won&apos;t be honored.</strong> At{' '}
        {platesPerScanner} plates × {scannerCount} scanners × {dpi} DPI ×{' '}
        {regionMm.w}×{regionMm.h} mm, each cycle will take ~{estimateMin} min —
        longer than your {intervalMinutes} min interval. Cycles will run
        back-to-back. To honor the {intervalMinutes} min cadence: use fewer
        plates per scanner, lower the DPI, or shorten the scan region.
      </div>
    </div>
  );
}
