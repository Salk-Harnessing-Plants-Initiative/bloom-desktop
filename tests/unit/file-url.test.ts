import { describe, it, expect } from 'vitest';
import { pathToFileUrl } from '../../src/utils/file-url';

describe('pathToFileUrl', () => {
  it('should convert macOS absolute path', () => {
    expect(pathToFileUrl('/Users/foo/bar.png')).toBe(
      'file:///Users/foo/bar.png'
    );
  });

  it('should convert Linux absolute path', () => {
    expect(pathToFileUrl('/home/user/images/scan.png')).toBe(
      'file:///home/user/images/scan.png'
    );
  });

  it('should convert Windows path with backslashes', () => {
    expect(pathToFileUrl('C:\\Users\\foo\\bar.png')).toBe(
      'file:///C:/Users/foo/bar.png'
    );
  });

  it('should handle Windows path with forward slashes', () => {
    expect(pathToFileUrl('C:/Users/foo/bar.png')).toBe(
      'file:///C:/Users/foo/bar.png'
    );
  });

  it('should encode spaces in path', () => {
    expect(pathToFileUrl('/Users/foo bar/img.png')).toBe(
      'file:///Users/foo%20bar/img.png'
    );
  });

  it('should handle Windows path with spaces', () => {
    expect(pathToFileUrl('C:\\Users\\foo bar\\img.png')).toBe(
      'file:///C:/Users/foo%20bar/img.png'
    );
  });

  it('should handle path with no special characters', () => {
    expect(pathToFileUrl('/simple/path/image.png')).toBe(
      'file:///simple/path/image.png'
    );
  });

  it('should handle lowercase Windows drive letter', () => {
    expect(pathToFileUrl('d:\\data\\scan\\001.png')).toBe(
      'file:///d:/data/scan/001.png'
    );
  });
});
