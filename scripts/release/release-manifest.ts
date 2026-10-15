/**
 * Release asset collection, manifest.json and SHA256SUMS for the release
 * workflow's manifest job.
 *
 * Collects the installers electron-forge wrote under `out/make/` for each
 * target, copies them into one bundle directory under release-safe names
 * (GitHub replaces spaces in asset names, so we do it first and the manifest
 * matches what's published), and records each file's size and SHA-256.
 *
 * CLI:
 *   ts-node scripts/release/release-manifest.ts \
 *     --tag v0.2.0 --version 0.2.0 --commit <sha> \
 *     --windows-dir <dir> --linux-dir <dir> --out-dir <dir>
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export type ReleaseTarget = 'windows' | 'linux';

export interface CollectedFile {
  source: string;
  name: string;
  target: ReleaseTarget;
}

export interface ManifestFile {
  name: string;
  target: ReleaseTarget;
  size: number;
  sha256: string;
}

// snake_case to match the published manifest.json format.
export interface ReleaseManifest {
  version: string;
  tag: string;
  commit: string;
  built_at: string;
  files: ManifestFile[];
}

interface RequiredFile {
  label: string;
  matches: (fileName: string) => boolean;
}

// Each target must produce exactly one of each of these files.
const REQUIRED_FILES: Record<ReleaseTarget, RequiredFile[]> = {
  windows: [
    { label: 'Setup.exe', matches: (f) => f.toLowerCase().endsWith('.exe') },
    { label: 'full .nupkg', matches: (f) => f.endsWith('-full.nupkg') },
    { label: 'RELEASES', matches: (f) => f === 'RELEASES' },
  ],
  linux: [{ label: '.deb', matches: (f) => f.endsWith('.deb') }],
};

export const MANIFEST_FILE_NAME = 'manifest.json';
export const SHA256SUMS_FILE_NAME = 'SHA256SUMS';

/**
 * Asset name as published. GitHub rewrites characters outside
 * [A-Za-z0-9._-] when uploading (spaces in the Squirrel Setup.exe, the `~`
 * electron-installer-debian puts in pre-release versions), so we replace them
 * first and the manifest names exactly what's published.
 *
 * Only the file name changes. A pre-release .deb keeps `Version: X.Y.Z~rc.N`
 * inside the package, which dpkg/apt use to order upgrades; don't "fix" that.
 */
export function releaseAssetName(fileName: string): string {
  return fileName.replace(/[^A-Za-z0-9._-]+/g, '-');
}

function walkFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(full) : [full];
  });
}

/** Find the required installer files for `target` under `dir`. */
export function collectReleaseFiles(
  dir: string,
  target: ReleaseTarget
): CollectedFile[] {
  if (!fs.existsSync(dir)) {
    throw new Error(`${target}: build output directory ${dir} does not exist`);
  }
  const all = walkFiles(dir);

  return REQUIRED_FILES[target].map(({ label, matches }) => {
    const found = all.filter((f) => matches(path.basename(f)));
    if (found.length !== 1) {
      throw new Error(
        `${target}: expected exactly one ${label}, found ${found.length}`
      );
    }
    const source = found[0];
    if (fs.statSync(source).size === 0) {
      throw new Error(`${target}: ${path.basename(source)} is empty`);
    }
    return { source, name: releaseAssetName(path.basename(source)), target };
  });
}

function sha256File(file: string): string {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

export function buildManifest(options: {
  version: string;
  tag: string;
  commit: string;
  builtAt: string;
  files: CollectedFile[];
}): ReleaseManifest {
  const seen = new Set<string>();
  for (const file of options.files) {
    if (seen.has(file.name)) {
      throw new Error(`Duplicate release asset name: ${file.name}`);
    }
    seen.add(file.name);
  }

  // Code-point order (target, then name) so the order is identical on every OS.
  const sortKey = (f: CollectedFile) => `${f.target}\u0000${f.name}`;
  const files = [...options.files]
    .sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1))
    .map((f) => ({
      name: f.name,
      target: f.target,
      size: fs.statSync(f.source).size,
      sha256: sha256File(f.source),
    }));

  return {
    version: options.version,
    tag: options.tag,
    commit: options.commit,
    built_at: options.builtAt,
    files,
  };
}

/** `sha256sum -c`-compatible checksum list. */
export function formatSha256Sums(manifest: ReleaseManifest): string {
  return manifest.files.map((f) => `${f.sha256}  ${f.name}\n`).join('');
}

/** Collect both targets, copy them into `outDir`, and write the manifest. */
export function writeReleaseBundle(options: {
  version: string;
  tag: string;
  commit: string;
  builtAt: string;
  windowsDir: string;
  linuxDir: string;
  outDir: string;
}): ReleaseManifest {
  if (fs.existsSync(options.outDir) && fs.readdirSync(options.outDir).length) {
    throw new Error(`Output directory ${options.outDir} is not empty`);
  }

  const files = [
    ...collectReleaseFiles(options.windowsDir, 'windows'),
    ...collectReleaseFiles(options.linuxDir, 'linux'),
  ];
  const manifest = buildManifest({ ...options, files });

  fs.mkdirSync(options.outDir, { recursive: true });
  for (const file of files) {
    fs.copyFileSync(file.source, path.join(options.outDir, file.name));
  }
  fs.writeFileSync(
    path.join(options.outDir, MANIFEST_FILE_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(options.outDir, SHA256SUMS_FILE_NAME),
    formatSha256Sums(manifest)
  );
  return manifest;
}

function readArg(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) {
    throw new Error(`Missing ${flag}`);
  }
  return value;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const manifest = writeReleaseBundle({
      tag: readArg(args, '--tag'),
      version: readArg(args, '--version'),
      commit: readArg(args, '--commit'),
      builtAt: new Date().toISOString(),
      windowsDir: readArg(args, '--windows-dir'),
      linuxDir: readArg(args, '--linux-dir'),
      outDir: readArg(args, '--out-dir'),
    });
    console.log(formatSha256Sums(manifest).trimEnd());
  } catch (error) {
    console.error(
      `[Release] ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    process.exit(1);
  }
}
