// @vitest-environment node
/**
 * Integration test for the wedge-detection pipeline (#236).
 *
 * Per PR #237 review: the WedgeDetector + SlackNotifier modules are
 * each unit-tested in isolation, but the END-TO-END chain (scan-event
 * from the coordinator → WedgeDetector → SlackNotifier.notify) was
 * not exercised. This test mirrors the wiring pattern from main.ts so
 * the chain is covered.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import { WedgeDetector } from '../../src/main/wedge-detector';
import { SlackNotifier } from '../../src/main/slack-notifier';

const WEBHOOK = 'https://hooks.slack.com/services/TEST/FAKE/URL';

interface ScanEvent {
  type: string;
  scanner_id: string;
  plate_index: string;
  job_id: string;
  cycle_number?: number;
  error?: string;
  bytes_received?: number;
  wall_seconds?: number;
  path?: string;
  duration_ms?: number;
}

describe('wedge pipeline integration (scan-event → detector → notifier)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /**
   * Build a stripped-down version of the main.ts wiring. Mirrors the
   * structure of `src/main/main.ts:scanCoordinator.on('scan-event',...)`.
   */
  function buildPipeline(opts: { webhookUrl?: string }) {
    const notifier = new SlackNotifier({ webhookUrl: opts.webhookUrl });
    const detector: WedgeDetector | null = new WedgeDetector({
      sessionId: 'sess-test',
      onWedge: (evt) => void notifier.notify(evt),
    });
    let lastSeenCycle = -1;
    detector.onCycleStart(1);
    lastSeenCycle = 1;

    function feedEvent(event: ScanEvent): void {
      if (!detector) return;
      if (
        typeof event.cycle_number === 'number' &&
        event.cycle_number !== lastSeenCycle
      ) {
        detector.onCycleStart(event.cycle_number);
        lastSeenCycle = event.cycle_number;
      }
      if (event.type === 'scan-error') {
        // Per Copilot PR #237 review (#15): pass undefined through
        // when fields are absent. Defaulting to 0 would mask the
        // WedgeDetector's missing-fields warning and prevent
        // detection of a pre-Task-0 Python worker at runtime.
        detector.onScanError({
          scanner_id: event.scanner_id,
          plate_index: event.plate_index,
          job_id: event.job_id,
          error: event.error ?? '',
          bytes_received: event.bytes_received,
          wall_seconds: event.wall_seconds,
        });
        detector.onScanEnd({
          scanner_id: event.scanner_id,
          plate_index: event.plate_index,
          success: false,
        });
      } else if (event.type === 'scan-complete') {
        detector.onScanEnd({
          scanner_id: event.scanner_id,
          plate_index: event.plate_index,
          success: true,
        });
      }
    }

    return { feedEvent };
  }

  it('sane_start_invalid scan-error → Slack POST is fired once', async () => {
    const { feedEvent } = buildPipeline({ webhookUrl: WEBHOOK });
    feedEvent({
      type: 'scan-error',
      scanner_id: 'sc-1',
      plate_index: '00',
      job_id: 'j1',
      error: 'epkowa: sane_start: Invalid argument',
      bytes_received: 0,
      wall_seconds: 5,
      cycle_number: 1,
    });
    // Allow microtask queue to drain
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(WEBHOOK);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.text).toContain('sc-1');
    expect(body.text).toContain('sane_start_invalid');
  });

  it('lone scan-complete with no preceding scan-error → no Slack POST (true recovered-scan path)', async () => {
    // ARCHITECTURE NOTE (Copilot PR #237 review): the coordinator
    // surfaces only the FINAL outcome of a per-plate scan attempt —
    // either scan-complete OR scan-error, never both for the same
    // (scanner_id, plate_index). The Python worker's internal retry
    // loop handles transient failures internally; the wiring sees
    // success or failure at the boundary.
    //
    // This means the "scan-error then scan-complete same plate"
    // sequence does NOT occur via the production wiring. The
    // WedgeDetector still SUPPORTS that sequence (recovered-scan
    // suppression at the detector level — see wedge-detector.test.ts)
    // for future architectures that might surface intermediate
    // outcomes, but the wiring path here funnels final outcomes only.
    //
    // What we ACTUALLY assert at the wiring level: a lone scan-
    // complete with no preceding scan-error fires no notification.
    const { feedEvent } = buildPipeline({ webhookUrl: WEBHOOK });
    feedEvent({
      type: 'scan-complete',
      scanner_id: 'sc-1',
      plate_index: '00',
      job_id: 'j1',
      cycle_number: 1,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no fetch when webhook URL is absent (feature disabled)', async () => {
    const { feedEvent } = buildPipeline({});
    feedEvent({
      type: 'scan-error',
      scanner_id: 'sc-1',
      plate_index: '00',
      job_id: 'j1',
      error: 'sane_start: Invalid argument',
      bytes_received: 0,
      wall_seconds: 5,
      cycle_number: 1,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('consecutive_failures fires exactly one notification per cycle', async () => {
    const { feedEvent } = buildPipeline({ webhookUrl: WEBHOOK });
    feedEvent({
      type: 'scan-error',
      scanner_id: 'sc-1',
      plate_index: '00',
      job_id: 'j1',
      error: 'some transient error',
      bytes_received: 0,
      wall_seconds: 5,
      cycle_number: 1,
    });
    feedEvent({
      type: 'scan-error',
      scanner_id: 'sc-1',
      plate_index: '01',
      job_id: 'j2',
      error: 'another transient error',
      bytes_received: 0,
      wall_seconds: 5,
      cycle_number: 1,
    });
    await new Promise((r) => setTimeout(r, 0));
    // Per WedgeDetector dedup: same-cycle same-scanner errors fire
    // ONE wedge (the consecutive_failures one). The first error also
    // fires nothing on its own (count=1). The second triggers
    // consecutive_failures.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.text).toContain('consecutive_failures');
  });

  // Copilot PR #237 review (#15): the wiring previously defaulted
  // bytes_received and wall_seconds to 0 when absent. That made
  // them ALWAYS numeric to the WedgeDetector — which checks
  // `typeof !== 'number'` to fire its "missing fields" warning.
  // Result: the warning never triggered, even when the Python worker
  // was pre-Task-0 and genuinely omitting the fields. Pass undefined
  // through instead so the detector can surface the configuration
  // drift.
  describe('pre-Task-0 worker detection (#15)', () => {
    it('logs missing-fields warning when scan-error has no bytes_received', async () => {
      const warnSpy = vi.spyOn(console, 'warn');
      const { feedEvent } = buildPipeline({ webhookUrl: WEBHOOK });
      feedEvent({
        type: 'scan-error',
        scanner_id: 'sc-1',
        plate_index: '00',
        job_id: 'j1',
        error: 'some error',
        // bytes_received omitted
        wall_seconds: 5,
        cycle_number: 1,
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('missing bytes_received or wall_seconds'),
      );
    });

    it('logs missing-fields warning when scan-error has no wall_seconds', async () => {
      const warnSpy = vi.spyOn(console, 'warn');
      const { feedEvent } = buildPipeline({ webhookUrl: WEBHOOK });
      feedEvent({
        type: 'scan-error',
        scanner_id: 'sc-1',
        plate_index: '00',
        job_id: 'j1',
        error: 'some error',
        bytes_received: 0,
        // wall_seconds omitted
        cycle_number: 1,
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('missing bytes_received or wall_seconds'),
      );
    });

    it('does NOT log missing-fields warning when both fields are present', async () => {
      const warnSpy = vi.spyOn(console, 'warn');
      const { feedEvent } = buildPipeline({ webhookUrl: WEBHOOK });
      feedEvent({
        type: 'scan-error',
        scanner_id: 'sc-1',
        plate_index: '00',
        job_id: 'j1',
        error: 'some error',
        bytes_received: 0,
        wall_seconds: 5,
        cycle_number: 1,
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('missing bytes_received or wall_seconds'),
      );
    });
  });

  it('cycle boundary resets per-scanner counter', async () => {
    const { feedEvent } = buildPipeline({ webhookUrl: WEBHOOK });
    feedEvent({
      type: 'scan-error',
      scanner_id: 'sc-1',
      plate_index: '00',
      job_id: 'j1',
      error: 'transient',
      bytes_received: 0,
      wall_seconds: 5,
      cycle_number: 1,
    });
    // One error in cycle 1. Cycle 2 begins: cycle_number changes.
    feedEvent({
      type: 'scan-error',
      scanner_id: 'sc-1',
      plate_index: '00',
      job_id: 'j2',
      error: 'transient',
      bytes_received: 0,
      wall_seconds: 5,
      cycle_number: 2,
    });
    await new Promise((r) => setTimeout(r, 0));
    // No wedge — each cycle saw only ONE failure for sc-1
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
