/**
 * Wedge Banner
 *
 * App-wide (mounted in Layout.tsx, gated on graviscan mode — design.md
 * Decision 4) banner showing one entry per auto-paused scanner, plus a
 * session-scoped auto-pause counter. See openspec/changes/
 * add-graviscan-wedge-response-ui for the full design rationale.
 */

import { useState } from 'react';
import { useWedgeEvents } from '../hooks/useWedgeEvents';
import type { GraviWedgeEvent } from '../../types/graviscan';

interface WedgeEntryRowProps {
  event: GraviWedgeEvent;
  onDismiss: (scannerId: string) => void;
}

function WedgeEntryRow({ event, onDismiss }: WedgeEntryRowProps) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  async function handleConfirmRetry() {
    setRetrying(true);
    setError(null);
    try {
      const result = await window.electron.gravi.retryScanner(event.scanner_id);
      if (result.success) {
        onDismiss(event.scanner_id);
      } else {
        // Manual cast: this repo's tsconfig doesn't set strictNullChecks,
        // so control-flow narrowing on the `success` discriminant doesn't
        // apply here (matches ConfigureScanner.tsx's own workaround).
        const err = (result as { success: false; error: string }).error;
        setError(err);
      }
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div
      data-testid={`wedge-entry-${event.scanner_id}`}
      className="bg-red-50 border-2 border-red-500 rounded-lg p-4 text-red-800"
    >
      <div className="font-semibold">
        {event.display_name ?? event.scanner_id} wedged (signature:{' '}
        {event.signature}) — this scanner has been automatically paused.
      </div>
      <div className="text-sm mt-1">{event.error_message}</div>

      {error && <div className="text-sm mt-2 text-red-900">{error}</div>}

      {!confirming ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="px-3 py-1 rounded border border-red-500 text-red-700"
            onClick={() => onDismiss(event.scanner_id)}
          >
            Dismiss
          </button>
          <button
            type="button"
            className="px-3 py-1 rounded bg-red-600 text-white"
            onClick={() => setConfirming(true)}
          >
            Power-Cycled &amp; Retry
          </button>
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-sm mb-2">
            Only click Confirm Retry after you have physically power-cycled this
            scanner. Retrying before the power-cycle is done will very likely
            wedge again immediately.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="px-3 py-1 rounded border border-gray-400"
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="px-3 py-1 rounded bg-red-600 text-white"
              disabled={retrying}
              onClick={handleConfirmRetry}
            >
              Confirm Retry
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function WedgeBanner() {
  const { entries, totalAutoPauseEvents, totalScannersAffected, dismiss } =
    useWedgeEvents();

  const entryList = Object.values(entries);

  if (entryList.length === 0 && totalAutoPauseEvents === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 p-2">
      {totalAutoPauseEvents > 0 && (
        <div
          data-testid="wedge-session-counter"
          className="text-sm text-red-700"
        >
          {totalAutoPauseEvents} auto-pause event
          {totalAutoPauseEvents === 1 ? '' : 's'} across {totalScannersAffected}{' '}
          scanner
          {totalScannersAffected === 1 ? '' : 's'} this session
        </div>
      )}
      {entryList.map((event) => (
        // Keying on scanner_id + cycle_number + timestamp intentionally
        // remounts this row (resetting its local confirm/error state) when
        // a new wedge for the same scanner supersedes the old one — design.md
        // Decision 2/4's "confirmation resets on replace" requirement.
        <WedgeEntryRow
          key={`${event.scanner_id}:${event.cycle_number}:${event.timestamp}`}
          event={event}
          onDismiss={dismiss}
        />
      ))}
    </div>
  );
}
