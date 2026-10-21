// @vitest-environment node
/**
 * Tests for tests/e2e/helpers/pyinstaller-temp.ts: after each E2E test, the
 * unpacked folders of force-killed bloom-hardware runs are removed, but only
 * those created during the current Playwright run.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  RUN_STARTED_ENV,
  removeLeakedPyInstallerDirs,
} from '../e2e/helpers/pyinstaller-temp';

const created: string[] = [];

function makeMeiDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '_MEI'));
  fs.writeFileSync(path.join(dir, 'python312.dll'), 'x');
  created.push(dir);
  return dir;
}

afterEach(() => {
  delete process.env[RUN_STARTED_ENV];
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('removeLeakedPyInstallerDirs', () => {
  it('removes _MEI folders created since the run started', () => {
    process.env[RUN_STARTED_ENV] = String(Date.now() - 1000);
    const dir = makeMeiDir();
    expect(removeLeakedPyInstallerDirs()).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('keeps _MEI folders from before the run', () => {
    const dir = makeMeiDir();
    process.env[RUN_STARTED_ENV] = String(Date.now() + 60_000);
    removeLeakedPyInstallerDirs();
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('does nothing outside a Playwright run', () => {
    const dir = makeMeiDir();
    expect(removeLeakedPyInstallerDirs()).toBe(0);
    expect(fs.existsSync(dir)).toBe(true);
  });
});
