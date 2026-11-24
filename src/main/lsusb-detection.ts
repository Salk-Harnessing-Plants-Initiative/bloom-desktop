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
  portPath: string; // Hierarchical port path: "3" for direct, "2.3" for port 3 of hub on port 2
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
 * Parse `lsusb -t` output to map Bus:Device → port path for stable identification.
 *
 * Builds hierarchical port paths to disambiguate hub-attached devices.
 * Indent level (4 spaces per depth) determines hub topology.
 *
 * Example output:
 *   /:  Bus 001.Port 001: Dev 001, ...
 *       |__ Port 002: Dev 002, ... Driver=hub        → portPath "2"
 *           |__ Port 003: Dev 016, ...               → portPath "2.3" (behind hub)
 *       |__ Port 003: Dev 012, ...                   → portPath "3"
 *       |__ Port 010: Dev 015, ...                   → portPath "10"
 */
function parseLsusbTree(output: string): LsusbTreeEntry[] {
  const entries: LsusbTreeEntry[] = [];
  let currentBus = 0;
  // Stack of port numbers at each depth, indexed by depth (1, 2, ...)
  const portStack: number[] = [];

  for (const line of output.split('\n')) {
    // Match bus root: "/:  Bus 001.Port 001: Dev 001, ..."
    const busMatch = line.match(/Bus (\d+)\.Port \d+: Dev \d+/);
    if (busMatch) {
      currentBus = parseInt(busMatch[1], 10);
      portStack.length = 0;
      continue;
    }

    // Match port entries: "    |__ Port 001: Dev 007, ..."
    // Indent depth = number of 4-space groups before "|__"
    const portMatch = line.match(/^( +)\|__ Port (\d+): Dev (\d+)/);
    if (portMatch && currentBus > 0) {
      const depth = Math.max(1, Math.floor(portMatch[1].length / 4));
      const port = parseInt(portMatch[2], 10);
      const device = parseInt(portMatch[3], 10);

      // Set this depth's port and trim deeper levels
      portStack[depth - 1] = port;
      portStack.length = depth;

      const portPath = portStack.join('.');
      entries.push({ bus: currentBus, portPath, device });
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
 * Build a stable USB port string from bus and hierarchical port path.
 * Format: "1-7" (bus 1, port 7), "1-2.3" (bus 1, port 3 of hub on port 2)
 */
function buildUsbPort(bus: number, portPath: string): string {
  return `${bus}-${portPath}`;
}

export interface DetectEpsonScannersResult {
  success: boolean;
  scanners: DetectedScanner[];
  count: number;
  error?: string;
}

/**
 * Turn raw `lsusb` and `lsusb -t` output into deduplicated scanners.
 *
 * **Pure.** Shared verbatim by the synchronous and asynchronous shells below,
 * which differ only in how they obtain the two strings. Task-level "same
 * parsing, same shape" is not a guarantee, and this is where the unfixed
 * device-number-wrap hazard lives (see the dedupe comment), so the two shells
 * must not be allowed to drift.
 *
 * `treeOutput` is `null` when `lsusb -t` failed; port mapping is then
 * unavailable and every `usb_port` comes back `''`.
 */
function buildDetectionResult(
  lsusbOutput: string,
  treeOutput: string | null
): DetectEpsonScannersResult {
  const epsonDevices = parseLsusb(lsusbOutput);

  if (epsonDevices.length === 0) {
    return { success: true, scanners: [], count: 0 };
  }

  const treeEntries: LsusbTreeEntry[] =
    treeOutput === null ? [] : parseLsusbTree(treeOutput);

  // Build device→portPath lookup
  const portMap = new Map<string, string>();
  for (const entry of treeEntries) {
    portMap.set(`${entry.bus}:${entry.device}`, entry.portPath);
  }

  // Build DetectedScanner array
  const scanners: DetectedScanner[] = epsonDevices.map((dev) => {
    const portPath = portMap.get(`${dev.bus}:${dev.device}`);
    return {
      name: buildDisplayName(dev.productId),
      scanner_id: '', // Will be matched against DB by caller
      usb_bus: dev.bus,
      usb_device: dev.device,
      usb_port: portPath !== undefined ? buildUsbPort(dev.bus, portPath) : '',
      is_available: true,
      vendor_id: dev.vendorId,
      product_id: dev.productId,
      sane_name: buildSaneName(dev.bus, dev.device),
    };
  });

  // Deduplicate by usb_port — USB re-enumeration can create ghost entries
  // where a scanner appears under both old and new device numbers on the same port.
  // Keep the entry with the highest usb_device number (most recent enumeration).
  //
  // Named assumption, not a proven invariant: device numbers are reused and
  // wrap at 127, so after a wrap a ghost could carry the higher number and
  // win. `scanner-usb-refresh` would then persist a dead address. Unfixed
  // here deliberately — it predates this change and is pinned by tests
  // rather than corrected.
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
}

/** Map a thrown lsusb error onto the shared failure shape. */
function detectionFailure(error: unknown): DetectEpsonScannersResult {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('ENOENT') || message.includes('not found')) {
    return {
      success: false,
      scanners: [],
      count: 0,
      error: 'lsusb not available',
    };
  }

  return {
    success: false,
    scanners: [],
    count: 0,
    error: `lsusb detection failed: ${message}`,
  };
}

/**
 * Detect Epson scanners using lsusb.
 *
 * **Blocking.** This runs `execFileSync` twice with a 5s timeout each, so it
 * can hold the calling thread for up to ~10s. In the Electron main process
 * that stalls the whole event loop — no IPC handler runs and no subprocess
 * output is parsed for the duration. That is acceptable on the Configure
 * Scanner paths, which are operator-initiated and have no session running,
 * and it is why `detectEpsonScannersAsync()` exists for anything reachable
 * during an active scan.
 *
 * @returns Array of detected scanners with USB identifiers and computed SANE names.
 */
export function detectEpsonScanners(): DetectEpsonScannersResult {
  try {
    // Run lsusb to find Epson devices
    const lsusbOutput = execFileSync('lsusb', [], {
      encoding: 'utf-8',
      timeout: 5000,
    });

    // Run lsusb -t to get stable port mappings
    let treeOutput: string | null = null;
    try {
      treeOutput = execFileSync('lsusb', ['-t'], {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch {
      console.warn('[lsusb] lsusb -t failed, port mapping unavailable');
    }

    return buildDetectionResult(lsusbOutput, treeOutput);
  } catch (error) {
    return detectionFailure(error);
  }
}

/**
 * Non-blocking `detectEpsonScanners()`.
 *
 * Required for anything reachable during an active scan session
 * (`design.md` Decision 4). The synchronous variant blocks the main-process
 * event loop for up to ~10s, which is not merely latency: `scanInterval`'s
 * sleep is delayed with no drift compensation — a real interval error in a
 * gravitropism time series — and because libuv runs the timers phase before
 * the poll phase, a row whose `cycle-done` arrived on the pipe *during* the
 * stall but whose `SCAN_ROW_TIMEOUT_MS` also expired during it can settle as
 * `'timeout'`. That is the entry condition for #371's permanent false
 * `MISSING` on an unrelated, healthy scanner.
 *
 * Shares `buildDetectionResult` with the synchronous shell, so the two
 * cannot drift.
 */
export async function detectEpsonScannersAsync(): Promise<DetectEpsonScannersResult> {
  // Imported lazily rather than at module scope so that a test's
  // complete-replacement `vi.mock('child_process', …)` factory cannot break
  // this module at *import* time — that would kill every test in a file
  // rather than failing one assertion.
  const { execFile } = await import('child_process');

  // Wrapped by hand rather than with `util.promisify`. Node's real
  // `execFile` carries a `util.promisify.custom` implementation that
  // resolves to `{ stdout, stderr }`, while a plain mock does not and
  // therefore resolves to the bare first callback value. Depending on that
  // difference would make the async shell behave one way in production and
  // another under test — the exact "the mock is more forgiving than
  // production" class of defect this change exists to avoid. The callback
  // contract is identical in both, so that is what we depend on.
  const run = (args: string[]): Promise<string> =>
    new Promise((resolve, reject) => {
      execFile(
        'lsusb',
        args,
        { encoding: 'utf-8', timeout: 5000 },
        (error, stdout) => {
          if (error) reject(error);
          else resolve(String(stdout));
        }
      );
    });

  try {
    const lsusbOutput = await run([]);

    let treeOutput: string | null = null;
    try {
      treeOutput = await run(['-t']);
    } catch {
      console.warn('[lsusb] lsusb -t failed, port mapping unavailable');
    }

    return buildDetectionResult(lsusbOutput, treeOutput);
  } catch (error) {
    return detectionFailure(error);
  }
}

// `buildSaneName` is exported as the single definition of the SANE device
// name format. It was duplicated with an identical body in
// `graviscan/scanner-handlers.ts`, whose own doc comment claimed "the format
// lives in exactly one place" — it did not. This change moves name
// construction from one caller into several, which makes the duplication
// load-bearing, so it is collapsed here rather than left to drift.
//
// It lives in THIS module, not `scanner-handlers.ts`, because this module
// uses it internally (`sane_name: buildSaneName(...)` above) while
// `scanner-handlers.ts` already imports from here — keeping the definition
// there would force an import back the other way and create a genuine
// runtime circular import.
export { parseLsusb, parseLsusbTree, buildSaneName, buildDisplayName };
