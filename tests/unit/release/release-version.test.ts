/**
 * Unit tests for the requested-version check used by the release workflow's
 * verify job (the maintainer types the version when starting a release).
 */

import { describe, it, expect } from 'vitest';
import {
  parseRequestedVersion,
  checkRequestedVersion,
  releaseTag,
  isPrerelease,
  formatGithubOutput,
} from '../../../scripts/release/release-version';

describe('parseRequestedVersion', () => {
  it.each([
    ['0.2.0', '0.2.0'],
    ['v0.2.0', '0.2.0'],
    ['1.10.3', '1.10.3'],
    ['0.2.0-rc.1', '0.2.0-rc.1'],
    ['v0.2.0-rc.1', '0.2.0-rc.1'],
  ])('accepts %s', (input, version) => {
    expect(parseRequestedVersion(input)).toBe(version);
  });

  it.each([
    '0.2',
    '0.2.0.1',
    '01.2.0',
    'vv0.2.0',
    'xv0.2.0',
    'release-0.2.0',
    '0.2.0-',
    '0.2.0 ',
    ' 0.2.0',
    '',
  ])('rejects %j', (input) => {
    expect(() => parseRequestedVersion(input)).toThrow(/not a release version/);
  });
});

describe('checkRequestedVersion', () => {
  it('passes when the version matches package.json', () => {
    expect(checkRequestedVersion('0.2.0', '0.2.0')).toBe('0.2.0');
  });

  it('accepts a leading v', () => {
    expect(checkRequestedVersion('v0.2.0', '0.2.0')).toBe('0.2.0');
  });

  it('passes for a matching pre-release', () => {
    expect(checkRequestedVersion('0.2.0-rc.1', '0.2.0-rc.1')).toBe(
      '0.2.0-rc.1'
    );
  });

  it('fails with both versions and what to do when they differ', () => {
    expect(() => checkRequestedVersion('0.2.1', '0.2.0')).toThrow(
      "Requested version 0.2.1 doesn't match package.json (0.2.0). Bump package.json on main first, or type 0.2.0."
    );
  });

  it('fails when only the pre-release part differs', () => {
    expect(() => checkRequestedVersion('0.2.0-rc.1', '0.2.0')).toThrow(
      /package\.json \(0\.2\.0\)/
    );
  });

  it('fails for a malformed version before comparing', () => {
    expect(() => checkRequestedVersion('0.2', '0.2')).toThrow(
      /not a release version/
    );
  });
});

describe('releaseTag', () => {
  it('prefixes the version with v', () => {
    expect(releaseTag('0.2.0')).toBe('v0.2.0');
    expect(releaseTag('0.2.0-rc.1')).toBe('v0.2.0-rc.1');
  });
});

describe('isPrerelease', () => {
  it('is false for X.Y.Z', () => {
    expect(isPrerelease('0.2.0')).toBe(false);
  });

  it('is true for X.Y.Z-suffix', () => {
    expect(isPrerelease('0.2.0-rc.1')).toBe(true);
  });
});

describe('formatGithubOutput', () => {
  it('writes version, tag and prerelease=false for a release', () => {
    expect(formatGithubOutput('0.2.0')).toBe(
      'version=0.2.0\ntag=v0.2.0\nprerelease=false\n'
    );
  });

  it('writes prerelease=true for a pre-release', () => {
    expect(formatGithubOutput('0.2.0-rc.1')).toBe(
      'version=0.2.0-rc.1\ntag=v0.2.0-rc.1\nprerelease=true\n'
    );
  });
});
