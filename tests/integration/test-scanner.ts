/**
 * Scanner Integration Test
 *
 * Tests the complete scanner workflow:
 * - Initialize scanner with camera and DAQ
 * - Check scanner status
 * - Perform scan with coordinate rotation and capture
 * - Cleanup resources
 *
 * Uses mock hardware for testing without physical devices.
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as os from 'os';

// Test configuration
const IS_WINDOWS = os.platform() === 'win32';
const PYTHON_EXECUTABLE = IS_WINDOWS
  ? path.join(__dirname, '../../dist/bloom-hardware.exe')
  : path.join(__dirname, '../../dist/bloom-hardware');

// Test timeout (30 seconds for scan workflow)
const TEST_TIMEOUT = 30000;

// Mock camera and DAQ settings for scanner test
const SCANNER_SETTINGS = {
  camera: {
    exposure_time: 10000,
    gain: 0.0,
    camera_ip_address: null as string | null,
    gamma: 1.0,
    num_frames: 72,
    seconds_per_rot: 36.0,
    width: 640,
    height: 480,
  },
  daq: {
    device_name: 'cDAQ1Mod1',
    sampling_rate: 40000,
    step_pin: 0,
    dir_pin: 1,
    steps_per_revolution: 6400,
    num_frames: 72,
    seconds_per_rot: 36.0,
  },
  num_frames: 72,
  output_path: './test-scans',
};

/**
 * Send command to Python process and wait for response
 */
function sendCommand(
  proc: ChildProcess,
  command: object
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Command timeout'));
    }, 5000);

    let dataReceived = false;

    const dataHandler = (data: Buffer) => {
      const lines = data.toString().split('\n');

      for (const line of lines) {
        if (line.startsWith('DATA:')) {
          clearTimeout(timeout);
          dataReceived = true;

          try {
            const jsonData = JSON.parse(line.substring(5));
            proc.stdout?.off('data', dataHandler);
            resolve({ success: true, data: jsonData });
          } catch (e) {
            proc.stdout?.off('data', dataHandler);
            reject(new Error(`Failed to parse JSON: ${e}`));
          }
        } else if (line.startsWith('ERROR:')) {
          clearTimeout(timeout);
          dataReceived = true;
          proc.stdout?.off('data', dataHandler);
          resolve({ success: false, error: line.substring(6) });
        }
      }
    };

    proc.stdout?.on('data', dataHandler);

    // Send command
    proc.stdin?.write(JSON.stringify(command) + '\n');

    // Fallback for unexpected termination
    proc.once('exit', () => {
      if (!dataReceived) {
        clearTimeout(timeout);
        reject(new Error('Python process exited unexpectedly'));
      }
    });
  });
}

/**
 * Main test function
 */
async function runTest(): Promise<void> {
  console.log('=== Scanner Integration Test ===\n');

  // Check if Python executable exists
  const fs = await import('fs');
  if (!fs.existsSync(PYTHON_EXECUTABLE)) {
    throw new Error(
      `Python executable not found at: ${PYTHON_EXECUTABLE}\nRun 'npm run build:python' first.`
    );
  }

  // Start Python process
  console.log('Starting Python process...');
  const pythonProcess = spawn(PYTHON_EXECUTABLE, ['--ipc'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      BLOOM_USE_MOCK_HARDWARE: 'true',
      BLOOM_USE_MOCK_CAMERA: 'true',
      BLOOM_USE_MOCK_DAQ: 'true',
    },
  });

  // Wait for "IPC handler ready" message
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Python process startup timeout'));
    }, 10000);

    pythonProcess.stdout.on('data', (data: Buffer) => {
      if (data.toString().includes('STATUS:IPC handler ready')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    pythonProcess.stderr.on('data', (data: Buffer) => {
      console.error('Python stderr:', data.toString());
    });

    pythonProcess.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Python process exited prematurely with code ${code}`));
    });
  });

  console.log('[PASS] Python process started successfully\n');

  try {
    // Test 1: Check initial scanner status
    console.log('Test 1: Checking initial scanner status...');
    const statusResult1 = await sendCommand(pythonProcess, {
      command: 'scanner',
      action: 'status',
    });

    if (!statusResult1.success || !statusResult1.data) {
      throw new Error('Scanner status check failed');
    }

    const status1 = statusResult1.data as {
      success: boolean;
      initialized: boolean;
      mock: boolean;
    };
    if (status1.initialized) {
      throw new Error('Scanner should not be initialized initially');
    }
    console.log('[PASS] Initial scanner status: not initialized\n');

    // Test 2: Initialize scanner
    console.log('Test 2: Initializing scanner...');
    const initResult = await sendCommand(pythonProcess, {
      command: 'scanner',
      action: 'initialize',
      settings: SCANNER_SETTINGS,
    });

    if (!initResult.success || !initResult.data) {
      throw new Error(`Scanner initialization failed: ${initResult.error}`);
    }

    const initData = initResult.data as { success: boolean; initialized: boolean };
    if (!initData.success || !initData.initialized) {
      throw new Error('Scanner initialization returned unsuccessful result');
    }
    console.log('[PASS] Scanner initialized successfully\n');

    // Test 3: Check scanner status after initialization
    console.log('Test 3: Checking scanner status after initialization...');
    const statusResult2 = await sendCommand(pythonProcess, {
      command: 'scanner',
      action: 'status',
    });

    if (!statusResult2.success || !statusResult2.data) {
      throw new Error('Scanner status check failed after initialization');
    }

    const status2 = statusResult2.data as {
      success: boolean;
      initialized: boolean;
      camera_status: string;
      daq_status: string;
      position: number;
    };
    if (!status2.initialized) {
      throw new Error('Scanner should be initialized');
    }
    console.log('[PASS] Scanner status after initialization:');
    console.log(`  - Camera: ${status2.camera_status}`);
    console.log(`  - DAQ: ${status2.daq_status}`);
    console.log(`  - Position: ${status2.position}°\n`);

    // Test 4: Perform scan (this is the main test)
    console.log('Test 4: Performing complete scan...');
    console.log('  Note: This will simulate 72 frames with rotation and capture');
    const scanResult = await sendCommand(pythonProcess, {
      command: 'scanner',
      action: 'scan',
    });

    if (!scanResult.success || !scanResult.data) {
      throw new Error(`Scan failed: ${scanResult.error}`);
    }

    const scanData = scanResult.data as {
      success: boolean;
      frames_captured: number;
      output_path: string;
      error?: string;
    };
    if (!scanData.success) {
      throw new Error(`Scan unsuccessful: ${scanData.error}`);
    }
    if (scanData.frames_captured !== 72) {
      throw new Error(
        `Expected 72 frames, got ${scanData.frames_captured}`
      );
    }
    console.log('[PASS] Scan completed successfully');
    console.log(`  - Frames captured: ${scanData.frames_captured}/72`);
    console.log(`  - Output path: ${scanData.output_path}\n`);

    // Test 5: Check scanner status after scan
    console.log('Test 5: Checking scanner status after scan...');
    const statusResult3 = await sendCommand(pythonProcess, {
      command: 'scanner',
      action: 'status',
    });

    if (!statusResult3.success || !statusResult3.data) {
      throw new Error('Scanner status check failed after scan');
    }

    const status3 = statusResult3.data as { position: number };
    if (Math.abs(status3.position) > 1) {
      // Should be back at home (0°), allow 1° tolerance
      throw new Error(
        `Scanner should be at home position, but is at ${status3.position}°`
      );
    }
    console.log(`[PASS] Scanner returned to home position: ${status3.position}°\n`);

    // Test 6: Cleanup scanner
    console.log('Test 6: Cleaning up scanner...');
    const cleanupResult = await sendCommand(pythonProcess, {
      command: 'scanner',
      action: 'cleanup',
    });

    if (!cleanupResult.success || !cleanupResult.data) {
      throw new Error(`Scanner cleanup failed: ${cleanupResult.error}`);
    }

    const cleanupData = cleanupResult.data as { success: boolean };
    if (!cleanupData.success) {
      throw new Error('Scanner cleanup returned unsuccessful result');
    }
    console.log('[PASS] Scanner cleaned up successfully\n');

    // Test 7: Verify scanner is no longer initialized
    console.log('Test 7: Verifying scanner cleanup...');
    const statusResult4 = await sendCommand(pythonProcess, {
      command: 'scanner',
      action: 'status',
    });

    if (!statusResult4.success || !statusResult4.data) {
      throw new Error('Scanner status check failed after cleanup');
    }

    const status4 = statusResult4.data as { initialized: boolean };
    if (status4.initialized) {
      throw new Error('Scanner should not be initialized after cleanup');
    }
    console.log('[PASS] Scanner cleanup verified\n');

    console.log('=== All Scanner Tests Passed ===');
  } finally {
    // Cleanup: kill Python process
    pythonProcess.kill();
  }
}

// Run the test
runTest()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n[FAIL] Scanner test failed:', error.message);
    process.exit(1);
  });

// Set global timeout
setTimeout(() => {
  console.error('\n[FAIL] Test timeout exceeded');
  process.exit(1);
}, TEST_TIMEOUT);
