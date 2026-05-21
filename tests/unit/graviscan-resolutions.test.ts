// @vitest-environment node
/**
 * Task 8 TS piece (#232): GRAVISCAN_RESOLUTIONS trimmed to the V600
 * empirically-validated set; LegacyGraviScanResolution + isValidResolution
 * type-guard for renderer DB-read paths where stale 3200/6400 values
 * may still be persisted.
 */

import { describe, it, expect } from 'vitest';
import {
  GRAVISCAN_RESOLUTIONS,
  isValidResolution,
} from '../../src/types/graviscan';

describe('GRAVISCAN_RESOLUTIONS', () => {
  it('contains exactly the V600-validated set', () => {
    expect(GRAVISCAN_RESOLUTIONS).toEqual([200, 400, 600, 800, 1200, 1600]);
  });

  it('still includes 1200 (the production value)', () => {
    expect((GRAVISCAN_RESOLUTIONS as readonly number[]).includes(1200)).toBe(
      true,
    );
  });

  it('does NOT include 3200 or 6400 (out of validated envelope)', () => {
    const arr = GRAVISCAN_RESOLUTIONS as readonly number[];
    expect(arr.includes(3200)).toBe(false);
    expect(arr.includes(6400)).toBe(false);
  });
});

describe('isValidResolution', () => {
  it('returns true for every validated DPI', () => {
    for (const dpi of [200, 400, 600, 800, 1200, 1600]) {
      expect(isValidResolution(dpi)).toBe(true);
    }
  });

  it('returns false for stale legacy values', () => {
    expect(isValidResolution(3200)).toBe(false);
    expect(isValidResolution(6400)).toBe(false);
  });

  it('returns false for arbitrary numbers', () => {
    expect(isValidResolution(0)).toBe(false);
    expect(isValidResolution(150)).toBe(false);
    expect(isValidResolution(1199)).toBe(false);
    expect(isValidResolution(99999)).toBe(false);
  });

  it('narrows the type when used as a type-guard', () => {
    const fromDb: number = 1200; // simulate DB read
    if (isValidResolution(fromDb)) {
      // TypeScript would error here if isValidResolution didn't narrow
      // fromDb to GraviScanResolution
      const _typed: 200 | 400 | 600 | 800 | 1200 | 1600 = fromDb;
      expect(_typed).toBe(1200);
    }
  });
});
