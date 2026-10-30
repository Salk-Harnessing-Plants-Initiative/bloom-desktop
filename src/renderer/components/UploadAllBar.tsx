/**
 * Browse Scans' "Upload all" (#449): how many scans, within the page's filters, have
 * frames not yet uploaded, and one button to upload them all, oldest first. While it
 * runs it shows "Uploading 12 of 40…" and can be stopped after the scan in progress;
 * at the end it says how many uploaded and how many failed (those can be retried).
 * The page refreshes its rows after each scan, and keeps its own Upload buttons
 * disabled while a run is going (and this one while they are), so a scan is never
 * uploaded twice at once.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ScanListFilters,
  UploadAllProgress,
  UploadAllResult,
} from '../../types/upload-all';

export interface UploadAllBarProps {
  filters: ScanListFilters;
  /** Changes whenever the page's scans reload, so the count follows other uploads. */
  refreshKey: unknown;
  /** Called after a run, so the page reloads its scans. */
  onFinished: () => void;
  /** Called after each scan of a run, so the page can refresh its rows. */
  onProgress?: () => void;
  /** Told when a run starts and ends, so the page can disable its own Upload buttons. */
  onRunningChange?: (running: boolean) => void;
  /** Another upload is in progress on the page. */
  disabled?: boolean;
}

const scansText = (n: number) => `${n} scan${n === 1 ? '' : 's'}`;

export function UploadAllBar({
  filters,
  refreshKey,
  onFinished,
  onProgress,
  onRunningChange,
  disabled = false,
}: UploadAllBarProps) {
  const [count, setCount] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [progress, setProgress] = useState<UploadAllProgress | null>(null);
  const [result, setResult] = useState<UploadAllResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { experimentId, dateFrom, dateTo } = filters;
  // The page's latest callbacks: a run can outlast the render that started it (for
  // example when the filters change), and must reload the page as it is now.
  const callbacks = useRef({ onFinished, onProgress, onRunningChange });
  callbacks.current = { onFinished, onProgress, onRunningChange };

  const loadCount = useCallback(async () => {
    try {
      const response = await window.electron.database.scans.pendingUploads({
        experimentId,
        dateFrom,
        dateTo,
      });
      setCount(response.success ? (response.data?.count ?? 0) : null);
    } catch {
      setCount(null);
    }
  }, [experimentId, dateFrom, dateTo]);

  useEffect(() => {
    if (!running) loadCount();
  }, [loadCount, refreshKey, running]);

  useEffect(
    () =>
      window.electron.database.scans.onUploadAllProgress((next) => {
        setProgress(next);
        callbacks.current.onProgress?.();
      }),
    []
  );

  useEffect(() => {
    callbacks.current.onRunningChange?.(running);
  }, [running]);

  const uploadAll = async () => {
    if (!count) return;
    if (!window.confirm(`Upload ${scansText(count)} to Bloom?`)) return;
    setRunning(true);
    setStopping(false);
    setProgress(null);
    setResult(null);
    setError(null);
    try {
      const response = await window.electron.database.scans.uploadAll({
        experimentId,
        dateFrom,
        dateTo,
      });
      if (response.success && response.data) setResult(response.data);
      else setError(response.error ?? 'Upload all failed');
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : 'Unknown error');
    } finally {
      setRunning(false);
      callbacks.current.onFinished();
    }
  };

  const stop = async () => {
    setStopping(true);
    await window.electron.database.scans.stopUploadAll();
  };

  const status = running
    ? progress
      ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
      : 'Starting upload…'
    : count === null
      ? 'Checking for scans to upload…'
      : count === 0
        ? 'All scans are uploaded.'
        : `${scansText(count)} not yet uploaded`;

  return (
    <div className="mb-4 space-y-2" data-testid="upload-all-bar">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
        <p className="text-sm text-gray-700" data-testid="upload-all-status">
          {status}
        </p>
        {running ? (
          <button
            type="button"
            onClick={stop}
            disabled={stopping}
            className="px-4 py-2 rounded-md border border-gray-300 text-sm hover:bg-gray-50 disabled:opacity-50"
            data-testid="upload-all-stop"
          >
            {stopping ? 'Stopping after this scan…' : 'Stop'}
          </button>
        ) : (
          <button
            type="button"
            onClick={uploadAll}
            disabled={!count || disabled}
            title={
              disabled ? 'Wait for the upload in progress to finish' : undefined
            }
            className="px-4 py-2 rounded-md bg-lime-700 text-sm font-medium text-white hover:bg-lime-800 disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="upload-all-button"
          >
            {count ? `Upload all (${count})` : 'Nothing to upload'}
          </button>
        )}
      </div>
      {result && (
        <div
          role="status"
          className={`rounded-lg border p-3 text-sm ${
            result.failedScans > 0
              ? 'border-amber-300 bg-amber-50 text-amber-900'
              : 'border-green-200 bg-green-50 text-green-800'
          }`}
          data-testid="upload-all-result"
        >
          <p>
            Uploaded {result.uploadedScans} of {scansText(result.total)}.
            {result.failedScans > 0 &&
              ` ${result.failedScans} failed and can be uploaded again.`}
            {result.stopped && ' Stopped before the rest.'}
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {result.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          Couldn&apos;t upload: {error}
        </p>
      )}
    </div>
  );
}
