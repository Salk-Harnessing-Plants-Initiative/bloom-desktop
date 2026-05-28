/**
 * WedgeDetector — recognizes the V600 USB wedge from scan-error events
 * emitted by the scanner subprocess pipeline.
 *
 * Pure logic. No I/O, no network, no DB. Deterministic — feeding the
 * same event stream twice produces identical output. Designed to be
 * wired into `ScanCoordinator` events by `main.ts` and to feed
 * `SlackNotifier` (Task 6).
 *
 * Configuration:
 *   The wedge-detector itself has no configuration. The notifier it
 *   feeds reads `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL` — see the
 *   "Environment variables" section of the repo README and
 *   `.env.example` for deployment.
 *
 * See:
 *   - investigation summary 2026-05-18 Section 1.2 (wedge mechanism)
 *   - issue #228 (root cause + libusb endpoint-recovery)
 *   - issue #236 (Slack notification + signatures)
 */

export type WedgeSignature =
  | 'sane_start_invalid'
  | 'device_io_120s_zero_bytes'
  | 'consecutive_failures';

/**
 * Subset of the scan-error event payload the detector needs. Matches
 * the fields emitted by `python/graviscan/scan_worker.py:_scan_plate`
 * after Task 0 (added `bytes_received` and `wall_seconds`).
 */
export interface ScanErrorInput {
  scanner_id: string;
  plate_index: string;
  job_id: string;
  error: string;
  bytes_received: number;
  wall_seconds: number;
}

export interface ScanEndInput {
  scanner_id: string;
  plate_index: string;
  /** true if the scan ultimately completed; false if it failed and was
   *  not recovered before scan-end. */
  success: boolean;
}

export interface WedgeDetectedEvent {
  scanner_id: string;
  signature: WedgeSignature;
  /** Session ID injected by the detector's constructor (the
   *  coordinator's per-run session). */
  session_id: string;
  /** Cycle in which the signature fired (last seen `onCycleStart`). */
  cycle_number: number;
  /** ISO 8601 with timezone offset. */
  timestamp: string;
  /** Original error message that triggered the match (for diagnosis). */
  error_message: string;
  /** Optional operator-friendly identity, populated by the main-process
   *  wiring before forwarding to the SlackNotifier. The detector
   *  itself does not know these — it only knows scanner_id. Per
   *  Copilot PR #237 review: Slack messages must include display name
   *  and USB path so operators can locate the physical scanner
   *  without cross-referencing logs. */
  display_name?: string;
  usb_port?: string;
}

export interface WedgeDetectorOptions {
  /** Session ID (e.g., from the active `GraviSession` row). Used as
   *  part of the SlackNotifier's rate-limit key. */
  sessionId: string;
  /** Callback fired exactly once per wedge detection. */
  onWedge: (evt: WedgeDetectedEvent) => void;
  /** Override the current-time provider — useful for deterministic
   *  test replays. */
  now?: () => Date;
}

/**
 * Per-scanner-per-cycle bookkeeping state. Tracked in a Map keyed by
 * scanner_id; reset on every NEW `cycle-start` (duplicate
 * `cycle-start` events with the same cycle number are idempotent).
 */
interface PerScannerState {
  /** Pending scan-error events that haven't yet been resolved by a
   *  subsequent scan-end (success/failure). */
  pendingErrors: PendingError[];
  /** Count of scan-end events for this scanner this cycle where
   *  success === false. Drives the consecutive_failures signature. */
  confirmedFailures: number;
  /** Signatures already emitted for this scanner this cycle. Prevents
   *  duplicate notifications. */
  emittedSignatures: Set<WedgeSignature>;
}

interface PendingError {
  plate_index: string;
  error: string;
  bytes_received: number;
  wall_seconds: number;
}

function newPerScannerState(): PerScannerState {
  return {
    pendingErrors: [],
    confirmedFailures: 0,
    emittedSignatures: new Set(),
  };
}

/**
 * Match a scan-error payload against the three V600 wedge signatures.
 * Returns the matched signature names (excluding consecutive_failures,
 * which is computed across multiple events).
 */
function matchInstantaneousSignatures(err: PendingError): WedgeSignature[] {
  const hits: WedgeSignature[] = [];
  if (err.error.includes('sane_start: Invalid argument')) {
    hits.push('sane_start_invalid');
  }
  if (
    err.error.includes('Error during device I/O') &&
    err.bytes_received === 0 &&
    err.wall_seconds >= 120
  ) {
    hits.push('device_io_120s_zero_bytes');
  }
  return hits;
}

export class WedgeDetector {
  private readonly sessionId: string;
  private readonly onWedge: (evt: WedgeDetectedEvent) => void;
  private readonly now: () => Date;

  private cycleNumber = 0;
  private perScanner = new Map<string, PerScannerState>();
  private warnedAboutMissingFields = false;

  constructor(opts: WedgeDetectorOptions) {
    this.sessionId = opts.sessionId;
    this.onWedge = opts.onWedge;
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * Begin a new cycle. Resets per-scanner counters but only if the
   * cycle number is new (idempotent on duplicate cycle-start events).
   */
  onCycleStart(cycleNumber: number): void {
    if (cycleNumber === this.cycleNumber) return; // idempotent
    this.cycleNumber = cycleNumber;
    this.perScanner.clear();
  }

  /**
   * Record a scan-error event. The detector buffers it as "pending"
   * until the matching `onScanEnd` arrives — if the scan recovers
   * (success=true), the pending error is discarded; if it doesn't
   * recover, signatures are evaluated.
   *
   * Defensive: if the payload is missing `bytes_received` or
   * `wall_seconds` (older Python worker that predates Task 0), the
   * device_io_120s_zero_bytes signature can never match — log a one-
   * time-per-detector warning so the configuration drift is visible.
   * The detector still tracks the scanner for sane_start_invalid and
   * consecutive_failures.
   */
  onScanError(err: ScanErrorInput): void {
    if (
      typeof err.bytes_received !== 'number' ||
      typeof err.wall_seconds !== 'number'
    ) {
      if (!this.warnedAboutMissingFields) {
        this.warnedAboutMissingFields = true;
        console.warn(
          `[WedgeDetector] scan-error event missing bytes_received or wall_seconds — `
            + `device_io_120s_zero_bytes signature will not fire. Is the Python worker on a `
            + `pre-Task-0 version?`,
        );
      }
    }
    const state = this.getOrCreateState(err.scanner_id);
    state.pendingErrors.push({
      plate_index: err.plate_index,
      error: err.error,
      bytes_received: typeof err.bytes_received === 'number' ? err.bytes_received : -1,
      wall_seconds: typeof err.wall_seconds === 'number' ? err.wall_seconds : -1,
    });
  }

  /**
   * Record a scan-end (success or failure) for a `(scanner_id,
   * plate_index)` pair. Resolves any pending scan-error for the same
   * pair: if the scan succeeded, the pending error is discarded
   * (recovered scan); if it failed, the pending error is "confirmed"
   * and signatures are evaluated.
   */
  onScanEnd(evt: ScanEndInput): void {
    const state = this.perScanner.get(evt.scanner_id);
    if (!state) return; // no pending errors for this scanner

    // Find and remove any pending error for this (scanner, plate)
    const idx = state.pendingErrors.findIndex(
      (e) => e.plate_index === evt.plate_index,
    );
    if (idx === -1) return;
    const pending = state.pendingErrors.splice(idx, 1)[0];

    if (evt.success) {
      // Recovered scan — do not page.
      return;
    }

    state.confirmedFailures += 1;

    // Evaluate instantaneous signatures (sane_start_invalid,
    // device_io_120s_zero_bytes). Each fires at most once per scanner
    // per cycle.
    for (const sig of matchInstantaneousSignatures(pending)) {
      if (state.emittedSignatures.has(sig)) continue;
      state.emittedSignatures.add(sig);
      this.emit(evt.scanner_id, sig, pending.error);
    }

    // Evaluate consecutive_failures (>= 2 confirmed failures in cycle)
    if (
      state.confirmedFailures >= 2 &&
      !state.emittedSignatures.has('consecutive_failures')
    ) {
      state.emittedSignatures.add('consecutive_failures');
      this.emit(evt.scanner_id, 'consecutive_failures', pending.error);
    }
  }

  private getOrCreateState(scannerId: string): PerScannerState {
    let s = this.perScanner.get(scannerId);
    if (!s) {
      s = newPerScannerState();
      this.perScanner.set(scannerId, s);
    }
    return s;
  }

  private emit(
    scannerId: string,
    signature: WedgeSignature,
    errorMessage: string,
  ): void {
    this.onWedge({
      scanner_id: scannerId,
      signature,
      session_id: this.sessionId,
      cycle_number: this.cycleNumber,
      timestamp: this.now().toISOString(),
      error_message: errorMessage,
    });
  }
}
