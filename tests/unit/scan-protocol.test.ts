/**
 * Unit tests: resolveScanPath() — path-traversal + containment validation
 * for the bloom-scan:// protocol handler (#93).
 *
 * Accepts an injectable path module (defaulting to the ambient `path`) so
 * Windows-specific behavior (drive letters, case-insensitivity) can be
 * tested deterministically on any CI host OS via `path.win32`, rather than
 * relying on the ambient module's host-OS-dependent semantics.
 */

import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  resolveScanPath,
  createScanProtocolHandler,
} from '../../src/main/scan-protocol';
import { pathToFileUrl } from '../../src/utils/file-url';

describe('resolveScanPath — POSIX', () => {
  const scansDir = '/home/phenotyper/bloom-scans';

  it('resolves a path inside scansDir', () => {
    const result = resolveScanPath(
      `${scansDir}/2026-08-03/scan.png`,
      scansDir,
      path.posix
    );
    expect(result).toBe(`${scansDir}/2026-08-03/scan.png`);
  });

  it('rejects a path escaping scansDir via ..', () => {
    const result = resolveScanPath(
      `${scansDir}/../etc/passwd`,
      scansDir,
      path.posix
    );
    expect(result).toBeNull();
  });

  it('rejects a sibling directory sharing a name prefix', () => {
    const result = resolveScanPath(
      '/home/phenotyper/bloom-scans-archive/x.png',
      scansDir,
      path.posix
    );
    expect(result).toBeNull();
  });
});

describe('resolveScanPath — Windows (path.win32, deterministic on any host OS)', () => {
  const scansDir = 'C:\\Users\\phenotyper\\bloom-scans';

  it('resolves a path inside scansDir', () => {
    const result = resolveScanPath(
      `${scansDir}\\2026-08-03\\scan.png`,
      scansDir,
      path.win32
    );
    expect(result).toBe(`${scansDir}\\2026-08-03\\scan.png`);
  });

  it('rejects a path escaping scansDir via ..', () => {
    const result = resolveScanPath(
      `${scansDir}\\..\\..\\Windows\\System32`,
      scansDir,
      path.win32
    );
    expect(result).toBeNull();
  });

  it('rejects an absolute-path override (different drive letter)', () => {
    const result = resolveScanPath('D:\\secrets\\x.png', scansDir, path.win32);
    expect(result).toBeNull();
  });

  it('rejects a sibling directory sharing a name prefix', () => {
    const result = resolveScanPath(
      'C:\\Users\\phenotyper\\bloom-scans-archive\\x.png',
      scansDir,
      path.win32
    );
    expect(result).toBeNull();
  });

  it('accepts a path differing only in case (case-insensitive containment)', () => {
    const result = resolveScanPath(
      'c:\\users\\phenotyper\\BLOOM-SCANS\\2026-08-03\\scan.png',
      scansDir,
      path.win32
    );
    expect(result).not.toBeNull();
  });
});

describe('resolveScanPath — case sensitivity is POSIX-only when using path.posix', () => {
  it('treats a differently-cased path as outside scansDir on POSIX', () => {
    const scansDir = '/home/phenotyper/bloom-scans';
    const result = resolveScanPath(
      '/home/phenotyper/BLOOM-SCANS/x.png',
      scansDir,
      path.posix
    );
    expect(result).toBeNull();
  });
});

describe('createScanProtocolHandler — reads scans_dir fresh on every request', () => {
  it('serves a request under the newly-configured scans_dir, not one cached from an earlier request', async () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-scans-a-'));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-scans-b-'));
    try {
      fs.writeFileSync(path.join(dirA, 'a.png'), 'a-content');
      fs.writeFileSync(path.join(dirB, 'b.png'), 'b-content');

      const getScansDir = vi
        .fn()
        .mockReturnValueOnce(dirA)
        .mockReturnValue(dirB);
      const handler = createScanProtocolHandler(getScansDir);

      // Build the same bloom-scan:// URL shape the renderer actually
      // produces via pathToFileUrl(), not a hand-rolled one — a
      // hand-rolled URL without the leading-slash-before-drive-letter
      // convention isn't parseable the same way (the embedded ":" would
      // be misread as part of a host/port instead of the path).
      const firstUrl = pathToFileUrl(path.join(dirA, 'a.png'));
      const firstResponse = await handler(new Request(firstUrl));
      expect(firstResponse.status).toBe(200);

      // Second request — simulating scans_dir having changed since the
      // handler was registered — resolves against dirB, not a value
      // cached from the first call.
      const secondUrl = pathToFileUrl(path.join(dirB, 'b.png'));
      const secondResponse = await handler(new Request(secondUrl));
      expect(secondResponse.status).toBe(200);

      expect(getScansDir).toHaveBeenCalledTimes(2);
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });

  it('rejects a request outside the currently-configured scans_dir', async () => {
    const scansDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-scans-'));
    try {
      const handler = createScanProtocolHandler(() => scansDir);
      const outsideUrl = `bloom-scan://${encodeURI('/etc/passwd')}`;
      const response = await handler(new Request(outsideUrl));
      expect(response.status).toBe(403);
    } finally {
      fs.rmSync(scansDir, { recursive: true, force: true });
    }
  });
});
