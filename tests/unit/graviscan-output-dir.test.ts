// @vitest-environment node
/**
 * Tests for the GraviScan output-directory resolver.
 *
 * Previously the GraviScan IPC handler hardcoded `~/.bloom/graviscan/` for
 * production, ignoring SCANS_DIR set by the operator in ~/.bloom/.env.
 * This test pins the new behavior: SCANS_DIR from .env wins in production,
 * with the hardcoded path as the fallback.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  getGraviscanOutputDir,
  readScansDirFromEnv,
} from '../../src/main/graviscan-output-dir';

describe('readScansDirFromEnv', () => {
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
    expect(readScansDirFromEnv(envPath)).toBeUndefined();
  });

  it('returns undefined when .env has no SCANS_DIR line', () => {
    fs.writeFileSync(envPath, 'BLOOM_API_URL=https://api.example.com\n');
    expect(readScansDirFromEnv(envPath)).toBeUndefined();
  });

  it('returns the value when SCANS_DIR is set', () => {
    fs.writeFileSync(envPath, 'SCANS_DIR=/data/bloom/graviscan\n');
    expect(readScansDirFromEnv(envPath)).toBe('/data/bloom/graviscan');
  });

  it('returns undefined when SCANS_DIR is present but empty', () => {
    fs.writeFileSync(envPath, 'SCANS_DIR=\n');
    expect(readScansDirFromEnv(envPath)).toBeUndefined();
  });

  it('ignores commented-out SCANS_DIR lines', () => {
    fs.writeFileSync(
      envPath,
      '# SCANS_DIR=/should/be/ignored\nSCANS_DIR=/real/value\n',
    );
    expect(readScansDirFromEnv(envPath)).toBe('/real/value');
  });

  it('trims whitespace around the value', () => {
    fs.writeFileSync(envPath, 'SCANS_DIR=   /data/bloom/graviscan   \n');
    expect(readScansDirFromEnv(envPath)).toBe('/data/bloom/graviscan');
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
    fs.writeFileSync(envPath, 'SCANS_DIR=/should/be/ignored/in/dev\n');
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

  it('production with SCANS_DIR in .env: returns the configured path', () => {
    fs.writeFileSync(envPath, 'SCANS_DIR=/data/bloom/graviscan\n');
    const result = getGraviscanOutputDir({
      envPath,
      homeDir: '/home/u',
      appPath: '/repo',
      isDev: false,
    });
    expect(result).toBe('/data/bloom/graviscan');
  });

  it('production with empty SCANS_DIR: falls back to ~/.bloom/graviscan', () => {
    fs.writeFileSync(envPath, 'SCANS_DIR=\n');
    const result = getGraviscanOutputDir({
      envPath,
      homeDir: '/home/u',
      appPath: '/repo',
      isDev: false,
    });
    expect(result).toBe(path.join('/home/u', '.bloom', 'graviscan'));
  });
});
