import path from 'path';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';

import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';
import { resolveExecutableName } from './scripts/resolve-executable-name';
import { PRODUCT_NAME } from './scripts/product-name';
import {
  APP_ICON_BASE,
  WINDOWS_ICON,
  LINUX_ICON,
  windowsMetadata,
} from './scripts/app-icon';
import { copySharpIntoApp } from './scripts/package-sharp';

const config: ForgeConfig = {
  packagerConfig: {
    executableName: resolveExecutableName(process.platform),
    // App icon (the platform's extension is added: .ico on Windows, .icns on macOS)
    icon: APP_ICON_BASE,
    // Shown by Windows in Task Manager and hover tooltips
    win32metadata: windowsMetadata(PRODUCT_NAME),
    asar: {
      // so.* covers libvips' versioned Linux library (libvips-cpp.so.8.17.3)
      unpack: '*.{node,dll,dylib,so,so.*,prisma,db,db-*}',
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

      // LD_PRELOAD USB filter for parallel scanner isolation (Linux only)
      // — built by `scripts/build-libusb-filter.sh` (npm run build:native).
      // Excluded from macOS/Windows builds so packaging doesn't error
      // when the .so doesn't exist on those platforms.
      ...(process.platform === 'linux'
        ? ['./src/main/native/libusb-filter.so']
        : []),
    ],
  },
  rebuildConfig: {},
  hooks: {
    // sharp is a webpack external, so the app needs it in its node_modules;
    // see scripts/package-sharp.ts
    packageAfterCopy: async (
      _config,
      buildPath,
      _electronVersion,
      platform,
      arch
    ) => {
      const copied = await copySharpIntoApp(
        path.join(__dirname, 'node_modules'),
        buildPath,
        platform,
        arch
      );
      console.log(`[package-sharp] Copied ${copied.join(', ')}`);
    },
  },
  makers: [
    // Windows installer (Squirrel)
    new MakerSquirrel({
      title: PRODUCT_NAME,
      setupIcon: WINDOWS_ICON,
    }),
    // macOS DMG installer (drag to Applications)
    new MakerDMG({}, ['darwin']),
    // macOS ZIP (alternative to DMG, smaller file)
    new MakerZIP({}, ['darwin']),
    // Linux RPM package (Fedora, RHEL, CentOS)
    new MakerRpm({ options: { icon: LINUX_ICON } }),
    // Linux DEB package (Debian, Ubuntu)
    new MakerDeb({ options: { icon: LINUX_ICON } }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
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
