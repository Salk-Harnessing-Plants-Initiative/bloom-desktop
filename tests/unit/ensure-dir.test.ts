/**
 * Tests for the `graviscan:ensure-dir` handler logic.
 *
 * The handler is registered inline against `ipcMain` so we re-implement its
 * one-line behavior with the same `fs.promises.mkdir({ recursive: true })`
 * call against a real temp directory. This pins the contract that:
 *  - The directory exists after the call.
 *  - Calling twice on the same path does not throw.
 *  - Nested paths are created in one call.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function ensureDir(dirPath: string): Promise<{
  success: boolean;
  path?: string;
  error?: string;
}> {
  try {
    if (!dirPath || typeof dirPath !== 'string') {
      return { success: false, error: 'dirPath is required' };
    }
    await fs.promises.mkdir(dirPath, { recursive: true });
    return { success: true, path: dirPath };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Failed to ensure directory',
    };
  }
}

describe('graviscan:ensure-dir', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ensure-dir-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('creates a non-existent directory recursively', async () => {
    const target = path.join(tmpRoot, 'expA_wave2_20260301T120000');
    expect(fs.existsSync(target)).toBe(false);

    const result = await ensureDir(target);

    expect(result.success).toBe(true);
    expect(result.path).toBe(target);
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.statSync(target).isDirectory()).toBe(true);
  });

  it('creates nested missing parent directories in one call', async () => {
    const target = path.join(tmpRoot, 'a', 'b', 'c', 'session');
    const result = await ensureDir(target);

    expect(result.success).toBe(true);
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.existsSync(path.join(tmpRoot, 'a', 'b'))).toBe(true);
  });

  it('is idempotent — succeeds when the directory already exists', async () => {
    const target = path.join(tmpRoot, 'already-here');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'keep.tif'), 'sentinel');

    const result = await ensureDir(target);

    expect(result.success).toBe(true);
    // Existing files are preserved.
    expect(fs.existsSync(path.join(target, 'keep.tif'))).toBe(true);
  });

  it('rejects empty or invalid input without crashing', async () => {
    const empty = await ensureDir('');
    expect(empty.success).toBe(false);
    expect(empty.error).toMatch(/required/i);

    // @ts-expect-error — intentionally passing wrong type
    const wrongType = await ensureDir(undefined);
    expect(wrongType.success).toBe(false);
  });
});
