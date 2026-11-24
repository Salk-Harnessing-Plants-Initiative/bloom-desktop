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

import { detectEpsonScannersAsync } from '../lsusb-detection';
import type { DetectedScanner } from '../../types/graviscan';

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
  usbPort: string | null | undefined,
  detected: DetectedScanner[]
): DetectedScanner | undefined {
  // An absent or empty port matches nothing. `buildUsbPort` yields '' for
  // every device when `lsusb -t` fails, so two unrelated scanners can both
  // carry '' — treating that as a match would bind an address to the wrong
  // physical device.
  if (!isUsableUsbPort(usbPort)) return undefined;

  // Linear scan, not a Map: first-in-list-order is the specified tie-break.
  return detected.find((d) => d.usb_port === usbPort);
}

/** A port is usable only if it is a non-empty string. */
function isUsableUsbPort(port: string | null | undefined): port is string {
  return typeof port === 'string' && port.length > 0;
}

/** Backoff between detection attempts. */
const DETECTION_ATTEMPTS = 3;
const DETECTION_BACKOFF_MS = [250, 750];

/**
 * Detection currently in flight, shared by concurrent callers.
 *
 * Several scanners retried in sequence each register their own
 * `cycle-complete` listener and are not serialized, so N resolvers can run
 * at one cycle boundary — up to 2N `lsusb` invocations on a bus that already
 * has a wedged device on it. Sharing collapses that burst into one pass.
 *
 * **In-flight deduplication, not a time-based cache.** `design.md`'s Risks
 * table describes this as "cached for a short TTL"; the intent is the same
 * but a TTL is the wrong mechanism *here* specifically. This module exists
 * because a cached USB address goes stale the instant a device
 * re-enumerates, so retaining a **completed** detection — even for a
 * second — reintroduces exactly the defect being fixed: a resolver could be
 * handed a result captured before the power-cycle it is recovering from.
 * Sharing only work that has not yet settled collapses the same burst with
 * no staleness window at all, and needs no reset hook in the production
 * module for tests to work around.
 */
let detectionInFlight: Promise<
  Awaited<ReturnType<DetectScannersAsync>>
> | null = null;

function detectShared(detect: DetectScannersAsync) {
  if (detectionInFlight) return detectionInFlight;

  const promise = detect();
  detectionInFlight = promise;
  // Cleared on settle, success or failure, so the next caller always starts
  // a genuinely fresh pass.
  const clear = () => {
    if (detectionInFlight === promise) detectionInFlight = null;
  };
  promise.then(clear, clear);
  return promise;
}

/**
 * Re-resolve and persist one scanner's `usb_bus`/`usb_device` from its
 * `usb_port`.
 *
 * Does its own `findUnique` so `row-missing` is reachable from this module's
 * own tests without a caller fabricating a row (`tasks.md` 2.3a).
 */
export async function refreshScannerUsbAddress(
  db: ScannerUsbRefreshDb,
  scannerId: string,
  opts: RefreshScannerUsbAddressOptions = {}
): Promise<ScannerUsbRefreshOutcome> {
  const detect = opts.detect ?? detectEpsonScannersAsync;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const row = await db.graviScanner.findUnique({ where: { id: scannerId } });
  // Distinct from `not-detected`: the scanner is not merely absent from the
  // bus, it is absent from the database. Reported before any detection is
  // attempted, so a deleted row costs no USB probe.
  if (!row) return { status: 'row-missing' };

  const previousUsbBus = row.usb_bus;
  const previousUsbDevice = row.usb_device;

  // Mock mode has no bus to re-resolve against: mock scanners are
  // deterministically addressed and never re-enumerate. Short-circuit to
  // the stored values rather than spawning a real `lsusb`.
  if (process.env.GRAVISCAN_MOCK?.toLowerCase() === 'true') {
    // Guarded at runtime with Number.isInteger rather than by the type:
    // this repo's tsconfig sets only `noImplicitAny`, so `null` stays
    // assignable to every member of the union and the type alone proves
    // nothing here.
    if (
      !Number.isInteger(previousUsbBus) ||
      !Number.isInteger(previousUsbDevice)
    ) {
      // Reported separately from `no-stable-port` because the port may be
      // perfectly good — `resetUsb` nulls these columns for 5s between
      // clearing and repopulating them. Saying "no stable port" there would
      // make the operator message a false statement about the row.
      return { status: 'unusable-address', usbPort: row.usb_port };
    }
    return {
      status: 'refreshed',
      changed: false,
      usbBus: previousUsbBus as number,
      usbDevice: previousUsbDevice as number,
      usbPort: row.usb_port,
      previousUsbBus,
      previousUsbDevice,
    };
  }

  // `usb_port` is the only stable identifier the V600 offers, so without one
  // there is nothing to re-resolve against and no safe fallback: after a
  // power-cycle the stored address is always wrong.
  if (!isUsableUsbPort(row.usb_port)) return { status: 'no-stable-port' };

  let lastError = 'USB detection failed';
  for (let attempt = 1; attempt <= DETECTION_ATTEMPTS; attempt++) {
    let result: Awaited<ReturnType<DetectScannersAsync>>;
    try {
      result = await detectShared(detect);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < DETECTION_ATTEMPTS) {
        await sleep(DETECTION_BACKOFF_MS[attempt - 1]);
      }
      continue;
    }

    if (!result.success) {
      // Only the *diagnostic* is retried. `execFile` with a 5s timeout can
      // fail transiently under exactly the bus contention a wedge creates,
      // and refusing on one failure would cost a run's remaining timepoints
      // for a reason unrelated to the scanner.
      lastError = result.error ?? 'USB detection failed';
      if (attempt < DETECTION_ATTEMPTS) {
        await sleep(DETECTION_BACKOFF_MS[attempt - 1]);
      }
      continue;
    }

    const match = matchDetectedByPort(row.usb_port, result.scanners);
    if (!match) {
      // A *successful* detection that found nothing is a conclusion, not a
      // flake — retrying it would spend ~15s confirming an absent scanner is
      // still absent.
      return { status: 'not-detected', usbPort: row.usb_port };
    }

    if (
      !Number.isInteger(match.usb_bus) ||
      !Number.isInteger(match.usb_device)
    ) {
      return { status: 'unusable-address', usbPort: row.usb_port };
    }

    const changed =
      match.usb_bus !== previousUsbBus || match.usb_device !== previousUsbDevice;

    if (changed) {
      // Exactly these two columns. `usb_port` is never written here — this
      // module re-resolves a volatile address for a row whose identity is
      // already established, and rewriting the identity key from a
      // detection result is what `fix-graviscan-scanner-identity-precedence`
      // exists to control.
      await db.graviScanner.update({
        where: { id: scannerId },
        data: { usb_bus: match.usb_bus, usb_device: match.usb_device },
      });
    }

    return {
      status: 'refreshed',
      changed,
      usbBus: match.usb_bus,
      usbDevice: match.usb_device,
      usbPort: row.usb_port,
      previousUsbBus,
      previousUsbDevice,
    };
  }

  return {
    status: 'detection-failed',
    attempts: DETECTION_ATTEMPTS,
    error: lastError,
  };
}
