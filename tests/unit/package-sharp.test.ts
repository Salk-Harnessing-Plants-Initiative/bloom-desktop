/**
 * Tests for scripts/package-sharp.ts: which packages the packaged app needs
 * for sharp on each platform, failing loudly when one is missing, and copying
 * them (symlinks included) into the app.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  sharpNativePackages,
  sharpPackages,
  copySharpIntoApp,
} from '../../scripts/package-sharp';

let tmp: string;
let nodeModules: string;

function addPackage(name: string, dependencies?: Record<string, string>) {
  const dir = path.join(nodeModules, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name, dependencies })
  );
  return dir;
}

function addSharp() {
  addPackage('sharp', {
    '@img/colour': '^1.0.0',
    'detect-libc': '^2.1.2',
    semver: '^7.7.3',
  });
  addPackage('@img/colour');
  addPackage('detect-libc');
  addPackage('semver');
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'package-sharp-'));
  nodeModules = path.join(tmp, 'node_modules');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('sharpNativePackages', () => {
  it('needs only the binary package on Windows, where libvips is inside it', () => {
    expect(sharpNativePackages('win32', 'x64')).toEqual([
      '@img/sharp-win32-x64',
    ]);
  });

  it('needs the binary and libvips packages on Linux and macOS', () => {
    expect(sharpNativePackages('linux', 'x64')).toEqual([
      '@img/sharp-linux-x64',
      '@img/sharp-libvips-linux-x64',
    ]);
    expect(sharpNativePackages('darwin', 'arm64')).toEqual([
      '@img/sharp-darwin-arm64',
      '@img/sharp-libvips-darwin-arm64',
    ]);
  });
});

describe('sharpPackages', () => {
  it('lists sharp, its dependencies and the platform packages', () => {
    addSharp();
    addPackage('@img/sharp-win32-x64');

    expect(sharpPackages(nodeModules, 'win32', 'x64').sort()).toEqual(
      [
        '@img/colour',
        '@img/sharp-win32-x64',
        'detect-libc',
        'semver',
        'sharp',
      ].sort()
    );
  });

  it('follows dependencies of dependencies', () => {
    addSharp();
    addPackage('semver', { 'lru-cache': '^6.0.0' });
    addPackage('lru-cache');
    addPackage('@img/sharp-win32-x64');

    expect(sharpPackages(nodeModules, 'win32', 'x64')).toContain('lru-cache');
  });

  it('leaves out other platforms’ packages', () => {
    addSharp();
    addPackage('@img/sharp-linux-x64');
    addPackage('@img/sharp-libvips-linux-x64');
    addPackage('@img/sharp-win32-x64');

    const names = sharpPackages(nodeModules, 'linux', 'x64');
    expect(names).toContain('@img/sharp-libvips-linux-x64');
    expect(names).not.toContain('@img/sharp-win32-x64');
  });

  it('throws, naming the package, when the platform binary is missing', () => {
    addSharp();

    expect(() => sharpPackages(nodeModules, 'win32', 'x64')).toThrow(
      /@img\/sharp-win32-x64 is not installed/
    );
  });

  it('throws when libvips is missing on Linux', () => {
    addSharp();
    addPackage('@img/sharp-linux-x64');

    expect(() => sharpPackages(nodeModules, 'linux', 'x64')).toThrow(
      /@img\/sharp-libvips-linux-x64 is not installed/
    );
  });

  it('throws when sharp itself is missing', () => {
    expect(() => sharpPackages(nodeModules, 'win32', 'x64')).toThrow(
      /sharp is not installed/
    );
  });
});

describe('copySharpIntoApp', () => {
  it('copies every package into the app’s node_modules with its files', async () => {
    addSharp();
    const binary = addPackage('@img/sharp-win32-x64');
    fs.mkdirSync(path.join(binary, 'lib'));
    fs.writeFileSync(path.join(binary, 'lib', 'sharp-win32-x64.node'), 'bin');
    const buildPath = path.join(tmp, 'app');

    const copied = await copySharpIntoApp(
      nodeModules,
      buildPath,
      'win32',
      'x64'
    );

    for (const name of copied) {
      expect(
        fs.existsSync(
          path.join(buildPath, 'node_modules', name, 'package.json')
        )
      ).toBe(true);
    }
    expect(
      fs.readFileSync(
        path.join(
          buildPath,
          'node_modules',
          '@img/sharp-win32-x64/lib/sharp-win32-x64.node'
        ),
        'utf8'
      )
    ).toBe('bin');
  });

  it.skipIf(process.platform === 'win32')(
    'keeps libvips’ relative symlinks as symlinks',
    async () => {
      addSharp();
      addPackage('@img/sharp-linux-x64');
      const libvips = addPackage('@img/sharp-libvips-linux-x64');
      const lib = path.join(libvips, 'lib');
      fs.mkdirSync(lib);
      fs.writeFileSync(path.join(lib, 'libvips-cpp.so.8.17.3'), 'lib');
      fs.symlinkSync('libvips-cpp.so.8.17.3', path.join(lib, 'libvips-cpp.so'));
      const buildPath = path.join(tmp, 'app');

      await copySharpIntoApp(nodeModules, buildPath, 'linux', 'x64');

      const link = path.join(
        buildPath,
        'node_modules/@img/sharp-libvips-linux-x64/lib/libvips-cpp.so'
      );
      expect(fs.readlinkSync(link)).toBe('libvips-cpp.so.8.17.3');
    }
  );

  it('copies nothing when a package is missing', async () => {
    addSharp();
    const buildPath = path.join(tmp, 'app');

    await expect(
      copySharpIntoApp(nodeModules, buildPath, 'win32', 'x64')
    ).rejects.toThrow(/not installed/);
    expect(fs.existsSync(path.join(buildPath, 'node_modules'))).toBe(false);
  });
});
