/**
 * Browse Scans' "Upload all" (#449): how many scans, within the page's filters, have
 * frames not yet uploaded, and one button to upload them all, oldest first. While it
 * runs it shows "Uploading 12 of 40…" and can be stopped after the scan in progress;
 * at the end it says how many uploaded and how many failed (those can be retried).
 * The run goes on in the main process, which remembers it: leaving the page and
 * coming back shows the run (with Stop) or how it ended. The page refreshes its rows
 * after each scan, and keeps its own Upload buttons disabled while a run is going
 * (and this one while they are), so a scan is never uploaded twice at once.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ScanListFilters,
  UploadAllDone,
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
  const [countFailed, setCountFailed] = useState(false);
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

  const showDone = (done: UploadAllDone | null) => {
    setResult(done?.result ?? null);
    setError(done?.error ?? null);
  };

  const loadCount = useCallback(async () => {
    try {
      const response = await window.electron.database.scans.pendingUploads({
        experimentId,
        dateFrom,
        dateTo,
      });
      if (!response.success) throw new Error(response.error);
      setCount(response.data?.count ?? 0);
      setCountFailed(false);
    } catch (thrown) {
      console.error(
        '[Upload all] Could not count scans to upload:',
        thrown instanceof Error ? thrown.message : 'Unknown error'
      );
      setCount(null);
      setCountFailed(true);
    }
  }, [experimentId, dateFrom, dateTo]);

  useEffect(() => {
    if (!running) loadCount();
  }, [loadCount, refreshKey, running]);

  // A run going on (or one that ended) while the page was closed.
  useEffect(() => {
    let current = true;
    window.electron.database.scans
      .uploadAllStatus()
      .then((response) => {
        if (!current || !response.success || !response.data) return;
        const status = response.data;
        if (status.running) {
          setRunning(true);
          setProgress(status.progress);
        } else {
          showDone(status.last);
        }
      })
      .catch((thrown) =>
        console.error(
          '[Upload all] Could not read the upload status:',
          thrown instanceof Error ? thrown.message : 'Unknown error'
        )
      );
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    const scans = window.electron.database.scans;
    const offProgress = scans.onUploadAllProgress((next) => {
      setRunning(true);
      setProgress(next);
      callbacks.current.onProgress?.();
    });
    const offDone = scans.onUploadAllDone((done) => {
      setRunning(false);
      setStopping(false);
      setProgress(null);
      showDone(done);
      callbacks.current.onFinished();
    });
    return () => {
      offProgress();
      offDone();
    };
  }, []);

  useEffect(() => {
    callbacks.current.onRunningChange?.(running);
  }, [running]);

  const uploadAll = async () => {
    if (!count) return;
    if (!window.confirm(`Upload ${scansText(count)} to Bloom?`)) return;
    showDone(null);
    try {
      const response = await window.electron.database.scans.uploadAll({
        experimentId,
        dateFrom,
        dateTo,
      });
      if (!response.success) {
        setError(response.error ?? 'Upload all failed');
        return;
      }
      setRunning(true);
      setProgress(
        (p) =>
          p ?? {
            done: 0,
            total: response.data?.total ?? count,
            uploadedScans: 0,
            failedScans: 0,
          }
      );
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : 'Unknown error');
    }
  };

  const stop = async () => {
    setStopping(true);
    try {
      await window.electron.database.scans.stopUploadAll();
    } catch (thrown) {
      setStopping(false);
      setError(thrown instanceof Error ? thrown.message : 'Unknown error');
    }
  };

  const dismiss = () => {
    showDone(null);
    window.electron.database.scans.dismissUploadAllResult().catch(() => {
      // Only clears the remembered result; nothing to tell the operator.
    });
  };

  const status = running
    ? progress && progress.total > 0
      ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
      : 'Starting upload…'
    : countFailed
      ? "Couldn't check for scans to upload."
      : count === null
        ? 'Checking for scans to upload…'
        : count === 0
          ? 'Nothing waiting to upload.'
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
          className={`flex items-start justify-between gap-3 rounded-lg border p-3 text-sm ${
            result.failedScans > 0
              ? 'border-amber-300 bg-amber-50 text-amber-900'
              : 'border-green-200 bg-green-50 text-green-800'
          }`}
          data-testid="upload-all-result"
        >
          <div>
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
                {result.failedScans > result.errors.length && (
                  <li>…and {result.failedScans - result.errors.length} more</li>
                )}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            className="text-lg leading-none opacity-60 hover:opacity-100"
            data-testid="upload-all-dismiss"
          >
            ×
          </button>
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
