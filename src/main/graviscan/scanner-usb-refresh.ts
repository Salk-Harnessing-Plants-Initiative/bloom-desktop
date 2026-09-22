/**
 * Re-resolve one scanner's volatile USB address from its stable `usb_port`.
 *
 * A physical power-cycle is the only way to clear a V600 wedge (#228) and it
 * always re-enumerates the device at a new USB device number. The
 * `usb_bus`/`usb_device` columns are therefore a cache of a volatile kernel
 * value, and **no consumer may build a SANE device name from the stored value
 * without a live re-resolution** — see `design.md` for the three paths that
 * used to do exactly that (issue #182).
 *
 * `usb_port` is the only stable physical identifier available, because the
 * V600 exposes no usable `iSerial` (#182's 2026-05-06 comment, tested on all
 * five rig scanners).
 *
 * This module owns no coordinator dependency, never writes `usb_port`, and
 * never constructs a SANE name — it returns an address, and the caller
 * formats it.
 */

import type { DetectedScanner } from '../types/graviscan';

/**
 * The subset of Prisma's `GraviScanner` delegate this module needs.
 *
 * Read **and** write: refresh persists a corrected address. This is in
 * tension with `session-handlers.ts`'s deliberate near-zero DB dependency,
 * which is why the interface is declared here and `ScannerRetryLookupDb`
 * extends it rather than the reverse (`design.md` Decision 1).
 */
export interface ScannerUsbRefreshDb {
  graviScanner: {
    findUnique(args: {
      where: { id: string };
    }): Promise<ScannerUsbRefreshRow | null>;
    update(args: {
      where: { id: string };
      data: { usb_bus: number; usb_device: number };
    }): Promise<unknown>;
  };
}

/**
 * The row fields refresh reads. Carries the union of what refresh and the
 * retry path need, because TypeScript will not let a derived interface
 * narrow this shape (`design.md` Decision 1).
 */
export interface ScannerUsbRefreshRow {
  id: string;
  usb_bus: number | null;
  usb_device: number | null;
  usb_port: string | null;
  display_name?: string | null;
  name?: string | null;
  enabled?: boolean;
}

/** Shape of the async detection call refresh depends on. */
export type DetectScannersAsync = () => Promise<{
  success: boolean;
  scanners: DetectedScanner[];
  count: number;
  error?: string;
}>;

/**
 * Outcome of a refresh attempt.
 *
 * The discriminant is a **string** deliberately: this repo's `tsconfig` sets
 * only `noImplicitAny`, and a boolean-literal discriminant does not narrow
 * under it (which is why `WedgeBanner.tsx` needs a manual cast). A string one
 * does.
 */
export type ScannerUsbRefreshOutcome =
  | {
      status: 'refreshed';
      /** True when the address moved and was persisted. */
      changed: boolean;
      usbBus: number;
      usbDevice: number;
      usbPort: string | null;
      /** The address held before this refresh, for the audit log line. */
      previousUsbBus: number | null;
      previousUsbDevice: number | null;
    }
  | { status: 'not-detected'; usbPort: string }
  | { status: 'no-stable-port' }
  | { status: 'unusable-address'; usbPort: string | null }
  | { status: 'row-missing' }
  | { status: 'detection-failed'; attempts: number; error: string };

export interface RefreshScannerUsbAddressOptions {
  /** Injected for tests; defaults to the real async lsusb detection. */
  detect?: DetectScannersAsync;
  /** Injected for tests so backoff does not really sleep. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Find the detected scanner currently occupying `usbPort`.
 *
 * Pure. Tie-break on a duplicate port is **first in list order**, specified
 * and tested rather than left to a `Map`'s iteration order: real detection
 * dedupes by port, but `resetUsb`'s mock branch can synthesise a collision,
 * and `Map.set` keeps the *last* entry where a linear scan finds the *first*
 * (`design.md` Decision 2).
 */
export function matchDetectedByPort(
  _usbPort: string | null | undefined,
  _detected: DetectedScanner[]
): DetectedScanner | undefined {
  throw new Error('not implemented');
}

/**
 * Re-resolve and persist one scanner's `usb_bus`/`usb_device` from its
 * `usb_port`.
 *
 * Does its own `findUnique` so `row-missing` is reachable from this module's
 * own tests without a caller fabricating a row (`tasks.md` 2.3a).
 */
export async function refreshScannerUsbAddress(
  _db: ScannerUsbRefreshDb,
  _scannerId: string,
  _opts?: RefreshScannerUsbAddressOptions
): Promise<ScannerUsbRefreshOutcome> {
  throw new Error('not implemented');
}
