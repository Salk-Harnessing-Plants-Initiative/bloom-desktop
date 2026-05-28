// @vitest-environment node
/**
 * Task 10 (#235): estimateCycleSeconds — pure function that predicts
 * the wall-clock seconds a single continuous-scan cycle will take.
 *
 * Calibrated against the investigation summary 2026-05-18 Section 3
 * Table 3 anchors:
 *  - 4 plates × 5 scanners × 1200 dpi × 140×140 mm ≈ 418 s (median)
 *  - 2 plates × 5 scanners × 1200 dpi × 140×140 mm ≈ 300 s (with warmup)
 *
 * Scanners run in parallel so scanner_count does NOT scale the
 * estimate. Tests target order-of-magnitude correctness within ±15%
 * of empirical anchors, not precise values.
 */

import { describe, it, expect } from 'vitest';
import { estimateCycleSeconds } from '../../src/renderer/utils/cadenceEstimator';

describe('estimateCycleSeconds (#235)', () => {
  describe('empirical anchor checks', () => {
    it('4 plates × 1200 dpi × 140×140 mm ≈ 350–470 s (matches summary 418 s)', () => {
      const s = estimateCycleSeconds({
        platesPerScanner: 4,
        scannerCount: 5,
        dpi: 1200,
        regionMm: { w: 140, h: 140 },
      });
      expect(s).toBeGreaterThanOrEqual(350);
      expect(s).toBeLessThanOrEqual(470);
    });

    it('2 plates × 1200 dpi × 140×140 mm ≈ 180–240 s (fits 5-min target)', () => {
      const s = estimateCycleSeconds({
        platesPerScanner: 2,
        scannerCount: 5,
        dpi: 1200,
        regionMm: { w: 140, h: 140 },
      });
      expect(s).toBeGreaterThanOrEqual(180);
      expect(s).toBeLessThanOrEqual(240);
    });
  });

  describe('parameter scaling', () => {
    it('lower DPI produces a shorter cycle (linear with DPI)', () => {
      const at1200 = estimateCycleSeconds({
        platesPerScanner: 4,
        scannerCount: 5,
        dpi: 1200,
        regionMm: { w: 140, h: 140 },
      });
      const at800 = estimateCycleSeconds({
        platesPerScanner: 4,
        scannerCount: 5,
        dpi: 800,
        regionMm: { w: 140, h: 140 },
      });
      expect(at800).toBeLessThan(at1200);
    });

    it('smaller scan-region height produces a shorter cycle', () => {
      const at140 = estimateCycleSeconds({
        platesPerScanner: 4,
        scannerCount: 5,
        dpi: 1200,
        regionMm: { w: 140, h: 140 },
      });
      const at100 = estimateCycleSeconds({
        platesPerScanner: 4,
        scannerCount: 5,
        dpi: 1200,
        regionMm: { w: 140, h: 100 },
      });
      expect(at100).toBeLessThan(at140);
    });

    it('scanner_count does NOT affect the estimate (parallel scanning)', () => {
      const at1 = estimateCycleSeconds({
        platesPerScanner: 4,
        scannerCount: 1,
        dpi: 1200,
        regionMm: { w: 140, h: 140 },
      });
      const at5 = estimateCycleSeconds({
        platesPerScanner: 4,
        scannerCount: 5,
        dpi: 1200,
        regionMm: { w: 140, h: 140 },
      });
      expect(at5).toBeCloseTo(at1, 1); // identical within 0.05 s
    });

    it('plates_per_scanner scales the estimate roughly linearly', () => {
      const at2 = estimateCycleSeconds({
        platesPerScanner: 2,
        scannerCount: 5,
        dpi: 1200,
        regionMm: { w: 140, h: 140 },
      });
      const at4 = estimateCycleSeconds({
        platesPerScanner: 4,
        scannerCount: 5,
        dpi: 1200,
        regionMm: { w: 140, h: 140 },
      });
      // 4 plates should be about 2x of 2 plates (linear scaling)
      const ratio = at4 / at2;
      expect(ratio).toBeGreaterThan(1.7);
      expect(ratio).toBeLessThan(2.3);
    });
  });

  describe('determinism', () => {
    it('returns the same value for the same inputs (pure function)', () => {
      const args = {
        platesPerScanner: 4,
        scannerCount: 3,
        dpi: 1200,
        regionMm: { w: 140, h: 140 },
      };
      expect(estimateCycleSeconds(args)).toBe(estimateCycleSeconds(args));
    });
  });
});
