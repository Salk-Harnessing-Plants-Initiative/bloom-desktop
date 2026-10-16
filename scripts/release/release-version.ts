/**
 * Requested-version check for the release workflow.
 *
 * A maintainer starts a release by typing a version (`0.2.0`, or `v0.2.0`).
 * It must be Semantic Versioning and equal package.json's `version`, so a
 * typo can't publish the wrong release. Squirrel only upgrades to a higher
 * version, so package.json is the single source of truth. The release tag is
 * always `v<version>`.
 *
 * CLI: `ts-node scripts/release/release-version.ts <version> [--github-output]`
 * prints the version and exits non-zero if it doesn't match package.json.
 * With --github-output it also appends `version=` / `tag=` / `prerelease=`
 * lines to $GITHUB_OUTPUT.
 */

import * as fs from 'fs';

import packageJson from '../../package.json';

// Semantic Versioning core (no leading zeros) with an optional pre-release.
const VERSION_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/;

/** Return the version in `0.2.0` or `v0.2.0`, or throw if it isn't one. */
export function parseRequestedVersion(input: string): string {
  const version = input.startsWith('v') ? input.slice(1) : input;
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(
      `"${input}" is not a release version (expected X.Y.Z or X.Y.Z-prerelease)`
    );
  }
  return version;
}

/** Throw unless `input` is exactly `packageVersion`. */
export function checkRequestedVersion(
  input: string,
  packageVersion: string
): string {
  const version = parseRequestedVersion(input);
  if (version !== packageVersion) {
    throw new Error(
      `Requested version ${version} doesn't match package.json (${packageVersion}). Bump package.json on main first, or type ${packageVersion}.`
    );
  }
  return version;
}

/** The git tag a release of `version` is published under. */
export function releaseTag(version: string): string {
  return `v${version}`;
}

/** Pre-releases (`X.Y.Z-rc.1`) are published as GitHub pre-releases. */
export function isPrerelease(version: string): boolean {
  return version.includes('-');
}

/** `version` / `tag` / `prerelease` lines for the workflow's `$GITHUB_OUTPUT`. */
export function formatGithubOutput(version: string): string {
  return `version=${version}\ntag=${releaseTag(version)}\nprerelease=${isPrerelease(version)}\n`;
}

if (require.main === module) {
  try {
    const input = process.argv[2] ?? '';
    const version = checkRequestedVersion(input, packageJson.version);
    if (process.argv.includes('--github-output')) {
      const outputFile = process.env.GITHUB_OUTPUT;
      if (!outputFile) {
        throw new Error('--github-output needs $GITHUB_OUTPUT to be set');
      }
      fs.appendFileSync(outputFile, formatGithubOutput(version));
    }
    console.log(version);
  } catch (error) {
    console.error(
      `[Release] ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    process.exit(1);
  }
}
