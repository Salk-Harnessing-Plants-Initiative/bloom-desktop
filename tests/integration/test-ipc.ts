/**
 * Integration Test for Python IPC
 *
 * This script tests the full TypeScript → Python IPC communication.
 * Run with: npm run test:ipc
 */

import { PythonProcess } from '../../src/main/python-process';
import path from 'path';

async function testIPC() {
  console.log('='.repeat(60));
  console.log('Testing Python IPC Communication');
  console.log('='.repeat(60));

  // Determine Python executable path (from project root)
  const pythonExecutable = path.join(
    __dirname,
    '..',
    '..',
    'dist',
    process.platform === 'win32' ? 'bloom-hardware.exe' : 'bloom-hardware'
  );

  console.log(`\nPython executable: ${pythonExecutable}`);
  console.log('');

  // Create Python process
  const pythonProcess = new PythonProcess(pythonExecutable, ['--ipc']);

  // Set up event listeners
  pythonProcess.on('status', (message: string) => {
    console.log(`[STATUS] ${message}`);
  });

  pythonProcess.on('error', (error: string) => {
    console.error(`[ERROR] ${error}`);
  });

  pythonProcess.on('exit', (code: number | null) => {
    console.log(`\n[EXIT] Process exited with code: ${code}`);
  });

  try {
    // Start Python process
    console.log('[TEST] Starting Python process...');
    await pythonProcess.start();
    console.log('[PASS] Python process started successfully\n');

    // Test 1: Ping
    console.log('[TEST] Sending ping command...');
    const pingResponse = await pythonProcess.sendCommand({ command: 'ping' });
    console.log(`[RESPONSE] ${JSON.stringify(pingResponse)}`);
    if (pingResponse.status === 'ok' && pingResponse.message === 'pong') {
      console.log('[PASS] Ping test passed\n');
    } else {
      throw new Error('Ping test failed');
    }

    // Test 2: Get version
    console.log('[TEST] Getting Python version...');
    const versionResponse = await pythonProcess.sendCommand({
      command: 'get_version',
    });
    console.log(`[RESPONSE] ${JSON.stringify(versionResponse)}`);
    if (versionResponse.version) {
      console.log('[PASS] Version test passed\n');
    } else {
      throw new Error('Version test failed');
    }

    // Test 3: Check hardware
    console.log('[TEST] Checking hardware availability...');
    const hardwareResponse = await pythonProcess.sendCommand({
      command: 'check_hardware',
    });
    console.log(`[RESPONSE] ${JSON.stringify(hardwareResponse)}`);
    if ('camera' in hardwareResponse && 'daq' in hardwareResponse) {
      console.log('[PASS] Hardware check test passed\n');
    } else {
      throw new Error('Hardware check test failed');
    }

    // Success!
    console.log('='.repeat(60));
    console.log('[PASS] All tests passed!');
    console.log('='.repeat(60));

    // Clean up
    pythonProcess.stop();
    process.exit(0);
  } catch (error) {
    console.error('\n[FAIL] Test failed:', error);
    pythonProcess.stop();
    process.exit(1);
  }
}

// Run tests
testIPC();
