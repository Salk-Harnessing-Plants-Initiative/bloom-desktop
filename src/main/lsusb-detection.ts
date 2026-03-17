/**
 * lsusb-based scanner detection.
 *
 * Detects Epson scanners using `lsusb` system commands instead of SANE.
 * This avoids SANE's process-wide global state issues and device lock contamination.
 *
 * Two commands are used:
 * - `lsusb` — lists USB devices with bus/device/vendor/product
 * - `lsusb -t` — tree view with stable port numbers
 */

import { execFileSync } from 'child_process';
import type { DetectedScanner } from '../types/graviscan';

/** Epson vendor ID */
const EPSON_VENDOR_ID = '04b8';

/** Known Epson scanner product IDs → model names */
const EPSON_MODELS: Record<string, string> = {
  '013a': 'Perfection V600 Photo',
  '0144': 'Perfection V850 Pro',
};

interface LsusbDevice {
  bus: number;
  device: number;
  vendorId: string;
  productId: string;
}

interface LsusbTreeEntry {
  bus: number;
  port: number;
  device: number;
}

/**
 * Parse `lsusb` output for Epson scanners.
 *
 * Example line: Bus 001 Device 007: ID 04b8:013a EPSON EPSON Scanner
 */
function parseLsusb(output: string): LsusbDevice[] {
  const devices: LsusbDevice[] = [];
  const regex = /Bus (\d+) Device (\d+): ID ([0-9a-f]{4}):([0-9a-f]{4})/gi;

  let match;
  while ((match = regex.exec(output)) !== null) {
    const vendorId = match[3].toLowerCase();
    const productId = match[4].toLowerCase();
    // Filter by vendor AND known scanner product IDs — ignore Epson printers etc.
    if (vendorId === EPSON_VENDOR_ID && productId in EPSON_MODELS) {
      devices.push({
        bus: parseInt(match[1], 10),
        device: parseInt(match[2], 10),
        vendorId,
        productId,
      });
    }
  }

  return devices;
}

/**
 * Parse `lsusb -t` output to map Bus:Device → Port for stable identification.
 *
 * Example output:
 *   /:  Bus 001.Port 001: Dev 001, ...
 *       |__ Port 001: Dev 007, ...
 *       |__ Port 009: Dev 013, ...
 */
function parseLsusbTree(output: string): LsusbTreeEntry[] {
  const entries: LsusbTreeEntry[] = [];
  let currentBus = 0;

  for (const line of output.split('\n')) {
    // Match bus root: "/:  Bus 001.Port 001: Dev 001, ..."
    const busMatch = line.match(/Bus (\d+)\.Port \d+: Dev \d+/);
    if (busMatch) {
      currentBus = parseInt(busMatch[1], 10);
      continue;
    }

    // Match port entries: "|__ Port 001: Dev 007, ..."
    const portMatch = line.match(/Port (\d+): Dev (\d+)/);
    if (portMatch && currentBus > 0) {
      entries.push({
        bus: currentBus,
        port: parseInt(portMatch[1], 10),
        device: parseInt(portMatch[2], 10),
      });
    }
  }

  return entries;
}

/**
 * Build the SANE device name from bus and device numbers.
 * Format: epkowa:interpreter:001:007
 */
function buildSaneName(bus: number, device: number): string {
  return `epkowa:interpreter:${String(bus).padStart(3, '0')}:${String(device).padStart(3, '0')}`;
}

/**
 * Build a display name from the product ID.
 */
function buildDisplayName(productId: string): string {
  return EPSON_MODELS[productId] || `Epson Scanner (${productId})`;
}

/**
 * Build a stable USB port string from bus and port numbers.
 * Format: "1-7" (bus 1, port 7)
 */
function buildUsbPort(bus: number, port: number): string {
  return `${bus}-${port}`;
}

/**
 * Detect Epson scanners using lsusb.
 *
 * @returns Array of detected scanners with USB identifiers and computed SANE names.
 */
export function detectEpsonScanners(): {
  success: boolean;
  scanners: DetectedScanner[];
  count: number;
  error?: string;
} {
  try {
    // Run lsusb to find Epson devices
    const lsusbOutput = execFileSync('lsusb', [], { encoding: 'utf-8', timeout: 5000 });
    const epsonDevices = parseLsusb(lsusbOutput);

    if (epsonDevices.length === 0) {
      return { success: true, scanners: [], count: 0 };
    }

    // Run lsusb -t to get stable port mappings
    let treeEntries: LsusbTreeEntry[] = [];
    try {
      const treeOutput = execFileSync('lsusb', ['-t'], { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] });
      treeEntries = parseLsusbTree(treeOutput);
    } catch {
      console.warn('[lsusb] lsusb -t failed, port mapping unavailable');
    }

    // Build device→port lookup
    const portMap = new Map<string, number>();
    for (const entry of treeEntries) {
      portMap.set(`${entry.bus}:${entry.device}`, entry.port);
    }

    // Build DetectedScanner array
    const scanners: DetectedScanner[] = epsonDevices.map((dev) => {
      const port = portMap.get(`${dev.bus}:${dev.device}`);
      return {
        name: buildDisplayName(dev.productId),
        scanner_id: '', // Will be matched against DB by caller
        usb_bus: dev.bus,
        usb_device: dev.device,
        usb_port: port !== undefined ? buildUsbPort(dev.bus, port) : '',
        is_available: true,
        vendor_id: dev.vendorId,
        product_id: dev.productId,
        sane_name: buildSaneName(dev.bus, dev.device),
      };
    });

    // Deduplicate by usb_port — USB re-enumeration can create ghost entries
    // where a scanner appears under both old and new device numbers on the same port.
    // Keep the entry with the highest usb_device number (most recent enumeration).
    const deduped: DetectedScanner[] = [];
    const byPort = new Map<string, DetectedScanner>();
    for (const s of scanners) {
      if (!s.usb_port) {
        // No port info — can't deduplicate, include as-is
        deduped.push(s);
        continue;
      }
      const existing = byPort.get(s.usb_port);
      if (!existing || s.usb_device > existing.usb_device) {
        byPort.set(s.usb_port, s);
      }
    }
    deduped.push(...byPort.values());

    return { success: true, scanners: deduped, count: deduped.length };
  } catch (error) {
    // lsusb command not available or failed
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('ENOENT') || message.includes('not found')) {
      return { success: false, scanners: [], count: 0, error: 'lsusb not available' };
    }

    return {
      success: false,
      scanners: [],
      count: 0,
      error: `lsusb detection failed: ${message}`,
    };
  }
}

// Exported for testing
export { parseLsusb, parseLsusbTree, buildSaneName, buildDisplayName };
