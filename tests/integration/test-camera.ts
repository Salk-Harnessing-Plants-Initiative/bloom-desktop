/**
 * Integration Test for Camera IPC
 *
 * This script tests the camera interface using the mock camera.
 * Run with: npm run test:camera
 */

import { CameraProcess } from '../../src/main/camera-process';
import type { CameraSettings } from '../../src/main/camera-process';
import path from 'path';
import fs from 'fs';

async function testCamera() {
  console.log('='.repeat(60));
  console.log('Testing Camera Interface (Mock Camera)');
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
  console.log('Environment: BLOOM_USE_MOCK_CAMERA=true (default)\n');

  // Create camera process
  const cameraProcess = new CameraProcess(pythonExecutable, ['--ipc']);

  // Set up event listeners
  cameraProcess.on('status', (message: string) => {
    console.log(`[STATUS] ${message}`);
  });

  cameraProcess.on('error', (error: string) => {
    // Ignore warnings, only log actual errors
    if (!error.toLowerCase().includes('warning')) {
      console.error(`[ERROR] ${error}`);
    }
  });

  cameraProcess.on('camera-trigger', () => {
    console.log('[EVENT] Camera triggered!');
  });

  cameraProcess.on('image-captured', (dataUri: string) => {
    const preview = dataUri.substring(0, 50) + '...';
    console.log(`[EVENT] Image captured: ${preview}`);
  });

  cameraProcess.on('exit', (code: number | null) => {
    console.log(`\n[EXIT] Camera process exited with code: ${code}`);
  });

  try {
    // Start camera process
    console.log('[TEST] Starting camera process...');
    await cameraProcess.start();
    console.log('[PASS] Camera process started successfully\n');

    // Test 1: Get camera status (should show mock camera)
    console.log('[TEST 1] Getting camera status...');
    const statusResponse = await cameraProcess.getStatus();
    console.log(`[RESPONSE] ${JSON.stringify(statusResponse)}`);
    if (statusResponse.available !== undefined && statusResponse.mock !== undefined) {
      console.log('[PASS] Status test passed');
      console.log(`  - Mock camera: ${statusResponse.mock}`);
      console.log(`  - Available: ${statusResponse.available}`);
      console.log(`  - Connected: ${statusResponse.connected}\n`);
    } else {
      throw new Error('Status test failed - unexpected response format');
    }

    // Test 2: Connect to mock camera
    console.log('[TEST 2] Connecting to mock camera...');
    const cameraSettings: CameraSettings = {
      camera_ip_address: '10.0.0.23', // Mock doesn't use this but required by API
      exposure_time: 5000,
      gain: 10,
      gamma: 1.0,
      num_frames: 3,
    };
    const connectSuccess = await cameraProcess.connect(cameraSettings);
    console.log(`[RESPONSE] Connected: ${connectSuccess}`);
    if (connectSuccess) {
      console.log('[PASS] Connect test passed\n');
    } else {
      throw new Error('Failed to connect to mock camera');
    }

    // Test 3: Capture a single frame
    console.log('[TEST 3] Capturing single frame...');
    const captureResponse = await cameraProcess.capture();
    console.log(`[RESPONSE] Success: ${captureResponse.success}`);
    if (captureResponse.success && captureResponse.image) {
      const imageSize = captureResponse.image.length;
      console.log(`  - Image size: ${imageSize} bytes`);
      console.log(`  - Width: ${captureResponse.width || 'unknown'}`);
      console.log(`  - Height: ${captureResponse.height || 'unknown'}`);
      console.log(`  - Format: ${captureResponse.image.substring(0, 30)}...`);
      console.log('[PASS] Capture test passed\n');

      // Optional: Save the captured image to verify it's valid
      if (captureResponse.image.startsWith('data:image/png;base64,')) {
        const base64Data = captureResponse.image.replace(
          'data:image/png;base64,',
          ''
        );
        const imageBuffer = Buffer.from(base64Data, 'base64');
        const outputPath = path.join(__dirname, 'test-capture.png');
        fs.writeFileSync(outputPath, imageBuffer);
        console.log(`[INFO] Saved test image to: ${outputPath}\n`);
      }
    } else {
      throw new Error(
        `Capture test failed: ${captureResponse.error || 'Unknown error'}`
      );
    }

    // Test 4: Configure camera settings
    console.log('[TEST 4] Configuring camera settings...');
    const configSuccess = await cameraProcess.configure({
      exposure_time: 10000,
      gain: 15,
    });
    console.log(`[RESPONSE] Configured: ${configSuccess}`);
    if (configSuccess) {
      console.log('[PASS] Configure test passed\n');
    } else {
      throw new Error('Configure test failed');
    }

    // Test 5: Disconnect from camera
    console.log('[TEST 5] Disconnecting from camera...');
    const disconnectSuccess = await cameraProcess.disconnect();
    console.log(`[RESPONSE] Disconnected: ${disconnectSuccess}`);
    if (disconnectSuccess) {
      console.log('[PASS] Disconnect test passed\n');
    } else {
      throw new Error('Disconnect test failed');
    }

    // Success!
    console.log('='.repeat(60));
    console.log('[PASS] All camera tests passed!');
    console.log('='.repeat(60));
    console.log('\nNext steps:');
    console.log('  1. Check test-capture.png to see the captured image');
    console.log('  2. Test with real camera: BLOOM_USE_MOCK_CAMERA=false');
    console.log('  3. Integrate camera API into React components');
    console.log('');

    // Clean up
    cameraProcess.stop();
    process.exit(0);
  } catch (error) {
    console.error('\n[FAIL] Test failed:', error);
    cameraProcess.stop();
    process.exit(1);
  }
}

// Run tests
testCamera();