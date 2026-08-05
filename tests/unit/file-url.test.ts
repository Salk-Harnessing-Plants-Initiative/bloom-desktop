import { describe, it, expect } from 'vitest';
import { pathToFileUrl } from '../../src/utils/file-url';

/**
 * pathToFileUrl() encodes the real path as a `path` query parameter behind
 * a fixed `local-file` host, rather than putting it in the URL's authority
 * or path position directly.
 *
 * Why: bloom-scan:// is registered with `standard: true` (see main.ts), so
 * Chromium's WHATWG "special scheme" URL parser applies to it — the same
 * parser used for http/https/file. That parser collapses extra leading
 * slashes after `//` and reads the first path segment as the host. A
 * previous implementation built URLs like `bloom-scan:///C:/foo/bar.png`
 * (the file:// triple-slash convention) — but unlike the literal `file:`
 * scheme, which has spec-mandated drive-letter/host quirk handling, a
 * *custom* standard scheme gets no such special-casing. Chromium silently
 * parsed "C:" as host "c" (lowercased, colon dropped), corrupting the path
 * before it ever reached the protocol handler — confirmed via a real
 * Electron E2E run, not just static analysis (see PR discussion). Query
 * parameters are untouched by authority/path parsing, so this class of bug
 * can't recur regardless of the path's shape.
 */
describe('pathToFileUrl', () => {
  it('should convert macOS absolute path', () => {
    expect(pathToFileUrl('/Users/foo/bar.png')).toBe(
      'bloom-scan://local-file/?path=' +
        encodeURIComponent('/Users/foo/bar.png')
    );
  });

  it('should convert Linux absolute path', () => {
    expect(pathToFileUrl('/home/user/images/scan.png')).toBe(
      'bloom-scan://local-file/?path=' +
        encodeURIComponent('/home/user/images/scan.png')
    );
  });

  it('should convert Windows path with backslashes', () => {
    expect(pathToFileUrl('C:\\Users\\foo\\bar.png')).toBe(
      'bloom-scan://local-file/?path=' +
        encodeURIComponent('C:/Users/foo/bar.png')
    );
  });

  it('should handle Windows path with forward slashes', () => {
    expect(pathToFileUrl('C:/Users/foo/bar.png')).toBe(
      'bloom-scan://local-file/?path=' +
        encodeURIComponent('C:/Users/foo/bar.png')
    );
  });

  it('should encode spaces in path', () => {
    expect(pathToFileUrl('/Users/foo bar/img.png')).toBe(
      'bloom-scan://local-file/?path=' +
        encodeURIComponent('/Users/foo bar/img.png')
    );
  });

  it('should handle Windows path with spaces', () => {
    expect(pathToFileUrl('C:\\Users\\foo bar\\img.png')).toBe(
      'bloom-scan://local-file/?path=' +
        encodeURIComponent('C:/Users/foo bar/img.png')
    );
  });

  it('should handle path with no special characters', () => {
    expect(pathToFileUrl('/simple/path/image.png')).toBe(
      'bloom-scan://local-file/?path=' +
        encodeURIComponent('/simple/path/image.png')
    );
  });

  it('should handle lowercase Windows drive letter', () => {
    expect(pathToFileUrl('d:\\data\\scan\\001.png')).toBe(
      'bloom-scan://local-file/?path=' +
        encodeURIComponent('d:/data/scan/001.png')
    );
  });

  it('round-trips through real WHATWG URL parsing (URLSearchParams), preserving the drive letter and colon', () => {
    const url = pathToFileUrl('C:\\Users\\foo\\bar.png');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('path')).toBe('C:/Users/foo/bar.png');
  });

  it('round-trips a path containing special characters (space, #, &) through real URL parsing', () => {
    const original = '/Users/foo bar/weird#name&file.png';
    const url = pathToFileUrl(original);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('path')).toBe(original);
  });
});
