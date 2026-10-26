import { describe, it, expect, afterEach } from 'vitest';
import {
  checkNewWave,
  checkSowingDateChange,
  formatDays,
  isIsoDate,
  plantAgeChangeError,
  plantAgeDays,
  sowingDateError,
  toIsoDate,
} from '../../src/utils/sowing-date';

const today = new Date(2026, 2, 10, 15, 30); // 10 Mar 2026, mid-afternoon

describe('dates', () => {
  it('accepts only real YYYY-MM-DD calendar dates', () => {
    expect(isIsoDate('2026-03-01')).toBe(true);
    for (const bad of [
      '2026-02-30',
      '2026-3-1',
      '01/03/2026',
      '',
      null,
      20260301,
    ]) {
      expect(isIsoDate(bad)).toBe(false);
    }
  });

  it('formats a local date', () => {
    expect(toIsoDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('plantAgeDays', () => {
  it('counts calendar days from sowing, whatever the time of day', () => {
    expect(plantAgeDays('2026-03-01', today)).toBe(9);
    expect(plantAgeDays('2026-03-10', new Date(2026, 2, 10, 0, 1))).toBe(0);
    expect(plantAgeDays('2025-11-26', new Date(2026, 2, 1, 10))).toBe(95);
  });

  it('is negative before sowing', () => {
    expect(plantAgeDays('2026-03-11', today)).toBe(-1);
  });

  describe('across a daylight-saving change', () => {
    const originalTz = process.env.TZ;
    afterEach(() => {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    });

    it('still counts whole days (a 23- or 25-hour day is one day)', (ctx) => {
      process.env.TZ = 'America/Los_Angeles';
      // Skip where the runtime can't switch time zones mid-process.
      if (
        new Date(2026, 0, 1).getTimezoneOffset() ===
        new Date(2026, 6, 1).getTimezoneOffset()
      ) {
        ctx.skip();
      }
      // Clocks go forward on 8 Mar 2026: 1 to 10 Mar is 9 days less an hour.
      expect(plantAgeDays('2026-03-01', new Date(2026, 2, 10, 0, 30))).toBe(9);
      // Clocks go back on 1 Nov 2026: 31 Oct to 2 Nov is 2 days and an hour.
      expect(plantAgeDays('2026-10-31', new Date(2026, 10, 2, 23, 30))).toBe(2);
    });
  });
});

describe('sowingDateError', () => {
  it('refuses a missing or future date and accepts today', () => {
    expect(sowingDateError('', today)).toBe('Enter the start date.');
    expect(sowingDateError('2026-03-11', today)).toMatch(/future/);
    expect(sowingDateError('2026-03-10', today)).toBeNull();
  });
});

describe('checkNewWave', () => {
  const wave1 = { wave_number: 1, sowing_date: '2025-11-26' };

  it('accepts the next wave sown after the earlier one', () => {
    expect(checkNewWave(2, '2026-02-20', [wave1], today)).toEqual({
      error: null,
      dateWarning: null,
      waveWarning: null,
      noteNeeded: null,
    });
  });

  it('asks "Are you sure" and needs a note for a wave sown on or before an earlier wave', () => {
    for (const date of ['2025-11-26', '2025-11-20']) {
      const check = checkNewWave(2, date, [wave1], today);
      expect(check.dateWarning).toEqual({
        question: "Are you sure wave 2's start date is correct?",
        detail: expect.stringMatching(
          /^It is on or before wave 1's start date \(.+\)\.$/
        ),
      });
      expect(check.noteNeeded).toMatch(
        /^Are you sure wave 2's start date is correct\? It is on or before .+ Add a note to proceed\.$/
      );
    }
  });

  it('needs a note for an earlier wave sown on or after a later one', () => {
    const wave3 = { wave_number: 3, sowing_date: '2026-01-10' };
    expect(
      checkNewWave(2, '2026-01-15', [wave1, wave3], today).dateWarning?.detail
    ).toMatch(/^It is on or after wave 3's start date/);
  });

  it('asks "Is the wave number correct?" and needs a note for a wave number that skips ahead', () => {
    const check = checkNewWave(5, '2026-02-20', [wave1], today);
    expect(check.waveWarning).toEqual({
      question: 'Is the wave number correct?',
      detail: 'Previous wave: wave 1.',
      confirm: 'Are you sure you want to scan wave 5?',
    });
    expect(check.noteNeeded).toMatch(/Add a note to proceed\.$/);
    expect(checkNewWave(3, '2026-02-20', [], today).waveWarning).toEqual({
      question: 'Is the wave number correct?',
      detail: "This is the experiment's first wave.",
      confirm: 'Are you sure you want to scan wave 3?',
    });
    for (const first of [0, 1]) {
      const firstCheck = checkNewWave(first, '2026-02-20', [], today);
      expect(firstCheck.waveWarning).toBeNull();
      expect(firstCheck.noteNeeded).toBeNull();
    }
  });

  it('reports a future date as an error before anything else', () => {
    const check = checkNewWave(5, '2026-04-01', [wave1], today);
    expect(check.error).toMatch(/future/);
    expect(check.noteNeeded).toBeNull();
  });
});

describe('checkSowingDateChange', () => {
  const change = (newDate: string, reason = '', waveHasScans = false) => ({
    waveNumber: 2,
    currentDate: '2026-03-01',
    newDate,
    reason,
    waveHasScans,
  });
  const wave1 = { wave_number: 1, sowing_date: '2026-02-20' };

  it('needs no reason before the first scan, and one after it', () => {
    expect(checkSowingDateChange(change('2026-03-02'), [wave1], today)).toEqual(
      {
        error: null,
        conflict: null,
        reasonNeeded: false,
        saveError: null,
      }
    );
    const scanned = checkSowingDateChange(
      change('2026-03-02', '  ', true),
      [wave1],
      today
    );
    expect(scanned.reasonNeeded).toBe(true);
    expect(scanned.saveError).toMatch(/give a reason/);
    expect(
      checkSowingDateChange(
        change('2026-03-02', 'Typo: sown on the 2nd', true),
        [wave1],
        today
      ).saveError
    ).toBeNull();
  });

  it('asks for a reason, not a note, when the date conflicts with another wave', () => {
    const check = checkSowingDateChange(change('2026-02-19'), [wave1], today);
    expect(check.conflict?.question).toBe(
      "Are you sure wave 2's start date is correct?"
    );
    expect(check.reasonNeeded).toBe(true);
    expect(check.saveError).toMatch(
      /^Are you sure wave 2's start date is correct\? It is on or before wave 1's start date \(.+\)\. Give a reason for the change\.$/
    );
  });

  it('refuses the same date, a future date and an over-long reason', () => {
    expect(checkSowingDateChange(change('2026-03-01'), [], today).error).toBe(
      'That is already the start date.'
    );
    expect(
      checkSowingDateChange(change('2026-04-01', 'x', true), [], today)
        .saveError
    ).toMatch(/future/);
    expect(
      checkSowingDateChange(
        change('2026-03-02', 'x'.repeat(501), true),
        [],
        today
      ).saveError
    ).toMatch(/under 500/);
  });
});

describe('plantAgeChangeError', () => {
  it('accepts the calculated age, and a changed age with a reason', () => {
    expect(
      plantAgeChangeError({ plant_age_days: 9, calculated_plant_age_days: 9 })
    ).toBeNull();
    expect(
      plantAgeChangeError({
        plant_age_days: 8,
        calculated_plant_age_days: 9,
        plant_age_change_reason: 'Sown a day later',
      })
    ).toBeNull();
    // Scans without a sowing date (e.g. older callers) have nothing to check.
    expect(plantAgeChangeError({ plant_age_days: 9 })).toBeNull();
  });

  it('refuses a changed age without a reason, and a reason without a change', () => {
    expect(
      plantAgeChangeError({
        plant_age_days: 8,
        calculated_plant_age_days: 9,
        plant_age_change_reason: ' ',
      })
    ).toBe('A changed plant age needs a reason.');
    expect(
      plantAgeChangeError({
        plant_age_days: 9,
        calculated_plant_age_days: 9,
        plant_age_change_reason: 'Sown a day later',
      })
    ).toBe("A reason was given, but the age wasn't changed.");
    expect(
      plantAgeChangeError({
        plant_age_days: 9,
        plant_age_change_reason: 'Sown a day later',
      })
    ).toMatch(/without a calculated age/);
  });

  it('refuses an over-long reason', () => {
    expect(
      plantAgeChangeError({
        plant_age_days: 8,
        calculated_plant_age_days: 9,
        plant_age_change_reason: 'x'.repeat(501),
      })
    ).toMatch(/under 500/);
  });
});

describe('formatDays', () => {
  it('uses the singular for one day', () => {
    expect(formatDays(0)).toBe('0 days');
    expect(formatDays(1)).toBe('1 day');
    expect(formatDays(9)).toBe('9 days');
  });
});
