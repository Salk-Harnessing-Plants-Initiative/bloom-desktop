// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// box-backup.ts imports fs via `import * as fs from 'fs'` (a namespace
// import), while this test file uses `import fs from 'fs'` (a default
// import). Those two import styles don't share an object identity under
// Vitest's transform, so `vi.spyOn(fs, 'writeFileSync')` here silently
// fails to intercept calls made through box-backup.ts's own binding
// (confirmed empirically — the spy recorded zero calls even though the
// write demonstrably ran). Mocking the whole 'fs' module instead
// intercepts at module resolution, which works regardless of import
// style; `importOriginal` keeps every other fs call (mkdtempSync,
// symlinkSync, rmSync, etc.) genuinely real.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const writeFileSync = vi.fn(actual.writeFileSync);
  return { ...actual, writeFileSync, default: { ...actual, writeFileSync } };
});

import { spawn } from 'child_process';
import {
  rcloneCopyFiles,
  csvEscape,
  runBoxBackup,
} from '../../src/main/box-backup';

const mockSpawn = vi.mocked(spawn);

beforeEach(() => {
  vi.mocked(fs.writeFileSync).mockClear();
});

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

  it('does not silently mark every file as uploaded when rclone logs a wave-level error unattributable to any real filename', async () => {
    // rclone can log a `level:"error"` line for a global/config failure
    // (auth-token expiry, quota exceeded, backend outage) with no
    // per-file attribution — e.g. `{"level":"error","msg":"Failed to
    // copy: googleapi: Error 401: Invalid Credentials"}`. The parser
    // extracts a "filename" via `msg.split(':')[0].trim()` regardless of
    // whether that token is a real file — here it'd be "Failed to copy",
    // which matches none of the real filenames. If that bogus token is
    // trusted as a per-file error, every REAL file fails to match it and
    // gets treated as if it copied fine (erroredFiles.has(realFilename)
    // is false for all of them), silently reporting a fully successful
    // upload for a wave that never left the machine — permanent, silent
    // data loss with no future retry (box_status becomes 'uploaded').
    const fakeProc = new FakeChildProcess();
    mockSpawn.mockReturnValue(fakeProc as never);

    const resultPromise = rcloneCopyFiles([sourceFile], 'ExperimentA/wave_0');
    fakeProc.stderr.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          level: 'error',
          msg: 'Failed to copy: googleapi: Error 401: Invalid Credentials',
        }) + '\n'
      )
    );
    fakeProc.emit('close', 1);

    const result = await resultPromise;
    expect(result.success).toBe(false);
    // The real file must NOT be silently treated as uploaded just
    // because the bogus extracted token doesn't match its name.
    expect(result.erroredFiles.has(path.basename(sourceFile))).toBe(false);
    expect(result.erroredFiles.size).toBe(0);
  });

  it('attributes a real per-file error correctly even when the DB path is stale and resolveGraviScanPath finds the file under its renamed (_et_) basename', async () => {
    // resolveGraviScanPath exists specifically because the DB can store a
    // path with only _st_ (start time) while the file on disk has since
    // been renamed to include _et_ (end time) — a real, documented,
    // previously-encountered production scenario, not a hypothetical.
    // rclone copies and logs using the RESOLVED (renamed) basename, but
    // the knownFileNames guard was built from the ORIGINAL (unresolved,
    // possibly-stale) basename. In a wave with at least one OTHER
    // correctly-matched error (so erroredFiles isn't empty and the safe
    // "mark whole wave failed" fallback doesn't trigger), the renamed
    // file's real error would fail knownFileNames.has() and be silently
    // dropped — leaving it (incorrectly) treated as uploaded despite
    // never actually succeeding.
    // Deliberately unique from the shared beforeEach's own `sourceFile`
    // (which the shared hook already writes to disk, which would make
    // resolveGraviScanPath find it as-is on the very first check and
    // never exercise the _et_ fallback this test targets).
    const staleDbPath = path.join(
      sourceDir,
      'exp2_st_20260102T000000_cy1_S1_00.tif'
    );
    // Deliberately do NOT create staleDbPath — only the renamed file
    // exists on disk, forcing resolveGraviScanPath's _et_ fallback.
    const renamedActualPath = path.join(
      sourceDir,
      'exp2_st_20260102T000000_et_20260102T000100_cy1_S1_00.tif'
    );
    fs.writeFileSync(renamedActualPath, 'fake tiff bytes renamed');
    const otherFile = path.join(
      sourceDir,
      'exp2_st_20260102T000000_cy1_S1_01.tif'
    );
    fs.writeFileSync(otherFile, 'fake tiff bytes other');

    const fakeProc = new FakeChildProcess();
    mockSpawn.mockReturnValue(fakeProc as never);

    const resultPromise = rcloneCopyFiles(
      [staleDbPath, otherFile],
      'ExperimentA/wave_0'
    );
    // Both files genuinely fail their own copy — one under its resolved
    // (renamed) name, one under its original name.
    fakeProc.stderr.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          level: 'error',
          msg: `${path.basename(renamedActualPath)}: simulated copy error`,
        }) + '\n'
      )
    );
    fakeProc.stderr.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          level: 'error',
          msg: `${path.basename(otherFile)}: simulated copy error`,
        }) + '\n'
      )
    );
    fakeProc.emit('close', 1);

    const result = await resultPromise;
    // erroredFiles is keyed by the ORIGINAL (DB-path) basenames — the
    // same space runBoxBackup's caller-side comparison uses — so the
    // renamed file's error must show up under its ORIGINAL basename,
    // not silently vanish.
    expect(result.erroredFiles.has(path.basename(staleDbPath))).toBe(true);
    expect(result.erroredFiles.has(path.basename(otherFile))).toBe(true);
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

  it('does not double-count images as both completed and failed when rclone dies mid-transfer with no per-file error info', async () => {
    // Total rclone failure (non-zero exit, empty erroredFiles) marks EVERY
    // image in the wave as failed — including ones that already logged a
    // per-file "Copied" line (and so already incremented completedImages)
    // before the process died. Without undoing that credit, the live
    // progress display could show an image as both "completed" and
    // "failed" simultaneously, and completedImages would overstate what's
    // actually durable when everything in this wave just got marked
    // box_status:'failed'.
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
    mockSpawn.mockImplementation((_cmd, args) => {
      const proc = new FakeChildProcess();
      const argv = args as string[];
      if (argv[0] === 'version') {
        queueMicrotask(() => proc.emit('exit', 0));
      } else if (argv.length > 4) {
        // img1 logs "Copied" (completedImages++ fires for it), then the
        // whole rclone process dies with a non-zero exit and no per-file
        // error line — a network drop mid-transfer, not a per-file error.
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
          proc.emit('close', 1);
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

    const result = await runBoxBackup(
      db as unknown as Parameters<typeof runBoxBackup>[0],
      (progress) => progressUpdates.push({ ...progress })
    );

    expect(result.success).toBe(false);
    // Both images end up box_status:'failed'. Note: the metadata CSV
    // step still runs unconditionally afterward regardless of whether
    // any image succeeded (a separate, pre-existing behavior not
    // asserted here) — this test only checks the image-status/progress
    // counters, not whether the CSV upload was attempted.
    const failCall = db.graviImage.updateMany.mock.calls.find(
      (call) => call[0].data.box_status === 'failed'
    );
    expect([...failCall[0].where.id.in].sort()).toEqual(['img1', 'img2']);
    const lastUpdate = progressUpdates[progressUpdates.length - 1];
    expect(lastUpdate.completedImages).toBe(0);
    expect(lastUpdate.failedImages).toBe(2);
  });

  it("does not let one wave's total-rclone-failure correction wipe out an earlier wave's already-valid completed count", async () => {
    // waveCompletedImages must reset every wave, not every experiment or
    // function call — with only a single-wave fixture, a version of the
    // fix that resets per-experiment (or never resets at all) is
    // indistinguishable from the correct per-wave version, since both
    // yield 0 for n=1. This wave-0-succeeds-then-wave-1-total-fails
    // scenario is the one case that can tell them apart: if
    // waveCompletedImages carried wave 0's contribution into wave 1's
    // correction, wave 1's failure would incorrectly erase wave 0's
    // valid completedImages credit too.
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
        images: [{ id: 'img1', path: sourceFile }],
      },
      {
        experiment: { name: 'ExpA', accession: null },
        wave_number: 1,
        plate_barcode: 'P1',
        plate_index: '1',
        grid_mode: '2grid',
        capture_date: new Date('2026-01-01'),
        transplant_date: null,
        custom_note: null,
        images: [{ id: 'img2', path: sourceFile2 }],
      },
    ]);

    let imageCopyCallCount = 0;
    mockSpawn.mockImplementation((_cmd, args) => {
      const proc = new FakeChildProcess();
      const argv = args as string[];
      if (argv[0] === 'version') {
        queueMicrotask(() => proc.emit('exit', 0));
      } else if (argv.length > 4) {
        imageCopyCallCount++;
        if (imageCopyCallCount === 1) {
          // Wave 0 (processed first, sorted by wave_number): image
          // copies cleanly.
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
          // Wave 1: logs "Copied" for its one image, then the whole
          // rclone process dies with no per-file error info.
          queueMicrotask(() => {
            proc.stderr.emit(
              'data',
              Buffer.from(
                JSON.stringify({
                  level: 'info',
                  msg: `${path.basename(sourceFile2)}: Copied (new)`,
                }) + '\n'
              )
            );
            proc.emit('close', 1);
          });
        }
      } else {
        // Metadata CSV copy for either wave — succeeds, keeping focus on
        // the image-copy counters.
        queueMicrotask(() => proc.emit('close', 0));
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
    // Wave 0's valid completed image must survive wave 1's correction.
    expect(lastUpdate.completedImages).toBe(1);
    expect(lastUpdate.failedImages).toBe(1);
  });

  it('marks every image in a wave as failed when rclone crashes partway through, even if one file already had a genuinely-matched per-file error', async () => {
    // A non-empty erroredFiles set does NOT mean "every other file is
    // confirmed fine" — it only means "these specific files logged a
    // per-file error." If rclone dies (non-zero exit) after logging a
    // real error for one file but before ever attempting the others,
    // those others were never confirmed copied OR skipped — treating
    // them as "not in erroredFiles, therefore uploaded" reintroduces the
    // exact silent-data-loss defect fixed once already for the
    // all-unmatched case, just reached via a wave with one real match.
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
    mockSpawn.mockImplementation((_cmd, args) => {
      const proc = new FakeChildProcess();
      const argv = args as string[];
      if (argv[0] === 'version') {
        queueMicrotask(() => proc.emit('exit', 0));
      } else if (argv.length > 4) {
        // img1 gets a real, correctly-matched per-file error; img2 is
        // never mentioned at all (rclone crashed before reaching it) —
        // then the whole process dies with a non-zero exit.
        queueMicrotask(() => {
          proc.stderr.emit(
            'data',
            Buffer.from(
              JSON.stringify({
                level: 'error',
                msg: `${path.basename(sourceFile)}: simulated copy error`,
              }) + '\n'
            )
          );
          proc.emit('close', 1);
        });
      } else {
        queueMicrotask(() => proc.emit('close', 1));
      }
      return proc as never;
    });

    const result = await runBoxBackup(
      db as unknown as Parameters<typeof runBoxBackup>[0]
    );

    const failCall = db.graviImage.updateMany.mock.calls.find(
      (call) => call[0].data.box_status === 'failed'
    );
    // Both img1 (genuinely matched) AND img2 (never attempted) must end
    // up failed — img2 must NOT be silently treated as uploaded just
    // because it never appeared in erroredFiles.
    expect([...failCall[0].where.id.in].sort()).toEqual(['img1', 'img2']);
    const uploadedCall = db.graviImage.updateMany.mock.calls.find(
      (call) => call[0].data.box_status === 'uploaded'
    );
    expect(uploadedCall).toBeUndefined();
    expect(result.filesCopied).toBe(0);
  });

  it("surfaces rclone's actual diagnostic message instead of a generic exit-code string, so an operator can tell a credentials/quota problem apart from a transient network blip", async () => {
    // This wave's image copy dies with a wave-level (unattributable)
    // error — no per-file match, so waveLevelErrorMsg is what surfaces.
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
                msg: 'Failed to copy: googleapi: Error 401: Invalid Credentials',
              }) + '\n'
            )
          );
          proc.emit('close', 1);
        });
      } else {
        queueMicrotask(() => proc.emit('close', 1));
      }
      return proc as never;
    });

    const result = await runBoxBackup(
      db as unknown as Parameters<typeof runBoxBackup>[0]
    );

    expect(
      result.errors.some((e) =>
        e.includes('googleapi: Error 401: Invalid Credentials')
      )
    ).toBe(true);
  });

  it('surfaces the FIRST unattributable rclone error, not the last, when several unrelated transfers fail after the root cause', async () => {
    // When one fatal error (e.g. bad credentials) kills the whole rclone
    // process, other in-flight transfers typically log their own
    // "context canceled"-style errors as they unwind. Keeping "last
    // wins" would silently overwrite the actual diagnostic with one of
    // those generic cancellation messages — the opposite of what an
    // operator debugging a credentials/quota problem needs.
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
                msg: 'Failed to copy: googleapi: Error 401: Invalid Credentials',
              }) + '\n'
            )
          );
          proc.stderr.emit(
            'data',
            Buffer.from(
              JSON.stringify({
                level: 'error',
                msg: 'Failed to copy: context canceled',
              }) + '\n'
            )
          );
          proc.emit('close', 1);
        });
      } else {
        queueMicrotask(() => proc.emit('close', 1));
      }
      return proc as never;
    });

    const result = await runBoxBackup(
      db as unknown as Parameters<typeof runBoxBackup>[0]
    );

    expect(
      result.errors.some((e) =>
        e.includes('googleapi: Error 401: Invalid Credentials')
      )
    ).toBe(true);
    expect(result.errors.some((e) => e.includes('context canceled'))).toBe(
      false
    );
  });

  it('uses the resolved (on-disk) filename in the exported metadata.csv, not a stale DB path, so the CSV matches what is actually in Box', async () => {
    // rcloneCopyFiles uploads the file under its RESOLVED basename (e.g.
    // the _et_-renamed name) — but exportMetadataCSV built image_filename
    // straight from the stale DB path. A human opening this wave's Box
    // folder directly would see a metadata.csv naming a file that
    // doesn't exist in that same folder — a human-visible provenance
    // mismatch, not just an internal bookkeeping quirk.
    const staleDbPath = path.join(
      sourceDir,
      'exp3_st_20260103T000000_cy1_S1_00.tif'
    );
    const renamedActualPath = path.join(
      sourceDir,
      'exp3_st_20260103T000000_et_20260103T000100_cy1_S1_00.tif'
    );
    fs.writeFileSync(renamedActualPath, 'fake tiff bytes renamed');
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
        images: [{ id: 'img1', path: staleDbPath }],
      },
    ]);
    await runBoxBackup(db as unknown as Parameters<typeof runBoxBackup>[0]);

    const csvCall = vi
      .mocked(fs.writeFileSync)
      .mock.calls.find((call) => String(call[0]).endsWith('.csv'));
    expect(csvCall).toBeDefined();
    const csvContent = csvCall![1] as string;
    expect(csvContent).toContain(path.basename(renamedActualPath));
    expect(csvContent).not.toContain(path.basename(staleDbPath));
  });

  it('excludes an image from the exported metadata.csv (and does not crash) when it cannot be found on disk under any name variant', async () => {
    // resolveGraviScanPath returns null when a file is missing under
    // every extension/rename variant it tries — that image was never
    // found on disk, so it was never even attempted for upload, let
    // alone actually placed in Box. Falling back to the stale DB path's
    // own basename for such a row (as an earlier version of this fix
    // did) made metadata.csv claim provenance for a file that doesn't
    // exist under ANY name in that folder — a stronger, more misleading
    // claim than "we don't know." Excluding the row entirely keeps the
    // CSV accurate to what Box actually received.
    const neverExistsPath = path.join(
      sourceDir,
      'exp4_st_20260104T000000_cy1_S1_00.tif'
    );
    // Deliberately never created on disk.
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
          { id: 'img2', path: neverExistsPath },
        ],
      },
    ]);

    await runBoxBackup(db as unknown as Parameters<typeof runBoxBackup>[0]);

    const csvCall = vi
      .mocked(fs.writeFileSync)
      .mock.calls.find((call) => String(call[0]).endsWith('.csv'));
    expect(csvCall).toBeDefined();
    const csvContent = csvCall![1] as string;
    expect(csvContent).toContain(path.basename(sourceFile));
    expect(csvContent).not.toContain(path.basename(neverExistsPath));
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
