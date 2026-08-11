// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'child_process';
import {
  rcloneCopyFiles,
  csvEscape,
  runBoxBackup,
} from '../../src/main/box-backup';

const mockSpawn = vi.mocked(spawn);

class FakeChildProcess extends EventEmitter {
  stderr = new EventEmitter();
}

describe('rcloneCopyFiles', () => {
  let sourceDir: string;
  let sourceFile: string;

  beforeEach(() => {
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'box-backup-test-src-'));
    sourceFile = path.join(sourceDir, 'exp1_st_20260101T000000_cy1_S1_00.tif');
    fs.writeFileSync(sourceFile, 'fake tiff bytes');
    mockSpawn.mockReset();
  });

  afterEach(() => {
    fs.rmSync(sourceDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('falls back to a real file copy instead of failing when symlink creation is denied (Windows without Developer Mode)', async () => {
    // Windows restricts unprivileged symlink creation — the same condition
    // fs-symlink-or-copy.ts's ensureSymlinkOrCopy() already exists to
    // handle. box-backup.ts must route through it rather than calling
    // fs.symlinkSync directly, or Box backup silently produces zero
    // copyable files on a stock Windows lab machine with rclone installed.
    vi.spyOn(fs, 'symlinkSync').mockImplementation(() => {
      throw new Error('EPERM: operation not permitted, symlink');
    });

    const fakeProc = new FakeChildProcess();
    mockSpawn.mockReturnValue(fakeProc as never);

    const resultPromise = rcloneCopyFiles([sourceFile], 'ExperimentA/wave_0');

    // rcloneCopyFiles synchronously stages the temp dir before spawning
    // rclone, so by the time spawn() has been called we can inspect it.
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    const tmpDir = spawnArgs[1];
    const stagedPath = path.join(tmpDir, path.basename(sourceFile));

    expect(fs.lstatSync(stagedPath).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(stagedPath, 'utf-8')).toBe('fake tiff bytes');

    fakeProc.emit('close', 0);
    const result = await resultPromise;
    expect(result.success).toBe(true);
  });
});

describe('runBoxBackup', () => {
  let sourceDir: string;
  let sourceFile: string;
  let db: {
    graviScan: { findMany: ReturnType<typeof vi.fn> };
    graviImage: { updateMany: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'box-backup-test-src-'));
    sourceFile = path.join(sourceDir, 'exp1_st_20260101T000000_cy1_S1_00.tif');
    fs.writeFileSync(sourceFile, 'fake tiff bytes');
    mockSpawn.mockReset();

    db = {
      graviScan: {
        findMany: vi.fn().mockResolvedValue([
          {
            experiment: { name: 'ExpA', accession: null },
            wave_number: 0,
            plate_barcode: 'P1',
            plate_index: '1',
            grid_mode: '2grid',
            capture_date: new Date('2026-01-01'),
            transplant_date: null,
            custom_note: null,
            images: [{ id: 'img1', path: sourceFile }],
          },
        ]),
      },
      graviImage: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };

    // Distinguish the three distinct rclone invocations by argv shape:
    // `rclone version` (isRcloneInstalled), `rclone copy ... --use-json-log
    // --log-level INFO` (rcloneCopyFiles, images — 7 args), and
    // `rclone copy ... --copy-links` (rcloneCopyFile, the metadata CSV — 4
    // args). Image copy always succeeds; CSV copy is made to fail so the
    // test isolates the CSV-specific bug from an image-copy failure.
    mockSpawn.mockImplementation((_cmd, args) => {
      const proc = new FakeChildProcess();
      const argv = args as string[];
      if (argv[0] === 'version') {
        queueMicrotask(() => proc.emit('exit', 0));
      } else if (argv.length > 4) {
        queueMicrotask(() => proc.emit('close', 0));
      } else {
        queueMicrotask(() => proc.emit('close', 1));
      }
      return proc as never;
    });
  });

  afterEach(() => {
    fs.rmSync(sourceDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('marks the whole backup as failed when the metadata CSV copy fails, even though every image copied successfully', async () => {
    // Images can copy fine while the per-wave metadata.csv upload fails
    // (e.g. a transient rclone error on that one file) — the operator
    // needs `result.success === false` to know something didn't make it
    // to Box, not a silent partial failure indistinguishable from full
    // success.
    const result = await runBoxBackup(
      db as unknown as Parameters<typeof runBoxBackup>[0]
    );

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes('metadata'))).toBe(true);
  });

  it('reverts the wave images back to a retryable status when only the metadata CSV copy fails, so the next run retries it instead of silently excluding the wave forever', async () => {
    // The scan-selection query only looks at box_status ('pending'/'failed')
    // — there is no separate per-wave CSV-status field. If the images that
    // copied fine are left at box_status:'uploaded' after a CSV-only
    // failure, that wave has zero pending/failed images on the next run and
    // is silently excluded from the query, so the CSV is never retried and
    // metadata.csv stays permanently missing from Box with no further
    // indication anything is wrong.
    await runBoxBackup(db as unknown as Parameters<typeof runBoxBackup>[0]);

    const calls = db.graviImage.updateMany.mock.calls;
    // Last call must be the one reverting this wave's images to a status
    // the next run's `box_status: { in: ['pending', 'failed'] }` filter
    // will pick up again — not left at 'uploaded'.
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0].where.id.in).toEqual(['img1']);
    expect(['pending', 'failed']).toContain(lastCall[0].data.box_status);
  });
});

describe('csvEscape', () => {
  it.each(['=cmd|"/c calc"!A1', '+1+1', '-2+3', '@SUM(1,1)'])(
    'neutralizes a leading formula trigger character in %s',
    (value) => {
      // CSV/formula injection: metadata.csv is uploaded to Box for humans
      // to open in Excel/Sheets, which treats a leading =, +, -, or @ as
      // the start of a formula. Prefixing with a single quote forces
      // spreadsheet apps to treat the cell as literal text.
      const escaped = csvEscape(value);
      expect(escaped.replace(/^"|"$/g, '')).toMatch(/^'/);
    }
  );

  it('does not alter ordinary values with no leading formula character', () => {
    expect(csvEscape('Col-0')).toBe('Col-0');
    expect(csvEscape('P1-section-3')).toBe('P1-section-3');
  });

  it.each(['A=1', '3+4', 'x@y'])(
    'does not treat a formula-trigger character as unsafe unless it is the leading character (%s)',
    (value) => {
      // The regex is anchored with ^ — only a *leading* =, +, -, or @
      // opens a formula in Excel/Sheets. A mid-string occurrence (already
      // covered for '-' by 'Col-0'/'P1-section-3' above) must pass
      // through unescaped for '=', '+', and '@' too.
      expect(csvEscape(value)).toBe(value);
    }
  );

  it('still quotes values containing commas after neutralizing a formula trigger', () => {
    const escaped = csvEscape('=A1,B1');
    expect(escaped).toBe('"\'=A1,B1"');
  });
});
