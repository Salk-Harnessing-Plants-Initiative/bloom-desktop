// @vitest-environment node
/**
 * Tests for the GraviScan output-directory resolver.
 *
 * Previously the GraviScan IPC handlers (in image-handlers.ts) hardcoded
 * `~/.bloom/graviscan/` for production, ignoring any operator override. This
 * test pins the new behavior: `GRAVISCAN_OUTPUT_DIR` from `~/.bloom/.env`
 * wins in production, with the hardcoded path as the fallback.
 *
 * Note: this deliberately uses `GRAVISCAN_OUTPUT_DIR`, not `SCANS_DIR` —
 * `SCANS_DIR` is already used elsewhere (config-store.ts) for an unrelated
 * setting, so reusing it here would cause a silent regression.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  getGraviscanOutputDir,
  readGraviscanOutputDirFromEnv,
} from '../../src/main/graviscan-output-dir';

describe('readGraviscanOutputDirFromEnv', () => {
  let testDir: string;
  let envPath: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gravi-output-dir-test-'));
    envPath = path.join(testDir, '.env');
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('returns undefined when .env file does not exist', () => {
    expect(readGraviscanOutputDirFromEnv(envPath)).toBeUndefined();
  });

  it('returns undefined when .env has no GRAVISCAN_OUTPUT_DIR line', () => {
    fs.writeFileSync(envPath, 'BLOOM_API_URL=https://api.example.com\n');
    expect(readGraviscanOutputDirFromEnv(envPath)).toBeUndefined();
  });

  it('returns the value when GRAVISCAN_OUTPUT_DIR is set', () => {
    fs.writeFileSync(envPath, 'GRAVISCAN_OUTPUT_DIR=/data/bloom/graviscan\n');
    expect(readGraviscanOutputDirFromEnv(envPath)).toBe(
      '/data/bloom/graviscan'
    );
  });

  it('returns undefined when GRAVISCAN_OUTPUT_DIR is present but empty', () => {
    fs.writeFileSync(envPath, 'GRAVISCAN_OUTPUT_DIR=\n');
    expect(readGraviscanOutputDirFromEnv(envPath)).toBeUndefined();
  });

  it('ignores commented-out GRAVISCAN_OUTPUT_DIR lines', () => {
    fs.writeFileSync(
      envPath,
      '# GRAVISCAN_OUTPUT_DIR=/should/be/ignored\nGRAVISCAN_OUTPUT_DIR=/real/value\n'
    );
    expect(readGraviscanOutputDirFromEnv(envPath)).toBe('/real/value');
  });

  it('trims whitespace around the value', () => {
    fs.writeFileSync(
      envPath,
      'GRAVISCAN_OUTPUT_DIR=   /data/bloom/graviscan   \n'
    );
    expect(readGraviscanOutputDirFromEnv(envPath)).toBe(
      '/data/bloom/graviscan'
    );
  });

  it('does not pick up an unrelated SCANS_DIR key', () => {
    fs.writeFileSync(envPath, 'SCANS_DIR=/home/user/.bloom/scans\n');
    expect(readGraviscanOutputDirFromEnv(envPath)).toBeUndefined();
  });
});

describe('getGraviscanOutputDir', () => {
  let testDir: string;
  let envPath: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gravi-output-dir-test-'));
    envPath = path.join(testDir, '.env');
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('dev mode: returns <appPath>/.graviscan regardless of .env contents', () => {
    fs.writeFileSync(
      envPath,
      'GRAVISCAN_OUTPUT_DIR=/should/be/ignored/in/dev\n'
    );
    const result = getGraviscanOutputDir({
      envPath,
      homeDir: '/home/u',
      appPath: '/repo',
      isDev: true,
    });
    expect(result).toBe(path.join('/repo', '.graviscan'));
  });

  it('production, .env missing: falls back to ~/.bloom/graviscan', () => {
    const result = getGraviscanOutputDir({
      envPath,
      homeDir: '/home/u',
      appPath: '/repo',
      isDev: false,
    });
    expect(result).toBe(path.join('/home/u', '.bloom', 'graviscan'));
  });

  it('production with GRAVISCAN_OUTPUT_DIR in .env: returns the configured path', () => {
    fs.writeFileSync(envPath, 'GRAVISCAN_OUTPUT_DIR=/data/bloom/graviscan\n');
    const result = getGraviscanOutputDir({
      envPath,
      homeDir: '/home/u',
      appPath: '/repo',
      isDev: false,
    });
    expect(result).toBe('/data/bloom/graviscan');
  });

  it('production with empty GRAVISCAN_OUTPUT_DIR: falls back to ~/.bloom/graviscan', () => {
    fs.writeFileSync(envPath, 'GRAVISCAN_OUTPUT_DIR=\n');
    const result = getGraviscanOutputDir({
      envPath,
      homeDir: '/home/u',
      appPath: '/repo',
      isDev: false,
    });
    expect(result).toBe(path.join('/home/u', '.bloom', 'graviscan'));
  });
});
