/**
 * Why the app can't use this station's settings (#477, #485), with Retry (reads
 * ~/.bloom/.env again). If a Retry doesn't fix it, it says to contact the Bloom team.
 * Capture Scan also links to Machine Configuration, where missing values are set; the
 * start-up screen for a file that can't be read doesn't, since saving there is refused.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';

export const CONTACT_BLOOM_TEAM =
  'If this keeps happening, contact the Bloom team.';

export interface StationConfigNoticeProps {
  problem: string;
  onRetry: () => Promise<void>;
  /** Heading above the problem. */
  title?: string;
  /** Show the link to Machine Configuration (needs a router). */
  showMachineConfigLink?: boolean;
}

export function StationConfigNotice({
  problem,
  onRetry,
  title = "Scanning is off until this station's settings are fixed.",
  showMachineConfigLink = true,
}: StationConfigNoticeProps) {
  const [retrying, setRetrying] = useState(false);
  // Still showing after a Retry: the problem came back.
  const [retried, setRetried] = useState(false);
  const retry = async () => {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
      setRetried(true);
    }
  };
  return (
    <div
      role="alert"
      className="mb-4 rounded-md border border-red-200 bg-red-50 p-4"
      data-testid="station-config-notice"
    >
      <p className="text-sm font-medium text-red-800">{title}</p>
      <p className="mt-1 text-sm text-red-700">{problem}</p>
      {retried && !retrying && (
        <p
          className="mt-1 text-sm font-medium text-red-800"
          data-testid="station-config-contact"
        >
          Retry didn&apos;t fix it. {CONTACT_BLOOM_TEAM}
        </p>
      )}
      <div className="mt-3 flex items-center gap-4">
        <button
          type="button"
          onClick={retry}
          disabled={retrying}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
        {showMachineConfigLink && (
          <Link
            to="/machine-config"
            className="text-sm font-medium text-red-800 underline hover:text-red-900"
          >
            Open Machine Configuration
          </Link>
        )}
      </div>
    </div>
  );
}
