import { describe, it, expect } from 'vitest';
import {
  agreesWithEarlierScans,
  impliedSowingDate,
  planBackfill,
  planWave,
} from '../../src/utils/sowing-date-backfill';

/** A scan taken on a local calendar day, at `hour`, with a typed age. */
const scan = (
  day: [number, number, number],
  age: number,
  wave = 1,
  experiment = 'exp',
  hour = 10
) => ({
  experiment_id: experiment,
  wave_number: wave,
  capture_date: new Date(day[0], day[1] - 1, day[2], hour),
  plant_age_days: age,
});

describe('impliedSowingDate', () => {
  it('is the local capture date minus the age, at any time of day', () => {
    expect(impliedSowingDate(scan([2026, 10, 23], 14))).toBe('2026-10-09');
    expect(impliedSowingDate(scan([2026, 10, 23], 14, 1, 'exp', 0))).toBe(
      '2026-10-09'
    );
    expect(impliedSowingDate(scan([2026, 10, 23], 14, 1, 'exp', 23))).toBe(
      '2026-10-09'
    );
  });

  it('crosses month and year ends', () => {
    expect(impliedSowingDate(scan([2026, 1, 3], 5))).toBe('2025-12-29');
    expect(impliedSowingDate(scan([2026, 3, 1], 9))).toBe('2026-02-20');
  });
});

describe('planWave', () => {
  it('sets the date when all scans agree, across several timepoints', () => {
    // Day 9 and day 12 scans of the same plants, sown 9 Oct.
    const scans = [
      ...Array.from({ length: 50 }, () => scan([2026, 10, 18], 9)),
      ...Array.from({ length: 50 }, () => scan([2026, 10, 21], 12)),
    ];
    const plan = planWave(scans);
    expect(plan.sowingDate).toBe('2026-10-09');
    expect(plan.agreeing).toBe(100);
    expect(plan.candidates).toEqual([{ date: '2026-10-09', count: 100 }]);
  });

  it('counts dates a day apart as agreeing', () => {
    const scans = [
      ...Array.from({ length: 80 }, () => scan([2026, 10, 23], 14)),
      ...Array.from({ length: 20 }, () => scan([2026, 10, 23], 13)),
    ];
    const plan = planWave(scans);
    expect(plan.sowingDate).toBe('2026-10-09');
    expect(plan.agreeing).toBe(100);
  });

  it('leaves a wave for the operator when fewer than 90% agree (#407: a carried-over age)', () => {
    // 80 day-12 scans, then 20 day-9 scans saved with age 12 by mistake.
    const scans = [
      ...Array.from({ length: 80 }, () => scan([2026, 8, 24], 12)),
      ...Array.from({ length: 20 }, () => scan([2026, 8, 27], 12)),
    ];
    const plan = planWave(scans);
    expect(plan.sowingDate).toBeNull();
    expect(plan.candidates).toEqual([
      { date: '2026-08-12', count: 80 },
      { date: '2026-08-15', count: 20 },
    ]);
  });

  it('sets the date when exactly 90% agree', () => {
    const scans = [
      ...Array.from({ length: 9 }, () => scan([2026, 10, 23], 14)),
      scan([2026, 10, 23], 4),
    ];
    expect(planWave(scans).sowingDate).toBe('2026-10-09');
  });

  it('breaks a tie between dates by the earlier date', () => {
    const scans = [scan([2026, 10, 23], 14), scan([2026, 10, 23], 4)];
    expect(planWave(scans).candidates[0].date).toBe('2026-10-09');
    expect(planWave(scans).sowingDate).toBeNull();
  });
});

describe('planBackfill', () => {
  it('plans each experiment and wave separately, in order', () => {
    const plans = planBackfill([
      scan([2026, 10, 23], 14, 2, 'exp-B'),
      scan([2026, 10, 23], 14, 1, 'exp-A'),
      scan([2026, 10, 23], 2, 2, 'exp-A'),
    ]);
    expect(
      plans.map((p) => [p.experiment_id, p.wave_number, p.sowingDate])
    ).toEqual([
      ['exp-A', 1, '2026-10-09'],
      ['exp-A', 2, '2026-10-21'],
      ['exp-B', 2, '2026-10-09'],
    ]);
  });

  it('has nothing to plan without scans', () => {
    expect(planBackfill([])).toEqual([]);
  });
});

describe('agreesWithEarlierScans', () => {
  const plan = {
    candidates: [
      { date: '2026-10-09', count: 80 },
      { date: '2026-10-12', count: 20 },
    ],
  };

  it('accepts the most common date or a day either side', () => {
    for (const date of ['2026-10-08', '2026-10-09', '2026-10-10']) {
      expect(agreesWithEarlierScans(date, plan)).toBe(true);
    }
  });

  it('flags a date further away, even a less common candidate', () => {
    expect(agreesWithEarlierScans('2026-10-12', plan)).toBe(false);
    expect(agreesWithEarlierScans('2026-10-19', plan)).toBe(false);
  });

  it('accepts anything when there are no earlier scans', () => {
    expect(agreesWithEarlierScans('2026-10-19', { candidates: [] })).toBe(true);
  });
});
