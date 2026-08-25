import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWaveMetadataLinks } from './hooks/useWaveMetadataLinks';
import {
  BoxBackupProgress,
  BOX_COLLISION_ERROR_MARKER,
} from '../types/graviscan';
import {
  computeDistinctValueSummary,
  computeNameList,
  computeDateRange,
  computeImageCountBreakdown,
  capForDisplay,
  formatDateRange,
} from './utils/graviExperimentSummary';

interface GraviExperimentScan {
  scanner_id: string;
  plate_index: string;
  cycle_number?: number | null;
  resolution: number;
  grid_mode: string;
  capture_date: string | Date;
  phenotyper?: { name: string } | null;
}

interface GraviExperimentRow {
  id: string;
  name: string;
  hasNeedsReview: boolean;
  scientist?: { name: string } | null;
  accession?: { id: string; name: string } | null;
  graviScans?: GraviExperimentScan[];
}

interface Filters {
  dateFrom: string;
  dateTo: string;
  experimentName: string;
  accession: string;
  uploadStatus: string;
}

const PAGE_SIZE = 20;

function BackupToBoxButton({
  scanActive,
  backingUp,
  onClick,
}: {
  scanActive: boolean;
  backingUp: boolean;
  onClick: () => void;
}) {
  const disabled = scanActive || backingUp;
  const label = scanActive
    ? 'Scan in progress...'
    : backingUp
      ? 'Backing up...'
      : 'Backup to Box';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {label}
    </button>
  );
}

function ExperimentRow({
  experiment,
  boxProgress,
}: {
  experiment: GraviExperimentRow;
  boxProgress?: BoxBackupProgress;
}) {
  const navigate = useNavigate();
  const { links, linkError } = useWaveMetadataLinks(experiment.id);
  const [selectedWave, setSelectedWave] = useState<string>('');
  const [divergedWaves, setDivergedWaves] = useState<number[]>([]);
  const [downloadResult, setDownloadResult] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const scans = experiment.graviScans ?? [];
  const phenotyperNames = computeNameList(
    scans.map((s) => s.phenotyper?.name).filter((n): n is string => !!n)
  );
  const resolutionSummary = computeDistinctValueSummary(
    scans.map((s) => s.resolution)
  );
  const gridModeSummary = computeDistinctValueSummary(
    scans.map((s) => s.grid_mode)
  );
  const dateRange = computeDateRange(scans.map((s) => s.capture_date));
  const imageBreakdown = computeImageCountBreakdown(scans);
  const phenotyperDisplay = capForDisplay(phenotyperNames.values);
  const resolutionDisplay = capForDisplay(resolutionSummary.values);
  const gridModeDisplay = capForDisplay(gridModeSummary.values);

  const handleDownload = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      const waveNumber = selectedWave === '' ? undefined : Number(selectedWave);
      // "All Waves" must warn about every diverged wave, not just check the
      // (nonexistent) selected one — a single-wave selection only checks
      // that one wave's link.
      const diverged =
        waveNumber === undefined
          ? links
              .filter((l) => l.accession_id !== experiment.accession?.id)
              .map((l) => l.wave_number)
          : links
              .filter(
                (l) =>
                  l.wave_number === waveNumber &&
                  l.accession_id !== experiment.accession?.id
              )
              .map((l) => l.wave_number);
      setDivergedWaves(diverged);
      const result = await window.electron.gravi.downloadImages({
        experimentId: experiment.id,
        experimentName: experiment.name,
        waveNumber,
      });
      if (!result.success) {
        setDownloadResult(`Download failed: ${result.error}`);
        return;
      }
      const inner = result.data;
      if (inner.success) {
        setDownloadResult(
          `Downloaded ${inner.copied} of ${inner.total} image(s)`
        );
      } else if (inner.copied > 0) {
        // errors.length===0 is downloadImages()'s own success criterion, so
        // success:false with copied>0 means some files DID land on disk —
        // reporting a flat "Download failed" here would falsely imply
        // nothing happened. Every distinct error is listed, not just the
        // first, matching this same file's Box-backup precedent.
        setDownloadResult(
          `Downloaded ${inner.copied} of ${inner.total} image(s), ${inner.errors.length} error(s): ${inner.errors.join('; ')}`
        );
      } else {
        setDownloadResult(
          `Download failed: ${inner.errors?.join('; ') ?? 'unknown error'}`
        );
      }
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="bg-white border rounded-lg shadow-sm p-4 hover:bg-gray-50">
      <div className="flex flex-wrap items-baseline gap-2 mb-1">
        <span className="font-medium">{experiment.name}</span>
        {experiment.hasNeedsReview && (
          <span className="text-xs font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
            Needs Review
          </span>
        )}
        <span className="text-sm text-gray-600">
          {experiment.scientist?.name ?? 'unknown'}
        </span>
        <span className="text-sm text-gray-600">
          {experiment.accession?.name ?? ''}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600 mb-2">
        {phenotyperNames.values.length > 0 && (
          <span title={phenotyperDisplay.title}>
            {phenotyperDisplay.display}
          </span>
        )}
        {dateRange && <span>{formatDateRange(dateRange)}</span>}
        {scans.length > 0 && (
          <span>
            {imageBreakdown.totalImages} images ({imageBreakdown.scannerCount}{' '}
            scanners &times; {imageBreakdown.plateCount} plates &times;{' '}
            {imageBreakdown.cycleCount} cycles)
            {imageBreakdown.scansWithoutCycle > 0 &&
              ` (+${imageBreakdown.scansWithoutCycle} without a cycle number)`}
          </span>
        )}
        {resolutionSummary.values.length > 0 && (
          <span
            title={resolutionDisplay.title}
            className="inline-flex items-center gap-1"
          >
            {resolutionDisplay.display}
            {resolutionSummary.isMixed && (
              <span
                data-testid="mixed-value-indicator-resolution"
                className="text-xs font-medium text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded"
              >
                &ne;
              </span>
            )}
          </span>
        )}
        {gridModeSummary.values.length > 0 && (
          <span
            title={gridModeDisplay.title}
            className="inline-flex items-center gap-1"
          >
            {gridModeDisplay.display}
            {gridModeSummary.isMixed && (
              <span
                data-testid="mixed-value-indicator-grid-mode"
                className="text-xs font-medium text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded"
              >
                &ne;
              </span>
            )}
          </span>
        )}
        {boxProgress && (
          <span className="text-blue-600">
            Box {boxProgress.completedImages}/{boxProgress.totalImages}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`wave-select-${experiment.id}`} className="text-sm">
          Wave
        </label>
        <select
          id={`wave-select-${experiment.id}`}
          aria-label="Wave"
          value={selectedWave}
          onChange={(e) => setSelectedWave(e.target.value)}
          className="p-1 rounded-md bg-white text-sm border border-gray-300 focus:outline-none"
        >
          <option value="">All Waves</option>
          {links.map((l) => (
            <option key={l.wave_number} value={l.wave_number}>
              Wave {l.wave_number}
            </option>
          ))}
        </select>
        <button
          onClick={handleDownload}
          disabled={!!linkError || isDownloading}
          title={
            linkError
              ? 'Download is disabled until this is resolved — see the error above for details.'
              : undefined
          }
          className="px-3 py-1 text-sm border rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isDownloading ? 'Downloading...' : 'Download'}
        </button>
        <button
          onClick={() => navigate(`/graviscan-experiment/${experiment.id}`)}
          className="px-3 py-1 text-sm text-blue-600 hover:text-blue-800 hover:underline"
        >
          View Images
        </button>
      </div>
      {linkError && <p className="text-sm text-red-600 mt-1">{linkError}</p>}
      {downloadResult && (
        <p className="text-sm text-gray-600 mt-1">{downloadResult}</p>
      )}
      {divergedWaves.length > 0 && (
        <p className="text-sm text-amber-600 mt-1">
          {divergedWaves.length > 1
            ? `Waves ${divergedWaves.join(', ')}'s`
            : `Wave ${divergedWaves[0]}'s`}{' '}
          linked metadata differs from the experiment&apos;s default accession —
          the downloaded CSV will reflect the default accession, not{' '}
          {divergedWaves.length > 1 ? 'those waves' : 'this wave'}&apos;s link.
        </p>
      )}
    </div>
  );
}

const EMPTY_FILTERS: Filters = {
  dateFrom: '',
  dateTo: '',
  experimentName: '',
  accession: '',
  uploadStatus: '',
};

export function BrowseGraviScans() {
  const [experiments, setExperiments] = useState<GraviExperimentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  const [scanActive, setScanActive] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [backupIsError, setBackupIsError] = useState(false);
  const [boxProgress, setBoxProgress] = useState<
    Record<string, BoxBackupProgress>
  >({});

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchExperiments = useCallback(
    async (currentFilters: Filters, currentOffset: number) => {
      setIsLoading(true);
      const nonEmptyFilters = Object.fromEntries(
        Object.entries(currentFilters).filter(([, v]) => v !== '')
      );
      const result =
        await window.electron.database.graviscans.browseByExperiment({
          offset: currentOffset,
          limit: PAGE_SIZE,
          filters: nonEmptyFilters,
        });
      if (result.success) {
        setError(null);
        setExperiments(result.data.experiments);
        setTotal(result.data.total);
      } else {
        setError(result.error ?? 'Failed to load GraviScan experiments');
      }
      setIsLoading(false);
    },
    []
  );

  useEffect(() => {
    fetchExperiments(filters, offset);
  }, [offset, fetchExperiments]);

  const updateFilter = (key: keyof Filters, value: string) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    setOffset(0);

    if (key === 'uploadStatus') {
      fetchExperiments(next, 0);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchExperiments(next, 0);
    }, 300);
  };

  const hasActiveFilter = Object.values(filters).some((v) => v !== '');

  const handleClearFilters = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setFilters(EMPTY_FILTERS);
    setOffset(0);
    fetchExperiments(EMPTY_FILTERS, 0);
  };

  // Backup-result banner: dismissable always; auto-clears after 4s only on
  // success — matching BrowseScans.tsx's actual convention (its dedicated
  // successMessage state auto-clears; its separate error state does not).
  // A Box failure/collision needs manual resolution and has no other
  // durable trace in this UI today, so it must persist until dismissed.
  useEffect(() => {
    if (!backupMessage || backupIsError) return;
    const timer = setTimeout(() => setBackupMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [backupMessage, backupIsError]);

  // Scan-active detection: one getScanStatus() call on mount (handles
  // mounting mid-scan) plus subscribing to push events — no polling
  // (design.md Decision 6).
  useEffect(() => {
    window.electron.gravi.getScanStatus().then((result) => {
      if (result.success) {
        setScanActive(result.data.isActive);
      }
    });
    const offStart = window.electron.gravi.onIntervalStart(() =>
      setScanActive(true)
    );
    const offComplete = window.electron.gravi.onIntervalComplete(() =>
      setScanActive(false)
    );
    const offCancelled = window.electron.gravi.onCancelled(() =>
      setScanActive(false)
    );
    return () => {
      offStart();
      offComplete();
      offCancelled();
    };
  }, []);

  useEffect(() => {
    const off = window.electron.gravi.onUploadProgress((progress) => {
      if (!progress.currentExperiment) return;
      setBoxProgress((prev) => ({
        ...prev,
        [progress.currentExperiment]: progress,
      }));
    });
    return off;
  }, []);

  const handleBackupToBox = async () => {
    setBackingUp(true);
    setBackupMessage(null);
    setBackupIsError(false);
    try {
      const response = await window.electron.gravi.uploadAllScans();
      if (response.success === false) {
        setBackupMessage(`Backup failed: ${response.error}`);
        setBackupIsError(true);
        return;
      }
      const result = response.data;
      if (result.boxErrors?.includes('rclone not installed')) {
        // Box-specific and reported as such regardless of Bloom's outcome,
        // but Bloom runs independently — note it too rather than silently
        // dropping real Bloom uploads/failures from the message. An
        // explicit "up to date" note (not blank) when Bloom succeeded with
        // nothing pending avoids leaving the operator to wonder whether
        // Bloom was even checked.
        const bloomNote = !result.bloomSuccess
          ? ` Bloom also failed: ${result.bloomErrors?.[0] ?? 'unknown error'}.`
          : result.bloomUploaded > 0
            ? ` Bloom: ${result.bloomUploaded} uploaded.`
            : ' Bloom: up to date (nothing to upload).';
        setBackupMessage(
          `Box backup unavailable (rclone not installed).${bloomNote}`
        );
        setBackupIsError(true);
      } else if (!result.bloomSuccess || !result.boxSuccess) {
        // Bloom and Box run independently (Promise.allSettled), so either
        // can fail alone or both can fail together (e.g. a network outage
        // taking out both at once) — checked directly on the per-target
        // success flags, not gated on `uploaded > 0`, so a total dual
        // failure (nothing uploaded at all) still names both systems
        // instead of falling through to a generic message that only shows
        // the first error and attributes it to neither. Name which
        // system(s) actually failed so an operator never mistakes a Bloom
        // (database) failure for a Box (offsite copy) one or vice versa.
        const failures: string[] = [];
        if (!result.bloomSuccess) {
          failures.push(
            `Bloom failed: ${result.bloomErrors?.[0] ?? 'unknown error'}`
          );
        }
        if (!result.boxSuccess) {
          // A filename-collision error needs different operator action
          // than an ordinary transient failure (rename a file and
          // manually reset status, vs. just retry) — surfacing only
          // whichever wave happened to be processed first would let a
          // collision silently hide behind an unrelated earlier error,
          // leaving the operator to keep retrying without ever learning
          // a different image needs manual attention. A backup run can
          // also produce MULTIPLE distinct collisions across different
          // waves/experiments — showing only the first of those has the
          // same problem one level up: the operator renames one file,
          // retries, and is surprised by a second never-previewed
          // collision. Every collision message is therefore shown, not
          // just one.
          const collisionErrors = result.boxErrors?.filter((e) =>
            e.includes(BOX_COLLISION_ERROR_MARKER)
          );
          const boxError =
            collisionErrors && collisionErrors.length > 0
              ? collisionErrors.join(' | ')
              : (result.boxErrors?.[0] ?? 'unknown error');
          failures.push(`Box failed: ${boxError}`);
        }
        // `failures` is always non-empty here: entry into this branch
        // requires !bloomSuccess || !boxSuccess, and each of those exact
        // conditions is what pushes to `failures` above.
        setBackupMessage(
          `${result.uploaded} uploaded, ${result.errors?.length ?? 0} error(s) — ${failures.join('; ')}`
        );
        setBackupIsError(true);
      } else if (!result.success) {
        // Whole-operation failures that never got as far as uploading or
        // failing individual images — e.g. the uploadInProgress guard
        // ({uploaded:0, failed:0, errors:['Upload already in progress']})
        // — would otherwise match neither branch above nor below and be
        // misreported as a successful no-op upload. Neither target is at
        // fault here (bloomSuccess/boxSuccess are both true), so this stays
        // system-agnostic rather than naming Bloom or Box.
        setBackupMessage(
          `Backup failed: ${result.errors?.[0] ?? 'unknown error'}`
        );
        setBackupIsError(true);
      } else {
        setBackupMessage(
          `Uploaded ${result.uploaded} image(s), ${result.skipped} skipped`
        );
      }
    } catch (error) {
      setBackupMessage(
        `Backup failed: ${error instanceof Error ? error.message : 'unknown error'}`
      );
      setBackupIsError(true);
    } finally {
      setBackingUp(false);
    }
  };

  if (error) {
    return <p>{error}</p>;
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Browse GraviScans</h1>

      <div className="mb-4 p-4 bg-white border rounded-lg shadow-sm">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label
              htmlFor="filter-date-from"
              className="block text-xs font-bold mb-1"
            >
              Date From
            </label>
            <input
              id="filter-date-from"
              type="date"
              value={filters.dateFrom}
              onChange={(e) => updateFilter('dateFrom', e.target.value)}
              className="p-2 rounded-md bg-white text-sm border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label
              htmlFor="filter-date-to"
              className="block text-xs font-bold mb-1"
            >
              Date To
            </label>
            <input
              id="filter-date-to"
              type="date"
              value={filters.dateTo}
              onChange={(e) => updateFilter('dateTo', e.target.value)}
              className="p-2 rounded-md bg-white text-sm border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label
              htmlFor="filter-experiment-name"
              className="block text-xs font-bold mb-1"
            >
              Experiment Name
            </label>
            <input
              id="filter-experiment-name"
              aria-label="Experiment Name"
              value={filters.experimentName}
              onChange={(e) => updateFilter('experimentName', e.target.value)}
              className="w-full p-2 rounded-md bg-white text-sm border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label
              htmlFor="filter-accession"
              className="block text-xs font-bold mb-1"
            >
              Accession
            </label>
            <input
              id="filter-accession"
              aria-label="Accession"
              value={filters.accession}
              onChange={(e) => updateFilter('accession', e.target.value)}
              className="w-full p-2 rounded-md bg-white text-sm border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label
              htmlFor="filter-upload-status"
              className="block text-xs font-bold mb-1"
            >
              Upload Status
            </label>
            <select
              id="filter-upload-status"
              aria-label="Upload Status"
              value={filters.uploadStatus}
              onChange={(e) => updateFilter('uploadStatus', e.target.value)}
              className="p-2 rounded-md bg-white text-sm border border-gray-300 focus:outline-none"
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="uploaded">Uploaded</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          {hasActiveFilter && (
            <button
              onClick={handleClearFilters}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <BackupToBoxButton
          scanActive={scanActive}
          backingUp={backingUp}
          onClick={handleBackupToBox}
        />
        {backupMessage && (
          <p className="text-sm text-gray-700 flex items-center gap-2">
            {backupMessage}
            <button
              onClick={() => setBackupMessage(null)}
              className="text-gray-500 hover:text-gray-700 text-xs underline"
            >
              Dismiss
            </button>
          </p>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading experiments...</p>
      ) : experiments.length === 0 ? (
        <p className="text-sm text-gray-500">No GraviScan data is present</p>
      ) : (
        <>
          <p className="mb-2 text-sm text-gray-600">
            Showing {experiments.length} of {total} experiments, page{' '}
            {Math.floor(offset / PAGE_SIZE) + 1} of{' '}
            {Math.max(1, Math.ceil(total / PAGE_SIZE))}
          </p>
          <div className="space-y-3">
            {experiments.map((exp) => (
              <ExperimentRow
                key={exp.id}
                experiment={exp}
                // box-backup.ts's progress payload identifies the in-flight
                // experiment by name (currentExperiment), not id — there is
                // no id in the payload to key by.
                boxProgress={boxProgress[exp.name]}
              />
            ))}
          </div>
        </>
      )}

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          disabled={offset === 0}
          className="px-3 py-1 text-sm border rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Previous
        </button>
        <button
          onClick={() => setOffset((o) => o + PAGE_SIZE)}
          disabled={offset + PAGE_SIZE >= total}
          className="px-3 py-1 text-sm border rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  );
}
