/**
 * Copies sharp into the packaged app.
 *
 * webpack treats sharp as an external (webpack.main.config.ts), and the Forge
 * webpack plugin packages no node_modules, so sharp has to be copied in: its
 * own package, its runtime dependencies, and the native packages for the
 * platform being built (@img/sharp-<platform>-<arch>, plus
 * @img/sharp-libvips-<platform>-<arch> outside Windows). Without them the
 * installed app can't load sharp and every Bloom upload fails.
 *
 * npm installs only the native packages for the machine it runs on, so each
 * platform is packaged on its own OS (as CI and the Release workflow do).
 */
import fs from 'fs';
import path from 'path';

interface PackageJson {
  dependencies?: Record<string, string>;
}

function readPackageJson(dir: string): PackageJson {
  return JSON.parse(
    fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
  ) as PackageJson;
}

/** sharp's native packages for a platform and architecture. */
export function sharpNativePackages(platform: string, arch: string): string[] {
  const binary = `@img/sharp-${platform}-${arch}`;
  // On Windows the libvips DLLs ship inside the binary package itself.
  return platform === 'win32'
    ? [binary]
    : [binary, `@img/sharp-libvips-${platform}-${arch}`];
}

/**
 * sharp and every package it needs at runtime on this platform, as names
 * under node_modules. Throws if one isn't installed, naming it.
 */
export function sharpPackages(
  nodeModulesDir: string,
  platform: string,
  arch: string
): string[] {
  const found = new Set<string>();
  const visit = (name: string): void => {
    if (found.has(name)) return;
    const dir = path.join(nodeModulesDir, name);
    if (!fs.existsSync(path.join(dir, 'package.json'))) {
      throw new Error(
        `[package-sharp] ${name} is not installed in ${nodeModulesDir}; ` +
          `the packaged app could not load sharp. Run npm ci on a ` +
          `${platform}-${arch} machine.`
      );
    }
    found.add(name);
    for (const dep of Object.keys(readPackageJson(dir).dependencies ?? {})) {
      visit(dep);
    }
  };

  visit('sharp');
  for (const name of sharpNativePackages(platform, arch)) {
    visit(name);
  }
  return [...found];
}

/** Copies sharp's packages from nodeModulesDir into buildPath/node_modules. */
export async function copySharpIntoApp(
  nodeModulesDir: string,
  buildPath: string,
  platform: string,
  arch: string
): Promise<string[]> {
  const names = sharpPackages(nodeModulesDir, platform, arch);
  for (const name of names) {
    await fs.promises.cp(
      path.join(nodeModulesDir, name),
      path.join(buildPath, 'node_modules', name),
      // Defensive: sharp's packages ship no symlinks today, but if one does,
      // copy the link itself rather than following it out of the package
      { recursive: true, verbatimSymlinks: true }
    );
  }
  return names;
}
