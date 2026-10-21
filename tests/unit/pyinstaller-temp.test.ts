// @vitest-environment node
/**
 * Tests for tests/e2e/helpers/pyinstaller-temp.ts: the E2E run gets its own temp
 * folder, and after each test the unpacked folders that force-killed bloom-hardware
 * runs left in it are removed. Uses its own temp folders, never the real one.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  RUN_TEMP_ENV,
  removeLeakedPyInstallerDirs,
  useRunTempDir,
} from '../e2e/helpers/pyinstaller-temp';

const TEMP_VARS = ['TEMP', 'TMP', 'TMPDIR', 'RUNNER_TEMP', RUN_TEMP_ENV];
const savedEnv = Object.fromEntries(TEMP_VARS.map((n) => [n, process.env[n]]));
const created: string[] = [];

function scratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-pyinstaller-test-'));
  created.push(dir);
  return dir;
}

afterEach(() => {
  for (const name of TEMP_VARS) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('useRunTempDir', () => {
  it('creates a folder under RUNNER_TEMP and makes it the temp directory', () => {
    const base = scratch();
    process.env.RUNNER_TEMP = base;
    const dir = useRunTempDir();
    expect(path.dirname(dir)).toBe(base);
    expect(fs.existsSync(dir)).toBe(true);
    for (const name of ['TEMP', 'TMP', 'TMPDIR', RUN_TEMP_ENV]) {
      expect(process.env[name]).toBe(dir);
    }
  });
});

describe('removeLeakedPyInstallerDirs', () => {
  it("removes _MEI folders in the run's temp folder and nothing else", () => {
    const runTemp = scratch();
    process.env[RUN_TEMP_ENV] = runTemp;
    fs.mkdirSync(path.join(runTemp, '_MEI12345'));
    fs.writeFileSync(path.join(runTemp, '_MEI12345', 'python312.dll'), 'x');
    fs.mkdirSync(path.join(runTemp, 'other'));
    expect(removeLeakedPyInstallerDirs()).toBe(1);
    expect(fs.readdirSync(runTemp)).toEqual(['other']);
  });

  it('does nothing outside a Playwright run', () => {
    delete process.env[RUN_TEMP_ENV];
    expect(removeLeakedPyInstallerDirs()).toBe(0);
  });
});
