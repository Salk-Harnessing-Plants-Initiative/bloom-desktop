import { describe, it, expect, afterEach } from 'vitest';
import {
  backfillReason,
  impliedSowingDate,
  planBackfill,
  planWave,
} from '../../src/utils/sowing-date-backfill';
import { plantAgeDays } from '../../src/utils/sowing-date';

/** A scan taken on a local calendar day, at `hour`, with a typed age. */
const scan = (
  day: [number, number, number],
  age: number,
  { wave = 1, experiment = 'exp', hour = 10, plant = 'PLANT_001' } = {}
) => ({
  experiment_id: experiment,
  wave_number: wave,
  plant_id: plant,
  capture_date: new Date(day[0], day[1] - 1, day[2], hour),
  plant_age_days: age,
});
const times = <T>(n: number, make: () => T) => Array.from({ length: n }, make);

describe('impliedSowingDate', () => {
  it('is the local capture date minus the age, at any time of day', () => {
    expect(impliedSowingDate(scan([2026, 10, 23], 14))).toBe('2026-10-09');
    expect(impliedSowingDate(scan([2026, 10, 23], 14, { hour: 0 }))).toBe(
      '2026-10-09'
    );
    expect(impliedSowingDate(scan([2026, 10, 23], 14, { hour: 23 }))).toBe(
      '2026-10-09'
    );
  });

  it('crosses month and year ends', () => {
    expect(impliedSowingDate(scan([2026, 1, 3], 5))).toBe('2025-12-29');
    expect(impliedSowingDate(scan([2026, 3, 1], 9))).toBe('2026-02-20');
  });

  it('gives back the typed age with the start date as day 0', () => {
    const s = scan([2026, 11, 2], 9, { hour: 23 });
    expect(plantAgeDays(impliedSowingDate(s), s.capture_date)).toBe(9);
  });

  describe('where the UTC date differs from the local one', () => {
    const originalTz = process.env.TZ;
    afterEach(() => {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    });

    it('uses the local date, not the UTC one', (ctx) => {
      process.env.TZ = 'America/Los_Angeles';
      // Skip where the runtime can't switch time zones mid-process.
      if (new Date(2026, 0, 1).getTimezoneOffset() === 0) ctx.skip();
      // 23:30 on 23 Oct in Los Angeles is already 24 Oct in UTC.
      const capture = new Date('2026-10-24T06:30:00.000Z');
      expect(
        impliedSowingDate({ capture_date: capture, plant_age_days: 14 })
      ).toBe('2026-10-09');
    });
  });
});

describe('planWave', () => {
  it('sets the date all the scans agree on, across several timepoints', () => {
    const plan = planWave([
      ...times(50, () => scan([2026, 10, 18], 9)),
      ...times(50, () => scan([2026, 10, 21], 12)),
    ]);
    expect(plan).toMatchObject({
      sowingDate: '2026-10-09',
      agreeing: 100,
      scanCount: 100,
      disputed: false,
      mismatches: [],
      candidates: [{ date: '2026-10-09', count: 100 }],
    });
  });

  it('counts dates a day apart as agreeing', () => {
    const plan = planWave([
      ...times(80, () => scan([2026, 10, 23], 14)),
      ...times(20, () => scan([2026, 10, 23], 13)),
    ]);
    expect(plan.agreeing).toBe(100);
    expect(plan.disputed).toBe(false);
    expect(plan.mismatches).toEqual([]);
  });

  it('counts dates two days apart as disagreeing', () => {
    const plan = planWave([
      ...times(80, () => scan([2026, 10, 23], 14)),
      ...times(20, () => scan([2026, 10, 23], 12)),
    ]);
    expect(plan.agreeing).toBe(80);
    expect(plan.disputed).toBe(true);
  });

  it('still sets the most common date when the scans disagree, and marks the wave disputed', () => {
    const plan = planWave([
      ...times(60, () => scan([2026, 10, 24], 12)),
      ...times(40, () => scan([2026, 10, 27], 12)),
    ]);
    expect(plan.sowingDate).toBe('2026-10-12');
    expect(plan.disputed).toBe(true);
    expect(plan.candidates).toEqual([
      { date: '2026-10-12', count: 60 },
      { date: '2026-10-15', count: 40 },
    ]);
  });

  it('is not disputed at exactly 90%, and is at 89%', () => {
    const at = (agree: number) =>
      planWave([
        ...times(agree, () => scan([2026, 10, 23], 14)),
        ...times(100 - agree, () => scan([2026, 10, 23], 5)),
      ]).disputed;
    expect(at(90)).toBe(false);
    expect(at(89)).toBe(true);
  });

  it('breaks a tie towards the earlier date', () => {
    const plan = planWave([
      ...times(5, () => scan([2026, 10, 23], 14)),
      ...times(5, () => scan([2026, 10, 23], 4)),
    ]);
    expect(plan.sowingDate).toBe('2026-10-09');
  });

  it('lists scans whose typed age is more than a day off the wave date', () => {
    const plan = planWave([
      ...times(9, () => scan([2026, 10, 23], 14)),
      // An age carried over from another experiment (#407).
      scan([2026, 10, 23], 21, { plant: 'PLANT_031' }),
    ]);
    expect(plan.sowingDate).toBe('2026-10-09');
    expect(plan.mismatches).toEqual([
      {
        plant_id: 'PLANT_031',
        captured: '2026-10-23',
        typed_age: 21,
        age_from_date: 14,
      },
    ]);
  });
});

describe('planBackfill', () => {
  it('plans each experiment and wave separately, in order', () => {
    const plans = planBackfill([
      scan([2026, 10, 23], 14, { wave: 2, experiment: 'b' }),
      scan([2026, 10, 23], 14, { wave: 2, experiment: 'a' }),
      scan([2026, 10, 23], 20, { wave: 1, experiment: 'a' }),
    ]);
    expect(
      plans.map((p) => [p.experiment_id, p.wave_number, p.sowingDate])
    ).toEqual([
      ['a', 1, '2026-10-03'],
      ['a', 2, '2026-10-09'],
      ['b', 2, '2026-10-09'],
    ]);
  });
});

describe('backfillReason', () => {
  it('says how many scans agree, and names the other dates of a disputed wave', () => {
    const agreed = planWave(times(10, () => scan([2026, 10, 23], 14)));
    expect(backfillReason(agreed)).toMatch(
      /^Set from earlier scans \(capture date minus typed age\): 10 of 10 point to .+2026\.$/
    );
    const disputed = planWave([
      ...times(80, () => scan([2026, 10, 24], 12)),
      ...times(20, () => scan([2026, 10, 27], 12)),
    ]);
    expect(backfillReason(disputed)).toMatch(
      /: 80 of 100 point to .+; others point to .+ \(20 scans\)\.$/
    );
  });

  it('names at most three other dates', () => {
    const plan = planWave([
      ...times(10, () => scan([2026, 10, 23], 14)),
      ...[2, 4, 6, 8, 10].map((age) => scan([2026, 10, 23], age)),
    ]);
    expect(backfillReason(plan)).toMatch(/ and 2 more\.$/);
  });
});
