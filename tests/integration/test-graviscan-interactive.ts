#!/usr/bin/env npx ts-node
/**
 * Interactive GraviScan IPC Test
 *
 * Run with: npm run test:graviscan-interactive
 *
 * This script tests the full IPC chain using GraviScanProcess:
 *   TypeScript (GraviScanProcess) -> Python (graviscan_main.py) -> SANE
 *
 * Steps:
 * 1. Detect connected scanners
 * 2. Select a scanner by number
 * 3. Connect to the scanner
 * 4. Perform a test scan
 */

import * as readline from 'readline';
import * as path from 'path';
// eslint-disable-next-line import/no-unresolved
import { GraviScanProcess } from '../../src/main/graviscan-process';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

interface DeviceInfo {
  index: number;
  name: string;
  vendor: string;
  model: string;
  type: string;
}

async function main() {
  console.log('=== GraviScan IPC Handler Test ===\n');

  // Use the bundled Python executable (same as test-graviscan-ipc.ts)
  const pythonExecutable = path.join(
    __dirname,
    '..',
    '..',
    'dist',
    process.platform === 'win32' ? 'bloom-hardware.exe' : 'bloom-hardware'
  );

  console.log(`Python executable: ${pythonExecutable}`);
  console.log(`Mock mode: ${process.env.GRAVISCAN_MOCK || 'false'}\n`);

  // Use the actual GraviScanProcess class (tests the real IPC handlers)
  const graviscan = new GraviScanProcess(pythonExecutable);

  // Set up event listeners
  graviscan.on('status', (msg) => console.log('  [STATUS]', msg));
  graviscan.on('error', (msg) => console.error('  [ERROR]', msg));
  graviscan.on('scan-complete', (event) => console.log('  [EVENT] Scan complete:', event));
  graviscan.on('scan-error', (event) => console.error('  [EVENT] Scan error:', event));

  try {
    // Start the subprocess
    console.log('Starting GraviScan subprocess...');
    await graviscan.start();
    console.log('✓ GraviScan subprocess started\n');

    // Test ping
    console.log('Testing ping...');
    const pingResult = await graviscan.sendCommand({ command: 'ping' });
    if (pingResult?.message === 'pong') {
      console.log('✓ Ping successful\n');
    } else {
      throw new Error('Ping failed: ' + JSON.stringify(pingResult));
    }

    // Step 1: Setup and detect scanners
    console.log('=== Step 1: Detecting Scanners ===\n');
    const setupResult = await graviscan.sendCommand({ command: 'graviscan', action: 'setup-scanners' });

    if (setupResult.error) {
      console.error('Failed to setup scanners:', setupResult.error);
      return;
    }

    const devices: DeviceInfo[] = setupResult.devices || [];

    if (devices.length === 0) {
      console.log('No scanners detected. Make sure scanners are connected and powered on.');
      console.log('On Linux, you may need to run: sudo sane-find-scanner');
      return;
    }

    console.log(`Found ${devices.length} scanner(s):\n`);
    devices.forEach((device, i) => {
      console.log(`  [${i + 1}] ${device.vendor} ${device.model}`);
      console.log(`      Device: ${device.name}`);
      console.log(`      Type: ${device.type}\n`);
    });

    // Step 2: Select scanner
    const selection = await prompt('Select scanner number (or q to quit): ');

    if (selection.toLowerCase() === 'q') {
      console.log('Exiting...');
      return;
    }

    const selectedIndex = parseInt(selection) - 1;
    if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= devices.length) {
      console.error('Invalid selection');
      return;
    }

    const selectedDevice = devices[selectedIndex];
    const scannerId = `scanner_${selectedIndex}`;
    console.log(`\nSelected: ${selectedDevice.vendor} ${selectedDevice.model}\n`);

    // Step 3: Connect to scanner
    console.log('=== Step 2: Connecting to Scanner ===\n');
    const connectResult = await graviscan.sendCommand({
      command: 'graviscan',
      action: 'connect-scanner',
      scanner_id: scannerId,
      device_index: selectedIndex
    });

    if (connectResult.error) {
      console.error('Failed to connect:', connectResult.error);
      return;
    }

    console.log('✓ Connected successfully\n');
    console.log('  Scanner ID:', connectResult.scanner_id);
    console.log('  Device:', connectResult.device_name);
    if (connectResult.max_br_x && connectResult.max_br_y) {
      console.log(`  Scan area: ${connectResult.max_br_x}mm x ${connectResult.max_br_y}mm\n`);
    }

    // Step 4: Ask about grid mode
    const gridMode = await prompt('Grid mode (2 or 4, default 2): ') || '2';
    const plateIndex = await prompt('Plate index (00, 01, etc., default 00): ') || '00';

    // Step 5: Perform scan
    console.log('\n=== Step 3: Scanning ===\n');
    console.log(`Scanning plate ${plateIndex} in ${gridMode}-grid mode...`);
    console.log('(This may take 30-60 seconds)\n');

    const scanResult = await graviscan.sendCommand({
      command: 'graviscan',
      action: 'scan-plate',
      scanner_id: scannerId,
      grid_mode: parseInt(gridMode),
      plate_index: plateIndex,
      resolution: 300,
      output_path: `/tmp/graviscan-test-${Date.now()}.jpg`
    });

    if (scanResult.error) {
      console.error('Scan failed:', scanResult.error);
    } else {
      console.log('✓ Scan completed successfully!\n');
      console.log('  Image path:', scanResult.image_path);
      console.log('  Image size:', scanResult.image_size, 'bytes');
      if (scanResult.width && scanResult.height) {
        console.log(`  Dimensions: ${scanResult.width}x${scanResult.height}`);
      }
    }

    // Step 6: Disconnect
    console.log('\n=== Step 4: Cleanup ===\n');
    await graviscan.sendCommand({
      command: 'graviscan',
      action: 'disconnect-scanner',
      scanner_id: scannerId
    });
    console.log('✓ Disconnected from scanner');

    await graviscan.sendCommand({ command: 'graviscan', action: 'release-scanners' });
    console.log('✓ Released all scanner resources\n');

    console.log('Test complete!');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    graviscan.stop();
    rl.close();
  }
}

main();
