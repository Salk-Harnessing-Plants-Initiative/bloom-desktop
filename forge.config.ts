import * as path from 'path';
import * as fs from 'fs';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';

import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';

import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';

const appMode = process.env.APP_MODE || 'full';

const appNames: Record<string, string> = {
  graviscan: 'bloom-graviscan',
  cylinderscan: 'bloom-cylinderscan',
  full: 'Bloom Desktop',
};

const productNames: Record<string, string> = {
  graviscan: 'Bloom GraviScan',
  cylinderscan: 'Bloom CylinderScan',
  full: 'Bloom Desktop',
};

const iconFiles: Record<string, string> = {
  graviscan: 'BloomGraviScanIcon.png',
  cylinderscan: 'BloomCylinderScanIcon.png',
  full: 'BloomFullIcon.png',
};

const appName = appNames[appMode] || appNames.full;
const productName = productNames[appMode] || productNames.full;
const iconPath = path.resolve(
  __dirname,
  'assets',
  iconFiles[appMode] || iconFiles.full
);

/**
 * Recursively copy a directory (no external deps needed).
 */
function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const config: ForgeConfig = {
  packagerConfig: {
    name: appName,
    executableName: appName,
    icon: iconPath,
    asar: {
      unpack: '*.{node,dll,dylib,so,prisma,db,db-*}',
    },
    extraResource: [
      // Python executable for hardware control (DAQ, camera)
      process.platform === 'win32'
        ? './dist/bloom-hardware.exe'
        : './dist/bloom-hardware',

      // CRITICAL: Prisma Client must be outside ASAR archive
      // Binary query engines cannot execute from read-only ASAR files.
      // These files are copied to Resources/ for runtime access.
      // See docs/PACKAGING.md for detailed explanation.
      './node_modules/.prisma', // Generated Prisma Client + native binaries
      './node_modules/@prisma/client', // Prisma Client package
      './prisma/schema.prisma', // Schema for runtime introspection
      './prisma/migrations', // Migration SQL files for first-launch DB setup
    ],
    afterCopy: [
      // Copy sharp and all its runtime dependencies into resources/node_modules/
      // so require('sharp') resolves correctly in the packaged app.
      // Sharp is externalized in webpack because it uses platform-specific native binaries.
      (
        buildPath: string,
        _electronVersion: string,
        _platform: string,
        _arch: string,
        callback: (err?: Error | null) => void
      ) => {
        const resourcesDir = path.join(buildPath, '..');
        const nodeModulesTarget = path.join(resourcesDir, 'node_modules');

        // Sharp + its runtime deps + platform-specific native binaries
        const modulesToCopy = [
          'sharp',
          'detect-libc',
          'semver',
          '@img', // All @img/* platform packages (native binaries + libvips)
        ];

        try {
          for (const mod of modulesToCopy) {
            const src = path.join('./node_modules', mod);
            const dest = path.join(nodeModulesTarget, mod);
            if (fs.existsSync(src)) {
              copyDirSync(src, dest);
              console.log(`[Forge] Copied ${mod} to resources/node_modules/`);
            }
          }

          // Create @prisma/client symlink so Prisma's internal requires resolve.
          // This must be done at build time because the installed app dir is read-only.
          // NOTE: extraResource copies client/ AFTER afterCopy runs, so we can't check
          // if the target exists. Dangling symlinks are fine on Linux — it resolves
          // once extraResource copies the client/ directory.
          // We use a RELATIVE path so the symlink works after .deb installation
          // (absolute build-time paths would break on the installed machine).
          const prismaModuleDir = path.join(nodeModulesTarget, '@prisma');
          const prismaClientSymlink = path.join(prismaModuleDir, 'client');
          if (!fs.existsSync(prismaClientSymlink)) {
            fs.mkdirSync(prismaModuleDir, { recursive: true });
            // From resources/node_modules/@prisma/client -> resources/client
            // Relative: ../../client (up from @prisma/ to node_modules/ to resources/)
            fs.symlinkSync('../../client', prismaClientSymlink);
            console.log(
              '[Forge] Created @prisma/client relative symlink in resources/node_modules/'
            );
          }
        } catch (err: unknown) {
          console.error(
            '[Forge] Failed to copy native module dependencies:',
            err
          );
        }
        callback();
      },
    ],
  },
  rebuildConfig: {},
  makers: [
    // Windows installer (Squirrel)
    new MakerSquirrel({}),
    // macOS DMG installer (drag to Applications)
    new MakerDMG({}, ['darwin']),
    // macOS ZIP (alternative to DMG, smaller file)
    new MakerZIP({}, ['darwin']),
    // Linux DEB package (Debian, Ubuntu)
    new MakerDeb({
      options: {
        bin: appName,
        name: appName,
        productName: productName,
        icon: iconPath,
        categories: ['Science', 'Education'],
        ...(appMode === 'graviscan' && {
          depends: ['libsane-dev', 'sane-utils'],
        }),
      },
    }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
      port: 3456,
      loggerPort: 9876,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/renderer/index.ejs',
            js: './src/renderer/index.tsx',
            name: 'main_window',
            preload: {
              js: './src/main/preload.ts',
            },
          },
        ],
      },
      devContentSecurityPolicy: ``,
    }),
  ],
};

export default config;
