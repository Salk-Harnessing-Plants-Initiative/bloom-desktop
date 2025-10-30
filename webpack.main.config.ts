import type { Configuration } from 'webpack';

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
    // Prisma is handled via extraResource in forge.config.ts
    // This ensures Prisma files are copied outside asar for Node.js require
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
