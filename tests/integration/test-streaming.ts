/**
 * Integration Test for Camera Streaming
 *
 * Tests full streaming workflow: Python → IPC → TypeScript
 * Run with: npm run test:streaming
 */

import { CameraProcess, CameraSettings } from '../../src/main/camera-process';
import path from 'path';

// Pattern to identify warning messages vs actual errors
const WARNING_MESSAGE_PATTERN = /\b(warn|warning|deprecationwarning)\b/i;

async function testStreaming() {
  console.log('='.repeat(60));
  console.log('Testing Camera Streaming');
  console.log('='.repeat(60));

  // Determine Python executable path
  const pythonExecutable = path.join(
    __dirname,
    '..',
    '..',
    'dist',
    process.platform === 'win32' ? 'bloom-hardware.exe' : 'bloom-hardware'
  );

  console.log(`\nPython executable: ${pythonExecutable}`);
  console.log('Environment: BLOOM_USE_MOCK_CAMERA=true (default)\n');

  const cameraProcess = new CameraProcess(pythonExecutable, ['--ipc']);

  // Set up event listeners
  cameraProcess.on('status', (message: string) => {
    console.log(`[STATUS] ${message}`);
  });

  cameraProcess.on('error', (error: string) => {
    if (!WARNING_MESSAGE_PATTERN.test(error)) {
      console.error(`[ERROR] ${error}`);
    }
  });

  // Track frames
  let frameCount = 0;
  const startTime = Date.now();

  cameraProcess.on('frame', (dataUri: string) => {
    frameCount++;
    if (frameCount === 1) {
      console.log(
        `[EVENT] First frame received! (${dataUri.substring(0, 50)}...)`
      );
    }
    if (frameCount % 30 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const fps = (frameCount / parseFloat(elapsed)).toFixed(1);
      console.log(
        `[PROGRESS] Frame ${frameCount} at ${elapsed}s - FPS: ${fps}`
      );
    }
  });

  cameraProcess.on('exit', (code: number | null) => {
    console.log(`\n[EXIT] Camera process exited with code: ${code}`);
  });

  try {
    // Start camera process
    console.log('[TEST] Starting camera process...');
    await cameraProcess.start();
    console.log('[PASS] Camera process started successfully\n');

    // Test 1: Start streaming
    console.log('[TEST 1] Starting stream...');
    const cameraSettings: Partial<CameraSettings> = {
      exposure_time: 10000,
      gain: 0.0,
      camera_ip_address: '192.168.1.100',
      num_frames: 1,
    };

    const startResponse = await cameraProcess.startStream(cameraSettings);
    console.log(`[RESPONSE] ${JSON.stringify(startResponse)}`);

    if (startResponse === true) {
      console.log('[PASS] Stream started successfully\n');
    } else {
      throw new Error(`Stream start failed: ${JSON.stringify(startResponse)}`);
    }

    // Test 2: Wait for frames
    console.log('[TEST 2] Waiting for frames (3 seconds)...');
    await new Promise((resolve) => setTimeout(resolve, 3000));

    if (frameCount > 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const fps = (frameCount / parseFloat(elapsed)).toFixed(1);
      console.log(
        `[PASS] Received ${frameCount} frames in ${elapsed}s (${fps} FPS)\n`
      );

      // Verify FPS is reasonable (5-40 FPS range for mock camera)
      // Note: PNG encoding/decoding overhead limits FPS
      // Real Basler camera will achieve higher FPS with raw image data
      const fpsNum = parseFloat(fps);
      if (fpsNum >= 5 && fpsNum <= 40) {
        console.log('[PASS] FPS within expected range (5-40)\n');
      } else {
        console.log(`[WARN] FPS ${fps} outside expected range (5-40)\n`);
      }
    } else {
      throw new Error('No frames received after 3 seconds');
    }

    // Test 3: Stop streaming
    console.log('[TEST 3] Stopping stream...');
    const stopResponse = await cameraProcess.stopStream();
    console.log(`[RESPONSE] ${JSON.stringify(stopResponse)}`);

    if (stopResponse === true) {
      console.log('[PASS] Stream stopped successfully\n');
    } else {
      throw new Error(`Stream stop failed: ${JSON.stringify(stopResponse)}`);
    }

    // Test 4: Verify no more frames after stop
    const framesBeforeStop = frameCount;
    console.log('[TEST 4] Verifying no frames after stop (1 second)...');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    if (frameCount === framesBeforeStop) {
      console.log('[PASS] No frames received after stop\n');
    } else {
      console.log(
        `[WARN] Received ${frameCount - framesBeforeStop} frames after stop\n`
      );
    }

    // Clean up
    console.log('[CLEANUP] Stopping camera process...');
    cameraProcess.stop();

    console.log('\n' + '='.repeat(60));
    console.log('ALL TESTS PASSED');
    console.log('='.repeat(60));
    process.exit(0);
  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('TEST FAILED');
    console.error('='.repeat(60));
    console.error(error);
    cameraProcess.stop();
    process.exit(1);
  }
}

testStreaming();
