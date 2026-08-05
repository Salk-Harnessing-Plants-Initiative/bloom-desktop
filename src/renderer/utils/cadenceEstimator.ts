/**
 * Predicts total wall-clock seconds for one continuous-scan cycle across
 * all assigned scanners, for the "Predictive Cadence Warning on
 * Continuous-Scan Form" requirement
 * (`openspec/specs/ui-management-pages/spec.md:1836`).
 *
 * Calibrated against that requirement's own two data points from the V600
 * wedge investigation summary:
 *   - 2 plates/scanner x 5 scanners x 1200 dpi x 140x140mm ≈ 300s
 *   - 4 plates/scanner x 5 scanners x 1200 dpi x 140x140mm ≈ 418s
 * Both are satisfied exactly by the constants below. There is no third
 * calibration point in the spec to independently pin down the DPI/region/
 * scannerCount scaling shape beyond "must move in the expected direction"
 * (see this file's own test suite) — the per-plate/per-scanner split and
 * the DPI/region scaling factors are this implementation's own reasonable
 * parameterization, not independently measured.
 */

export interface CadenceEstimatorInput {
  /** Plates assigned to each scanner (same for every scanner in a run). */
  platesPerScanner: number;
  /** Number of scanners participating in this cycle. */
  scannerCount: number;
  dpi: number;
  regionMm: { width: number; height: number };
}

const BASE_DPI = 1200;
const BASE_REGION_HEIGHT_MM = 140;

/** Seconds per plate at the base DPI/region — derived from the two
 * calibration points above: (418 - 300) / (4 - 2). */
const BASE_SECONDS_PER_PLATE = 59;

/** Fixed per-scanner overhead (e.g. homing/staggered start) at the base
 * DPI/region — derived from: (300 - 2 * BASE_SECONDS_PER_PLATE) / 5. */
const BASE_SECONDS_PER_SCANNER_OVERHEAD = 36.4;

export function estimateCycleSeconds(
  input: CadenceEstimatorInput
): number {
  const { platesPerScanner, scannerCount, dpi, regionMm } = input;
  const dpiScale = dpi / BASE_DPI;
  const regionScale = regionMm.height / BASE_REGION_HEIGHT_MM;
  const scale = dpiScale * regionScale;

  const perPlateSeconds = BASE_SECONDS_PER_PLATE * scale;
  const perScannerOverheadSeconds = BASE_SECONDS_PER_SCANNER_OVERHEAD * scale;

  return (
    platesPerScanner * perPlateSeconds +
    scannerCount * perScannerOverheadSeconds
  );
}
