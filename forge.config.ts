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

const config: ForgeConfig = {
  packagerConfig: {
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
    // Linux RPM package (Fedora, RHEL, CentOS)
    new MakerRpm({}),
    // Linux DEB package (Debian, Ubuntu)
    new MakerDeb({}),
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
