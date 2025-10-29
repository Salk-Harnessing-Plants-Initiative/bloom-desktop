/**
 * Scanner-Database Integration Test
 *
 * Tests the scanner-database integration workflow:
 * - Initialize database and scanner
 * - Create required database records (scientist, phenotyper, experiment)
 * - Perform scan with metadata
 * - Verify scan and images saved to database
 * - Verify nested create pattern (atomic transaction)
 * - Cleanup resources
 *
 * Uses mock hardware for testing without physical devices.
 */

import { PrismaClient } from '@prisma/client';
import { ScannerProcess } from '../../src/main/scanner-process';
import { PythonProcess } from '../../src/main/python-process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { execSync } from 'child_process';

// Test configuration
const IS_WINDOWS = os.platform() === 'win32';
const PYTHON_EXECUTABLE = IS_WINDOWS
  ? path.join(__dirname, '../../dist/bloom-hardware.exe')
  : path.join(__dirname, '../../dist/bloom-hardware');

// Test timeout (60 seconds for full workflow)
const TEST_TIMEOUT = 60000;

// Test database path
const TEST_DB_PATH = path.join(__dirname, '../../prisma/test-scanner-db.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

// Scanner settings with metadata for database
const createScannerSettings = (metadata: {
  experiment_id: string;
  phenotyper_id: string;
}) => ({
  camera: {
    exposure_time: 10000,
    gain: 0.0,
    camera_ip_address: '192.168.1.100',
    gamma: 1.0,
    brightness: 0.5,
    contrast: 1.0,
    width: 640,
    height: 480,
  },
  daq: {
    device_name: 'cDAQ1Mod1',
    sampling_rate: 40000,
    step_pin: 0,
    dir_pin: 1,
    steps_per_revolution: 6400,
    num_frames: 36, // Use fewer frames for faster testing
    seconds_per_rot: 18.0,
  },
  num_frames: 36,
  output_path: './test-scans',
  metadata: {
    experiment_id: metadata.experiment_id,
    phenotyper_id: metadata.phenotyper_id,
    scanner_name: 'TestScanner-01',
    plant_id: 'TEST-PLANT-001',
    // accession_id is optional, omit it
    plant_age_days: 14,
    wave_number: 1,
  },
});

/**
 * Setup test database with required records
 */
async function setupTestDatabase(): Promise<{
  prisma: PrismaClient;
  scientistId: string;
  phenotyperId: string;
  experimentId: string;
}> {
  // Clean up existing test database
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
    console.log('[PASS] Cleaned up existing test database');
  }

  // Create new Prisma client with test database
  const prisma = new PrismaClient({
    datasources: {
      db: { url: TEST_DB_URL },
    },
  });

  console.log('[INFO] Initializing test database...');

  // Run migrations programmatically
  execSync(`DATABASE_URL="${TEST_DB_URL}" npx prisma migrate deploy`, {
    stdio: 'inherit',
  });

  console.log('[PASS] Test database migrations applied');

  // Create test scientist
  const scientist = await prisma.scientist.create({
    data: {
      name: 'Test Scientist',
      email: 'test.scientist@example.com',
    },
  });
  console.log(`[PASS] Created test scientist: ${scientist.id}`);

  // Create test phenotyper
  const phenotyper = await prisma.phenotyper.create({
    data: {
      name: 'Test Phenotyper',
      email: 'test.phenotyper@example.com',
    },
  });
  console.log(`[PASS] Created test phenotyper: ${phenotyper.id}`);

  // Create test experiment
  const experiment = await prisma.experiment.create({
    data: {
      name: 'Scanner Integration Test Experiment',
      species: 'Arabidopsis thaliana',
      scientist_id: scientist.id,
    },
  });
  console.log(`[PASS] Created test experiment: ${experiment.id}`);

  return {
    prisma,
    scientistId: scientist.id,
    phenotyperId: phenotyper.id,
    experimentId: experiment.id,
  };
}

/**
 * Main test function
 */
async function runTest(): Promise<void> {
  console.log('=== Scanner-Database Integration Test ===\n');

  let pythonProcess: PythonProcess | null = null;
  let prisma: PrismaClient | null = null;

  try {
    // Check if Python executable exists
    if (!fs.existsSync(PYTHON_EXECUTABLE)) {
      throw new Error(
        `Python executable not found at: ${PYTHON_EXECUTABLE}\nRun 'npm run build:python' first.`
      );
    }

    // Setup test database
    const dbSetup = await setupTestDatabase();
    prisma = dbSetup.prisma;

    // Start Python process with mock hardware
    console.log('\n[INFO] Starting Python process with mock hardware...');
    pythonProcess = new PythonProcess(PYTHON_EXECUTABLE, ['--ipc']);

    // Set environment for mock hardware
    process.env.BLOOM_USE_MOCK_HARDWARE = 'true';
    process.env.BLOOM_USE_MOCK_CAMERA = 'true';
    process.env.BLOOM_USE_MOCK_DAQ = 'true';

    await pythonProcess.start();
    console.log('[PASS] Python process started');

    // Create scanner process
    const scannerProcess = new ScannerProcess(pythonProcess);
    console.log('[PASS] Scanner process created');

    // Initialize scanner with metadata
    const scannerSettings = createScannerSettings({
      experiment_id: dbSetup.experimentId,
      phenotyper_id: dbSetup.phenotyperId,
    });

    console.log('\n[INFO] Initializing scanner with metadata...');
    const initResult = await scannerProcess.initialize(scannerSettings);

    if (!initResult.success || !initResult.initialized) {
      throw new Error(
        `Scanner initialization failed: ${JSON.stringify(initResult)}`
      );
    }
    console.log('[PASS] Scanner initialized with metadata');

    // Track progress events
    let progressCount = 0;
    scannerProcess.onProgress((progress) => {
      progressCount++;
      if (progressCount === 1 || progressCount % 10 === 0) {
        console.log(
          `[INFO] Progress: Frame ${progress.frame_number + 1}/${progress.total_frames} (${progress.position}°)`
        );
      }
    });

    // Perform scan
    console.log('\n[INFO] Starting scan with database persistence...');
    const scanResult = await scannerProcess.scan();

    if (!scanResult.success) {
      throw new Error(`Scan failed: ${scanResult.error}`);
    }
    console.log('[PASS] Scan completed successfully');
    console.log(`[INFO] Frames captured: ${scanResult.frames_captured}`);
    console.log(`[INFO] Output path: ${scanResult.output_path}`);

    // Verify scan_id was returned
    if (!scanResult.scan_id) {
      throw new Error('Scan ID not returned - database save may have failed');
    }
    console.log(`[PASS] Scan ID returned: ${scanResult.scan_id}`);

    // Verify scan was saved to database
    console.log('\n[INFO] Verifying database records...');
    const savedScan = await prisma.scan.findUnique({
      where: { id: scanResult.scan_id },
      include: { images: true },
    });

    if (!savedScan) {
      throw new Error('Scan not found in database');
    }
    console.log('[PASS] Scan found in database');

    // Verify scan metadata
    if (savedScan.experiment_id !== dbSetup.experimentId) {
      throw new Error('Scan experiment_id mismatch');
    }
    console.log('[PASS] Scan experiment_id matches');

    if (savedScan.phenotyper_id !== dbSetup.phenotyperId) {
      throw new Error('Scan phenotyper_id mismatch');
    }
    console.log('[PASS] Scan phenotyper_id matches');

    if (savedScan.scanner_name !== 'TestScanner-01') {
      throw new Error('Scan scanner_name mismatch');
    }
    console.log('[PASS] Scan scanner_name matches');

    if (savedScan.plant_id !== 'TEST-PLANT-001') {
      throw new Error('Scan plant_id mismatch');
    }
    console.log('[PASS] Scan plant_id matches');

    if (savedScan.plant_age_days !== 14) {
      throw new Error('Scan plant_age_days mismatch');
    }
    console.log('[PASS] Scan plant_age_days matches');

    if (savedScan.wave_number !== 1) {
      throw new Error('Scan wave_number mismatch');
    }
    console.log('[PASS] Scan wave_number matches');

    // Verify scan parameters
    if (savedScan.num_frames !== scanResult.frames_captured) {
      throw new Error('Scan num_frames mismatch');
    }
    console.log('[PASS] Scan num_frames matches');

    if (savedScan.exposure_time !== 10000) {
      throw new Error('Scan exposure_time mismatch');
    }
    console.log('[PASS] Scan camera settings saved correctly');

    // Verify images were created (nested create pattern)
    if (!savedScan.images || savedScan.images.length === 0) {
      throw new Error('No images found in database');
    }
    console.log(
      `[PASS] Images created via nested pattern: ${savedScan.images.length} images`
    );

    // Verify image frame numbers are 1-indexed (pilot compatible)
    const firstImage = savedScan.images.find((img) => img.frame_number === 1);
    if (!firstImage) {
      throw new Error(
        'First image with frame_number=1 not found (1-indexed expected)'
      );
    }
    console.log('[PASS] Images use 1-indexed frame numbers (pilot compatible)');

    // Verify all images have CAPTURED status
    const allCaptured = savedScan.images.every(
      (img) => img.status === 'CAPTURED'
    );
    if (!allCaptured) {
      throw new Error('Not all images have CAPTURED status');
    }
    console.log('[PASS] All images have CAPTURED status');

    // Test: Scan without metadata (should not save to database)
    console.log('\n[INFO] Testing scan without metadata...');
    const settingsWithoutMetadata = {
      camera: scannerSettings.camera,
      daq: scannerSettings.daq,
      num_frames: 10,
      output_path: './test-scans-no-meta',
    };

    await scannerProcess.initialize(settingsWithoutMetadata);
    const scanWithoutMetadata = await scannerProcess.scan();

    if (scanWithoutMetadata.scan_id) {
      throw new Error('Scan ID returned when no metadata provided');
    }
    console.log('[PASS] Scan without metadata does not save to database');

    // Cleanup
    console.log('\n[INFO] Cleaning up...');
    await scannerProcess.cleanup();
    console.log('[PASS] Scanner cleanup successful');

    console.log('\n=== All Tests Passed ===');
  } catch (error) {
    console.error('\n[FAIL] Test failed:', error);
    throw error;
  } finally {
    // Cleanup resources
    if (pythonProcess) {
      pythonProcess.stop();
    }
    if (prisma) {
      await prisma.$disconnect();
    }
    // Clean up test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  }
}

// Run test with timeout
const timeoutPromise = new Promise((_, reject) => {
  setTimeout(() => reject(new Error('Test timeout')), TEST_TIMEOUT);
});

Promise.race([runTest(), timeoutPromise])
  .then(() => {
    console.log('\nTest completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nTest failed:', error);
    process.exit(1);
  });
