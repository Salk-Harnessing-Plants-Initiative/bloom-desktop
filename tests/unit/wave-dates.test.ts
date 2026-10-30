import { describe, it, expect, afterEach } from 'vitest';
import {
  checkNewWave,
  checkWaveDateChange,
  formatDays,
  isIsoDate,
  plantAgeDays,
  germDay,
  germinationDateError,
  waveDatesError,
  toIsoDate,
} from '../../src/utils/wave-dates';

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

describe('germDay', () => {
  it('is the calendar days from sowing to germination', () => {
    expect(
      germDay({ sowing_date: '2026-10-01', germination_date: '2026-10-04' })
    ).toBe(3);
    // Across a month end.
    expect(
      germDay({ sowing_date: '2026-09-29', germination_date: '2026-10-02' })
    ).toBe(3);
  });

  it('is 0, as always sent before, without both dates', () => {
    expect(germDay({ sowing_date: null, germination_date: '2026-10-04' })).toBe(
      0
    );
    expect(germDay({ sowing_date: '2026-10-01', germination_date: null })).toBe(
      0
    );
    expect(
      germDay({ sowing_date: 'not a date', germination_date: '2026-10-04' })
    ).toBe(0);
  });

  it('is never negative', () => {
    expect(
      germDay({ sowing_date: '2026-10-05', germination_date: '2026-10-04' })
    ).toBe(0);
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

describe('germinationDateError', () => {
  it('refuses a missing or future date and accepts today', () => {
    expect(germinationDateError('', today)).toBe('Enter the germination date.');
    expect(germinationDateError('2026-03-11', today)).toMatch(/future/);
    expect(germinationDateError('2026-03-10', today)).toBeNull();
  });
});

/** A wave's dates: sown well before, transferred the germination day. */
const dates = (germination: string, sowing = '2025-11-01') => ({
  germination,
  sowing,
  transfer: '',
});

describe('waveDatesError', () => {
  const ok = { germination: '2026-02-20', sowing: '2026-02-17', transfer: '' };

  it('accepts germination and sowing dates, transferred the same day or later', () => {
    expect(waveDatesError(ok, today)).toBeNull();
    expect(waveDatesError({ ...ok, transfer: '2026-02-22' }, today)).toBeNull();
  });

  it('needs the germination and sowing dates', () => {
    expect(waveDatesError({ ...ok, germination: '' }, today)).toBe(
      'Enter the germination date.'
    );
    expect(waveDatesError({ ...ok, sowing: '' }, today)).toBe(
      'Enter the sowing date.'
    );
  });

  it('refuses a sowing date after germination, or in the future', () => {
    expect(waveDatesError({ ...ok, sowing: '2026-02-21' }, today)).toBe(
      'The sowing date must be before the germination date.'
    );
    expect(
      waveDatesError(
        { germination: '2026-04-02', sowing: '2026-04-01', transfer: '' },
        today
      )
    ).toBe("The germination date can't be in the future.");
  });

  it('needs sowing strictly before germination: the same day is refused', () => {
    expect(waveDatesError({ ...ok, sowing: '2026-02-20' }, today)).toBe(
      'The sowing date must be before the germination date.'
    );
  });

  it('needs the transfer on or after germination', () => {
    expect(waveDatesError({ ...ok, transfer: '2026-02-20' }, today)).toBeNull();
    expect(
      waveDatesError(
        {
          germination: '2026-02-20',
          sowing: '2026-02-17',
          transfer: '2026-02-17',
        },
        today
      )
    ).toBe("The transfer date can't be before the germination date.");
  });

  it('refuses a transfer date before germination, in the future, or not a date', () => {
    expect(waveDatesError({ ...ok, transfer: '2026-02-10' }, today)).toBe(
      "The transfer date can't be before the germination date."
    );
    expect(waveDatesError({ ...ok, transfer: '2026-04-01' }, today)).toBe(
      "The transfer date can't be in the future."
    );
    expect(waveDatesError({ ...ok, transfer: 'soon' }, today)).toBe(
      'Enter the transfer date, or tick "Same as germination date".'
    );
  });
});

describe('checkNewWave', () => {
  const wave1 = { wave_number: 1, germination_date: '2025-11-26' };

  it('accepts the next wave sown after the earlier one', () => {
    expect(checkNewWave(2, dates('2026-02-20'), [wave1], today)).toEqual({
      error: null,
      dateWarning: null,
      waveWarning: null,
      noteNeeded: null,
    });
  });

  it('asks "Are you sure" and needs a note for a wave sown on or before an earlier wave', () => {
    for (const date of ['2025-11-26', '2025-11-20']) {
      const check = checkNewWave(2, dates(date), [wave1], today);
      expect(check.dateWarning).toEqual({
        question: "Are you sure about wave 2's dates?",
        detail: expect.stringMatching(
          /^Its germination date is on or before wave 1's \(.+\)\.$/
        ),
        conflicts: [
          {
            field: 'germination',
            waveNumber: 1,
            date: '2025-11-26',
            when: 'on or before',
          },
        ],
      });
      expect(check.noteNeeded).toMatch(
        /^Are you sure about wave 2's dates\? Its germination date is on or before .+ Add a note to proceed\.$/
      );
    }
  });

  it('needs a note for an earlier wave sown on or after a later one', () => {
    const wave3 = { wave_number: 3, germination_date: '2026-01-10' };
    expect(
      checkNewWave(2, dates('2026-01-15'), [wave1, wave3], today).dateWarning
        ?.detail
    ).toMatch(/^Its germination date is on or after wave 3's/);
  });

  it('checks the sowing date too: a later wave is sown after an earlier one', () => {
    const sown = { ...wave1, sowing_date: '2025-11-01' };
    // Germinates after wave 1, but sown the same day as it.
    const check = checkNewWave(
      2,
      dates('2026-02-20', '2025-11-01'),
      [sown],
      today
    );
    expect(check.dateWarning?.conflicts).toEqual([
      {
        field: 'sowing',
        waveNumber: 1,
        date: '2025-11-01',
        when: 'on or before',
      },
    ]);
    expect(check.dateWarning?.detail).toMatch(
      /^Its sowing date is on or before wave 1's \(.+\)\.$/
    );
    // Sown and germinated before wave 1: both are listed.
    expect(
      checkNewWave(
        2,
        dates('2025-11-20', '2025-10-20'),
        [sown],
        today
      ).dateWarning?.conflicts?.map((c) => c.field)
    ).toEqual(['sowing', 'germination']);
    // Sown after wave 1: no warning.
    expect(
      checkNewWave(2, dates('2026-02-20', '2025-12-01'), [sown], today)
        .dateWarning
    ).toBeNull();
  });

  it('says which waves were skipped, and needs a note, for a wave number that skips ahead', () => {
    const check = checkNewWave(5, dates('2026-02-20'), [wave1], today);
    expect(check.waveWarning).toEqual({
      question: 'Waves 2–4 were skipped',
      detail: 'The latest wave in this experiment is wave 1.',
      skipped: 'waves 2–4',
    });
    expect(
      checkNewWave(3, dates('2026-02-20'), [wave1], today).waveWarning
    ).toMatchObject({ question: 'Wave 2 was skipped', skipped: 'wave 2' });
    expect(check.noteNeeded).toMatch(/Add a note to proceed\.$/);
    expect(checkNewWave(3, dates('2026-02-20'), [], today).waveWarning).toEqual(
      {
        question: 'Waves 1–2 were skipped',
        detail: 'This experiment has no waves yet.',
        skipped: 'waves 1–2',
      }
    );
    for (const first of [0, 1]) {
      const firstCheck = checkNewWave(first, dates('2026-02-20'), [], today);
      expect(firstCheck.waveWarning).toBeNull();
      expect(firstCheck.noteNeeded).toBeNull();
    }
  });

  it('reports a future date as an error before anything else', () => {
    const check = checkNewWave(5, dates('2026-04-01'), [wave1], today);
    expect(check.error).toMatch(/future/);
    expect(check.noteNeeded).toBeNull();
  });
});

describe('checkWaveDateChange', () => {
  const current = {
    germination: '2026-03-01',
    sowing: '2026-01-01',
    transfer: '',
  };
  const change = (germination: string, reason = '', waveHasScans = false) => ({
    waveNumber: 2,
    current,
    next: { ...current, germination },
    reason,
    waveHasScans,
  });
  const wave1 = { wave_number: 1, germination_date: '2026-02-20' };

  it('allows a change before the first scan, with no reason, and none after it', () => {
    expect(checkWaveDateChange(change('2026-03-02'), [wave1], today)).toEqual({
      error: null,
      conflict: null,
      reasonNeeded: false,
      saveError: null,
    });
    // Once the wave has scans its dates are final, whatever the reason.
    const scanned = checkWaveDateChange(
      change('2026-03-02', 'Typo: sown on the 2nd', true),
      [wave1],
      today
    );
    expect(scanned.error).toBe(
      "Wave 2 already has scans, so its dates can't be changed."
    );
    expect(scanned.saveError).toBe(scanned.error);
  });

  it('asks for a reason, not a note, when the date conflicts with another wave', () => {
    const check = checkWaveDateChange(change('2026-02-19'), [wave1], today);
    expect(check.conflict?.question).toBe("Are you sure about wave 2's dates?");
    expect(check.reasonNeeded).toBe(true);
    expect(check.saveError).toMatch(
      /^Are you sure about wave 2's dates\? Its germination date is on or before wave 1's \(.+\)\. Give a reason for the change\.$/
    );
  });

  it('refuses the same date, a future date and an over-long reason', () => {
    expect(checkWaveDateChange(change('2026-03-01'), [], today).error).toBe(
      "Those are already the wave's dates."
    );
    expect(
      checkWaveDateChange(change('2026-04-01', 'x'), [], today).saveError
    ).toMatch(/future/);
    expect(
      checkWaveDateChange(change('2026-03-02', 'x'.repeat(501)), [], today)
        .saveError
    ).toMatch(/under 500/);
  });
});

describe('checkWaveDateChange: sowing and transfer', () => {
  const current = {
    germination: '2026-03-01',
    sowing: '2026-02-25',
    transfer: '',
  };
  const change = (next: typeof current) => ({
    waveNumber: 2,
    current,
    next,
    reason: '',
    waveHasScans: false,
  });

  it("checks only the dates a change touches against the other waves'", () => {
    const wave1 = { wave_number: 1, germination_date: '2026-03-05' };
    // Wave 1 germinated after wave 2, but only a new germination date is checked against it.
    const sowing = checkWaveDateChange(
      change({ ...current, sowing: '2026-02-26' }),
      [wave1],
      today
    );
    expect(sowing).toMatchObject({ error: null, conflict: null });
    expect(
      checkWaveDateChange(
        change({ ...current, transfer: '2026-03-02' }),
        [wave1],
        today
      ).saveError
    ).toBeNull();
  });

  it('checks the new dates together', () => {
    expect(
      checkWaveDateChange(
        change({ ...current, sowing: '2026-03-02' }),
        [],
        today
      ).error
    ).toBe('The sowing date must be before the germination date.');
  });
});

describe('formatDays', () => {
  it('uses the singular for one day', () => {
    expect(formatDays(0)).toBe('0 days');
    expect(formatDays(1)).toBe('1 day');
    expect(formatDays(9)).toBe('9 days');
  });
});
