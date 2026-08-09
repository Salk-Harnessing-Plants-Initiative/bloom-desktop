import type { Configuration } from 'webpack';

import { rules } from './webpack.rules';
import { plugins } from './webpack.plugins';

rules.push({
  test: /\.css$/,
  use: [
    { loader: 'style-loader' },
    { loader: 'css-loader' },
    {
      loader: 'postcss-loader',
      options: {
        postcssOptions: {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          plugins: [require('tailwindcss'), require('autoprefixer')],
        },
      },
    },
  ],
});

export const rendererConfig: Configuration = {
  module: {
    rules,
  },
  plugins,
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css'],
    alias: {
      // exceljs's default `main` entry is Node-oriented and retains a
      // require() call that survives bundling, throwing
      // "ReferenceError: require is not defined" in Electron's sandboxed
      // renderer. Its package.json already ships a purpose-built browser
      // bundle (the `browser` field) — alias directly to it since
      // webpack's default `resolve.mainFields` for this build doesn't
      // pick it up on its own.
      exceljs: require.resolve('exceljs/dist/exceljs.min.js'),
    },
  },
};
