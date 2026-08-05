/**
 * Tests for `estimateCycleSeconds()`, the pure prediction function behind
 * the "Predictive Cadence Warning on Continuous-Scan Form" requirement
 * (`openspec/specs/ui-management-pages/spec.md:1836`).
 *
 * Calibrated against that requirement's own two data points from the V600
 * wedge investigation summary: 2 plates x 5 scanners x 1200 dpi x 140x140mm
 * ≈ 300s (interval honored); 4 plates x 5 scanners x 1200 dpi x 140x140mm
 * ≈ 418s (back-to-back, interval exceeded). Everything else (dpi/region
 * scaling shape, per-scanner overhead split) is this implementation's own
 * reasonable parameterization satisfying those two fixed points exactly —
 * no third calibration point exists in the spec to pin it down further.
 */
import { describe, it, expect } from 'vitest';
import { estimateCycleSeconds } from '../../src/renderer/utils/cadenceEstimator';

describe('estimateCycleSeconds', () => {
  it('matches the spec\'s 4-plate/5-scanner/1200dpi/140x140mm calibration point (~418s, exceeds a 300s interval)', () => {
    const seconds = estimateCycleSeconds({
      platesPerScanner: 4,
      scannerCount: 5,
      dpi: 1200,
      regionMm: { width: 140, height: 140 },
    });
    expect(seconds).toBeCloseTo(418, 0);
    expect(seconds).toBeGreaterThan(300);
  });

  it('matches the spec\'s 2-plate/5-scanner/1200dpi/140x140mm calibration point (~300s, fits a 300s interval)', () => {
    const seconds = estimateCycleSeconds({
      platesPerScanner: 2,
      scannerCount: 5,
      dpi: 1200,
      regionMm: { width: 140, height: 140 },
    });
    expect(seconds).toBeCloseTo(300, 0);
    expect(seconds).toBeLessThanOrEqual(300);
  });

  it('scales up with higher DPI', () => {
    const base = estimateCycleSeconds({
      platesPerScanner: 2,
      scannerCount: 5,
      dpi: 600,
      regionMm: { width: 140, height: 140 },
    });
    const higher = estimateCycleSeconds({
      platesPerScanner: 2,
      scannerCount: 5,
      dpi: 1200,
      regionMm: { width: 140, height: 140 },
    });
    expect(higher).toBeGreaterThan(base);
  });

  it('scales up with a taller scan region', () => {
    const shorter = estimateCycleSeconds({
      platesPerScanner: 2,
      scannerCount: 5,
      dpi: 1200,
      regionMm: { width: 140, height: 70 },
    });
    const taller = estimateCycleSeconds({
      platesPerScanner: 2,
      scannerCount: 5,
      dpi: 1200,
      regionMm: { width: 140, height: 140 },
    });
    expect(taller).toBeGreaterThan(shorter);
  });

  it('scales up with more plates per scanner', () => {
    const fewer = estimateCycleSeconds({
      platesPerScanner: 1,
      scannerCount: 5,
      dpi: 1200,
      regionMm: { width: 140, height: 140 },
    });
    const more = estimateCycleSeconds({
      platesPerScanner: 4,
      scannerCount: 5,
      dpi: 1200,
      regionMm: { width: 140, height: 140 },
    });
    expect(more).toBeGreaterThan(fewer);
  });

  it('scales up with more scanners (reacts to scannerCount, per the spec)', () => {
    const fewer = estimateCycleSeconds({
      platesPerScanner: 2,
      scannerCount: 1,
      dpi: 1200,
      regionMm: { width: 140, height: 140 },
    });
    const more = estimateCycleSeconds({
      platesPerScanner: 2,
      scannerCount: 5,
      dpi: 1200,
      regionMm: { width: 140, height: 140 },
    });
    expect(more).toBeGreaterThan(fewer);
  });
});
