#!/usr/bin/env node
/**
 * Builds webpack development build for E2E testing.
 *
 * This script runs `electron-forge start` to build webpack in development mode,
 * then immediately kills the process. The dev build webpack files remain in .webpack/
 *
 * This is necessary because:
 * - Playwright's _electron.launch() adds debug flags that only work with dev builds
 * - electron-forge package creates production builds that reject these flags
 * - There's no standalone command to build webpack without starting the app
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const WEBPACK_CHECK_INTERVAL = 500; // Check every 500ms
const MAX_WAIT_TIME = 120000; // Max 2 minutes

console.log('[build-webpack-dev] Starting webpack development build...');

// On Windows, spawn needs shell:true to find npx.cmd
// But shell:true can cause issues with process signals on Unix
const forgeProcess = spawn('npx', ['electron-forge', 'start'], {
  cwd: path.join(__dirname, '..'),
  stdio: 'pipe',
  shell: process.platform === 'win32', // Only use shell on Windows
});

let stdoutBuffer = '';
let stderrBuffer = '';

forgeProcess.stdout.on('data', (data) => {
  stdoutBuffer += data.toString();
  process.stdout.write(data);
});

forgeProcess.stderr.on('data', (data) => {
  stderrBuffer += data.toString();
  process.stderr.write(data);
});

const startTime = Date.now();

// Check for webpack build completion
const checkInterval = setInterval(() => {
  // Look for the main webpack output
  const webpackMainPath = path.join(__dirname, '../.webpack/main/index.js');
  const webpackRendererPath = path.join(__dirname, '../.webpack/renderer');

  if (fs.existsSync(webpackMainPath) && fs.existsSync(webpackRendererPath)) {
    console.log('[build-webpack-dev] Webpack build detected!');
    console.log(
      '[build-webpack-dev] Waiting 2 seconds to ensure build completes...'
    );

    // Wait a bit more to ensure all files are written
    setTimeout(() => {
      console.log('[build-webpack-dev] Killing electron-forge process...');
      forgeProcess.kill('SIGTERM');

      // Force kill if it doesn't die gracefully
      setTimeout(() => {
        if (!forgeProcess.killed) {
          console.log('[build-webpack-dev] Force killing process...');
          forgeProcess.kill('SIGKILL');
        }
      }, 2000);
    }, 2000);

    clearInterval(checkInterval);
  } else if (Date.now() - startTime > MAX_WAIT_TIME) {
    console.error('[build-webpack-dev] Timeout waiting for webpack build');
    forgeProcess.kill('SIGKILL');
    clearInterval(checkInterval);
    process.exit(1);
  }
}, WEBPACK_CHECK_INTERVAL);

forgeProcess.on('exit', (code) => {
  clearInterval(checkInterval);

  // Verify webpack was built
  const webpackMainPath = path.join(__dirname, '../.webpack/main/index.js');

  if (fs.existsSync(webpackMainPath)) {
    console.log(
      '[build-webpack-dev] ✓ Webpack development build completed successfully'
    );
    console.log(`[build-webpack-dev] Output: ${path.dirname(webpackMainPath)}`);
    process.exit(0);
  } else {
    console.error(
      '[build-webpack-dev] ✗ Webpack build failed - main index.js not found'
    );
    process.exit(1);
  }
});

forgeProcess.on('error', (err) => {
  console.error('[build-webpack-dev] Failed to start electron-forge:', err);
  clearInterval(checkInterval);
  process.exit(1);
});
