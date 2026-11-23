import { useEffect, useMemo, useState, useCallback } from 'react';
import type { ScansExportProgress } from '../types/database';
import type { ScanFilter } from '../types/scan-groups';
import { ExportExperimentList } from './components/export/ExportExperimentList';
import {
  ExportSearch,
  NO_SEARCH,
  type ExportSearchValues,
} from './components/export/ExportSearch';
import { useExportExperiments } from './hooks/useExportExperiments';
import { useExportScanTree } from './hooks/useExportScanTree';
import {
  ExportResultBanner,
  type ResultBanner,
} from './components/export/ExportResultBanner';

/** How long typing pauses before the search runs. */
export const SEARCH_WAIT_MS = 300;

const plural = (n: number, word: string) =>
  `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

export function Export() {
  // Experiments with their scan counts: all the page loads when it opens (#436),
  // narrowed by the search and dates (#471); typing waits for a pause.
  const [searchValues, setSearchValues] =
    useState<ExportSearchValues>(NO_SEARCH);
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(
      () => setSearch(searchValues.search.trim()),
      SEARCH_WAIT_MS
    );
    return () => clearTimeout(timer);
  }, [searchValues.search]);
  const { dateFrom, dateTo } = searchValues;
  const filter = useMemo<ScanFilter>(
    () => ({
      ...(search ? { search } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
    }),
    [search, dateFrom, dateTo]
  );
  const list = useExportExperiments(filter);
  const experiments = list.experiments ?? [];
  const isLoading = list.experiments === null && !list.loadError;
  const loadError = list.loadError;
  const tree = useExportScanTree(filter);
  const selectedScanIds = tree.selected;
  const [destinationDir, setDestinationDir] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<ScansExportProgress | null>(null);
  const [resultBanner, setResultBanner] = useState<ResultBanner | null>(null);

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

  const handlePickDestination = async () => {
    const picked = await window.electron.config.browseDirectory();
    if (picked) setDestinationDir(picked);
  };

  // A ticked experiment or day is loading its scans: wait for the whole selection.
  const selecting = tree.pending > 0;
  const canExport =
    !exporting &&
    !selecting &&
    selectedScanIds.size > 0 &&
    destinationDir !== null;

  const handleExport = useCallback(async () => {
    if (exporting || selecting || selectedScanIds.size === 0 || !destinationDir)
      return;

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
          exportedScans: data.exportedScans,
          exportedFiles: data.exportedFiles,
          skippedFiles: data.skippedFiles,
          failedScans: data.failedScans,
        });
      } else {
        setResultBanner({
          type: 'success',
          exportedScans: data.exportedScans,
          exportedFiles: data.exportedFiles,
          skippedFiles: data.skippedFiles,
        });
      }
      tree.clearSelection();
    } catch (err) {
      console.error('Error exporting scans:', err);
      setResultBanner({
        type: 'error',
        message: 'An unexpected error occurred during export',
      });
    } finally {
      setExporting(false);
    }
  }, [
    exporting,
    selecting,
    selectedScanIds,
    destinationDir,
    tree.clearSelection,
  ]);

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
        <ExportResultBanner
          banner={resultBanner}
          onDismiss={() => setResultBanner(null)}
        />
      )}

      <ExportSearch
        values={searchValues}
        onChange={setSearchValues}
        disabled={exporting}
      />

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-600">
          {list.filtered && list.experiments !== null && (
            <span className="mr-3" data-testid="filter-summary">
              Showing {plural(experiments.length, 'experiment')} ·{' '}
              {list.matchingScans.toLocaleString()} of{' '}
              {plural(list.totalScans, 'scan')}
            </span>
          )}
          {selectedScanIds.size} scan{selectedScanIds.size === 1 ? '' : 's'}{' '}
          selected
        </p>
        <button
          type="button"
          onClick={handleExport}
          disabled={!canExport}
          className="px-4 py-2 bg-lime-700 text-white rounded-md hover:bg-lime-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {exporting ? 'Exporting…' : `Export ${selectedScanIds.size} scan(s)`}
        </button>
      </div>

      <div className="bg-white border rounded-lg shadow-sm overflow-hidden">
        {isLoading ? (
          <div
            role="status"
            className="h-96 flex flex-col items-center justify-center gap-3"
          >
            <div
              aria-hidden="true"
              className="h-8 w-8 animate-spin rounded-full border-4 border-lime-200 border-t-lime-700"
            />
            <p className="text-sm font-medium text-gray-700">
              {list.filtered ? 'Searching scans…' : 'Loading experiments…'}
            </p>
          </div>
        ) : experiments.length === 0 ? (
          <div className="h-96 flex flex-col items-center justify-center gap-3">
            <p className="text-sm text-gray-500">
              {loadError
                ? 'Experiments could not be loaded'
                : list.filtered
                  ? 'No scans match this search'
                  : 'No scans to export'}
            </p>
            {list.filtered && (
              <button
                type="button"
                onClick={() => setSearchValues(NO_SEARCH)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Clear search
              </button>
            )}
          </div>
        ) : (
          <ExportExperimentList
            experiments={experiments}
            tree={tree}
            disabled={exporting}
          />
        )}
      </div>
    </div>
  );
}
