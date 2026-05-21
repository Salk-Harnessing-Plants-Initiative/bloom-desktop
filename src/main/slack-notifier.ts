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
  const lines = [
    `🚨 V600 wedge on scanner ${evt.scanner_id}`,
    `Signature: ${evt.signature}`,
    `Session: ${evt.session_id}, Cycle: ${evt.cycle_number}`,
    `Time: ${evt.timestamp}`,
    'Physical AC power-cycle required.',
    `Investigation summary: ${INVESTIGATION_SUMMARY_URL}`,
  ];
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

  /** Last-sent timestamp per `(scanner_id, session_id)` key. */
  private lastSent = new Map<string, number>();

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
