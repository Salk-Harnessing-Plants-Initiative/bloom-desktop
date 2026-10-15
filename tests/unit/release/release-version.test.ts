/**
 * Unit tests for the release tag / package.json version check used by the
 * release workflow's verify job.
 */

import { describe, it, expect } from 'vitest';
import {
  parseReleaseTag,
  checkTagMatchesVersion,
  isPrerelease,
  formatGithubOutput,
} from '../../../scripts/release/release-version';

describe('parseReleaseTag', () => {
  it.each([
    ['v0.2.0', '0.2.0'],
    ['v1.10.3', '1.10.3'],
    ['v0.2.0-rc.1', '0.2.0-rc.1'],
  ])('accepts %s', (tag, version) => {
    expect(parseReleaseTag(tag)).toBe(version);
  });

  it.each([
    '0.2.0',
    'v0.2',
    'v0.2.0.1',
    'v01.2.0',
    'release-0.2.0',
    'v0.2.0-',
    'v0.2.0 ',
    '',
  ])('rejects %j', (tag) => {
    expect(() => parseReleaseTag(tag)).toThrow(/not a release tag/);
  });
});

describe('checkTagMatchesVersion', () => {
  it('passes when the tag matches package.json', () => {
    expect(checkTagMatchesVersion('v0.2.0', '0.2.0')).toBe('0.2.0');
  });

  it('passes for a matching pre-release', () => {
    expect(checkTagMatchesVersion('v0.2.0-rc.1', '0.2.0-rc.1')).toBe(
      '0.2.0-rc.1'
    );
  });

  it('fails and names both versions when they differ', () => {
    expect(() => checkTagMatchesVersion('v0.2.1', '0.2.0')).toThrow(
      'Tag v0.2.1 is version 0.2.1, but package.json is 0.2.0'
    );
  });

  it('fails when only the pre-release part differs', () => {
    expect(() => checkTagMatchesVersion('v0.2.0-rc.1', '0.2.0')).toThrow(
      /package\.json is 0\.2\.0/
    );
  });

  it('fails for a malformed tag before comparing', () => {
    expect(() => checkTagMatchesVersion('0.2.0', '0.2.0')).toThrow(
      /not a release tag/
    );
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
  it('writes version and prerelease=false for a release', () => {
    expect(formatGithubOutput('0.2.0')).toBe(
      'version=0.2.0\nprerelease=false\n'
    );
  });

  it('writes prerelease=true for a pre-release', () => {
    expect(formatGithubOutput('0.2.0-rc.1')).toBe(
      'version=0.2.0-rc.1\nprerelease=true\n'
    );
  });
});
