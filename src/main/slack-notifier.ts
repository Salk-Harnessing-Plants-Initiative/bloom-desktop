/**
 * SlackNotifier — posts a structured wedge alert to a Slack incoming
 * webhook URL. Consumes `wedge-detected` events emitted by the
 * `WedgeDetector` (Task 5).
 *
 * Configuration:
 *   Reads `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL` from `~/.bloom/.env`
 *   via `config-store.ts` (loaded into `process.env` by `main.ts`).
 *   See the repo README's "Environment variables" section and
 *   `.env.example` for deployment. SECRET — never logged.
 *
 * Defensive properties (per design.md Decision 4 and #236):
 *  - Absent webhook URL ⇒ no-op (feature disabled). No fetch, no
 *    error, no log spam.
 *  - Rate-limit: at most one notification per (scanner_id, session_id)
 *    per `rateLimitMs` (default 60_000 ms). The key persists across
 *    cycles within the same session.
 *  - Configurable fetch timeout via AbortController (default 10_000 ms)
 *    so a hung webhook cannot block the notifier indefinitely.
 *  - Fetch failures (network, non-2xx, timeout) are logged via
 *    `console.error` but never thrown to the caller.
 *  - The webhook URL NEVER appears in any log output — only sanitized
 *    one-line failure messages.
 */

import type { WedgeDetectedEvent } from './wedge-detector';

const INVESTIGATION_SUMMARY_URL =
  'https://salkinstitute.box.com/s/rj7dcdv8g8wo6kps1qy36ffaj21cwx0x';

export interface SlackNotifierOptions {
  /** Webhook URL. Undefined or empty ⇒ feature disabled. */
  webhookUrl?: string;
  /** Rate-limit window in milliseconds; default 60_000. Set to 0 to
   *  disable rate-limiting (testing only). */
  rateLimitMs?: number;
  /** Fetch timeout in milliseconds; default 10_000. */
  timeoutMs?: number;
  /** Override `Date.now()` for deterministic test replays. */
  now?: () => number;
}

function buildMessageText(evt: WedgeDetectedEvent): string {
  // Operator-friendly identity: prefer display_name when the wiring
  // populated it (main.ts does a DB lookup before notify); fall back
  // to the scanner_id otherwise. USB path included on a separate line
  // so the operator can locate the physical scanner. Per Copilot PR
  // #237 review.
  const identity = evt.display_name
    ? `${evt.display_name} (${evt.scanner_id})`
    : evt.scanner_id;
  const lines = [
    `🚨 V600 wedge on scanner ${identity}`,
  ];
  if (evt.usb_port) {
    lines.push(`USB path: ${evt.usb_port}`);
  }
  lines.push(
    `Signature: ${evt.signature}`,
    `Session: ${evt.session_id}, Cycle: ${evt.cycle_number}`,
    `Time: ${evt.timestamp}`,
    'Physical AC power-cycle required.',
    `Investigation summary: ${INVESTIGATION_SUMMARY_URL}`,
  );
  return lines.join('\n');
}

function rateLimitKey(evt: WedgeDetectedEvent): string {
  return `${evt.scanner_id}::${evt.session_id}`;
}

export class SlackNotifier {
  private readonly webhookUrl: string | undefined;
  private readonly rateLimitMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  /** Last-sent timestamp per `(scanner_id, session_id)` key.
   *  Pruned opportunistically (see `maybePruneRateLimitMap`) so an
   *  app process that runs for months doesn't grow this map without
   *  bound. */
  private lastSent = new Map<string, number>();
  /** Map-size threshold above which we prune entries older than
   *  `pruneAgeMs`. Sized so a typical 6-month rig run with ≤100
   *  scanners × hourly sessions stays well below it. */
  private readonly pruneThreshold = 10_000;
  /** Prune entries older than this many ms. */
  private readonly pruneAgeMs = 24 * 60 * 60 * 1000; // 24h

  /**
   * Drop entries from `lastSent` whose timestamps are older than
   * `pruneAgeMs`. Called opportunistically after each send so the map
   * never grows without bound across very long-lived sessions.
   *
   * Bounded: only runs when the map has more than `pruneThreshold`
   * entries, so the cost is dominated by typical-case operation.
   */
  private maybePruneRateLimitMap(now: number): void {
    if (this.lastSent.size <= this.pruneThreshold) return;
    const threshold = now - this.pruneAgeMs;
    for (const [k, ts] of this.lastSent.entries()) {
      if (ts < threshold) this.lastSent.delete(k);
    }
  }

  constructor(opts: SlackNotifierOptions) {
    this.webhookUrl =
      opts.webhookUrl && opts.webhookUrl.length > 0 ? opts.webhookUrl : undefined;
    this.rateLimitMs = opts.rateLimitMs ?? 60_000;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Send a Slack notification for a wedge event. Never throws.
   */
  async notify(evt: WedgeDetectedEvent): Promise<void> {
    if (!this.webhookUrl) return; // feature disabled

    const key = rateLimitKey(evt);
    const lastSent = this.lastSent.get(key);
    const now = this.now();
    if (
      this.rateLimitMs > 0 &&
      lastSent !== undefined &&
      now - lastSent < this.rateLimitMs
    ) {
      // Rate-limited — silently suppress.
      return;
    }

    // Record send time BEFORE the fetch so concurrent calls are also
    // rate-limited (and so failed POSTs don't bypass rate-limit).
    this.lastSent.set(key, now);
    this.maybePruneRateLimitMap(now);

    const body = JSON.stringify({ text: buildMessageText(evt) });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: ctrl.signal,
      });
      if (!res.ok) {
        // Sanitized log — no URL, no headers, no body.
        console.error(`[SlackNotifier] POST failed: HTTP ${res.status}`);
      }
    } catch (err) {
      // Sanitized log — never include the URL or full error object.
      const name = err instanceof Error ? err.name : 'Error';
      if (name === 'AbortError') {
        console.error(
          `[SlackNotifier] POST failed: timeout after ${this.timeoutMs} ms`,
        );
      } else {
        console.error(`[SlackNotifier] POST failed: ${name}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
