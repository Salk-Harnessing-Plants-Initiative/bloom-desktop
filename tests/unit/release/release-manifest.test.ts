/**
 * Unit tests for release asset collection and manifest / SHA256SUMS
 * generation used by the release workflow's manifest job.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  releaseAssetName,
  collectReleaseFiles,
  buildManifest,
  formatSha256Sums,
  writeReleaseBundle,
} from '../../../scripts/release/release-manifest';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-release-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeFile(rel: string, content = 'x'.repeat(16)): string {
  const full = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function makeWindowsOutput(dir = 'win'): void {
  writeFile(`${dir}/squirrel.windows/x64/Bloom Desktop-0.2.0 Setup.exe`, 'exe');
  writeFile(
    `${dir}/squirrel.windows/x64/bloom_desktop-0.2.0-full.nupkg`,
    'nup'
  );
  writeFile(`${dir}/squirrel.windows/x64/RELEASES`, 'rel');
}

function makeLinuxOutput(dir = 'linux'): void {
  writeFile(`${dir}/deb/x64/bloom-desktop_0.2.0_amd64.deb`, 'deb');
}

describe('releaseAssetName', () => {
  it('replaces spaces with dashes', () => {
    expect(releaseAssetName('Bloom Desktop-0.2.0 Setup.exe')).toBe(
      'Bloom-Desktop-0.2.0-Setup.exe'
    );
  });

  it('leaves names without spaces unchanged', () => {
    expect(releaseAssetName('bloom-desktop_0.2.0_amd64.deb')).toBe(
      'bloom-desktop_0.2.0_amd64.deb'
    );
  });
});

describe('collectReleaseFiles', () => {
  it('finds the Windows Setup.exe, full .nupkg and RELEASES', () => {
    makeWindowsOutput();
    const files = collectReleaseFiles(path.join(tmp, 'win'), 'windows');
    expect(files.map((f) => f.name).sort()).toEqual([
      'Bloom-Desktop-0.2.0-Setup.exe',
      'RELEASES',
      'bloom_desktop-0.2.0-full.nupkg',
    ]);
    expect(files.every((f) => f.target === 'windows')).toBe(true);
  });

  it('finds the Linux .deb', () => {
    makeLinuxOutput();
    const files = collectReleaseFiles(path.join(tmp, 'linux'), 'linux');
    expect(files).toEqual([
      {
        source: path.join(tmp, 'linux/deb/x64/bloom-desktop_0.2.0_amd64.deb'),
        name: 'bloom-desktop_0.2.0_amd64.deb',
        target: 'linux',
      },
    ]);
  });

  it('ignores delta .nupkg files', () => {
    makeWindowsOutput();
    writeFile('win/squirrel.windows/x64/bloom_desktop-0.2.0-delta.nupkg');
    const names = collectReleaseFiles(path.join(tmp, 'win'), 'windows').map(
      (f) => f.name
    );
    expect(names).not.toContain('bloom_desktop-0.2.0-delta.nupkg');
  });

  it.each([
    ['Setup.exe', 'Bloom Desktop-0.2.0 Setup.exe'],
    ['full .nupkg', 'bloom_desktop-0.2.0-full.nupkg'],
    ['RELEASES', 'RELEASES'],
  ])('fails when the Windows %s is missing', (label, file) => {
    makeWindowsOutput();
    fs.rmSync(path.join(tmp, 'win/squirrel.windows/x64', file));
    expect(() => collectReleaseFiles(path.join(tmp, 'win'), 'windows')).toThrow(
      `windows: expected exactly one ${label}, found 0`
    );
  });

  it('fails when the .deb is missing', () => {
    fs.mkdirSync(path.join(tmp, 'linux'));
    expect(() => collectReleaseFiles(path.join(tmp, 'linux'), 'linux')).toThrow(
      'linux: expected exactly one .deb, found 0'
    );
  });

  it('fails when there are two .deb files', () => {
    makeLinuxOutput();
    writeFile('linux/deb/x64/bloom-desktop_0.1.0_amd64.deb');
    expect(() => collectReleaseFiles(path.join(tmp, 'linux'), 'linux')).toThrow(
      'linux: expected exactly one .deb, found 2'
    );
  });

  it('fails on a zero-byte file and names it', () => {
    makeLinuxOutput();
    fs.writeFileSync(
      path.join(tmp, 'linux/deb/x64/bloom-desktop_0.2.0_amd64.deb'),
      ''
    );
    expect(() => collectReleaseFiles(path.join(tmp, 'linux'), 'linux')).toThrow(
      'bloom-desktop_0.2.0_amd64.deb is empty'
    );
  });

  it('fails when the directory does not exist', () => {
    expect(() =>
      collectReleaseFiles(path.join(tmp, 'missing'), 'linux')
    ).toThrow(/does not exist/);
  });
});

describe('buildManifest', () => {
  it('records version, tag, commit, build time and each file', () => {
    makeLinuxOutput();
    const files = collectReleaseFiles(path.join(tmp, 'linux'), 'linux');
    const manifest = buildManifest({
      version: '0.2.0',
      tag: 'v0.2.0',
      commit: 'abc1234',
      builtAt: '2026-10-13T20:00:00.000Z',
      files,
    });

    expect(manifest).toEqual({
      version: '0.2.0',
      tag: 'v0.2.0',
      commit: 'abc1234',
      built_at: '2026-10-13T20:00:00.000Z',
      files: [
        {
          name: 'bloom-desktop_0.2.0_amd64.deb',
          target: 'linux',
          size: 3,
          sha256: sha256('deb'),
        },
      ],
    });
  });

  it('sorts files by target then name', () => {
    makeWindowsOutput();
    makeLinuxOutput();
    const files = [
      ...collectReleaseFiles(path.join(tmp, 'win'), 'windows'),
      ...collectReleaseFiles(path.join(tmp, 'linux'), 'linux'),
    ];
    const names = buildManifest({
      version: '0.2.0',
      tag: 'v0.2.0',
      commit: 'abc1234',
      builtAt: '2026-10-13T20:00:00.000Z',
      files,
    }).files.map((f) => `${f.target}/${f.name}`);

    expect(names).toEqual([
      'linux/bloom-desktop_0.2.0_amd64.deb',
      'windows/Bloom-Desktop-0.2.0-Setup.exe',
      'windows/RELEASES',
      'windows/bloom_desktop-0.2.0-full.nupkg',
    ]);
  });

  it('fails when two files would get the same asset name', () => {
    const a = writeFile('a/x y.deb', 'a');
    const b = writeFile('b/x-y.deb', 'b');
    expect(() =>
      buildManifest({
        version: '0.2.0',
        tag: 'v0.2.0',
        commit: 'abc1234',
        builtAt: '2026-10-13T20:00:00.000Z',
        files: [
          { source: a, name: 'x-y.deb', target: 'linux' },
          { source: b, name: 'x-y.deb', target: 'linux' },
        ],
      })
    ).toThrow('Duplicate release asset name: x-y.deb');
  });
});

describe('formatSha256Sums', () => {
  it('writes one "<sha256>  <name>" line per file, in manifest order', () => {
    const text = formatSha256Sums({
      version: '0.2.0',
      tag: 'v0.2.0',
      commit: 'abc1234',
      built_at: '2026-10-13T20:00:00.000Z',
      files: [
        { name: 'a.deb', target: 'linux', size: 1, sha256: 'aa' },
        { name: 'b.exe', target: 'windows', size: 2, sha256: 'bb' },
      ],
    });
    expect(text).toBe('aa  a.deb\nbb  b.exe\n');
  });
});

describe('writeReleaseBundle', () => {
  it('copies assets under their release names and writes manifest + SHA256SUMS', () => {
    makeWindowsOutput();
    makeLinuxOutput();
    const out = path.join(tmp, 'bundle');

    const manifest = writeReleaseBundle({
      version: '0.2.0',
      tag: 'v0.2.0',
      commit: 'abc1234',
      builtAt: '2026-10-13T20:00:00.000Z',
      windowsDir: path.join(tmp, 'win'),
      linuxDir: path.join(tmp, 'linux'),
      outDir: out,
    });

    expect(fs.readdirSync(out).sort()).toEqual([
      'Bloom-Desktop-0.2.0-Setup.exe',
      'RELEASES',
      'SHA256SUMS',
      'bloom-desktop_0.2.0_amd64.deb',
      'bloom_desktop-0.2.0-full.nupkg',
      'manifest.json',
    ]);
    expect(
      JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'))
    ).toEqual(manifest);
    expect(fs.readFileSync(path.join(out, 'SHA256SUMS'), 'utf8')).toBe(
      formatSha256Sums(manifest)
    );
    for (const file of manifest.files) {
      const bytes = fs.readFileSync(path.join(out, file.name));
      expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(
        file.sha256
      );
    }
  });

  it('refuses a non-empty output directory', () => {
    makeWindowsOutput();
    makeLinuxOutput();
    writeFile('bundle/stale.txt');
    expect(() =>
      writeReleaseBundle({
        version: '0.2.0',
        tag: 'v0.2.0',
        commit: 'abc1234',
        builtAt: '2026-10-13T20:00:00.000Z',
        windowsDir: path.join(tmp, 'win'),
        linuxDir: path.join(tmp, 'linux'),
        outDir: path.join(tmp, 'bundle'),
      })
    ).toThrow(/is not empty/);
  });
});
