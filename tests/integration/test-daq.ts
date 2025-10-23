/**
 * Integration Test for DAQ IPC
 *
 * This script tests the DAQ interface using the mock DAQ.
 * Run with: npm run test:daq
 */

import { DAQProcess } from '../../src/main/daq-process';
import type { DAQSettings } from '../../src/types/daq';
import path from 'path';

// Pattern to identify warning messages vs actual errors
const WARNING_MESSAGE_PATTERN = /\b(warn|warning|deprecationwarning)\b/i;

async function testDAQ() {
  console.log('='.repeat(60));
  console.log('Testing DAQ Interface (Mock DAQ)');
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
  console.log('Environment: BLOOM_USE_MOCK_DAQ=true (default)\n');

  // Create DAQ process
  const daqProcess = new DAQProcess(pythonExecutable, ['--ipc']);

  // Set up event listeners
  daqProcess.on('status', (message: string) => {
    console.log(`[STATUS] ${message}`);
  });

  daqProcess.on('error', (error: string) => {
    // Ignore warnings, only log actual errors
    if (!WARNING_MESSAGE_PATTERN.test(error)) {
      console.error(`[ERROR] ${error}`);
    }
  });

  daqProcess.on('daq-initialized', () => {
    console.log('[EVENT] DAQ initialized!');
  });

  daqProcess.on('daq-position-changed', (position: number) => {
    console.log(`[EVENT] Position changed: ${position}°`);
  });

  daqProcess.on('daq-home', () => {
    console.log('[EVENT] Returned to home position!');
  });

  daqProcess.on('exit', (code: number | null) => {
    console.log(`\n[EXIT] DAQ process exited with code: ${code}`);
  });

  try {
    // Start DAQ process
    console.log('[TEST] Starting DAQ process...');
    await daqProcess.start();
    console.log('[PASS] DAQ process started successfully\n');

    // Test 1: Get DAQ status (should show not initialized)
    console.log('[TEST 1] Getting DAQ status (before initialization)...');
    const status1 = await daqProcess.getStatus();
    console.log(`[RESPONSE] ${JSON.stringify(status1)}`);
    if (
      status1.success !== undefined &&
      status1.initialized === false &&
      status1.mock !== undefined
    ) {
      console.log('[PASS] Initial status test passed');
      console.log(`  - Mock DAQ: ${status1.mock}`);
      console.log(`  - Available: ${status1.available}`);
      console.log(`  - Initialized: ${status1.initialized}`);
      console.log(`  - Position: ${status1.position}°\n`);
    } else {
      throw new Error('Status test failed - unexpected response format');
    }

    // Test 2: Initialize DAQ
    console.log('[TEST 2] Initializing DAQ with default settings...');
    const daqSettings: DAQSettings = {
      device_name: 'cDAQ1Mod1',
      sampling_rate: 40_000,
      step_pin: 0,
      dir_pin: 1,
      steps_per_revolution: 6400,
      num_frames: 72,
      seconds_per_rot: 36.0,
    };
    const initResponse = await daqProcess.initialize(daqSettings);
    console.log(`[RESPONSE] ${JSON.stringify(initResponse)}`);
    if (initResponse.success && initResponse.initialized) {
      console.log('[PASS] Initialize test passed\n');
    } else {
      throw new Error(
        `Initialize test failed: ${initResponse.error || 'Unknown error'}`
      );
    }

    // Test 3: Get status after initialization
    console.log('[TEST 3] Getting DAQ status (after initialization)...');
    const status2 = await daqProcess.getStatus();
    console.log(`[RESPONSE] ${JSON.stringify(status2)}`);
    if (status2.success && status2.initialized) {
      console.log('[PASS] Post-initialization status test passed');
      console.log(`  - Initialized: ${status2.initialized}`);
      console.log(`  - Position: ${status2.position}°\n`);
    } else {
      throw new Error('Post-initialization status test failed');
    }

    // Test 4: Rotate 90 degrees clockwise
    console.log('[TEST 4] Rotating 90° clockwise...');
    const rotate1 = await daqProcess.rotate(90);
    console.log(`[RESPONSE] ${JSON.stringify(rotate1)}`);
    if (rotate1.success && rotate1.position === 90) {
      console.log('[PASS] 90° rotation test passed');
      console.log(`  - New position: ${rotate1.position}°\n`);
    } else {
      throw new Error(
        `90° rotation test failed: ${rotate1.error || 'Position mismatch'}`
      );
    }

    // Test 5: Rotate 45 degrees more (should be at 135°)
    console.log('[TEST 5] Rotating 45° more (should be at 135°)...');
    const rotate2 = await daqProcess.rotate(45);
    console.log(`[RESPONSE] ${JSON.stringify(rotate2)}`);
    if (rotate2.success && rotate2.position === 135) {
      console.log('[PASS] 45° rotation test passed');
      console.log(`  - New position: ${rotate2.position}°\n`);
    } else {
      throw new Error(
        `45° rotation test failed: ${rotate2.error || 'Position mismatch'}`
      );
    }

    // Test 6: Rotate counter-clockwise (-45°, should wrap to 90°)
    console.log('[TEST 6] Rotating -45° (counter-clockwise to 90°)...');
    const rotate3 = await daqProcess.rotate(-45);
    console.log(`[RESPONSE] ${JSON.stringify(rotate3)}`);
    if (rotate3.success && rotate3.position === 90) {
      console.log('[PASS] Counter-clockwise rotation test passed');
      console.log(`  - New position: ${rotate3.position}°\n`);
    } else {
      throw new Error(
        `Counter-clockwise rotation test failed: ${rotate3.error || 'Position mismatch'}`
      );
    }

    // Test 7: Step command (100 steps clockwise)
    console.log('[TEST 7] Stepping 100 steps clockwise...');
    const step1 = await daqProcess.step(100, 1);
    console.log(`[RESPONSE] ${JSON.stringify(step1)}`);
    if (step1.success && step1.position > 90) {
      console.log('[PASS] Step command test passed');
      console.log(`  - New position: ${step1.position}°\n`);
    } else {
      throw new Error(
        `Step command test failed: ${step1.error || 'Position did not increase'}`
      );
    }

    // Test 8: Home command (return to 0°)
    console.log('[TEST 8] Returning to home position (0°)...');
    const homeResponse = await daqProcess.home();
    console.log(`[RESPONSE] ${JSON.stringify(homeResponse)}`);
    if (homeResponse.success && homeResponse.position === 0) {
      console.log('[PASS] Home command test passed');
      console.log(`  - Position: ${homeResponse.position}°\n`);
    } else {
      throw new Error(
        `Home command test failed: ${homeResponse.error || 'Position not 0'}`
      );
    }

    // Test 9: Verify position after home
    console.log('[TEST 9] Verifying position is 0° after home...');
    const status3 = await daqProcess.getStatus();
    console.log(`[RESPONSE] ${JSON.stringify(status3)}`);
    if (status3.success && status3.position === 0) {
      console.log('[PASS] Position verification test passed');
      console.log(`  - Position: ${status3.position}°\n`);
    } else {
      throw new Error('Position verification test failed');
    }

    // Test 10: Full rotation (360°, should end at 0°)
    console.log('[TEST 10] Performing full rotation (360°)...');
    const rotate360 = await daqProcess.rotate(360);
    console.log(`[RESPONSE] ${JSON.stringify(rotate360)}`);
    if (rotate360.success && rotate360.position === 0) {
      console.log('[PASS] Full rotation test passed');
      console.log(`  - Position wraps to: ${rotate360.position}°\n`);
    } else {
      throw new Error(
        `Full rotation test failed: ${rotate360.error || 'Position should wrap to 0'}`
      );
    }

    // Test 11: Cleanup DAQ
    console.log('[TEST 11] Cleaning up DAQ...');
    const cleanupResponse = await daqProcess.cleanup();
    console.log(`[RESPONSE] ${JSON.stringify(cleanupResponse)}`);
    if (cleanupResponse.success && !cleanupResponse.initialized) {
      console.log('[PASS] Cleanup test passed\n');
    } else {
      throw new Error(
        `Cleanup test failed: ${cleanupResponse.error || 'DAQ still initialized'}`
      );
    }

    // Test 12: Verify status after cleanup
    console.log('[TEST 12] Verifying DAQ status after cleanup...');
    const status4 = await daqProcess.getStatus();
    console.log(`[RESPONSE] ${JSON.stringify(status4)}`);
    if (status4.success && !status4.initialized) {
      console.log('[PASS] Post-cleanup status test passed');
      console.log(`  - Initialized: ${status4.initialized}\n`);
    } else {
      throw new Error('Post-cleanup status test failed');
    }

    // Success!
    console.log('='.repeat(60));
    console.log('[PASS] All DAQ tests passed!');
    console.log('='.repeat(60));
    console.log('\nTest Summary:');
    console.log('  ✓ Status checks (before and after operations)');
    console.log('  ✓ Initialize and cleanup operations');
    console.log('  ✓ Clockwise and counter-clockwise rotation');
    console.log('  ✓ Position tracking and wrapping (0-360°)');
    console.log('  ✓ Step command');
    console.log('  ✓ Home command');
    console.log('  ✓ Full rotation (360°)');
    console.log('\nNext steps:');
    console.log('  1. Test with real DAQ: BLOOM_USE_MOCK_DAQ=false');
    console.log('  2. Integrate DAQ API into React components');
    console.log('  3. Test synchronized camera + DAQ scanning');
    console.log('');

    // Clean up
    daqProcess.stop();
    process.exit(0);
  } catch (error) {
    console.error('\n[FAIL] Test failed:', error);
    daqProcess.stop();
    process.exit(1);
  }
}

// Run tests
testDAQ();
