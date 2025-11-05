#!/usr/bin/env node
/**
 * Builds webpack development build by spawning electron-forge start and killing it.
 *
 * **IMPORTANT**: This script is currently NOT used in the standard E2E test workflow.
 * See .github/workflows/pr-checks.yml which uses `npm run start &` instead.
 *
 * **Standard E2E Workflow (as documented in docs/E2E_TESTING.md)**:
 * 1. npm run start      # Starts dev server in background (keeps running on port 9000)
 * 2. npm run test:e2e   # Runs E2E tests (requires dev server to be running)
 * 3. Kill dev server    # Stop the background process
 *
 * **Why This Script Spawns Full electron-forge (not webpack CLI directly)**:
 * - Webpack config is managed by Electron Forge webpack plugin
 * - Electron Forge sets up special plugins that create MAIN_WINDOW_WEBPACK_ENTRY constants
 * - These constants point to http://localhost:9000 (dev server URL)
 * - Running webpack CLI standalone bypasses these Forge plugins
 * - The built Electron app wouldn't know where to load the renderer from
 * - Therefore, must use `electron-forge start` to get correct webpack build
 *
 * **How It Works**:
 * - Spawns `electron-forge start` which builds webpack AND starts dev server
 * - Waits for .webpack/main/index.js to be created (indicates webpack build complete)
 * - Immediately kills the Electron Forge process (dev server doesn't stay running)
 * - Built webpack files remain in .webpack/ directory for Electron to use
 *
 * **Potential Use Cases**:
 * - Alternative CI workflows that need webpack build without persistent dev server
 * - Standalone webpack build phase in modified test pipelines
 * - Currently kept for reference and potential future workflows
 *
 * **See Also**:
 * - docs/E2E_TESTING.md (current E2E testing workflow)
 * - .github/workflows/pr-checks.yml (CI pipeline using npm run start)
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
