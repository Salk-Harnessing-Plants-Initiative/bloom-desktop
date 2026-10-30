/**
 * The E2E helper sets the developer's ~/.bloom/camera-settings.json aside on disk and
 * puts it back, including after a run that crashed before cleaning up.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-e2e-helper-'));
vi.mock('os', async (importOriginal) => {
  const real = await importOriginal<typeof import('os')>();
  return { ...real, homedir: () => home };
});

const { createTestBloomConfig, cleanupTestBloomConfig } = await import(
  '../e2e/helpers/bloom-config'
);

const bloom = path.join(home, '.bloom');
const settings = path.join(bloom, 'camera-settings.json');
const backup = `${settings}.e2e-backup`;

beforeEach(() => fs.rmSync(bloom, { recursive: true, force: true }));
afterEach(() => fs.rmSync(bloom, { recursive: true, force: true }));

describe('E2E bloom-config helper: saved camera settings', () => {
  it("sets the developer's settings aside on disk and puts them back", () => {
    fs.mkdirSync(bloom, { recursive: true });
    fs.writeFileSync(settings, 'mine');

    createTestBloomConfig(path.join(home, 'scans'));
    expect(fs.existsSync(settings)).toBe(false);
    expect(fs.readFileSync(backup, 'utf8')).toBe('mine');

    fs.writeFileSync(settings, 'the test applied these');
    cleanupTestBloomConfig();

    expect(fs.readFileSync(settings, 'utf8')).toBe('mine');
    expect(fs.existsSync(backup)).toBe(false);
  });

  it('removes the test file when the developer had none', () => {
    createTestBloomConfig(path.join(home, 'scans'));
    fs.writeFileSync(settings, 'the test applied these');
    cleanupTestBloomConfig();

    expect(fs.existsSync(settings)).toBe(false);
  });

  it("recovers the developer's settings after a run that crashed before cleanup", () => {
    fs.mkdirSync(bloom, { recursive: true });
    fs.writeFileSync(settings, 'mine');
    createTestBloomConfig(path.join(home, 'scans'));
    fs.writeFileSync(settings, 'the crashed test applied these');

    // The next run starts without the previous one having cleaned up.
    createTestBloomConfig(path.join(home, 'scans'));
    expect(fs.existsSync(settings)).toBe(false);
    cleanupTestBloomConfig();

    expect(fs.readFileSync(settings, 'utf8')).toBe('mine');
  });
});
