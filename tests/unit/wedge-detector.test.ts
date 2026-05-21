// @vitest-environment node
/**
 * Task 5 (#236): WedgeDetector — consumes scan-error / scan-complete /
 * cycle-start events from the coordinator and emits `wedge-detected`
 * events when one of three signatures fires:
 *
 *  1. sane_start_invalid          — stderr contains "sane_start: Invalid argument"
 *  2. device_io_120s_zero_bytes   — stderr contains "Error during device I/O"
 *                                   AND bytes_received === 0
 *                                   AND wall_seconds >= 120
 *  3. consecutive_failures        — 2+ scan-error events from the same
 *                                   scanner within one cycle
 *
 * Per design.md Decision 1: pure logic, no I/O, deterministic. The
 * detector defers emission until scan-outcome is determined — a
 * scan-error followed by scan-complete for the same plate is "recovered"
 * and does NOT page the operator.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WedgeDetector } from '../../src/main/wedge-detector';
import type {
  ScanErrorInput,
  WedgeSignature,
} from '../../src/main/wedge-detector';

function makeScanError(
  overrides: Partial<ScanErrorInput> = {},
): ScanErrorInput {
  return {
    scanner_id: 'sc-a',
    plate_index: '00',
    job_id: 'job-1',
    error: 'unknown failure',
    bytes_received: 0,
    wall_seconds: 5,
    ...overrides,
  };
}

describe('WedgeDetector', () => {
  let emitted: Array<{ scanner_id: string; signature: WedgeSignature }>;
  let detector: WedgeDetector;

  beforeEach(() => {
    emitted = [];
    detector = new WedgeDetector({
      sessionId: 'sess-1',
      onWedge: (evt) =>
        emitted.push({
          scanner_id: evt.scanner_id,
          signature: evt.signature,
        }),
    });
    detector.onCycleStart(1);
  });

  describe('sane_start_invalid signature', () => {
    it('emits exactly one wedge on match', () => {
      detector.onScanError(
        makeScanError({ error: 'epkowa: sane_start: Invalid argument' }),
      );
      detector.onScanEnd({ scanner_id: 'sc-a', plate_index: '00', success: false });
      expect(emitted).toEqual([
        { scanner_id: 'sc-a', signature: 'sane_start_invalid' },
      ]);
    });

    it('does NOT emit if the scan recovers (scan-complete follows scan-error)', () => {
      detector.onScanError(
        makeScanError({ error: 'sane_start: Invalid argument' }),
      );
      detector.onScanEnd({ scanner_id: 'sc-a', plate_index: '00', success: true });
      expect(emitted).toEqual([]);
    });

    it('deduplicates: two sane_start errors from the same scanner in one cycle emit ONE wedge', () => {
      detector.onScanError(
        makeScanError({ plate_index: '00', error: 'sane_start: Invalid argument' }),
      );
      detector.onScanEnd({ scanner_id: 'sc-a', plate_index: '00', success: false });
      detector.onScanError(
        makeScanError({ plate_index: '01', error: 'sane_start: Invalid argument' }),
      );
      detector.onScanEnd({ scanner_id: 'sc-a', plate_index: '01', success: false });
      const saneStartCount = emitted.filter(
        (e) => e.signature === 'sane_start_invalid',
      ).length;
      expect(saneStartCount).toBe(1);
    });
  });

  describe('device_io_120s_zero_bytes signature', () => {
    it('emits on full triple match', () => {
      detector.onScanError(
        makeScanError({
          error: 'Error during device I/O',
          bytes_received: 0,
          wall_seconds: 121,
        }),
      );
      detector.onScanEnd({ scanner_id: 'sc-a', plate_index: '00', success: false });
      expect(emitted).toEqual([
        { scanner_id: 'sc-a', signature: 'device_io_120s_zero_bytes' },
      ]);
    });

    it('does NOT emit when bytes_received > 0 (only one sub-condition fails)', () => {
      detector.onScanError(
        makeScanError({
          error: 'Error during device I/O',
          bytes_received: 100,
          wall_seconds: 121,
        }),
      );
      detector.onScanEnd({ scanner_id: 'sc-a', plate_index: '00', success: false });
      const ioCount = emitted.filter(
        (e) => e.signature === 'device_io_120s_zero_bytes',
      ).length;
      expect(ioCount).toBe(0);
    });

    it('does NOT emit when wall_seconds < 120', () => {
      detector.onScanError(
        makeScanError({
          error: 'Error during device I/O',
          bytes_received: 0,
          wall_seconds: 90,
        }),
      );
      detector.onScanEnd({ scanner_id: 'sc-a', plate_index: '00', success: false });
      const ioCount = emitted.filter(
        (e) => e.signature === 'device_io_120s_zero_bytes',
      ).length;
      expect(ioCount).toBe(0);
    });

    it('does NOT emit when the error message does not match', () => {
      detector.onScanError(
        makeScanError({
          error: 'some other error',
          bytes_received: 0,
          wall_seconds: 150,
        }),
      );
      detector.onScanEnd({ scanner_id: 'sc-a', plate_index: '00', success: false });
      const ioCount = emitted.filter(
        (e) => e.signature === 'device_io_120s_zero_bytes',
      ).length;
      expect(ioCount).toBe(0);
    });
  });

  describe('consecutive_failures signature', () => {
    it('emits when same scanner errors twice in one cycle (with both scans failing)', () => {
      detector.onScanError(makeScanError({ plate_index: '00', error: 'transient' }));
      detector.onScanEnd({ scanner_id: 'sc-a', plate_index: '00', success: false });
      detector.onScanError(makeScanError({ plate_index: '01', error: 'transient' }));
      detector.onScanEnd({ scanner_id: 'sc-a', plate_index: '01', success: false });
      const count = emitted.filter(
        (e) => e.signature === 'consecutive_failures',
      ).length;
      expect(count).toBe(1);
    });

    it('cycle boundary resets the counter', () => {
      detector.onScanError(makeScanError({ plate_index: '00' }));
      detector.onScanEnd({ scanner_id: 'sc-a', plate_index: '00', success: false });
      detector.onCycleStart(2);
      detector.onScanError(makeScanError({ plate_index: '00' }));
      detector.onScanEnd({ scanner_id: 'sc-a', plate_index: '00', success: false });
      // One error in cycle 1, one error in cycle 2 — no consecutive_failures
      const count = emitted.filter(
        (e) => e.signature === 'consecutive_failures',
      ).length;
      expect(count).toBe(0);
    });

    it('counter is per scanner: errors from A and B in one cycle do NOT trigger', () => {
      detector.onScanError(makeScanError({ scanner_id: 'sc-a' }));
      detector.onScanEnd({ scanner_id: 'sc-a', plate_index: '00', success: false });
      detector.onScanError(makeScanError({ scanner_id: 'sc-b' }));
      detector.onScanEnd({ scanner_id: 'sc-b', plate_index: '00', success: false });
      const count = emitted.filter(
        (e) => e.signature === 'consecutive_failures',
      ).length;
      expect(count).toBe(0);
    });

    it('a recovered scan does NOT increment the consecutive counter past threshold', () => {
      detector.onScanError(makeScanError({ plate_index: '00' }));
      detector.onScanEnd({ scanner_id: 'sc-a', plate_index: '00', success: true }); // recovered
      detector.onScanError(makeScanError({ plate_index: '01' }));
      detector.onScanEnd({ scanner_id: 'sc-a', plate_index: '01', success: false });
      // Only one ACTUAL failure for sc-a → no wedge
      const count = emitted.filter(
        (e) => e.signature === 'consecutive_failures',
      ).length;
      expect(count).toBe(0);
    });
  });

  describe('determinism and idempotency', () => {
    it('replaying the same event stream produces identical output', () => {
      function run(): typeof emitted {
        const out: typeof emitted = [];
        const d = new WedgeDetector({
          sessionId: 'sess-1',
          onWedge: (evt) =>
            out.push({
              scanner_id: evt.scanner_id,
              signature: evt.signature,
            }),
        });
        d.onCycleStart(1);
        d.onScanError(makeScanError({ error: 'sane_start: Invalid argument' }));
        d.onScanEnd({ scanner_id: 'sc-a', plate_index: '00', success: false });
        d.onCycleStart(2);
        d.onScanError(makeScanError({ plate_index: '00', error: 'x' }));
        d.onScanEnd({ scanner_id: 'sc-a', plate_index: '00', success: false });
        d.onScanError(makeScanError({ plate_index: '01', error: 'x' }));
        d.onScanEnd({ scanner_id: 'sc-a', plate_index: '01', success: false });
        return out;
      }
      expect(run()).toEqual(run());
    });

    it('duplicate cycle-start events with the same cycle number are idempotent', () => {
      detector.onScanError(makeScanError({ plate_index: '00' }));
      detector.onScanEnd({ scanner_id: 'sc-a', plate_index: '00', success: false });
      // Replay the same cycle-start — should NOT reset the per-scanner
      // counter (cycle number 1 is already in flight)
      detector.onCycleStart(1);
      detector.onScanError(makeScanError({ plate_index: '01' }));
      detector.onScanEnd({ scanner_id: 'sc-a', plate_index: '01', success: false });
      // Two failures in cycle 1 → consecutive_failures fires
      const count = emitted.filter(
        (e) => e.signature === 'consecutive_failures',
      ).length;
      expect(count).toBe(1);
    });
  });

  describe('wedge event payload', () => {
    it('includes scanner_id, signature, session_id, cycle_number, timestamp', () => {
      const events: Array<Record<string, unknown>> = [];
      const d = new WedgeDetector({
        sessionId: 'sess-42',
        onWedge: (evt) =>
          events.push(evt as unknown as Record<string, unknown>),
      });
      d.onCycleStart(7);
      d.onScanError(
        makeScanError({
          scanner_id: 'sc-x',
          error: 'sane_start: Invalid argument',
        }),
      );
      d.onScanEnd({ scanner_id: 'sc-x', plate_index: '00', success: false });

      expect(events).toHaveLength(1);
      expect(events[0].scanner_id).toBe('sc-x');
      expect(events[0].signature).toBe('sane_start_invalid');
      expect(events[0].session_id).toBe('sess-42');
      expect(events[0].cycle_number).toBe(7);
      expect(typeof events[0].timestamp).toBe('string');
    });
  });
});
