import type { Configuration } from 'webpack';
import CopyPlugin from 'copy-webpack-plugin';

import { rules } from './webpack.rules';
import { plugins } from './webpack.plugins';

export const mainConfig: Configuration = {
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: './src/main/main.ts',
  // Put your normal webpack config below here
  module: {
    rules,
  },
  plugins: [
    ...plugins,
    // Copy Prisma Client to webpack output (pilot pattern)
    // This ensures the generated Prisma Client and native binaries are available at runtime
    new CopyPlugin({
      patterns: [{ from: './node_modules/.prisma/client' }],
    }),
  ],
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.json'],
  },
  externals: {
    // Prisma Client needs to be external since it loads native binary engines
    '.prisma/client': 'commonjs .prisma/client',
    '@prisma/client': 'commonjs @prisma/client',
  },
};
