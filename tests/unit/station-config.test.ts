import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createStationConfig,
  saveStationConfig,
} from '../../src/main/station-config';
import {
  getDefaultConfig,
  loadEnvConfig,
  saveEnvConfig,
  validateConfig,
  type MachineConfig,
} from '../../src/main/config-store';

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
      /^Couldn't read this station's settings file \(.*\.env\): EISDIR$/
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

describe('saveStationConfig (#485)', () => {
  let dir: string;
  let envPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-station-save-'));
    envPath = path.join(dir, '.env');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const stored = () => [
    'SCANNER_MODE=cylinderscan',
    'SCANNER_NAME=PBIOBScanner',
    'CAMERA_IP_ADDRESS=10.0.0.5',
    `SCANS_DIR=${dir}`,
    'BLOOM_API_URL=https://bloom.example.org/api',
    'BLOOM_SCANNER_USERNAME=pbiob',
    'BLOOM_SCANNER_PASSWORD=real-password',
    'BLOOM_ANON_KEY=anon',
    'NUM_FRAMES=72',
    'SECONDS_PER_ROT=7',
  ];

  /** The form as Machine Configuration submits it: password left blank to keep it. */
  const form = (extra: Partial<MachineConfig> = {}): MachineConfig => ({
    scanner_mode: 'cylinderscan',
    scanner_name: 'PBIOBScanner',
    camera_ip_address: '10.0.0.5',
    scans_dir: dir,
    bloom_api_url: 'https://bloom.example.org/api',
    bloom_scanner_username: 'pbiob',
    bloom_scanner_password: '',
    bloom_anon_key: 'anon',
    num_frames: 72,
    seconds_per_rot: 7,
    ...extra,
  });

  const deps = (station: ReturnType<typeof createStationConfig>) => ({
    station,
    save: (config: MachineConfig) => saveEnvConfig(config, envPath),
    validate: validateConfig,
  });

  it('saves nothing while the file exists but cannot be read', () => {
    fs.mkdirSync(envPath);
    const station = createStationConfig(envPath);
    const result = saveStationConfig(form(), deps(station));

    expect(result.success).toBe(false);
    expect(result.errors?.general).toMatch(
      /Nothing was saved.*contact the Bloom team/
    );
    expect(fs.statSync(envPath).isDirectory()).toBe(true);
  });

  it("keeps the file's password when the start-up read had failed but the file is readable now", () => {
    // Start-up: the file was locked, so the kept copy is the defaults (no password).
    fs.mkdirSync(envPath);
    const station = createStationConfig(envPath);
    expect(station.get().error).not.toBeNull();

    // The lock clears; the operator saves with the password left blank.
    fs.rmdirSync(envPath);
    fs.writeFileSync(envPath, stored().join('\n') + '\n');
    const result = saveStationConfig(
      form({ scanner_name: 'PBIOBScanner2' }),
      deps(station)
    );

    expect(result.success).toBe(true);
    const saved = loadEnvConfig(envPath);
    expect(saved.bloom_scanner_password).toBe('real-password');
    expect(saved.scanner_name).toBe('PBIOBScanner2');
  });

  it('keeps the copy in step with what was saved', () => {
    fs.writeFileSync(envPath, stored().join('\n') + '\n');
    const station = createStationConfig(envPath);
    station.get();

    saveStationConfig(form({ scanner_name: 'SlowScanner' }), deps(station));
    expect(station.get().config.scanner_name).toBe('SlowScanner');
    expect(station.get().error).toBeNull();
  });

  it('saves nothing when the form is invalid', () => {
    fs.writeFileSync(envPath, stored().join('\n') + '\n');
    const station = createStationConfig(envPath);
    const before = fs.readFileSync(envPath, 'utf-8');

    const result = saveStationConfig(form({ scanner_name: '' }), deps(station));
    expect(result.success).toBe(false);
    expect(fs.readFileSync(envPath, 'utf-8')).toBe(before);
  });
});
