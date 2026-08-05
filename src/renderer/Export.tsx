import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type {
  ScanWithImageSummary,
  PaginatedScansResponse,
  ScansExportFailure,
  ScansExportProgress,
} from '../types/database';

type ResultBanner =
  | { type: 'success'; exportedFiles: number; skippedFiles: number }
  | {
      type: 'partial';
      exportedFiles: number;
      skippedFiles: number;
      failedScans: ScansExportFailure[];
    }
  | { type: 'error'; message: string };

interface ScanGroup {
  key: string;
  label: string;
  scans: ScanWithImageSummary[];
}

function dayKey(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function dayLabel(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function timestampLabel(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function groupScans(scans: ScanWithImageSummary[]): ScanGroup[] {
  const groups = new Map<string, ScanGroup>();
  for (const scan of scans) {
    const key = `${scan.experiment_id}__${dayKey(scan.capture_date)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.scans.push(scan);
    } else {
      groups.set(key, {
        key,
        label: `${scan.experiment?.name ?? 'Unknown experiment'} — ${dayLabel(
          scan.capture_date
        )}`,
        scans: [scan],
      });
    }
  }
  return Array.from(groups.values()).sort((a, b) =>
    a.label.localeCompare(b.label)
  );
}

const SCANS_PAGE_SIZE = 100;
// Defense-in-depth only: at 100/page this covers 500k scans, far beyond any
// real lab's scan count. Guards against an infinite fetch loop if
// `db:scans:list`'s pagination ever regresses (e.g. a miscounted `total`)
// rather than silently spinning forever.
const MAX_SCAN_PAGES = 5000;

/** Fetches every non-deleted scan across all scanners, looping over `db:scans:list`'s
 * paginated branch (which already filters `deleted: false`, unlike the legacy branch). */
async function fetchAllScans(): Promise<ScanWithImageSummary[]> {
  let page = 1;
  const all: ScanWithImageSummary[] = [];

  while (page <= MAX_SCAN_PAGES) {
    const result = await window.electron.database.scans.list({
      page,
      pageSize: SCANS_PAGE_SIZE,
    });
    if (!result.success) {
      throw new Error(result.error || 'Failed to load scans');
    }
    const data = result.data as PaginatedScansResponse;
    all.push(...data.scans);
    if (all.length >= data.total || data.scans.length === 0) return all;
    page++;
  }

  throw new Error(
    `Scan list pagination did not terminate after ${MAX_SCAN_PAGES} pages`
  );
}

function GroupHeaderCheckbox({
  allSelected,
  someSelected,
  onChange,
}: {
  allSelected: boolean;
  someSelected: boolean;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = someSelected && !allSelected;
    }
  }, [someSelected, allSelected]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={allSelected}
      onChange={(e) => onChange(e.target.checked)}
      className="w-4 h-4 rounded border-gray-300"
      aria-label="Select all scans in group"
    />
  );
}

export function Export() {
  const [scans, setScans] = useState<ScanWithImageSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedScanIds, setSelectedScanIds] = useState<Set<string>>(
    new Set()
  );
  const [destinationDir, setDestinationDir] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<ScansExportProgress | null>(null);
  const [resultBanner, setResultBanner] = useState<ResultBanner | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setIsLoading(true);
        setLoadError(null);
        const all = await fetchAllScans();
        if (!cancelled) setScans(all);
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : 'Failed to load scans'
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Only subscribed while an export is actually in progress, and cleaned up
  // both when it finishes and (critically) if the page unmounts mid-export —
  // this is the exact bug class PR #280 fixed for 8 other listeners.
  useEffect(() => {
    if (!exporting) return;
    const unsubscribe = window.electron.database.scans.onExportProgress((p) =>
      setProgress(p)
    );
    return () => unsubscribe();
  }, [exporting]);

  const groups = useMemo(() => groupScans(scans), [scans]);

  const handleSelectScan = (scanId: string, checked: boolean) => {
    setSelectedScanIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(scanId);
      else next.delete(scanId);
      return next;
    });
  };

  const handleSelectGroup = (group: ScanGroup, checked: boolean) => {
    setSelectedScanIds((prev) => {
      const next = new Set(prev);
      for (const scan of group.scans) {
        if (checked) next.add(scan.id);
        else next.delete(scan.id);
      }
      return next;
    });
  };

  const handlePickDestination = async () => {
    const picked = await window.electron.config.browseDirectory();
    if (picked) setDestinationDir(picked);
  };

  const canExport =
    !exporting && selectedScanIds.size > 0 && destinationDir !== null;

  const handleExport = useCallback(async () => {
    if (exporting || selectedScanIds.size === 0 || !destinationDir) return;

    // The completion banner (in particular a `partial` banner's failed-scan
    // list) is the only record of what failed in the last run — nothing is
    // persisted to disk. Starting a new export silently replaces it, so
    // confirm before discarding one the user hasn't dismissed yet.
    if (
      resultBanner &&
      resultBanner.type !== 'success' &&
      !window.confirm(
        'The previous export had failures you have not dismissed. Starting a new export will replace that summary. Continue?'
      )
    ) {
      return;
    }

    setExporting(true);
    setResultBanner(null);
    setProgress(null);

    try {
      const result = await window.electron.database.scans.export(
        Array.from(selectedScanIds),
        destinationDir
      );

      if (!result.success) {
        setResultBanner({
          type: 'error',
          message: result.error || 'Export failed',
        });
        return;
      }

      const data = result.data!;
      if (data.failedScans.length > 0) {
        setResultBanner({
          type: 'partial',
          exportedFiles: data.exportedFiles,
          skippedFiles: data.skippedFiles,
          failedScans: data.failedScans,
        });
      } else {
        setResultBanner({
          type: 'success',
          exportedFiles: data.exportedFiles,
          skippedFiles: data.skippedFiles,
        });
      }
      setSelectedScanIds(new Set());
    } catch (err) {
      console.error('Error exporting scans:', err);
      setResultBanner({
        type: 'error',
        message: 'An unexpected error occurred during export',
      });
    } finally {
      setExporting(false);
    }
  }, [exporting, selectedScanIds, destinationDir]);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Export Scans</h1>

      {/* Destination picker */}
      <div className="mb-6 p-4 bg-white border rounded-lg shadow-sm flex items-center gap-4">
        <button
          type="button"
          onClick={handlePickDestination}
          disabled={exporting}
          className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Choose Destination
        </button>
        <span className="text-sm text-gray-600">
          {destinationDir || 'No destination selected'}
        </span>
      </div>

      {loadError && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{loadError}</p>
        </div>
      )}

      {exporting && (
        <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-sm font-medium text-yellow-800">
            Do not disconnect the destination (e.g. a USB drive) until the
            export finishes.
          </p>
          {progress && (
            <p className="text-sm text-yellow-700 mt-1">
              {progress.completedFiles} of {progress.totalFiles} files
              processed…
            </p>
          )}
        </div>
      )}

      {resultBanner && (
        <div
          className={`mb-4 p-4 border rounded-lg ${
            resultBanner.type === 'error'
              ? 'bg-red-50 border-red-200'
              : resultBanner.type === 'partial'
                ? 'bg-yellow-50 border-yellow-200'
                : 'bg-green-50 border-green-200'
          }`}
        >
          {resultBanner.type === 'error' ? (
            <p className="text-sm text-red-600">{resultBanner.message}</p>
          ) : (
            <>
              <p className="text-sm text-gray-800">
                {resultBanner.exportedFiles} exported,{' '}
                {resultBanner.skippedFiles} skipped (already exist)
              </p>
              {resultBanner.type === 'partial' && (
                <div className="mt-2">
                  <p className="text-sm font-medium text-red-700">
                    {resultBanner.failedScans.length} scan
                    {resultBanner.failedScans.length === 1 ? '' : 's'} failed:
                  </p>
                  <ul className="list-disc list-inside text-sm text-red-600">
                    {resultBanner.failedScans.map((f) => (
                      <li key={f.scanId}>
                        {f.experimentName} — {timestampLabel(f.captureDate)}:{' '}
                        {f.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => setResultBanner(null)}
            className="mt-2 text-xs text-gray-500 hover:text-gray-700 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-600">
          {selectedScanIds.size} scan{selectedScanIds.size === 1 ? '' : 's'}{' '}
          selected
        </p>
        <button
          type="button"
          onClick={handleExport}
          disabled={!canExport}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {exporting ? 'Exporting…' : `Export ${selectedScanIds.size} scan(s)`}
        </button>
      </div>

      <div className="bg-white border rounded-lg shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="h-96 flex items-center justify-center">
            <p className="text-sm text-gray-500">Loading scans...</p>
          </div>
        ) : groups.length === 0 ? (
          <div className="h-96 flex items-center justify-center">
            <p className="text-sm text-gray-500">No scans to export</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {groups.map((group) => {
              const allSelected = group.scans.every((s) =>
                selectedScanIds.has(s.id)
              );
              const someSelected = group.scans.some((s) =>
                selectedScanIds.has(s.id)
              );
              return (
                <div key={group.key}>
                  <div className="px-4 py-3 bg-gray-50 flex items-center gap-3">
                    <GroupHeaderCheckbox
                      allSelected={allSelected}
                      someSelected={someSelected}
                      onChange={(checked) => handleSelectGroup(group, checked)}
                    />
                    <span className="text-sm font-medium text-gray-700">
                      {group.label} ({group.scans.length} scan
                      {group.scans.length === 1 ? '' : 's'})
                    </span>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {group.scans.map((scan) => (
                      <div
                        key={scan.id}
                        className="px-4 py-2 pl-10 flex items-center gap-3 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={selectedScanIds.has(scan.id)}
                          onChange={(e) =>
                            handleSelectScan(scan.id, e.target.checked)
                          }
                          className="w-4 h-4 rounded border-gray-300"
                        />
                        <span className="text-gray-700">{scan.plant_id}</span>
                        <span className="text-gray-500">
                          {timestampLabel(scan.capture_date)}
                        </span>
                        <span
                          className="text-xs text-gray-400"
                          title="Capturing scanner — shown because this list is not scoped to the current machine's scanner"
                        >
                          {scan.scanner_name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
