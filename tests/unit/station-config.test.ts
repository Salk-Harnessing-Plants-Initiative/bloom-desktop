import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createStationConfig } from '../../src/main/station-config';
import { getDefaultConfig, loadEnvConfig } from '../../src/main/config-store';

describe('station configuration read once at start-up (#477)', () => {
  let dir: string;
  let envPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-station-config-'));
    envPath = path.join(dir, '.env');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const write = (lines: string[]) =>
    fs.writeFileSync(envPath, lines.join('\n') + '\n');

  it('reads the file once and keeps the copy', () => {
    write(['SCANNER_MODE=cylinderscan', 'SCANNER_NAME=PBIOBScanner']);
    const read = vi.fn((p: string) => loadEnvConfig(p, { strict: true }));
    const station = createStationConfig(envPath, read);

    expect(station.get().config.scanner_name).toBe('PBIOBScanner');
    expect(station.get().error).toBeNull();
    write(['SCANNER_MODE=cylinderscan', 'SCANNER_NAME=SlowScanner']);
    expect(station.get().config.scanner_name).toBe('PBIOBScanner');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('reads the file again on reload', () => {
    write(['SCANNER_NAME=SlowScanner']);
    const station = createStationConfig(envPath);
    expect(station.get().config.scanner_name).toBe('SlowScanner');

    write(['SCANNER_NAME=PBIOBScanner']);
    expect(station.reload().config.scanner_name).toBe('PBIOBScanner');
    expect(station.get().config.scanner_name).toBe('PBIOBScanner');
  });

  it('reports a file it cannot read, rather than treating it as empty', () => {
    // A folder where the file should be: it exists, but reading it fails.
    fs.mkdirSync(envPath);
    const station = createStationConfig(envPath);

    const { config, error } = station.get();
    expect(error).toMatch(
      /^Couldn't read this station's settings \(.*\.env\): /
    );
    expect(config).toEqual(getDefaultConfig());
  });

  it('treats a missing file as first-run setup, not an error', () => {
    const station = createStationConfig(envPath);
    const { config, error } = station.get();
    expect(error).toBeNull();
    expect(config.scanner_name).toBe('');
  });

  it('clears the error once the file can be read again', () => {
    fs.mkdirSync(envPath);
    const station = createStationConfig(envPath);
    expect(station.get().error).not.toBeNull();

    fs.rmdirSync(envPath);
    write(['SCANNER_NAME=PBIOBScanner']);
    const { config, error } = station.reload();
    expect(error).toBeNull();
    expect(config.scanner_name).toBe('PBIOBScanner');
  });
});

describe('loadEnvConfig', () => {
  it('still treats an unreadable file as empty unless asked to be strict', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-env-'));
    const envPath = path.join(dir, '.env');
    fs.mkdirSync(envPath);
    try {
      expect(loadEnvConfig(envPath).scanner_name).toBe('');
      expect(() => loadEnvConfig(envPath, { strict: true })).toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
