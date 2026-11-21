// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildStartScanPlan,
  buildTestScanPlan,
  type StartScanLookupLike,
  type StartScanPathRequest,
} from '../../../src/main/graviscan/start-scan-paths';

const STARTED_AT = new Date('2026-08-09T19:09:46.500Z');

let outputDir: string;

beforeEach(() => {
  outputDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-start-scan-paths-'))
  );
});
afterEach(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

const SCANNERS = [
  { id: 'scanner-a', name: 'epkowa-a', display_name: 'Left rear' },
  { id: 'scanner-b', name: 'epkowa-b', display_name: null },
];

function fakeDb(
  experiment: { name: string } | null = { name: 'Perceptome Screen' },
  phenotyper: { name: string } | null = { name: 'Jane Doe' },
  scanners = SCANNERS
): StartScanLookupLike {
  return {
    experiment: { findUnique: vi.fn().mockResolvedValue(experiment) },
    phenotyper: { findUnique: vi.fn().mockResolvedValue(phenotyper) },
    graviScanner: { findMany: vi.fn().mockResolvedValue(scanners) },
  };
}

/** Planned path of a plate: its name without `_et_`, as the page tracks it. */
function planned(plan: { outputPaths: Record<string, string> }, key: string) {
  return plan.outputPaths[key];
}

function plate(plate_index: string, plate_barcode: string | null = null) {
  return {
    plate_index,
    grid_mode: '4grid' as const,
    resolution: 1200,
    plate_barcode,
  };
}

function request(
  overrides: Partial<StartScanPathRequest> = {}
): StartScanPathRequest {
  return {
    scannerOrder: ['scanner-a', 'scanner-b'],
    scanners: [
      { scannerId: 'scanner-a', saneName: 'epkowa:a', plates: [plate('00')] },
      { scannerId: 'scanner-b', saneName: 'epkowa:b', plates: [plate('00')] },
    ],
    metadata: {
      experimentId: 'exp-1',
      phenotyperId: 'ph-1',
      resolution: 1200,
      waveNumber: 20,
    },
    ...overrides,
  };
}

function deps(db = fakeDb(), systemName = 'graviscan-desktop') {
  return { db, outputDir, systemName, now: () => STARTED_AT };
}

const SESSION_DIR = 'Perceptome_Screen_wave20_20260809T190946';

describe('buildStartScanPlan', () => {
  it('hands the worker the name parts, as on the rig, without creating the folder', async () => {
    const plan = await buildStartScanPlan(deps(), request());
    if ('error' in plan) throw new Error(plan.error);

    // The worker creates the session folder when it saves the first image,
    // so a start that fails later leaves no empty folder behind.
    const dir = path.join(outputDir, SESSION_DIR);
    expect(fs.existsSync(dir)).toBe(false);
    expect(plan.sessionDir).toBe(dir);

    const [a, b] = plan.scanners.map((s) => s.plates[0]);
    expect(a).toEqual({
      plate_index: '00',
      grid_mode: '4grid',
      resolution: 1200,
      output_dir: dir,
      exp_name: 'Perceptome_Screen',
      experiment_name: 'Perceptome Screen',
      wave_number: 20,
      st_timestamp: '20260809T190946',
      cycle: 1,
      system_prefix: 'graviscan-desktop_',
      scanner_tag: 'Sc1',
      phenotyper_name: 'Jane Doe',
      scanner_name: 'Left rear',
      plate_barcode: null,
      transplant_date: null,
      custom_note: null,
    });
    expect(a).not.toHaveProperty('output_path');
    expect(b.scanner_tag).toBe('Sc2');
    // No display name: falls back to the scanner's name.
    expect(b.scanner_name).toBe('epkowa-b');
  });

  it('returns the planned path (no _et_) of every plate for the page', async () => {
    const plan = await buildStartScanPlan(deps(), request());
    if ('error' in plan) throw new Error(plan.error);
    const dir = path.join(outputDir, SESSION_DIR);
    expect(plan.outputPaths).toEqual({
      'scanner-a:00': path.join(
        dir,
        'Perceptome_Screen_wave20_st_20260809T190946_cy1_graviscan-desktop_Sc1_00.tif'
      ),
      'scanner-b:00': path.join(
        dir,
        'Perceptome_Screen_wave20_st_20260809T190946_cy1_graviscan-desktop_Sc2_00.tif'
      ),
    });
  });

  it('numbers scanners by the page order, counting one with no plates', async () => {
    const plan = await buildStartScanPlan(
      deps(),
      request({
        scannerOrder: ['scanner-idle', 'scanner-a', 'scanner-b'],
      })
    );
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.scanners[0].plates[0].scanner_tag).toBe('Sc2');
    expect(plan.scanners[1].plates[0].scanner_tag).toBe('Sc3');
    expect(planned(plan, 'scanner-b:00')).toContain('_Sc3_00.tif');
  });

  it("keeps each plate's barcode, transplant date and note for its records", async () => {
    const plan = await buildStartScanPlan(
      deps(),
      request({
        scanners: [
          {
            scannerId: 'scanner-a',
            saneName: 'epkowa:a',
            plates: [
              {
                ...plate('00', 'PLATE_002'),
                transplant_date: '2026-08-01',
                custom_note: 'low germination',
              },
            ],
          },
        ],
      })
    );
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.scanners[0].plates[0]).toMatchObject({
      plate_barcode: 'PLATE_002',
      transplant_date: '2026-08-01',
      custom_note: 'low germination',
    });
  });

  it('accepts a transplant date sent as a Date (plate assignments hold Dates at runtime, #315)', async () => {
    const plan = await buildStartScanPlan(
      deps(),
      request({
        scanners: [
          {
            scannerId: 'scanner-a',
            saneName: 'epkowa:a',
            plates: [
              {
                ...plate('00'),
                transplant_date: new Date('2026-08-01T00:00:00.000Z') as never,
              },
            ],
          },
        ],
      })
    );
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.scanners[0].plates[0].transplant_date).toBe('2026-08-01');
  });

  it('keeps the plate barcode', async () => {
    const plan = await buildStartScanPlan(
      deps(),
      request({
        scanners: [
          {
            scannerId: 'scanner-a',
            saneName: 'epkowa:a',
            plates: [plate('01', 'BC-1')],
          },
        ],
      })
    );
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.scanners[0].plates[0].plate_barcode).toBe('BC-1');
  });

  it('leaves out the system part when no system name is set', async () => {
    const plan = await buildStartScanPlan(deps(fakeDb(), ''), request());
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.scanners[0].plates[0].system_prefix).toBe('');
    expect(path.basename(planned(plan, 'scanner-a:00'))).toBe(
      'Perceptome_Screen_wave20_st_20260809T190946_cy1_Sc1_00.tif'
    );
  });

  it('ignores an output_path sent by the renderer', async () => {
    const req = request();
    (req.scanners[0].plates[0] as Record<string, unknown>).output_path =
      '/etc/evil.tif';
    const plan = await buildStartScanPlan(deps(), req);
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.scanners[0].plates[0]).not.toHaveProperty('output_path');
    expect(plan.scanners[0].plates[0].output_dir).toBe(
      path.join(outputDir, SESSION_DIR)
    );
  });

  describe('refuses', () => {
    async function refused(req: unknown, db = fakeDb()): Promise<string> {
      const plan = await buildStartScanPlan(
        deps(db),
        req as StartScanPathRequest
      );
      expect('error' in plan).toBe(true);
      expect(fs.readdirSync(outputDir)).toEqual([]);
      return 'error' in plan ? plan.error : '';
    }

    it('an unknown experiment', async () => {
      expect(await refused(request(), fakeDb(null))).toMatch(/experiment/i);
    });

    it('an unknown phenotyper', async () => {
      expect(await refused(request(), fakeDb({ name: 'X' }, null))).toMatch(
        /phenotyper/i
      );
    });

    it('a bad wave number', async () => {
      const req = request();
      req.metadata.waveNumber = -1;
      expect(await refused(req)).toMatch(/wave/i);
    });

    it('a plate index that is not two digits', async () => {
      expect(
        await refused(
          request({
            scanners: [
              {
                scannerId: 'scanner-a',
                saneName: 'a',
                plates: [plate('../x')],
              },
            ],
          })
        )
      ).toMatch(/plate index/i);
    });

    it('the same plate twice on one scanner', async () => {
      expect(
        await refused(
          request({
            scanners: [
              {
                scannerId: 'scanner-a',
                saneName: 'a',
                plates: [plate('00'), plate('00')],
              },
            ],
          })
        )
      ).toMatch(/twice/i);
    });

    it('a scanner that is not in the database, saying what to do', async () => {
      const msg = await refused(
        request(),
        fakeDb(undefined, undefined, [SCANNERS[0]])
      );
      expect(msg).toMatch(/Configure Scanner/);
      expect(msg).not.toContain('scanner-b');
    });

    it('an unknown experiment or phenotyper, saying what to do', async () => {
      expect(await refused(request(), fakeDb(null))).toMatch(
        /choose the experiment again/i
      );
      expect(await refused(request(), fakeDb({ name: 'X' }, null))).toMatch(
        /choose the phenotyper again/i
      );
    });

    it.each(['../x', 'a/b', 'a b', 'a.b', 'x'.repeat(33)])(
      'a system name %j that is not letters, digits, - and _ (up to 32), saying where to fix it',
      async (systemName) => {
        const plan = await buildStartScanPlan(
          { ...deps(), systemName },
          request()
        );
        if (!('error' in plan)) throw new Error('expected a refusal');
        expect(plan.error).toContain('GRAVISCAN_SYSTEM_NAME');
        expect(plan.error).toContain('~/.bloom/.env');
        expect(fs.readdirSync(outputDir)).toEqual([]);
      }
    );

    it.each([
      ['a transplant date that is not a date', { transplant_date: 'soon' }],
      ['a transplant date that is a number', { transplant_date: 42 }],
      ['a note that is not text', { custom_note: 42 }],
      ['a barcode that is not text', { plate_barcode: 42 }],
    ])('%s', async (_label, fields) => {
      const req = request();
      Object.assign(req.scanners[0].plates[0], fields);
      expect(await refused(req)).toMatch(/malformed/i);
    });

    it('a SANE device name that is not a string', async () => {
      const req = request();
      (req.scanners[0] as Record<string, unknown>).saneName = 42;
      expect(await refused(req)).toMatch(/malformed/i);
    });

    it('a scanner missing from the page order', async () => {
      expect(await refused(request({ scannerOrder: ['scanner-a'] }))).toMatch(
        /malformed/i
      );
    });

    it('a malformed request', async () => {
      expect(await refused(null)).toMatch(/malformed/i);
      expect(await refused({ ...request(), scanners: 'x' })).toMatch(
        /malformed/i
      );
      expect(
        await refused(
          request({
            scanners: [
              { scannerId: 'scanner-a', saneName: 'a', plates: 'x' as never },
            ],
          })
        )
      ).toMatch(/malformed/i);
    });

    it('no plates at all', async () => {
      expect(
        await refused(
          request({
            scanners: [{ scannerId: 'scanner-a', saneName: 'a', plates: [] }],
          })
        )
      ).toMatch(/no plates/i);
    });
  });
});

describe('buildTestScanPlan', () => {
  const testDeps = () => ({ outputDir, now: () => STARTED_AT });

  it('names test scans as the rig does, inside the test folder', async () => {
    const plan = await buildTestScanPlan(testDeps(), {
      test: true,
      scanners: [
        {
          scannerId: '1a2b3c4d-aaaa-bbbb',
          saneName: 'epkowa:a',
          plates: [plate('00'), plate('01')],
        },
        {
          scannerId: '9f8e7d6c-cccc-dddd',
          saneName: 'epkowa:b',
          plates: [plate('00')],
        },
      ],
    });
    if ('error' in plan) throw new Error(plan.error);
    const dir = path.join(outputDir, 'test');
    // The worker creates the test folder when it saves.
    expect(fs.existsSync(dir)).toBe(false);

    // Rig test-scan parts (rig useTestScan.ts): `test-` + first 8 characters
    // of the scanner id, wave 0, cycle 1, no system name, Sc{K} by position.
    const [a0, a1] = plan.scanners[0].plates;
    expect(a0).toEqual({
      plate_index: '00',
      grid_mode: '4grid',
      resolution: 1200,
      output_dir: dir,
      exp_name: 'test-1a2b3c4d',
      wave_number: 0,
      st_timestamp: '20260809T190946',
      cycle: 1,
      system_prefix: '',
      scanner_tag: 'Sc1',
      phenotyper_name: '',
    });
    expect(a0).not.toHaveProperty('output_path');
    expect(a1.plate_index).toBe('01');
    expect(plan.scanners[1].plates[0].exp_name).toBe('test-9f8e7d6c');
    expect(plan.scanners[1].plates[0].scanner_tag).toBe('Sc2');
    expect(plan.outputPaths['9f8e7d6c-cccc-dddd:00']).toBe(
      path.join(dir, 'test-9f8e7d6c_wave0_st_20260809T190946_cy1_Sc2_00.tif')
    );
  });

  it('refuses a scanner id that is not a plain name', async () => {
    for (const scannerId of ['../x', 'a/b', '', '..']) {
      const plan = await buildTestScanPlan(testDeps(), {
        test: true,
        scanners: [{ scannerId, saneName: 'a', plates: [plate('00')] }],
      });
      expect('error' in plan).toBe(true);
    }
    expect(fs.readdirSync(outputDir)).toEqual([]);
  });

  it('refuses a plate index that is not two digits', async () => {
    const plan = await buildTestScanPlan(testDeps(), {
      test: true,
      scanners: [{ scannerId: 'a', saneName: 'a', plates: [plate('0/1')] }],
    });
    expect('error' in plan).toBe(true);
  });

  it('refuses a malformed request', async () => {
    const plan = await buildTestScanPlan(testDeps(), {
      test: true,
      scanners: 'x',
    } as never);
    expect('error' in plan).toBe(true);
  });

  it('refuses a plate index that is not a string, even one that looks right', async () => {
    const plan = await buildTestScanPlan(testDeps(), {
      test: true,
      scanners: [
        {
          scannerId: 'a',
          saneName: 'a',
          plates: [{ ...plate('00'), plate_index: ['01'] as never }],
        },
      ],
    });
    expect('error' in plan).toBe(true);
  });

  it('refuses the same plate twice on one scanner', async () => {
    const plan = await buildTestScanPlan(testDeps(), {
      test: true,
      scanners: [
        { scannerId: 'a', saneName: 'a', plates: [plate('00'), plate('00')] },
      ],
    });
    if (!('error' in plan)) throw new Error('expected a refusal');
    expect(plan.error).toMatch(/twice/i);
  });

  it('refuses a test scan with no plates at all', async () => {
    const plan = await buildTestScanPlan(testDeps(), {
      test: true,
      scanners: [{ scannerId: 'a', saneName: 'a', plates: [] }],
    });
    if (!('error' in plan)) throw new Error('expected a refusal');
    expect(plan.error).toMatch(/no plates/i);
  });

  it('refuses a SANE device name that is not a string', async () => {
    const plan = await buildTestScanPlan(testDeps(), {
      test: true,
      scanners: [
        { scannerId: 'a', saneName: 42 as never, plates: [plate('00')] },
      ],
    });
    expect('error' in plan).toBe(true);
  });
});
