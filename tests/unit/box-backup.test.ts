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
import { rcloneCopyFiles, csvEscape } from '../../src/main/box-backup';

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

  it('still quotes values containing commas after neutralizing a formula trigger', () => {
    const escaped = csvEscape('=A1,B1');
    expect(escaped).toBe('"\'=A1,B1"');
  });
});
