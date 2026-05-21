/**
 * Predictive cadence estimator for the continuous-scan form (#235).
 *
 * Pure function. Order-of-magnitude estimate of per-cycle wall time so
 * the UI can show a "configured interval won't be honored" warning
 * BEFORE the operator clicks Start.
 *
 * Calibrated against investigation summary 2026-05-18 Section 3
 * Table 3 row "4 plates per scanner sequential":
 *   cycle-gap median = 418 s on PCIe at 1200 dpi 140×140 mm
 *   ⇒ ~104.5 s per plate (4 plates / cycle)
 *   ⇒ rounded to 102 s per plate as the BASE_PER_PLATE_SEC anchor
 *
 * The ~15% empirical variance documented in the summary means tests
 * should target order-of-magnitude correctness, not exact values.
 * Future tunings: edit BASE_PER_PLATE_SEC.
 */

export interface CadenceEstimatorInput {
  /** Plates each scanner does per cycle (2 or 4 in current production). */
  platesPerScanner: number;
  /** Number of scanners. Accepted for future formulas but does NOT
   *  scale the estimate today — scanners run in parallel per Section 3
   *  of the investigation summary. */
  scannerCount: number;
  /** Requested DPI. */
  dpi: number;
  /** Scan region in mm (width × height). Scan time scales with height
   *  (slow-axis Y traversal). */
  regionMm: { w: number; h: number };
}

/** Empirical per-plate time at the anchor config (1200 dpi, 140×140 mm). */
const BASE_PER_PLATE_SEC = 102;
const BASE_DPI = 1200;
const BASE_REGION_HEIGHT_MM = 140;

/**
 * Estimate per-cycle wall time in seconds.
 *
 * Formula:
 *   estimate = plates_per_scanner * per_plate_time(dpi, region_h)
 *   per_plate_time = BASE_PER_PLATE_SEC * (dpi / BASE_DPI) * (region_h / BASE_REGION_HEIGHT_MM)
 */
export function estimateCycleSeconds(input: CadenceEstimatorInput): number {
  const { platesPerScanner, dpi, regionMm } = input;
  const dpiScale = dpi / BASE_DPI;
  const regionScale = regionMm.h / BASE_REGION_HEIGHT_MM;
  const perPlate = BASE_PER_PLATE_SEC * dpiScale * regionScale;
  return platesPerScanner * perPlate;
}
