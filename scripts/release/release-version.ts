/**
 * Release tag / package.json version check for the release workflow.
 *
 * A release is a `vX.Y.Z` (optionally `vX.Y.Z-prerelease`) tag whose version
 * equals package.json's `version`. Squirrel only upgrades to a higher version,
 * so package.json is the single source of truth.
 *
 * CLI: `ts-node scripts/release/release-version.ts <tag> [--github-output]`
 * prints the version and exits non-zero if the tag doesn't match package.json.
 * With --github-output it also appends `version=` / `prerelease=` lines to
 * $GITHUB_OUTPUT.
 */

import * as fs from 'fs';

import packageJson from '../../package.json';

// Semantic Versioning core (no leading zeros) with an optional pre-release.
const RELEASE_TAG_PATTERN =
  /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?)$/;

/** Return the version in a `vX.Y.Z` tag, or throw if it isn't a release tag. */
export function parseReleaseTag(tag: string): string {
  const match = RELEASE_TAG_PATTERN.exec(tag);
  if (!match) {
    throw new Error(
      `"${tag}" is not a release tag (expected vX.Y.Z or vX.Y.Z-prerelease)`
    );
  }
  return match[1];
}

/** Throw unless `tag` is a release tag for exactly `packageVersion`. */
export function checkTagMatchesVersion(
  tag: string,
  packageVersion: string
): string {
  const version = parseReleaseTag(tag);
  if (version !== packageVersion) {
    throw new Error(
      `Tag ${tag} is version ${version}, but package.json is ${packageVersion}`
    );
  }
  return version;
}

/** Pre-releases (`X.Y.Z-rc.1`) are published as GitHub pre-releases. */
export function isPrerelease(version: string): boolean {
  return version.includes('-');
}

/** `version` / `prerelease` lines for the workflow's `$GITHUB_OUTPUT`. */
export function formatGithubOutput(version: string): string {
  return `version=${version}\nprerelease=${isPrerelease(version)}\n`;
}

if (require.main === module) {
  try {
    const tag = process.argv[2] ?? '';
    const version = checkTagMatchesVersion(tag, packageJson.version);
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
