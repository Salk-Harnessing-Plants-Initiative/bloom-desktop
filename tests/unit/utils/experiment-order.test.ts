/**
 * Unit tests: the Experiments page's order — unscanned first, then most recent scan.
 */
import { describe, it, expect } from 'vitest';
import { orderByRecentScan } from '../../../src/renderer/utils/experiment-order';

const exp = (id: string, name: string) => ({ id, name });

describe('orderByRecentScan', () => {
  it('puts experiments with no scans first by name, then the most recently scanned', () => {
    const experiments = [
      exp('old', '2025-06-02 Soy drought'),
      exp('new', 'Zinnia-W1'),
      exp('recent', '2026-11-10 STL Soy'),
      exp('fresh', 'Alfalfa-W9'),
      exp('mid', '2026-10-02 KCS'),
    ];
    const latest = [
      { experiment_id: 'old', latest_ms: Date.UTC(2025, 5, 2) },
      { experiment_id: 'recent', latest_ms: Date.UTC(2026, 10, 20) },
      { experiment_id: 'mid', latest_ms: Date.UTC(2026, 9, 3) },
    ];
    expect(orderByRecentScan(experiments, latest).map((e) => e.id)).toEqual([
      'fresh',
      'new',
      'recent',
      'mid',
      'old',
    ]);
  });

  it('breaks a tie on scan time by name, and leaves the input as it was', () => {
    const experiments = [exp('b', 'Beta'), exp('a', 'Alpha')];
    const latest = [
      { experiment_id: 'a', latest_ms: 5 },
      { experiment_id: 'b', latest_ms: 5 },
    ];
    expect(orderByRecentScan(experiments, latest).map((e) => e.id)).toEqual([
      'a',
      'b',
    ]);
    expect(experiments.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('sorts by name when no scan times are known', () => {
    expect(
      orderByRecentScan([exp('b', 'Beta'), exp('a', 'Alpha')], []).map(
        (e) => e.id
      )
    ).toEqual(['a', 'b']);
  });
});
