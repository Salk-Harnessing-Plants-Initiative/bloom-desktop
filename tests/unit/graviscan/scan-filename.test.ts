// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
  sanitizeExpName,
  formatScanTimestamp,
  buildScannerTag,
  buildSessionDirName,
  buildScanFileName,
  composeScanFileName,
  buildSystemPrefix,
  readCycleFromScanFileName,
} from '../../../src/main/graviscan/scan-filename';

/**
 * Mirror of the worker's `compose_output_path()` (scan_worker.py): inserts
 * `_et_<stamp>` right after `_st_<stamp>`. Python tests cover the worker
 * itself; this lets the golden test compare whole names.
 */
function insertEt(name: string, et: string): string {
  return name.replace(/(_st_\d{8}T\d{6})/, `$1_et_${et}`);
}

// Real file names from rig scans backed up to Box
// (GraviScan-Backups/graviscan-desktop/Perceptome_Screen/wave_20/, 2026-08-09).
// Two scanners, two cycles, 4-grid.
const RIG_GOLDEN = [
  'Perceptome_Screen_wave20_st_20260809T190946_et_20260809T121108_cy1_graviscan-desktop_Sc1_00.tif',
  'Perceptome_Screen_wave20_st_20260809T190946_et_20260809T121112_cy1_graviscan-desktop_Sc2_00.tif',
  'Perceptome_Screen_wave20_st_20260809T191127_et_20260809T121252_cy1_graviscan-desktop_Sc1_01.tif',
  'Perceptome_Screen_wave20_st_20260809T191127_et_20260809T121256_cy1_graviscan-desktop_Sc2_01.tif',
  'Perceptome_Screen_wave20_st_20260809T191311_et_20260809T121435_cy1_graviscan-desktop_Sc1_10.tif',
  'Perceptome_Screen_wave20_st_20260809T191311_et_20260809T121440_cy1_graviscan-desktop_Sc2_10.tif',
  'Perceptome_Screen_wave20_st_20260809T191455_et_20260809T121618_cy1_graviscan-desktop_Sc1_11.tif',
  'Perceptome_Screen_wave20_st_20260809T191455_et_20260809T121623_cy1_graviscan-desktop_Sc2_11.tif',
  'Perceptome_Screen_wave20_st_20260809T191646_et_20260809T121807_cy2_graviscan-desktop_Sc1_00.tif',
  'Perceptome_Screen_wave20_st_20260809T191646_et_20260809T121812_cy2_graviscan-desktop_Sc2_00.tif',
];

const RIG_NAME =
  /^(.+)_wave(\d+)_st_(\d{8}T\d{6})_et_(\d{8}T\d{6})_cy(\d+)_graviscan-desktop_Sc(\d+)_(\d{2})\.tif$/;

describe('scan-filename: golden names from real rig files', () => {
  it.each(RIG_GOLDEN)('reproduces %s', (golden) => {
    const m = RIG_NAME.exec(golden);
    expect(m).not.toBeNull();
    const [, , wave, st, et, cycle, k, plate] = m!;

    const built = buildScanFileName({
      expName: 'Perceptome Screen',
      waveNumber: Number(wave),
      stTimestamp: st,
      cycle: Number(cycle),
      systemName: 'graviscan-desktop',
      scannerIndex: Number(k) - 1,
      plateIndex: plate,
    });

    expect(insertEt(built, et)).toBe(golden);
  });
});

describe('sanitizeExpName', () => {
  it('replaces every character outside A-Z a-z 0-9 with _', () => {
    expect(sanitizeExpName('Perceptome Screen')).toBe('Perceptome_Screen');
    expect(sanitizeExpName('a-b.c/d\\e:f')).toBe('a_b_c_d_e_f');
    expect(sanitizeExpName('Ägypten 1')).toBe('_gypten_1');
  });

  it('cuts the name to 20 characters', () => {
    expect(sanitizeExpName('ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe(
      'ABCDEFGHIJKLMNOPQRST'
    );
  });

  it('falls back to "scan" when there is no name', () => {
    expect(sanitizeExpName('')).toBe('scan');
    expect(sanitizeExpName(undefined)).toBe('scan');
    expect(sanitizeExpName(null)).toBe('scan');
  });

  it('never yields a path separator or "..", so it cannot leave the folder', () => {
    const s = sanitizeExpName('../../etc/passwd');
    expect(s).not.toContain('/');
    expect(s).not.toContain('\\');
    expect(s).not.toContain('..');
  });
});

describe('formatScanTimestamp', () => {
  it('is UTC, YYYYMMDDTHHMMSS', () => {
    expect(formatScanTimestamp(new Date('2026-08-09T19:09:46.789Z'))).toBe(
      '20260809T190946'
    );
  });
});

describe('buildScannerTag', () => {
  it('is Sc plus the 1-based position', () => {
    expect(buildScannerTag(0)).toBe('Sc1');
    expect(buildScannerTag(3)).toBe('Sc4');
  });

  it('rejects a negative or non-integer position', () => {
    expect(() => buildScannerTag(-1)).toThrow();
    expect(() => buildScannerTag(1.5)).toThrow();
  });
});

describe('buildSessionDirName', () => {
  it('matches the rig: {exp}_wave{N}_{UTC timestamp}', () => {
    expect(
      buildSessionDirName({
        expName: 'Perceptome Screen',
        waveNumber: 20,
        startedAt: new Date('2026-08-09T19:09:46Z'),
      })
    ).toBe('Perceptome_Screen_wave20_20260809T190946');
  });

  it('stays a single path segment under the output folder', () => {
    const outputDir = '/data/graviscan';
    const dir = buildSessionDirName({
      expName: '../../escape',
      waveNumber: 1,
      startedAt: new Date('2026-01-01T00:00:00Z'),
    });
    expect(path.dirname(path.join(outputDir, dir))).toBe(outputDir);
  });
});

describe('buildScanFileName', () => {
  const base = {
    expName: 'Perceptome Screen',
    waveNumber: 20,
    stTimestamp: '20260809T190946',
    cycle: 1,
    systemName: 'graviscan-desktop',
    scannerIndex: 0,
    plateIndex: '00',
  };

  it('ends in .tif', () => {
    expect(buildScanFileName(base)).toMatch(/\.tif$/);
  });

  it('leaves out the system part and its _ when no system name is set', () => {
    expect(buildScanFileName({ ...base, systemName: '' })).toBe(
      'Perceptome_Screen_wave20_st_20260809T190946_cy1_Sc1_00.tif'
    );
    expect(buildScanFileName({ ...base, systemName: undefined })).toBe(
      'Perceptome_Screen_wave20_st_20260809T190946_cy1_Sc1_00.tif'
    );
  });

  it('two scanners at the same plate index in one cycle get different names', () => {
    const a = buildScanFileName({ ...base, scannerIndex: 0 });
    const b = buildScanFileName({ ...base, scannerIndex: 1 });
    expect(a).not.toBe(b);
    expect(a).toContain('_Sc1_00.tif');
    expect(b).toContain('_Sc2_00.tif');
  });

  it('rejects a plate index that is not two digits', () => {
    for (const plateIndex of ['0', '000', 'a0', '../x', '0/']) {
      expect(() => buildScanFileName({ ...base, plateIndex })).toThrow();
    }
  });

  it('rejects a bad wave or cycle', () => {
    expect(() => buildScanFileName({ ...base, waveNumber: -1 })).toThrow();
    expect(() => buildScanFileName({ ...base, waveNumber: 1.5 })).toThrow();
    expect(() => buildScanFileName({ ...base, cycle: 0 })).toThrow();
  });

  it('rejects a start time that is not YYYYMMDDTHHMMSS', () => {
    expect(() =>
      buildScanFileName({ ...base, stTimestamp: '2026-08-09' })
    ).toThrow();
  });

  it('rejects a system name that could change the folder', () => {
    for (const systemName of ['a/b', 'a\\b', '..']) {
      expect(() => buildScanFileName({ ...base, systemName })).toThrow();
    }
  });
});

describe('composeScanFileName (planned name from prepared parts)', () => {
  it('mirrors the worker: the rig name without _et_', () => {
    expect(
      composeScanFileName({
        exp_name: 'Perceptome_Screen',
        wave_number: 20,
        st_timestamp: '20260809T191646',
        cycle: 2,
        system_prefix: 'graviscan-desktop_',
        scanner_tag: 'Sc2',
        plate_index: '00',
      })
    ).toBe(
      'Perceptome_Screen_wave20_st_20260809T191646_cy2_graviscan-desktop_Sc2_00.tif'
    );
  });

  it('keeps an experiment name containing a date or _cy<N>_ as it is', () => {
    expect(
      composeScanFileName({
        exp_name: 'Trial_cy1',
        wave_number: 1,
        st_timestamp: '20260810T080000',
        cycle: 3,
        system_prefix: '',
        scanner_tag: 'Sc1',
        plate_index: '01',
      })
    ).toBe('Trial_cy1_wave1_st_20260810T080000_cy3_Sc1_01.tif');
  });
});

describe('buildSystemPrefix', () => {
  it('adds _ after the system name, or is empty', () => {
    expect(buildSystemPrefix('graviscan-desktop')).toBe('graviscan-desktop_');
    expect(buildSystemPrefix('')).toBe('');
    expect(buildSystemPrefix(undefined)).toBe('');
  });
});

describe('readCycleFromScanFileName', () => {
  it('reads the cycle that follows _st_ (and _et_, after the worker saves)', () => {
    expect(readCycleFromScanFileName(RIG_GOLDEN[0])).toBe(1);
    expect(readCycleFromScanFileName(RIG_GOLDEN[8])).toBe(2);
    expect(
      readCycleFromScanFileName(
        'Test_cy7_run_wave1_st_20260809T191000_cy2_Sc1_01.tif'
      )
    ).toBe(2);
  });

  it('returns null for a name without the rig pattern', () => {
    expect(readCycleFromScanFileName('00_cy1_1700000000000.tiff')).toBeNull();
  });
});
