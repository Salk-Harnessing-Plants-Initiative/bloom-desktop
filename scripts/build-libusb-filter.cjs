#!/usr/bin/env node
/**
 * Cross-platform launcher for the libusb-filter shim build.
 *
 * On Linux: invokes `bash scripts/build-libusb-filter.sh` which runs
 * gcc to produce src/main/native/libusb-filter.so.
 *
 * On macOS/Windows: no-op with an informational log line. The shim is
 * Linux-only (LD_PRELOAD doesn't exist on those platforms) and
 * forge.config.ts already excludes it from the extraResource list for
 * non-Linux builds.
 *
 * This wrapper exists so npm scripts (dev / package / make) can run
 * `build:native` on every platform without bash being available. The
 * previous direct `bash scripts/build-libusb-filter.sh` invocation
 * failed on Windows where bash is not on PATH.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
// (Plain JS script — ESM not configured here; CommonJS require is the
// idiomatic approach for one-file build helpers in this project.)
'use strict';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawnSync } = require('child_process');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

if (process.platform !== 'linux') {
  console.log(
    `[build-libusb-filter] Skipping on ${process.platform} — Linux-only shim.`,
  );
  process.exit(0);
}

const scriptPath = path.join(__dirname, 'build-libusb-filter.sh');
const result = spawnSync('bash', [scriptPath], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
});

if (result.error) {
  console.error('[build-libusb-filter] Failed to invoke bash:', result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
