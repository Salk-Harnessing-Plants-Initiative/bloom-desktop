/**
 * Verifies electron-forge's `make` maker stage actually produced an
 * installer artifact (DMG/ZIP on macOS, Squirrel exe/nupkg on Windows,
 * .deb on Linux).
 *
 * Run with: npm run test:make:artifacts
 * Prerequisites: npm run make (or, on Linux, npm run make:linux) must
 * have been run
 */

import fs from 'fs';
import path from 'path';

export interface MakerArtifact {
  path: string;
  size: number;
}

// Priority order per platform: prefer an installer over a bare archive/package.
const PLATFORM_EXTENSIONS: Record<string, string[]> = {
  darwin: ['.dmg', '.zip'],
  win32: ['.exe', '.nupkg'],
  linux: ['.deb'],
};

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Finds the maker artifact electron-forge's `make` stage produced under
 * `makeDir` (typically `out/make/`) for the given platform. Zero-byte files
 * (a maker that crashed mid-write) are never treated as a match.
 */
export function findMakerArtifact(
  makeDir: string,
  platform: NodeJS.Platform = process.platform
): MakerArtifact | null {
  const extensions = PLATFORM_EXTENSIONS[platform];
  if (!extensions) {
    return null;
  }

  const files = walkFiles(makeDir);

  for (const ext of extensions) {
    const candidates = files
      .filter((filePath) => filePath.toLowerCase().endsWith(ext))
      .map((filePath) => ({ path: filePath, size: fs.statSync(filePath).size }))
      .filter((artifact) => artifact.size > 0)
      .sort((a, b) => a.path.localeCompare(b.path));

    if (candidates.length > 0) {
      return candidates[0];
    }
  }

  return null;
}

if (require.main === module) {
  const makeDir = path.join(__dirname, '..', '..', 'out', 'make');
  const result = findMakerArtifact(makeDir);

  if (!result) {
    console.error(
      `[FAIL] No maker artifact found under ${makeDir} for platform "${process.platform}".`
    );
    console.error('   Run "npm run make" first.');
    process.exit(1);
  }

  console.log(
    `[PASS] Found maker artifact: ${result.path} (${result.size} bytes)`
  );
  process.exit(0);
}
