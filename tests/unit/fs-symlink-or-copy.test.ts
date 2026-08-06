/**
 * Unit tests for ensureSymlinkOrCopy().
 *
 * Windows restricts unprivileged symlink creation (no Developer Mode/admin),
 * which broke Prisma client resolution in packaged builds (EPERM). This
 * helper tries a symlink first, then falls back to a recursive copy.
 *
 * We mock fs.symlinkSync/fs.cpSync rather than relying on real symlink
 * privilege, since that privilege is exactly the thing under test and isn't
 * guaranteed to be available (or unavailable) in any given CI/dev environment.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ensureSymlinkOrCopy } from '../../src/main/fs-symlink-or-copy';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'symlink-or-copy-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('ensureSymlinkOrCopy', () => {
  it('does nothing if linkPath already exists', () => {
    const base = makeTempDir();
    const target = path.join(base, 'target');
    const linkPath = path.join(base, 'link');
    fs.mkdirSync(target);
    fs.mkdirSync(linkPath); // linkPath already exists

    const symlinkSpy = vi.spyOn(fs, 'symlinkSync');
    const cpSpy = vi.spyOn(fs, 'cpSync');

    ensureSymlinkOrCopy(target, linkPath, 'dir');

    expect(symlinkSpy).not.toHaveBeenCalled();
    expect(cpSpy).not.toHaveBeenCalled();
  });

  it('creates a symlink when possible, without falling back to copy', () => {
    const base = makeTempDir();
    const target = path.join(base, 'target');
    const linkPath = path.join(base, 'link');
    fs.mkdirSync(target);

    const symlinkSpy = vi
      .spyOn(fs, 'symlinkSync')
      .mockImplementation(() => undefined);
    const cpSpy = vi.spyOn(fs, 'cpSync');

    ensureSymlinkOrCopy(target, linkPath, 'dir');

    expect(symlinkSpy).toHaveBeenCalledWith(target, linkPath, 'dir');
    expect(cpSpy).not.toHaveBeenCalled();
  });

  it('falls back to a recursive copy when symlink creation fails', () => {
    const base = makeTempDir();
    const target = path.join(base, 'target');
    const linkPath = path.join(base, 'link');
    fs.mkdirSync(target);

    vi.spyOn(fs, 'symlinkSync').mockImplementation(() => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    });
    const cpSpy = vi.spyOn(fs, 'cpSync').mockImplementation(() => undefined);

    ensureSymlinkOrCopy(target, linkPath, 'dir');

    expect(cpSpy).toHaveBeenCalledWith(target, linkPath, { recursive: true });
  });

  it('throws if both the symlink and the fallback copy fail', () => {
    const base = makeTempDir();
    const target = path.join(base, 'target');
    const linkPath = path.join(base, 'link');
    fs.mkdirSync(target);

    vi.spyOn(fs, 'symlinkSync').mockImplementation(() => {
      throw new Error('symlink failed');
    });
    vi.spyOn(fs, 'cpSync').mockImplementation(() => {
      throw new Error('copy failed too');
    });

    expect(() => ensureSymlinkOrCopy(target, linkPath, 'dir')).toThrow(
      'copy failed too'
    );
  });
});
