/**
 * Unit tests for the electron-forge `make` artifact resolver.
 *
 * Verifies findMakerArtifact() locates the installer artifact electron-forge's
 * maker stage produces under out/make/, per-platform, without depending on
 * electron-forge's exact nesting (which varies by maker/version).
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { findMakerArtifact } from '../integration/test-make-artifacts';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'make-artifacts-test-'));
  tempDirs.push(dir);
  return dir;
}

function writeFile(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('findMakerArtifact', () => {
  it('finds a DMG under a macOS-shaped nested path', () => {
    const makeDir = makeTempDir();
    writeFile(
      path.join(makeDir, 'dmg', 'Bloom Desktop-1.0.0-arm64.dmg'),
      'fake-dmg-bytes'
    );

    const result = findMakerArtifact(makeDir, 'darwin');

    expect(result).not.toBeNull();
    expect(result?.path.endsWith('.dmg')).toBe(true);
    expect(result?.size).toBeGreaterThan(0);
  });

  it('finds a Squirrel installer exe under a Windows-shaped nested path', () => {
    const makeDir = makeTempDir();
    writeFile(
      path.join(makeDir, 'squirrel.windows', 'x64', 'BloomDesktopSetup.exe'),
      'fake-exe-bytes'
    );

    const result = findMakerArtifact(makeDir, 'win32');

    expect(result).not.toBeNull();
    expect(result?.path.endsWith('.exe')).toBe(true);
  });

  it('finds a .nupkg when no exe is present on Windows', () => {
    const makeDir = makeTempDir();
    writeFile(
      path.join(
        makeDir,
        'squirrel.windows',
        'x64',
        'bloomdesktop-1.0.0-full.nupkg'
      ),
      'fake-nupkg-bytes'
    );

    const result = findMakerArtifact(makeDir, 'win32');

    expect(result).not.toBeNull();
    expect(result?.path.endsWith('.nupkg')).toBe(true);
  });

  it('returns null when the directory has no matching artifact', () => {
    const makeDir = makeTempDir();
    writeFile(path.join(makeDir, 'README.txt'), 'not an artifact');

    const result = findMakerArtifact(makeDir, 'darwin');

    expect(result).toBeNull();
  });

  it('returns null when the only matching file is zero bytes', () => {
    const makeDir = makeTempDir();
    writeFile(path.join(makeDir, 'dmg', 'Bloom Desktop.dmg'), '');

    const result = findMakerArtifact(makeDir, 'darwin');

    expect(result).toBeNull();
  });

  it('prefers the DMG over a ZIP when both exist on macOS', () => {
    const makeDir = makeTempDir();
    writeFile(path.join(makeDir, 'zip', 'Bloom Desktop.zip'), 'fake-zip-bytes');
    writeFile(path.join(makeDir, 'dmg', 'Bloom Desktop.dmg'), 'fake-dmg-bytes');

    const result = findMakerArtifact(makeDir, 'darwin');

    expect(result).not.toBeNull();
    expect(result?.path.endsWith('.dmg')).toBe(true);
  });

  it('returns null for an empty directory', () => {
    const makeDir = makeTempDir();

    const result = findMakerArtifact(makeDir, 'darwin');

    expect(result).toBeNull();
  });

  it('finds a .deb under a Linux-shaped nested path', () => {
    const makeDir = makeTempDir();
    writeFile(
      path.join(makeDir, 'deb', 'x64', 'bloom-desktop_0.1.0_amd64.deb'),
      'fake-deb-bytes'
    );

    const result = findMakerArtifact(makeDir, 'linux');

    expect(result).not.toBeNull();
    expect(result?.path.endsWith('.deb')).toBe(true);
    expect(result?.size).toBeGreaterThan(0);
  });

  it('prefers .deb over .rpm when both exist on Linux', () => {
    const makeDir = makeTempDir();
    writeFile(
      path.join(makeDir, 'rpm', 'x64', 'bloom-desktop-0.1.0.x86_64.rpm'),
      'fake-rpm-bytes'
    );
    writeFile(
      path.join(makeDir, 'deb', 'x64', 'bloom-desktop_0.1.0_amd64.deb'),
      'fake-deb-bytes'
    );

    const result = findMakerArtifact(makeDir, 'linux');

    expect(result).not.toBeNull();
    expect(result?.path.endsWith('.deb')).toBe(true);
  });
});
