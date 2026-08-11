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
    // will pick up again — not left at 'uploaded'. Asserted as the exact
    // value ('failed', never 'pending') since this string is also shown
    // directly to operators via the Upload Status filter — a future
    // regression reverting to the wrong status would be user-visible.
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0].where.id.in).toEqual(['img1']);
    expect(lastCall[0].data.box_status).toBe('failed');
  });

  it("reverts ALL of a wave's successfully-copied images, not just the first, when the metadata CSV copy fails", async () => {
    // The single-image fixture above can't distinguish "reverts the whole
    // uploadedIds array" from "reverts only uploadedIds[0]" — a real wave
    // backing up multiple images per plate needs every one of them
    // reverted, or a partial subset would slip back to 'uploaded' and be
    // silently excluded from the next retry.
    const sourceFile2 = path.join(
      sourceDir,
      'exp1_st_20260101T000000_cy1_S1_01.tif'
    );
    fs.writeFileSync(sourceFile2, 'fake tiff bytes 2');
    db.graviScan.findMany.mockResolvedValue([
      {
        experiment: { name: 'ExpA', accession: null },
        wave_number: 0,
        plate_barcode: 'P1',
        plate_index: '1',
        grid_mode: '2grid',
        capture_date: new Date('2026-01-01'),
        transplant_date: null,
        custom_note: null,
        images: [
          { id: 'img1', path: sourceFile },
          { id: 'img2', path: sourceFile2 },
        ],
      },
    ]);

    const result = await runBoxBackup(
      db as unknown as Parameters<typeof runBoxBackup>[0]
    );

    const calls = db.graviImage.updateMany.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect([...lastCall[0].where.id.in].sort()).toEqual(['img1', 'img2']);
    expect(lastCall[0].data.box_status).toBe('failed');
    // Distinguishes "reverts the whole uploadedIds array" from a
    // hardcoded `-= 1`, which would coincidentally also yield 0 in the
    // single-image test above but not here (2 added, only 1 subtracted).
    expect(result.filesCopied).toBe(0);
  });

  it('leaves images at box_status:"uploaded" when both the image copy and the metadata CSV copy succeed', async () => {
    // The revert fix must only fire on CSV failure — this pins down the
    // complementary "must NOT trigger when it shouldn't" branch, so a
    // future refactor that moves the revert outside its `if
    // (!csvResult.success)` guard would be caught here.
    mockSpawn.mockImplementation((_cmd, args) => {
      const proc = new FakeChildProcess();
      const argv = args as string[];
      if (argv[0] === 'version') {
        queueMicrotask(() => proc.emit('exit', 0));
      } else {
        queueMicrotask(() => proc.emit('close', 0));
      }
      return proc as never;
    });

    const result = await runBoxBackup(
      db as unknown as Parameters<typeof runBoxBackup>[0]
    );

    expect(result.success).toBe(true);
    const calls = db.graviImage.updateMany.mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0].data.box_status).toBe('uploaded');
    // Positive control for the sibling revert tests: filesCopied CAN be
    // nonzero, so their `=== 0` assertions prove a real decrement
    // happened rather than the counter never having been incremented.
    expect(result.filesCopied).toBe(1);
  });

  it('does not count reverted images in filesCopied, so the summary count matches what is actually durable in Box', async () => {
    // filesCopied is incremented before the CSV attempt and flows directly
    // into the operator-facing "N uploaded" message (via
    // image-handlers.ts's `uploaded: bloomResult.uploaded +
    // boxResult.filesCopied`) — if it isn't corrected when the same
    // images are reverted to 'failed', the message overstates how much
    // actually made it to Box this run, for the exact images the DB now
    // says still need a retry.
    const result = await runBoxBackup(
      db as unknown as Parameters<typeof runBoxBackup>[0]
    );

    expect(result.filesCopied).toBe(0);
  });

  it('also corrects the live completedImages/failedImages progress counters on a CSV-only failure, not just the final result', async () => {
    // result.filesCopied is fixed, but the separate per-callback
    // completedImages/failedImages counters (broadcast live via
    // onProgress to Layout.tsx's global banner and BrowseGraviScans'
    // per-row "Box N/M" indicator) are a different code path with the
    // exact same "counted before the CSV attempt, never corrected on CSV
    // failure" defect — an operator could see "Box 1/1" (implying full
    // success) on a row whose image was just reverted to box_status:
    // 'failed' and excluded from the visible upload count.
    // The default mock's image-copy branch just closes with code 0 and
    // never emits rclone's per-file "Copied" info log line, so
    // onFileComplete (and therefore onProgress) never fires at all under
    // it — emit that line here so completedImages actually increments
    // before the CSV failure, giving this test something real to correct.
    mockSpawn.mockImplementation((_cmd, args) => {
      const proc = new FakeChildProcess();
      const argv = args as string[];
      if (argv[0] === 'version') {
        queueMicrotask(() => proc.emit('exit', 0));
      } else if (argv.length > 4) {
        queueMicrotask(() => {
          proc.stderr.emit(
            'data',
            Buffer.from(
              JSON.stringify({
                level: 'info',
                msg: `${path.basename(sourceFile)}: Copied (new)`,
              }) + '\n'
            )
          );
          proc.emit('close', 0);
        });
      } else {
        queueMicrotask(() => proc.emit('close', 1));
      }
      return proc as never;
    });

    const progressUpdates: Array<{
      totalImages: number;
      completedImages: number;
      failedImages: number;
    }> = [];

    await runBoxBackup(
      db as unknown as Parameters<typeof runBoxBackup>[0],
      (progress) => progressUpdates.push({ ...progress })
    );

    const lastUpdate = progressUpdates[progressUpdates.length - 1];
    expect(lastUpdate.completedImages).toBe(0);
    expect(lastUpdate.failedImages).toBe(1);
  });

  it('reverts only the images that copied successfully (not the ones that already failed their own copy) when a partially-failed wave also fails its metadata CSV copy', async () => {
    // Distinguishes `filesCopied -= uploadedIds.length` from a broken
    // variant that also subtracts failedIds.length (double-counting) or
    // reverts failedIds a second time — every existing CSV-failure test
    // has failedIds empty, so this is the only test that can catch that
    // class of bug.
    const sourceFile2 = path.join(
      sourceDir,
      'exp1_st_20260101T000000_cy1_S1_01.tif'
    );
    fs.writeFileSync(sourceFile2, 'fake tiff bytes 2');
    db.graviScan.findMany.mockResolvedValue([
      {
        experiment: { name: 'ExpA', accession: null },
        wave_number: 0,
        plate_barcode: 'P1',
        plate_index: '1',
        grid_mode: '2grid',
        capture_date: new Date('2026-01-01'),
        transplant_date: null,
        custom_note: null,
        images: [
          { id: 'img1', path: sourceFile },
          { id: 'img2', path: sourceFile2 },
        ],
      },
    ]);
    // img2's filename must appear in rcloneCopyFiles' erroredFiles set to
    // simulate a partial per-file copy failure. Since this test file
    // mocks child_process.spawn (not rcloneCopyFiles itself), drive that
    // via the JSON log line rcloneCopyFiles parses for per-file errors.
    mockSpawn.mockImplementation((_cmd, args) => {
      const proc = new FakeChildProcess();
      const argv = args as string[];
      if (argv[0] === 'version') {
        queueMicrotask(() => proc.emit('exit', 0));
      } else if (argv.length > 4) {
        queueMicrotask(() => {
          proc.stderr.emit(
            'data',
            Buffer.from(
              JSON.stringify({
                level: 'error',
                msg: `${path.basename(sourceFile2)}: simulated copy error`,
              }) + '\n'
            )
          );
          proc.emit('close', 0);
        });
      } else {
        queueMicrotask(() => proc.emit('close', 1));
      }
      return proc as never;
    });

    const result = await runBoxBackup(
      db as unknown as Parameters<typeof runBoxBackup>[0]
    );

    // img1 copied fine then got reverted for the CSV failure; img2 was
    // already marked 'failed' from its own copy failure and must not be
    // touched again by the revert.
    const revertCall = db.graviImage.updateMany.mock.calls.find(
      (call) =>
        call[0].data.box_status === 'failed' &&
        call[0].where.id.in.includes('img1')
    );
    expect(revertCall[0].where.id.in).toEqual(['img1']);
    expect(result.filesCopied).toBe(0);
    expect(result.errors.some((e) => e.includes('1/2 files failed'))).toBe(
      true
    );
    expect(result.errors.some((e) => e.includes('metadata'))).toBe(true);
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
