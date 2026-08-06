/**
 * Unit tests for resolveStagedAppPath(), a pure (platform, arch) -> path
 * function extracted from the darwin/win32/linux branching already
 * duplicated between scripts/test-package-database-full.sh and
 * tests/integration/test-package.ts.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { resolveStagedAppPath } from '../integration/lib/resolve-staged-app-path';

const repoRoot = path.join('C:', 'repo');

describe('resolveStagedAppPath', () => {
  it('resolves the macOS .app bundle inner binary path', () => {
    const result = resolveStagedAppPath('darwin', 'arm64', repoRoot);

    expect(result).toBe(
      path.join(
        repoRoot,
        'out',
        'Bloom Desktop-darwin-arm64',
        'Bloom Desktop.app',
        'Contents',
        'MacOS',
        'Bloom Desktop'
      )
    );
  });

  it('resolves the Windows .exe path', () => {
    const result = resolveStagedAppPath('win32', 'x64', repoRoot);

    expect(result).toBe(
      path.join(repoRoot, 'out', 'Bloom Desktop-win32-x64', 'Bloom Desktop.exe')
    );
  });

  it('resolves the Linux binary path', () => {
    const result = resolveStagedAppPath('linux', 'x64', repoRoot);

    expect(result).toBe(
      path.join(repoRoot, 'out', 'Bloom Desktop-linux-x64', 'bloom-desktop')
    );
  });

  it('throws for an unsupported platform', () => {
    expect(() => resolveStagedAppPath('freebsd', 'x64', repoRoot)).toThrow(
      /unsupported platform/i
    );
  });
});
