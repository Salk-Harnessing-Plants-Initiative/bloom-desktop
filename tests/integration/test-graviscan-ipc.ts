/**
 * Integration Test for GraviScan IPC Subprocess
 *
 * This script tests the GraviScan dedicated subprocess communication.
 * Tests the --graviscan-ipc flag and all graviscan commands.
 *
 * Run with: npm run test:graviscan-ipc
 * Requires: GRAVISCAN_MOCK=true environment variable
 */

// eslint-disable-next-line import/no-unresolved
import { GraviScanProcess } from '../../src/main/graviscan-process';
import path from 'path';

// Ensure mock mode is enabled
process.env.GRAVISCAN_MOCK = 'true';

async function runTests() {
  console.log('='.repeat(60));
  console.log('Testing GraviScan IPC Subprocess');
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
  console.log('GRAVISCAN_MOCK:', process.env.GRAVISCAN_MOCK);
  console.log('');

  // Create GraviScan process (uses --graviscan-ipc flag)
  const graviscanProcess = new GraviScanProcess(pythonExecutable);

  // Track test results
  let passed = 0;
  let failed = 0;
  const errors: string[] = [];

  // Set up event listeners
  graviscanProcess.on('status', (message: string) => {
    console.log(`[STATUS] ${message}`);
  });

  graviscanProcess.on('error', (error: string) => {
    console.error(`[ERROR] ${error}`);
  });

  graviscanProcess.on('exit', (code: number | null) => {
    console.log(`\n[EXIT] Process exited with code: ${code}`);
  });

  // Helper to run a test
  async function runTest(
    name: string,
    testFn: () => Promise<void>
  ): Promise<void> {
    console.log(`\n[TEST] ${name}`);
    try {
      await testFn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (error) {
      console.error(`[FAIL] ${name}:`, error);
      errors.push(`${name}: ${error}`);
      failed++;
    }
  }

  try {
    // Start GraviScan process
    console.log('[TEST] Starting GraviScan subprocess...');
    await graviscanProcess.start();
    console.log('[PASS] GraviScan subprocess started successfully\n');

    // Test 1: Ping
    await runTest('Ping command', async () => {
      const response = await graviscanProcess.sendCommand({ command: 'ping' });
      if (response.status !== 'ok' || response.message !== 'pong') {
        throw new Error(`Unexpected response: ${JSON.stringify(response)}`);
      }
      console.log(`[RESPONSE] ${JSON.stringify(response)}`);
    });

    // Test 2: Get version (should indicate graviscan subprocess)
    await runTest('Get version', async () => {
      const response = await graviscanProcess.sendCommand({
        command: 'get_version',
      });
      if (!response.version) {
        throw new Error(`No version in response: ${JSON.stringify(response)}`);
      }
      if (response.subprocess !== 'graviscan') {
        throw new Error(
          `Expected subprocess='graviscan', got: ${response.subprocess}`
        );
      }
      console.log(`[RESPONSE] ${JSON.stringify(response)}`);
    });

    // Test 3: Platform info
    await runTest('Platform info', async () => {
      const response = await graviscanProcess.sendCommand({
        command: 'graviscan',
        action: 'platform-info',
      });
      if (!response.success) {
        throw new Error(`Platform info failed: ${response.error}`);
      }
      if (response.mock_enabled !== true) {
        throw new Error(
          `Expected mock_enabled=true, got: ${response.mock_enabled}`
        );
      }
      console.log(`[RESPONSE] ${JSON.stringify(response)}`);
    });

    // Test 4: Detect scanners (mock mode)
    await runTest('Detect scanners (mock)', async () => {
      const response = await graviscanProcess.sendCommand({
        command: 'graviscan',
        action: 'detect-scanners',
        mock_count: 3,
      });
      if (!response.success) {
        throw new Error(`Detect scanners failed: ${response.error}`);
      }
      if (response.count !== 3) {
        throw new Error(`Expected 3 scanners, got: ${response.count}`);
      }
      if (!response.mock) {
        throw new Error('Expected mock=true');
      }
      console.log(`[RESPONSE] Found ${response.count} mock scanners`);
    });

    // Test 5: Get cached scanners
    await runTest('Get cached scanners', async () => {
      const response = await graviscanProcess.sendCommand({
        command: 'graviscan',
        action: 'get-scanners',
      });
      if (!response.success) {
        throw new Error(`Get scanners failed: ${response.error}`);
      }
      if (response.count !== 3) {
        throw new Error(`Expected 3 cached scanners, got: ${response.count}`);
      }
      console.log(`[RESPONSE] Cached ${response.count} scanners`);
    });

    // Test 6: Detect scanners with DB records
    await runTest('Detect scanners with DB records', async () => {
      const dbScanners = [
        { id: 'scanner-A', name: 'Lab Scanner A' },
        { id: 'scanner-B', name: 'Lab Scanner B' },
      ];
      const response = await graviscanProcess.sendCommand({
        command: 'graviscan',
        action: 'detect-scanners',
        mock_count: 2,
        db_scanners: dbScanners,
      });
      if (!response.success) {
        throw new Error(`Detect scanners failed: ${response.error}`);
      }
      // Check that names from DB records are used
      const scanner1 = response.scanners[0];
      if (
        scanner1.name !== 'Lab Scanner A' ||
        scanner1.scanner_id !== 'scanner-A'
      ) {
        throw new Error(
          `Expected DB record names, got: ${JSON.stringify(scanner1)}`
        );
      }
      console.log(
        `[RESPONSE] Matched ${response.count} scanners with DB records`
      );
    });

    // Test 7: Scan plate (mock mode)
    await runTest('Scan plate (mock)', async () => {
      const response = await graviscanProcess.sendCommand({
        command: 'graviscan',
        action: 'scan-plate',
        scanner_id: 'scanner-A',
        grid_mode: '2grid',
        plate_index: '00', // Use valid plate index format
        resolution: 1200,
        output_path: '/tmp/test-scan.jpg',
      });
      if (!response.success) {
        throw new Error(`Scan plate failed: ${response.error}`);
      }
      console.log(`[RESPONSE] ${JSON.stringify(response)}`);
    });

    // Test 8: Get scanner status
    await runTest('Get scanner status', async () => {
      const response = await graviscanProcess.sendCommand({
        command: 'graviscan',
        action: 'get-scanner-status',
        scanner_id: 'scanner-A',
      });
      if (!response.success) {
        throw new Error(`Get status failed: ${response.error}`);
      }
      console.log(`[RESPONSE] ${JSON.stringify(response)}`);
    });

    // Test 9: Release scanners
    await runTest('Release scanners', async () => {
      const response = await graviscanProcess.sendCommand({
        command: 'graviscan',
        action: 'release-scanners',
      });
      if (!response.success) {
        throw new Error(`Release scanners failed: ${response.error}`);
      }
      console.log(`[RESPONSE] Released ${response.released} scanner(s)`);
    });

    // Test 10: Error handling - unknown action
    await runTest('Error handling - unknown action', async () => {
      // This should NOT throw - the process should handle it gracefully
      // But we need to handle the fact that it returns an error
      await graviscanProcess.sendCommand({
        command: 'graviscan',
        action: 'unknown-action',
      });
      // For error responses, we might get an empty object since ERROR: is sent
      // The test passes if we don't crash
      console.log('[RESPONSE] Error handled gracefully');
    });

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log(`Test Results: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(60));

    if (failed > 0) {
      console.log('\nFailed tests:');
      errors.forEach((e) => console.log(`  - ${e}`));
      graviscanProcess.stop();
      process.exit(1);
    } else {
      console.log('\n[PASS] All tests passed!');
      graviscanProcess.stop();
      process.exit(0);
    }
  } catch (error) {
    console.error('\n[FATAL] Test suite failed:', error);
    graviscanProcess.stop();
    process.exit(1);
  }
}

// Run tests
runTests();
