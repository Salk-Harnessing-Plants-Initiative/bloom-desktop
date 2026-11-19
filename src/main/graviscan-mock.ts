/**
 * Mock scanner detection for GraviScan mock mode (`GRAVISCAN_MOCK=true`).
 *
 * Lets the app run without V600 hardware, for example on a Mac. The optional
 * control file `~/.bloom/graviscan-mock.json` decides which mock scanners
 * exist and which are plugged in:
 *
 *   { "scanners": [ { "port": "1-1", "present": true }, ... ] }
 *
 * It is re-read on every detection, so editing it while the app runs
 * simulates plugging a scanner in or out. Without the file, detection behaves
 * as mock mode always has (see `MockDetectionMode`). Test tooling only: never
 * called outside mock mode.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import type { DetectedScanner } from '../types/graviscan';

/** Location of the mock control file. */
export const MOCK_CONTROL_FILE = path.join(
  os.homedir(),
  '.bloom',
  'graviscan-mock.json'
);

/** Number of scanners `fixed-pair` mode reports when there is no file. */
const DEFAULT_MOCK_SCANNER_COUNT = 2;

/** Epson vendor/product ids reported for mock scanners with no DB row. */
const MOCK_VENDOR_ID = '04b8';
const MOCK_PRODUCT_ID = '013a';

/** One scanner entry in the control file. */
export interface MockScannerControl {
  port: string;
  present: boolean;
}

/** Parsed control file. */
export interface MockControl {
  scanners: MockScannerControl[];
}

/** The GraviScanner columns mock detection needs. */
export interface MockScannerRow {
  id: string;
  name: string;
  vendor_id: string;
  product_id: string;
  usb_port: string | null;
  usb_bus: number | null;
  usb_device: number | null;
}

/**
 * How detection behaves when there is no control file. The two modes keep
 * the two behaviours the handlers had before this module existed:
 * - `fixed-pair`: always 2 scanners on ports 1-1 and 1-2, paired with DB rows
 *   by position (scanner setup, startup validation).
 * - `saved`: every saved row is present on its saved port (reset, config
 *   validation, auto-init).
 * With a control file, both modes return exactly the present entries.
 */
export type MockDetectionMode = 'fixed-pair' | 'saved';

type FileReader = (filePath: string, encoding: 'utf8') => string;

/**
 * Read and validate the mock control file.
 *
 * @param filePath - Control file path; defaults to `MOCK_CONTROL_FILE`.
 * @param readFile - Injected for tests; defaults to `fs.readFileSync`.
 * @returns The parsed file, or `null` if it does not exist.
 * @throws Error naming the file if it cannot be read or is malformed.
 */
export function readMockControl(
  filePath: string = MOCK_CONTROL_FILE,
  readFile: FileReader = fs.readFileSync
): MockControl | null {
  let raw: string;
  try {
    raw = readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Invalid mock control file ${filePath}: ${reason}`);
  }

  return validateControl(parsed, filePath);
}

function validateControl(parsed: unknown, filePath: string): MockControl {
  const fail = (reason: string): never => {
    throw new Error(`Invalid mock control file ${filePath}: ${reason}`);
  };

  const scanners = (parsed as { scanners?: unknown } | null)?.scanners;
  if (!Array.isArray(scanners)) fail('"scanners" must be an array');

  const seen = new Set<string>();
  const result: MockScannerControl[] = [];
  (scanners as unknown[]).forEach((entry, i) => {
    const { port, present } = (entry ?? {}) as Record<string, unknown>;
    if (typeof port !== 'string' || port === '') {
      fail(`scanners[${i}].port must be a non-empty string`);
    }
    if (typeof present !== 'boolean') {
      fail(`scanners[${i}].present must be true or false`);
    }
    if (seen.has(port as string)) fail(`port ${port} is listed twice`);
    seen.add(port as string);
    result.push({ port: port as string, present: present as boolean });
  });

  return { scanners: result };
}

/**
 * Build the scanner list mock-mode detection returns.
 *
 * @param rows - Enabled GraviScanner rows from the database.
 * @param mode - Behaviour when `control` is null; see `MockDetectionMode`.
 * @param control - Parsed control file, or null if there is none.
 * @returns One DetectedScanner per present mock scanner.
 */
export function detectMockScanners(
  rows: MockScannerRow[],
  mode: MockDetectionMode,
  control: MockControl | null
): DetectedScanner[] {
  if (control) return fromControl(rows, control);
  return mode === 'fixed-pair' ? fixedPair(rows) : fromSavedRows(rows);
}

function fromControl(
  rows: MockScannerRow[],
  control: MockControl
): DetectedScanner[] {
  // Device numbers already held by saved rows. Saving a scanner looks up its
  // row by (usb_bus, usb_device) before usb_port, so a mock scanner must
  // never report a number that belongs to a different saved row.
  const takenDevices = new Set<number>();
  for (const r of rows) {
    if (r.usb_device != null) takenDevices.add(r.usb_device);
  }

  const detected: DetectedScanner[] = [];
  control.scanners.forEach((entry, i) => {
    if (!entry.present) return;
    const row = rows.find((r) => r.usb_port === entry.port);
    if (row && row.usb_bus != null && row.usb_device != null) {
      detected.push(
        mockScanner(row, i + 1, row.usb_bus, row.usb_device, entry.port)
      );
      return;
    }
    const device = freeDeviceNumber(entry.port, takenDevices);
    takenDevices.add(device);
    detected.push(mockScanner(row, i + 1, 1, device, entry.port));
  });
  return detected;
}

/**
 * Device number for a mock scanner with no saved address: the number after
 * the dash in a `<bus>-<n>` port (`1-3` → 3, as in `fixed-pair` mode), or 1
 * for any other port, moved up to the first number not already taken.
 */
function freeDeviceNumber(port: string, taken: Set<number>): number {
  const match = /^\d+-(\d+)$/.exec(port);
  let device = match ? Math.max(1, Number(match[1])) : 1;
  while (taken.has(device)) device++;
  return device;
}

function fixedPair(rows: MockScannerRow[]): DetectedScanner[] {
  const detected: DetectedScanner[] = [];
  for (let i = 0; i < DEFAULT_MOCK_SCANNER_COUNT; i++) {
    detected.push(mockScanner(rows[i], i + 1, 1, i + 1, `1-${i + 1}`));
  }
  return detected;
}

function fromSavedRows(rows: MockScannerRow[]): DetectedScanner[] {
  return rows.map((row, i) =>
    mockScanner(
      row,
      i + 1,
      row.usb_bus || 1,
      row.usb_device || i + 1,
      row.usb_port || `1-${i + 1}`
    )
  );
}

/**
 * @param row - Matching DB row, or undefined to invent a mock identity.
 * @param position - 1-based position, used for invented ids and names.
 */
function mockScanner(
  row: MockScannerRow | undefined,
  position: number,
  usbBus: number,
  usbDevice: number,
  usbPort: string
): DetectedScanner {
  return {
    name: row?.name ?? `Mock Scanner ${position}`,
    scanner_id: row?.id ?? `mock-scanner-${position}`,
    usb_bus: usbBus,
    usb_device: usbDevice,
    usb_port: usbPort,
    is_available: true,
    vendor_id: row?.vendor_id ?? MOCK_VENDOR_ID,
    product_id: row?.product_id ?? MOCK_PRODUCT_ID,
    sane_name: `epkowa:interpreter:001:${String(usbDevice).padStart(3, '0')}`,
  };
}
