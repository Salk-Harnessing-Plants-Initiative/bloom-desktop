/**
 * Pure (platform, arch) -> staged-app-binary-path resolver, extracted from
 * the darwin/win32/linux branching already duplicated between
 * scripts/test-package-database-full.sh and tests/integration/test-package.ts,
 * so it has one tested implementation instead of a third inline copy.
 *
 * Resolves the actual executable electron-forge stages under out/ (the same
 * path whether `npm run package` or `npm run make` was run), not the
 * higher-level maker output under out/make/.
 */

import path from 'path';
import { PRODUCT_NAME } from '../../../scripts/product-name';

export function resolveStagedAppPath(
  platform: NodeJS.Platform,
  arch: string = process.arch,
  repoRoot: string = path.join(__dirname, '..', '..', '..')
): string {
  switch (platform) {
    case 'darwin':
      return path.join(
        repoRoot,
        'out',
        `${PRODUCT_NAME}-darwin-${arch}`,
        `${PRODUCT_NAME}.app`,
        'Contents',
        'MacOS',
        PRODUCT_NAME
      );
    case 'win32':
      return path.join(
        repoRoot,
        'out',
        `${PRODUCT_NAME}-win32-${arch}`,
        `${PRODUCT_NAME}.exe`
      );
    case 'linux':
      return path.join(
        repoRoot,
        'out',
        `${PRODUCT_NAME}-linux-${arch}`,
        'bloom-desktop'
      );
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}
