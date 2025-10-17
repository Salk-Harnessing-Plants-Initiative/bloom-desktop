/**
 * Integration Test for Packaged App
 *
 * This script tests that the packaged Electron app includes the Python
 * executable in the correct location and that it works.
 *
 * Run with: npm run test:package
 *
 * Prerequisites: npm run package must have been run
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// Color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

async function testPackagedApp() {
  log('='.repeat(60), colors.cyan);
  log('Testing Packaged Electron App', colors.cyan);
  log('='.repeat(60), colors.cyan);
  console.log('');

  // Determine expected package path based on platform
  let packagePath: string;
  let pythonExecutablePath: string;

  if (process.platform === 'darwin') {
    packagePath = path.join(
      __dirname,
      '..',
      '..',
      'out',
      'Bloom Desktop-darwin-arm64',
      'Bloom Desktop.app'
    );
    pythonExecutablePath = path.join(
      packagePath,
      'Contents',
      'Resources',
      'bloom-hardware'
    );
  } else if (process.platform === 'win32') {
    packagePath = path.join(
      __dirname,
      '..',
      '..',
      'out',
      'Bloom Desktop-win32-x64'
    );
    pythonExecutablePath = path.join(
      packagePath,
      'resources',
      'bloom-hardware.exe'
    );
  } else {
    // Linux
    packagePath = path.join(
      __dirname,
      '..',
      '..',
      'out',
      'Bloom Desktop-linux-x64'
    );
    pythonExecutablePath = path.join(
      packagePath,
      'resources',
      'bloom-hardware'
    );
  }

  // Test 1: Check if package exists
  log('[TEST] Checking if packaged app exists...', colors.yellow);
  if (!fs.existsSync(packagePath)) {
    log(
      `[FAIL] Packaged app not found at: ${packagePath}`,
      colors.red
    );
    log(
      '\nRun "npm run package" first to create the packaged app.',
      colors.yellow
    );
    process.exit(1);
  }
  log(`[PASS] Package found: ${packagePath}`, colors.green);
  console.log('');

  // Test 2: Check if Python executable exists
  log('[TEST] Checking if Python executable is bundled...', colors.yellow);
  if (!fs.existsSync(pythonExecutablePath)) {
    log(
      `[FAIL] Python executable not found at: ${pythonExecutablePath}`,
      colors.red
    );
    process.exit(1);
  }
  log(`[PASS] Python executable found: ${pythonExecutablePath}`, colors.green);
  console.log('');

  // Test 3: Check executable permissions (Unix only)
  if (process.platform !== 'win32') {
    log('[TEST] Checking executable permissions...', colors.yellow);
    try {
      fs.accessSync(pythonExecutablePath, fs.constants.X_OK);
      log('[PASS] Python executable has correct permissions', colors.green);
    } catch (error) {
      log(
        '[FAIL] Python executable is not executable',
        colors.red
      );
      log(
        `Run: chmod +x "${pythonExecutablePath}"`,
        colors.yellow
      );
      process.exit(1);
    }
    console.log('');
  }

  // Test 4: Check file size
  log('[TEST] Checking Python executable size...', colors.yellow);
  const stats = fs.statSync(pythonExecutablePath);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  log(`[INFO] Size: ${sizeMB} MB`, colors.cyan);

  if (stats.size < 1024 * 1024) {
    log('[FAIL] Python executable is suspiciously small (<1MB)', colors.red);
    process.exit(1);
  }

  if (stats.size > 100 * 1024 * 1024) {
    log('[WARN] Python executable is very large (>100MB)', colors.yellow);
  }

  log('[PASS] Python executable size is reasonable', colors.green);
  console.log('');

  // Test 5: Test Python executable functionality
  log('[TEST] Testing Python executable IPC...', colors.yellow);

  const testCommands = [
    { command: 'ping', expectedStatus: 'ok' },
    { command: 'get_version', expectedField: 'version' },
    { command: 'check_hardware', expectedFields: ['camera', 'daq'] },
  ];

  for (const test of testCommands) {
    log(`  Testing command: ${test.command}`, colors.cyan);

    const result = await testPythonCommand(pythonExecutablePath, test.command);

    if (!result.success) {
      log(`[FAIL] Command "${test.command}" failed: ${result.error}`, colors.red);
      process.exit(1);
    }

    if (test.expectedStatus && result.data.status !== test.expectedStatus) {
      log(
        `[FAIL] Expected status "${test.expectedStatus}", got "${result.data.status}"`,
        colors.red
      );
      process.exit(1);
    }

    if (test.expectedField && !(test.expectedField in result.data)) {
      log(
        `[FAIL] Expected field "${test.expectedField}" not found in response`,
        colors.red
      );
      process.exit(1);
    }

    if (test.expectedFields) {
      for (const field of test.expectedFields) {
        if (!(field in result.data)) {
          log(
            `[FAIL] Expected field "${field}" not found in response`,
            colors.red
          );
          process.exit(1);
        }
      }
    }

    log(`  Response: ${JSON.stringify(result.data)}`, colors.cyan);
    log(`  [PASS] Command "${test.command}" successful`, colors.green);
  }

  console.log('');

  // Success!
  log('='.repeat(60), colors.green);
  log('[PASS] All packaged app tests passed!', colors.green);
  log('='.repeat(60), colors.green);
  console.log('');
  log('Summary:', colors.cyan);
  log(`  Package path: ${packagePath}`, colors.cyan);
  log(`  Python executable: ${pythonExecutablePath}`, colors.cyan);
  log(`  Executable size: ${sizeMB} MB`, colors.cyan);
  log(`  IPC commands tested: ${testCommands.length}`, colors.cyan);
  console.log('');

  process.exit(0);
}

/**
 * Test a Python IPC command
 */
async function testPythonCommand(
  pythonPath: string,
  command: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  return new Promise((resolve) => {
    const pythonProcess = spawn(pythonPath, ['--ipc'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let dataReceived = false;

    pythonProcess.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
      const lines = stdout.split('\n');

      for (const line of lines) {
        if (line.startsWith('DATA:')) {
          const jsonStr = line.substring(5).trim();
          try {
            const data = JSON.parse(jsonStr);
            dataReceived = true;
            pythonProcess.kill();
            resolve({ success: true, data });
            return;
          } catch (error) {
            resolve({
              success: false,
              error: `Invalid JSON: ${jsonStr}`,
            });
            pythonProcess.kill();
            return;
          }
        } else if (line.startsWith('ERROR:')) {
          resolve({
            success: false,
            error: line.substring(6).trim(),
          });
          pythonProcess.kill();
          return;
        }
      }
    });

    pythonProcess.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    pythonProcess.on('error', (error: Error) => {
      resolve({ success: false, error: error.message });
    });

    pythonProcess.on('exit', (code: number | null) => {
      if (!dataReceived) {
        resolve({
          success: false,
          error: `Process exited with code ${code}. stderr: ${stderr}`,
        });
      }
    });

    // Send command
    pythonProcess.stdin?.write(`${JSON.stringify({ command })}\n`);

    // Timeout after 5 seconds
    setTimeout(() => {
      if (!dataReceived) {
        pythonProcess.kill();
        resolve({ success: false, error: 'Timeout waiting for response' });
      }
    }, 5000);
  });
}

// Run tests
testPackagedApp();
