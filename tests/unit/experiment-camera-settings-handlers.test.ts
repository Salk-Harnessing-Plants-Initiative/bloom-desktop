import { describe, it, expect, vi } from 'vitest';
import {
  confirmSettings,
  getStatus,
  listHistory,
  listReference,
  registerExperimentCameraSettingsHandlers,
  type CameraSettingsDbLike,
  type SettingsRow,
} from '../../src/main/experiment-camera-settings-handlers';
import {
  NOTE_REQUIRED,
  SETTINGS_CHANGED_MEANWHILE,
} from '../../src/utils/experiment-camera-settings';

const ANA = 'ph-ana';
const BEN = 'ph-ben';
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 10, day, hour, minute);

const row = (
  id: string,
  exposure_time: number,
  createdAt: Date,
  extra: Partial<SettingsRow> = {}
): SettingsRow => ({
  id,
  experiment_id: 'kcs',
  exposure_time,
  gain: 250,
  gamma: 1,
  note: 'Initial settings',
  set_by_phenotyper_id: ANA,
  createdAt,
  last_confirmed_at: null,
  last_confirmed_by_phenotyper_id: null,
  ...extra,
});

interface FakeScan {
  experiment_id: string;
  exposure_time: number;
  gain: number;
  gamma: number;
  capture_date: Date;
  deleted: boolean;
  image: string;
}

/** Enough of Prisma for these handlers, keeping rows in memory. */
function fakeDb(rows: SettingsRow[], scans: FakeScan[] = []) {
  let nextId = 1;
  const settings = {
    findMany: vi.fn(
      async (args: { where: { experiment_id: string }; take?: number }) =>
        rows
          .filter((r) => r.experiment_id === args.where.experiment_id)
          .sort(
            (a, b) =>
              b.createdAt.getTime() - a.createdAt.getTime() ||
              b.id.localeCompare(a.id)
          )
          .slice(0, args.take ?? rows.length)
          .map((r) => ({ ...r }))
    ),
    create: vi.fn(
      async (args: { data: Omit<SettingsRow, 'id' | 'createdAt'> }) => {
        const created: SettingsRow = {
          id: `new-${nextId++}`,
          createdAt: args.data.last_confirmed_at ?? new Date(),
          ...args.data,
        };
        rows.push(created);
        return created;
      }
    ),
    update: vi.fn(
      async (args: {
        where: { id: string };
        data: Pick<
          SettingsRow,
          'last_confirmed_at' | 'last_confirmed_by_phenotyper_id'
        >;
      }) => {
        const found = rows.find((r) => r.id === args.where.id)!;
        Object.assign(found, args.data);
        return found;
      }
    ),
  };
  const live = (experimentId: string) =>
    scans.filter(
      (s) =>
        s.experiment_id === experimentId && !s.deleted && s.exposure_time > 0
    );
  const db = {
    experiment: {
      findUnique: vi.fn(async (args: { where: { id: string } }) =>
        ['kcs', 'new'].includes(args.where.id) ? { id: args.where.id } : null
      ),
    },
    phenotyper: {
      findMany: vi.fn(async (args: { where: { id: { in: string[] } } }) =>
        [
          { id: ANA, name: 'Ana' },
          { id: BEN, name: 'Ben' },
        ].filter((p) => args.where.id.in.includes(p.id))
      ),
    },
    scan: {
      groupBy: vi.fn(async (args: { where: { experiment_id: string } }) => {
        const groups = new Map<string, FakeScan[]>();
        for (const s of live(args.where.experiment_id)) {
          const key = `${s.exposure_time}/${s.gain}/${s.gamma}`;
          groups.set(key, [...(groups.get(key) ?? []), s]);
        }
        return [...groups.values()].map((g) => ({
          exposure_time: g[0].exposure_time,
          gain: g[0].gain,
          gamma: g[0].gamma,
          _count: { _all: g.length },
          _min: {
            capture_date: new Date(Math.min(...g.map((s) => +s.capture_date))),
          },
          _max: {
            capture_date: new Date(Math.max(...g.map((s) => +s.capture_date))),
          },
        }));
      }),
      findFirst: vi.fn(
        async (args: {
          where: {
            experiment_id: string;
            exposure_time: number;
            gain: number;
            gamma: number;
          };
        }) => {
          const latest = live(args.where.experiment_id)
            .filter(
              (s) =>
                s.exposure_time === args.where.exposure_time &&
                s.gain === args.where.gain &&
                s.gamma === args.where.gamma
            )
            .sort((a, b) => +b.capture_date - +a.capture_date)[0];
          return latest ? { images: [{ path: latest.image }] } : null;
        }
      ),
    },
    experimentCameraSettings: settings,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ experimentCameraSettings: settings })
    ),
  };
  return { db: db as unknown as CameraSettingsDbLike, raw: db, rows };
}

describe('getStatus', () => {
  it('has no current settings for a new experiment', async () => {
    const { db } = fakeDb([]);
    const result = await getStatus({ db, now: () => at(4, 9) }, 'kcs', ANA);
    expect(result).toEqual({
      success: true,
      data: { current: null, confirmedToday: false, changedToday: null },
    });
  });

  it('uses the newest row as the current settings', async () => {
    const { db } = fakeDb([
      row('r1', 8800, at(3, 9)),
      row('r2', 7400, at(3, 14), { note: 'Roots too dark' }),
    ]);
    const result = await getStatus({ db, now: () => at(4, 9) }, 'kcs', ANA);
    expect(result.data?.current).toMatchObject({
      id: 'r2',
      exposure_time: 7400,
      note: 'Roots too dark',
      set_by_name: 'Ana',
    });
  });

  it('counts as confirmed when this phenotyper checked them today', async () => {
    const { db } = fakeDb([
      row('r1', 7400, at(1, 9), {
        last_confirmed_at: at(4, 9, 12),
        last_confirmed_by_phenotyper_id: ANA,
      }),
    ]);
    const result = await getStatus({ db, now: () => at(4, 15) }, 'kcs', ANA);
    expect(result.data?.confirmedToday).toBe(true);
    expect(result.data?.current?.last_confirmed_by_name).toBe('Ana');
  });

  it('asks again on a new day, even just after midnight', async () => {
    const { db } = fakeDb([
      row('r1', 7400, at(1, 9), {
        last_confirmed_at: at(3, 23, 30),
        last_confirmed_by_phenotyper_id: ANA,
      }),
    ]);
    const result = await getStatus({ db, now: () => at(4, 0, 10) }, 'kcs', ANA);
    expect(result.data?.confirmedToday).toBe(false);
  });

  it('asks a different phenotyper on the same day', async () => {
    const { db } = fakeDb([
      row('r1', 7400, at(1, 9), {
        last_confirmed_at: at(4, 9, 12),
        last_confirmed_by_phenotyper_id: ANA,
      }),
    ]);
    const result = await getStatus({ db, now: () => at(4, 13) }, 'kcs', BEN);
    expect(result.data?.confirmedToday).toBe(false);
  });

  it('is not confirmed without a phenotyper', async () => {
    const { db } = fakeDb([
      row('r1', 7400, at(1, 9), {
        last_confirmed_at: at(4, 9),
        last_confirmed_by_phenotyper_id: ANA,
      }),
    ]);
    const result = await getStatus({ db, now: () => at(4, 13) }, 'kcs', '');
    expect(result.data?.confirmedToday).toBe(false);
  });

  it('says who changed the settings today, from what, when it was someone else', async () => {
    const { db } = fakeDb([
      row('r1', 7300, at(1, 9)),
      row('r2', 7400, at(4, 10, 15), {
        note: 'Roots too dark',
        last_confirmed_at: at(4, 10, 15),
        last_confirmed_by_phenotyper_id: ANA,
      }),
    ]);
    const result = await getStatus({ db, now: () => at(4, 13) }, 'kcs', BEN);
    expect(result.data?.changedToday).toEqual({
      by_name: 'Ana',
      at: at(4, 10, 15).toISOString(),
      from: { exposure_time: 7300, gain: 250, gamma: 1 },
      to: { exposure_time: 7400, gain: 250, gamma: 1 },
      note: 'Roots too dark',
    });
  });

  it("doesn't report your own change, or one from another day", async () => {
    const { db } = fakeDb([row('r1', 7400, at(4, 10, 15))]);
    expect(
      (await getStatus({ db, now: () => at(4, 13) }, 'kcs', ANA)).data
        ?.changedToday
    ).toBeNull();
    expect(
      (await getStatus({ db, now: () => at(5, 9) }, 'kcs', BEN)).data
        ?.changedToday
    ).toBeNull();
  });

  it("doesn't report the rows copied from scans at install as a change", async () => {
    const { db } = fakeDb([
      row('r1', 7400, at(4, 8), {
        set_by_phenotyper_id: null,
        note: 'Copied from latest scan (2026-10-20)',
      }),
    ]);
    const result = await getStatus({ db, now: () => at(4, 9) }, 'kcs', BEN);
    expect(result.data?.changedToday).toBeNull();
    expect(result.data?.current?.set_by_name).toBe('admin');
  });

  it('rejects a missing experiment id', async () => {
    const { db } = fakeDb([]);
    expect((await getStatus({ db }, ' ', ANA)).success).toBe(false);
  });

  it('returns a database error instead of throwing', async () => {
    const { db, raw } = fakeDb([]);
    raw.experimentCameraSettings.findMany.mockRejectedValueOnce(
      new Error('locked')
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await getStatus({ db }, 'kcs', ANA)).toEqual({
      success: false,
      error: 'locked',
    });
  });
});

describe('confirmSettings', () => {
  const now = () => at(4, 9, 12);
  const input = {
    experimentId: 'kcs',
    phenotyperId: ANA,
    exposure_time: 7400,
    gain: 250,
    gamma: 1,
    currentSettingsId: 'r1' as string | null,
  };

  it('updates only the last check when the values are unchanged', async () => {
    const { db, raw, rows } = fakeDb([
      row('r1', 7400, at(1, 9), { note: 'Roots too dark' }),
    ]);
    const result = await confirmSettings(
      { db, now },
      { ...input, phenotyperId: BEN }
    );
    expect(result.success).toBe(true);
    expect(raw.experimentCameraSettings.create).not.toHaveBeenCalled();
    expect(raw.experimentCameraSettings.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { last_confirmed_at: now(), last_confirmed_by_phenotyper_id: BEN },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      exposure_time: 7400,
      note: 'Roots too dark',
    });
    expect(result.data?.confirmedToday).toBe(true);
  });

  it('needs no note to confirm unchanged values', async () => {
    const { db } = fakeDb([row('r1', 7400, at(1, 9))]);
    expect(
      (await confirmSettings({ db, now }, { ...input, note: '' })).success
    ).toBe(true);
  });

  it('adds a checked row with the note when the values change', async () => {
    const { db, rows } = fakeDb([row('r1', 7300, at(1, 9))]);
    const result = await confirmSettings(
      { db, now },
      { ...input, note: '  Roots too dark  ' }
    );
    expect(result.success).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      exposure_time: 7400,
      note: 'Roots too dark',
      set_by_phenotyper_id: ANA,
      last_confirmed_at: now(),
      last_confirmed_by_phenotyper_id: ANA,
    });
    expect(rows[0].exposure_time).toBe(7300);
    expect(result.data?.current?.exposure_time).toBe(7400);
    expect(result.data?.confirmedToday).toBe(true);
  });

  it('rejects a change without a note', async () => {
    const { db, rows } = fakeDb([row('r1', 7300, at(1, 9))]);
    for (const note of [undefined, '', '   ']) {
      expect(await confirmSettings({ db, now }, { ...input, note })).toEqual({
        success: false,
        error: NOTE_REQUIRED,
      });
    }
    expect(rows).toHaveLength(1);
  });

  it("saves an experiment's first settings without a note as Initial settings", async () => {
    const { db, rows } = fakeDb([]);
    const result = await confirmSettings(
      { db, now },
      { ...input, currentSettingsId: null, exposure_time: 10000, gain: 100 }
    );
    expect(result.success).toBe(true);
    expect(rows[0]).toMatchObject({
      exposure_time: 10000,
      gain: 100,
      note: 'Initial settings',
      last_confirmed_by_phenotyper_id: ANA,
    });
  });

  it('refuses when the settings changed after the panel opened', async () => {
    const { db, rows } = fakeDb([
      row('r1', 7400, at(1, 9)),
      row('r2', 7300, at(4, 9)),
    ]);
    expect(
      await confirmSettings({ db, now }, { ...input, currentSettingsId: 'r1' })
    ).toEqual({ success: false, error: SETTINGS_CHANGED_MEANWHILE });
    expect(rows).toHaveLength(2);
    expect(rows[0].last_confirmed_at).toBeNull();
  });

  it('refuses first settings when someone else saved them meanwhile', async () => {
    const { db } = fakeDb([row('r1', 7400, at(4, 9))]);
    expect(
      await confirmSettings({ db, now }, { ...input, currentSettingsId: null })
    ).toEqual({ success: false, error: SETTINGS_CHANGED_MEANWHILE });
  });

  it('rejects out-of-range values without writing', async () => {
    const { db, raw } = fakeDb([row('r1', 7400, at(1, 9))]);
    const result = await confirmSettings(
      { db, now },
      { ...input, gain: 600, note: 'x' }
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Gain/);
    expect(raw.$transaction).not.toHaveBeenCalled();
  });

  it('needs a phenotyper that exists', async () => {
    const { db } = fakeDb([row('r1', 7400, at(1, 9))]);
    expect(
      (await confirmSettings({ db, now }, { ...input, phenotyperId: '' })).error
    ).toBe('Choose the phenotyper first.');
    expect(
      (await confirmSettings({ db, now }, { ...input, phenotyperId: 'gone' }))
        .error
    ).toBe('That phenotyper no longer exists.');
  });

  it('needs an experiment that exists', async () => {
    const { db } = fakeDb([]);
    expect(
      (await confirmSettings({ db, now }, { ...input, experimentId: 'gone' }))
        .error
    ).toBe('That experiment no longer exists.');
  });

  it('rejects a note that is too long', async () => {
    const { db } = fakeDb([row('r1', 7300, at(1, 9))]);
    const result = await confirmSettings(
      { db, now },
      { ...input, note: 'x'.repeat(2000) }
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Keep the note under/);
  });
});

describe('listHistory', () => {
  it('lists every saved setting newest first, with who set and checked it', async () => {
    const { db } = fakeDb([
      row('r1', 7000, at(1, 9), { set_by_phenotyper_id: null }),
      row('r2', 7400, at(3, 10), {
        set_by_phenotyper_id: BEN,
        last_confirmed_at: at(4, 9),
        last_confirmed_by_phenotyper_id: ANA,
      }),
    ]);
    const result = await listHistory({ db }, 'kcs');
    expect(
      result.data?.map((r) => [r.id, r.set_by_name, r.last_confirmed_by_name])
    ).toEqual([
      ['r2', 'Ben', 'Ana'],
      ['r1', 'admin', null],
    ]);
  });
});

describe('listReference', () => {
  const scan = (
    exposure_time: number,
    day: number,
    extra: Partial<FakeScan> = {}
  ): FakeScan => ({
    experiment_id: 'kcs',
    exposure_time,
    gain: 250,
    gamma: 1,
    capture_date: at(day, 10),
    deleted: false,
    image: `${exposure_time}-${day}/frame_1.png`,
    ...extra,
  });

  it('lists the settings live scans used, leaving out deleted scans and self-tests', async () => {
    const { db, raw } = fakeDb(
      [row('r1', 7400, at(2, 9))],
      [
        scan(7000, 1),
        scan(7400, 2),
        scan(7400, 3),
        scan(9000, 3, { deleted: true }),
        scan(0, 4, { gain: 0, gamma: 0 }),
      ]
    );
    const result = await listReference({ db }, 'kcs');
    expect(
      result.data?.map((l) => [
        l.exposure_time,
        l.scan_count,
        l.is_current,
        l.latest_image_path,
      ])
    ).toEqual([
      [7400, 2, true, '7400-3/frame_1.png'],
      [7000, 1, false, '7000-1/frame_1.png'],
    ]);
    expect(raw.scan.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          experiment_id: 'kcs',
          deleted: false,
          exposure_time: { gt: 0 },
        },
      })
    );
  });

  it('keeps each line with its own image when a setting has no dates', async () => {
    const { db, raw } = fakeDb([], [scan(7000, 1), scan(7400, 2)]);
    raw.scan.groupBy.mockResolvedValueOnce([
      {
        exposure_time: 7000,
        gain: 250,
        gamma: 1,
        _count: { _all: 1 },
        _min: { capture_date: null },
        _max: { capture_date: null },
      },
      {
        exposure_time: 7400,
        gain: 250,
        gamma: 1,
        _count: { _all: 1 },
        _min: { capture_date: at(2, 10) },
        _max: { capture_date: at(2, 10) },
      },
    ]);
    const result = await listReference({ db }, 'kcs');
    expect(
      result.data?.map((l) => [l.exposure_time, l.latest_image_path])
    ).toEqual([[7400, '7400-2/frame_1.png']]);
  });
});

describe('registerExperimentCameraSettingsHandlers', () => {
  it('registers the four channels', () => {
    const ipcMain = { handle: vi.fn() };
    const { db } = fakeDb([]);
    registerExperimentCameraSettingsHandlers({ ipcMain, db });
    expect(ipcMain.handle.mock.calls.map((c) => c[0])).toEqual([
      'db:experimentCameraSettings:status',
      'db:experimentCameraSettings:history',
      'db:experimentCameraSettings:reference',
      'db:experimentCameraSettings:confirm',
    ]);
  });
});
