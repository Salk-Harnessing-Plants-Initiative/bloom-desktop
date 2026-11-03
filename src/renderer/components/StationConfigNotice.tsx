/**
 * Why Capture Scan can't scan with this station's settings (#477), with Retry (reads
 * ~/.bloom/.env again) and a link to Machine Configuration, where they're set.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';

export interface StationConfigNoticeProps {
  problem: string;
  onRetry: () => Promise<void>;
}

export function StationConfigNotice({
  problem,
  onRetry,
}: StationConfigNoticeProps) {
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };
  return (
    <div
      role="alert"
      className="mb-4 rounded-md border border-red-200 bg-red-50 p-4"
      data-testid="station-config-notice"
    >
      <p className="text-sm font-medium text-red-800">
        Scanning is off until this station&apos;s settings are fixed.
      </p>
      <p className="mt-1 text-sm text-red-700">{problem}</p>
      <div className="mt-3 flex items-center gap-4">
        <button
          type="button"
          onClick={retry}
          disabled={retrying}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
        <Link
          to="/machine-config"
          className="text-sm font-medium text-red-800 underline hover:text-red-900"
        >
          Open Machine Configuration
        </Link>
      </div>
    </div>
  );
}
