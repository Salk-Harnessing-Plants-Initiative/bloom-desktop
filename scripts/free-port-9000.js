const { execSync } = require('child_process');

/**
 * Frees port 9000 on Windows by killing any process using it.
 * This is needed because port 9000 isn't released fast enough after
 * build-webpack-dev.js kills the Electron Forge process.
 */
function freePort9000Windows() {
  try {
    console.log('[free-port] Checking for processes using port 9000...');

    // Find process using port 9000
    const netstatOutput = execSync('netstat -ano | findstr :9000', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();

    if (!netstatOutput) {
      console.log('[free-port] ✓ Port 9000 is free');
      return;
    }

    // Extract PIDs from netstat output
    const lines = netstatOutput.split('\n');
    const pids = new Set();

    for (const line of lines) {
      // netstat format: TCP    0.0.0.0:9000    0.0.0.0:0    LISTENING    1234
      const match = line.trim().match(/\s+(\d+)\s*$/);
      if (match) {
        pids.add(match[1]);
      }
    }

    if (pids.size === 0) {
      console.log('[free-port] ✓ Port 9000 is free');
      return;
    }

    console.log(`[free-port] Found ${pids.size} process(es) using port 9000: ${Array.from(pids).join(', ')}`);

    // Kill each process
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        console.log(`[free-port] ✓ Killed process ${pid}`);
      } catch (error) {
        console.log(`[free-port] Process ${pid} already terminated or access denied`);
      }
    }

    // Wait a moment for port to be released
    const sleep = (ms) => execSync(`ping 127.0.0.1 -n ${Math.ceil(ms / 1000) + 1} > nul`, { stdio: 'ignore' });
    sleep(1000);

    console.log('[free-port] ✓ Port 9000 should now be free');

  } catch (error) {
    if (error.status === 1) {
      // netstat returned no results - port is free
      console.log('[free-port] ✓ Port 9000 is free');
    } else {
      console.error(`[free-port] Error checking/freeing port: ${error.message}`);
      process.exit(1);
    }
  }
}

// Only run on Windows
if (process.platform === 'win32') {
  freePort9000Windows();
} else {
  console.log('[free-port] Not Windows, skipping port check');
}
