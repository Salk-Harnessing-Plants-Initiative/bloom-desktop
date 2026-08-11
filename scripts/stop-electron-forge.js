/**
 * Cross-platform script to stop Electron Forge dev server
 *
 * This script reads the PID from electron-forge.pid file and terminates
 * the process. Works on Linux, macOS, and Windows (unlike Bash scripts).
 *
 * Used in CI to clean up background dev server process.
 */

const fs = require('fs');
const path = require('path');

const pidFile = path.join(process.cwd(), 'electron-forge.pid');

try {
  if (fs.existsSync(pidFile)) {
    const pidContent = fs.readFileSync(pidFile, 'utf8').trim();
    const pid = parseInt(pidContent, 10);

    if (isNaN(pid)) {
      console.log(`Invalid PID in ${pidFile}: ${pidContent}`);
    } else {
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`✓ Stopped Electron Forge dev server (PID: ${pid})`);
      } catch (killError) {
        if (killError.code === 'ESRCH') {
          console.log(`Process ${pid} was already terminated`);
        } else if (killError.code === 'EPERM') {
          // On Windows, a PID can be recycled by an unrelated (often
          // system/elevated) process between the dev server exiting and
          // this cleanup step running, making it unsignalable by this
          // user. The dev server itself is already gone either way, so
          // this is not a real failure -- just log and move on.
          console.log(
            `Process ${pid} could not be signaled (EPERM) -- likely already exited and its PID was reused`
          );
        } else {
          throw killError;
        }
      }
    }

    // Clean up PID file
    fs.unlinkSync(pidFile);
    console.log(`✓ Removed ${pidFile}`);
  } else {
    console.log(
      `No ${pidFile} file found - dev server may not have been started`
    );
  }
} catch (error) {
  console.error(`Error stopping dev server: ${error.message}`);

  // Try to clean up PID file even if kill failed
  try {
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
      console.log(`✓ Cleaned up ${pidFile} after error`);
    }
  } catch (cleanupError) {
    console.error(`Failed to cleanup PID file: ${cleanupError.message}`);
  }

  // Exit with non-zero code on error
  process.exit(1);
}
