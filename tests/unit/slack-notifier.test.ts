// @vitest-environment node
/**
 * Task 6 (#236): SlackNotifier — POSTs a Slack message when the
 * WedgeDetector emits a wedge-detected event.
 *
 * Requirements:
 *  - Absent webhook URL ⇒ no-op (feature disabled)
 *  - Rate-limit: 1 POST per (scanner_id, session_id) per 60 seconds.
 *    Rate-limit persists across cycles within the same session.
 *  - Configurable fetch timeout via AbortController (default 10 s).
 *  - URL never leaks into stderr / log output.
 *  - Fetch failures (network, non-2xx, timeout) are logged but do not
 *    throw.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import { SlackNotifier } from '../../src/main/slack-notifier';
import type { WedgeDetectedEvent } from '../../src/main/wedge-detector';

const TEST_URL =
  'https://hooks.slack.com/services/SECRET/PATH/TOKEN-DO-NOT-LOG';

function makeWedge(
  overrides: Partial<WedgeDetectedEvent> = {},
): WedgeDetectedEvent {
  return {
    scanner_id: 'sc-a',
    signature: 'sane_start_invalid',
    session_id: 'sess-1',
    cycle_number: 3,
    timestamp: '2026-05-21T14:00:00-07:00',
    error_message: 'sane_start: Invalid argument',
    ...overrides,
  };
}

describe('SlackNotifier', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('disabled mode', () => {
    it('is a no-op when constructed without a webhook URL', async () => {
      const n = new SlackNotifier({});
      await n.notify(makeWedge());
      expect(fetchMock).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('is a no-op when constructed with an empty string', async () => {
      const n = new SlackNotifier({ webhookUrl: '' });
      await n.notify(makeWedge());
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('basic POST behavior', () => {
    it('issues one fetch POST to the webhook URL', async () => {
      const n = new SlackNotifier({ webhookUrl: TEST_URL });
      await n.notify(makeWedge());
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(TEST_URL);
      expect((init as RequestInit).method).toBe('POST');
    });

    it('sends a JSON body with text containing scanner_id, signature, CTA, and Box link', async () => {
      const n = new SlackNotifier({ webhookUrl: TEST_URL });
      await n.notify(
        makeWedge({
          scanner_id: 'sc-x',
          signature: 'device_io_120s_zero_bytes',
          session_id: 'sess-7',
          cycle_number: 47,
        }),
      );
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect((init.headers as Record<string, string>)['Content-Type']).toBe(
        'application/json',
      );
      const body = JSON.parse(init.body as string);
      expect(typeof body.text).toBe('string');
      const t = body.text as string;
      expect(t).toContain('sc-x');
      expect(t).toContain('device_io_120s_zero_bytes');
      expect(t).toContain('sess-7');
      expect(t).toContain('47');
      expect(t).toContain('AC power-cycle');
      expect(t).toContain('salkinstitute.box.com'); // investigation summary link
    });
  });

  describe('rate-limit', () => {
    it('suppresses a second notification within 60 s for same (scanner, session)', async () => {
      const n = new SlackNotifier({ webhookUrl: TEST_URL });
      await n.notify(makeWedge({ scanner_id: 'sc-a', session_id: 'sess-1' }));
      await n.notify(makeWedge({ scanner_id: 'sc-a', session_id: 'sess-1' }));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('allows two notifications for the same scanner but DIFFERENT sessions', async () => {
      const n = new SlackNotifier({ webhookUrl: TEST_URL });
      await n.notify(makeWedge({ scanner_id: 'sc-a', session_id: 'sess-1' }));
      await n.notify(makeWedge({ scanner_id: 'sc-a', session_id: 'sess-2' }));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('rate-limit key persists across cycles within the same session', async () => {
      vi.useFakeTimers({ now: 0 });
      const n = new SlackNotifier({ webhookUrl: TEST_URL });
      // Cycle 3 at T=0
      await n.notify(
        makeWedge({ scanner_id: 'sc-a', session_id: 'sess-1', cycle_number: 3 }),
      );
      // Cycle 4 at T=45s (within 60s window) — should be suppressed
      vi.setSystemTime(45_000);
      await n.notify(
        makeWedge({ scanner_id: 'sc-a', session_id: 'sess-1', cycle_number: 4 }),
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // At T=61s (after window expires) — should fire again
      vi.setSystemTime(61_000);
      await n.notify(
        makeWedge({ scanner_id: 'sc-a', session_id: 'sess-1', cycle_number: 5 }),
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('allows two notifications for the same (scanner, session) >60 s apart', async () => {
      vi.useFakeTimers({ now: 0 });
      const n = new SlackNotifier({ webhookUrl: TEST_URL });
      await n.notify(makeWedge());
      vi.setSystemTime(61_000);
      await n.notify(makeWedge());
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('failure modes (no throw, no URL leak)', () => {
    it('a fetch network error is logged but does not throw', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ENOTFOUND'));
      const n = new SlackNotifier({ webhookUrl: TEST_URL });
      await expect(n.notify(makeWedge())).resolves.toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('a non-2xx status is logged but does not throw', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response('rate limited', { status: 429 }),
      );
      const n = new SlackNotifier({ webhookUrl: TEST_URL });
      await expect(n.notify(makeWedge())).resolves.toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('does NOT log the webhook URL on any failure path', async () => {
      const failures: Array<() => void> = [
        () => fetchMock.mockRejectedValueOnce(new Error('boom')),
        () =>
          fetchMock.mockResolvedValueOnce(
            new Response('x', { status: 503 }),
          ),
      ];
      for (const setup of failures) {
        consoleErrorSpy.mockClear();
        consoleLogSpy.mockClear();
        fetchMock.mockClear();
        setup();
        const n = new SlackNotifier({
          webhookUrl: TEST_URL,
          rateLimitMs: 0, // disable rate-limit for this scenario
        });
        await n.notify(makeWedge());
        const allLogText = [
          ...consoleErrorSpy.mock.calls,
          ...consoleLogSpy.mock.calls,
        ]
          .flat()
          .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
          .join('\n');
        expect(allLogText).not.toMatch(/hooks\.slack\.com/);
        expect(allLogText).not.toMatch(/SECRET/);
        expect(allLogText).not.toMatch(/TOKEN-DO-NOT-LOG/);
      }
    });
  });

  describe('AbortController timeout', () => {
    it('aborts the fetch after the configured timeout (default 10s)', async () => {
      vi.useFakeTimers({ now: 0 });

      // Mock fetch to honor AbortSignal — reject with AbortError when
      // the signal aborts.
      let signal: AbortSignal | undefined;
      const fetchPromise = new Promise<Response>((_resolve, reject) => {
        const onAbort = () => {
          reject(new DOMException('aborted', 'AbortError'));
        };
        // We'll wire signal in the fetch call below
        setTimeout(() => {
          if (signal?.aborted) onAbort();
        }, 0);
      });
      fetchMock.mockImplementation((_url: string, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return new Promise((_resolve, reject) => {
          signal!.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      });

      const n = new SlackNotifier({ webhookUrl: TEST_URL, timeoutMs: 10_000 });
      const promise = n.notify(makeWedge());

      // Advance time past the timeout — should trigger abort
      await vi.advanceTimersByTimeAsync(11_000);

      await expect(promise).resolves.toBeUndefined();
      expect(signal).toBeDefined();
      expect(signal!.aborted).toBe(true);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });
});
