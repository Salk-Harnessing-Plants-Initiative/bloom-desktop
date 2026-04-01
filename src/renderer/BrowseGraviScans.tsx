import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ExperimentWithScans } from '../types/graviscan';

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 300;

interface Filters {
  dateFrom: string;
  dateTo: string;
  experimentName: string;
  accession: string;
  uploadStatus: string;
}

const emptyFilters: Filters = {
  dateFrom: '',
  dateTo: '',
  experimentName: '',
  accession: '',
  uploadStatus: '',
};

export function BrowseGraviScans() {
  const navigate = useNavigate();
  const [experiments, setExperiments] = useState<ExperimentWithScans[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    total: number;
    completed: number;
    failed: number;
  } | null>(null);
  const [boxProgress, setBoxProgress] = useState<{
    totalImages: number;
    completedImages: number;
    failedImages: number;
  } | null>(null);
  const [scanActive, setScanActive] = useState(false);

  // Wave selector per experiment: expId -> selected wave number (default 0)
  const [selectedWaves, setSelectedWaves] = useState<
    Record<string, number | 'all'>
  >({});

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchExperiments = useCallback(
    async (newOffset: number, currentFilters: Filters) => {
      setLoading(true);
      try {
        const filterParams: Record<string, string> = {};
        if (currentFilters.dateFrom)
          filterParams.dateFrom = currentFilters.dateFrom;
        if (currentFilters.dateTo) filterParams.dateTo = currentFilters.dateTo;
        if (currentFilters.experimentName)
          filterParams.experimentName = currentFilters.experimentName;
        if (currentFilters.accession)
          filterParams.accession = currentFilters.accession;
        if (currentFilters.uploadStatus)
          filterParams.uploadStatus = currentFilters.uploadStatus;

        const result =
          await window.electron.database.graviscans.browseByExperiment({
            offset: newOffset,
            limit: PAGE_SIZE,
            filters:
              Object.keys(filterParams).length > 0 ? filterParams : undefined,
          });

        if (result.success && result.data) {
          setExperiments(result.data);
          setTotal(result.total ?? 0);
        } else {
          setExperiments([]);
          setTotal(0);
        }
      } catch (err) {
        console.error('[BrowseScans] Failed to fetch:', err);
        setExperiments([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Initial fetch
  useEffect(() => {
    fetchExperiments(0, emptyFilters);
  }, [fetchExperiments]);

  // Poll scan status to disable backup button during active scan
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const status = await window.electron.graviscan.getScanStatus();
        if (!cancelled) setScanActive(status.isActive);
      } catch {
        /* ignore */
      }
    };
    check();
    const interval = setInterval(check, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Upload progress listeners
  useEffect(() => {
    const cleanupBloom = window.electron.graviscan.onUploadProgress(
      (progress) => {
        setUploadProgress({
          total: progress.total,
          completed: progress.completed,
          failed: progress.failed,
        });
      }
    );
    const cleanupBox = window.electron.graviscan.onBoxBackupProgress(
      (progress) => {
        setBoxProgress({
          totalImages: progress.totalImages,
          completedImages: progress.completedImages,
          failedImages: progress.failedImages,
        });
      }
    );
    return () => {
      cleanupBloom();
      cleanupBox();
    };
  }, []);

  // Clear debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Debounced filter change
  const handleFilterChange = useCallback(
    (key: keyof Filters, value: string) => {
      const newFilters = { ...filters, [key]: value };
      setFilters(newFilters);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (key === 'uploadStatus') {
        setOffset(0);
        fetchExperiments(0, newFilters);
      } else {
        debounceRef.current = setTimeout(() => {
          setOffset(0);
          fetchExperiments(0, newFilters);
        }, DEBOUNCE_MS);
      }
    },
    [filters, fetchExperiments]
  );

  const clearFilters = useCallback(() => {
    setFilters(emptyFilters);
    setOffset(0);
    fetchExperiments(0, emptyFilters);
  }, [fetchExperiments]);

  const handlePageChange = useCallback(
    (newOffset: number) => {
      setOffset(newOffset);
      fetchExperiments(newOffset, filters);
    },
    [filters, fetchExperiments]
  );

  const handleUploadAll = useCallback(async () => {
    setUploading(true);
    setUploadProgress(null);
    setUploadMessage('Backing up all pending scans to Box...');

    try {
      const result = await window.electron.graviscan.uploadAllScans();

      if (
        result.uploaded === 0 &&
        result.skipped === 0 &&
        result.failed === 0
      ) {
        setUploadMessage('No pending or failed scans to back up');
      } else if (result.success) {
        setUploadMessage(
          `Backed up ${result.uploaded} image${result.uploaded !== 1 ? 's' : ''} to Box` +
            (result.skipped > 0 ? `, ${result.skipped} skipped` : '')
        );
      } else {
        setUploadMessage(
          `Box backup completed with ${result.failed} error${result.failed !== 1 ? 's' : ''}` +
            (result.uploaded > 0 ? `, ${result.uploaded} backed up` : '') +
            (result.errors.length > 0 ? `: ${result.errors[0]}` : '')
        );
      }

      fetchExperiments(offset, filters);
    } catch (err) {
      setUploadMessage(
        `Box backup failed: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    } finally {
      setUploading(false);
      setUploadProgress(null);
      setBoxProgress(null);
      setTimeout(() => setUploadMessage(null), 5000);
    }
  }, [fetchExperiments, offset, filters]);

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasFilters = Object.values(filters).some((v) => v !== '');

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-gray-500">
          {total} experiment{total !== 1 ? 's' : ''} found
        </p>
        <button
          disabled={uploading || scanActive}
          onClick={handleUploadAll}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {uploading
            ? 'Backing up...'
            : scanActive
              ? 'Scan in progress...'
              : 'Backup to Box'}
        </button>
      </div>

      {scanActive && (
        <div className="mb-4 p-3 rounded-lg border bg-amber-50 border-amber-200">
          <p className="text-sm text-amber-700">
            Please wait, still saving scans...
          </p>
        </div>
      )}

      {/* Upload progress panel */}
      {uploading && (uploadProgress || boxProgress) && (
        <div className="mb-4 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
          {uploadProgress && (
            <div className="mb-2">
              <div className="flex justify-between text-xs font-medium text-gray-600 mb-1">
                <span>Bloom</span>
                <span>
                  {uploadProgress.completed}/{uploadProgress.total}
                  {uploadProgress.failed > 0
                    ? ` (${uploadProgress.failed} failed)`
                    : ''}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className={`h-3 rounded-full transition-all duration-300 ${uploadProgress.total > 0 && uploadProgress.completed === uploadProgress.total ? 'bg-green-500' : 'bg-blue-500'}`}
                  style={{
                    width: `${uploadProgress.total > 0 ? Math.round((uploadProgress.completed / uploadProgress.total) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          )}
          {boxProgress && (
            <div>
              <div className="flex justify-between text-xs font-medium text-gray-600 mb-1">
                <span>Box</span>
                <span>
                  {boxProgress.completedImages}/{boxProgress.totalImages}
                  {boxProgress.failedImages > 0
                    ? ` (${boxProgress.failedImages} failed)`
                    : ''}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className={`h-3 rounded-full transition-all duration-300 ${boxProgress.totalImages > 0 && boxProgress.completedImages === boxProgress.totalImages ? 'bg-green-500' : 'bg-amber-500'}`}
                  style={{
                    width: `${boxProgress.totalImages > 0 ? Math.round((boxProgress.completedImages / boxProgress.totalImages) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Upload message toast */}
      {!uploading && uploadMessage && (
        <div className="mb-4 p-3 bg-blue-50 text-blue-700 rounded-lg text-sm">
          {uploadMessage}
        </div>
      )}

      {/* Filter bar */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Date from
            </label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Date to
            </label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => handleFilterChange('dateTo', e.target.value)}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Experiment
            </label>
            <input
              type="text"
              value={filters.experimentName}
              onChange={(e) =>
                handleFilterChange('experimentName', e.target.value)
              }
              placeholder="Search..."
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Accession
            </label>
            <input
              type="text"
              value={filters.accession}
              onChange={(e) => handleFilterChange('accession', e.target.value)}
              placeholder="Search..."
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Upload status
            </label>
            <select
              value={filters.uploadStatus}
              onChange={(e) =>
                handleFilterChange('uploadStatus', e.target.value)
              }
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="uploaded">Uploaded</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="mt-3 text-sm text-blue-600 hover:text-blue-800"
          >
            Clear all filters
          </button>
        )}
      </div>

      {/* Experiment list */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">
          Loading experiments...
        </div>
      ) : experiments.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">
            {hasFilters
              ? 'No experiments match your filters'
              : 'No scans have been performed yet'}
          </p>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="mt-2 text-sm text-blue-600 hover:text-blue-800"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {experiments.map((exp) => {
            const totalImages = exp.scans.reduce(
              (sum, s) => sum + s.images.length,
              0
            );
            const uniqueWaves = [
              ...new Set(exp.scans.map((s) => s.wave_number)),
            ].sort((a, b) => a - b);
            const selectedWave = selectedWaves[exp.id] ?? 0;
            const allImages = exp.scans.flatMap((s) =>
              s.images.map((img) => ({
                ...img,
                scannerName:
                  s.scanner?.display_name || s.scanner?.name || 'Unknown',
                plateIndex: s.plate_index,
                captureDate: s.capture_date,
                transplantDate: s.transplant_date,
                customNote: s.custom_note,
              }))
            );

            // Date range
            const dates = exp.scans.map((s) =>
              new Date(s.capture_date).getTime()
            );
            const earliest = dates.length ? new Date(Math.min(...dates)) : null;
            const latest = dates.length ? new Date(Math.max(...dates)) : null;

            // Aggregate metadata from scans
            const phenotypers = [
              ...new Set(
                exp.scans.map((s) => s.phenotyper?.name).filter(Boolean)
              ),
            ];
            const resolutions = [
              ...new Set(exp.scans.map((s) => s.resolution)),
            ];
            const gridModes = [...new Set(exp.scans.map((s) => s.grid_mode))];

            // Derive image breakdown: scanners × plates × cycles
            const uniqueScanners = new Set(exp.scans.map((s) => s.scanner_id));
            const scannerCount = uniqueScanners.size;
            const platesPerScanner = gridModes.includes('4grid')
              ? 4
              : gridModes.includes('2grid')
                ? 2
                : 1;

            // Session info (from first scan that has a session)
            const session = exp.scans.find((s) => s.session)?.session;
            const isContinuous = session && session.scan_mode === 'continuous';
            const cycleCount =
              isContinuous && session.total_cycles ? session.total_cycles : 1;

            // Build image breakdown string
            const breakdownParts = [
              `${scannerCount} scanner${scannerCount !== 1 ? 's' : ''}`,
              `${platesPerScanner} plate${platesPerScanner !== 1 ? 's' : ''}`,
            ];
            if (isContinuous)
              breakdownParts.push(
                `${cycleCount} cycle${cycleCount !== 1 ? 's' : ''}`
              );
            const imageBreakdown = `${totalImages} (${breakdownParts.join(' × ')})`;

            // Session duration formatting
            const formatDuration = (seconds: number) => {
              if (seconds >= 3600)
                return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
              if (seconds >= 60)
                return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
              return `${seconds}s`;
            };
            const actualDurationSeconds =
              session?.started_at && session?.completed_at
                ? Math.round(
                    (new Date(session.completed_at).getTime() -
                      new Date(session.started_at).getTime()) /
                      1000
                  )
                : null;

            return (
              <div
                key={exp.id}
                className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden"
              >
                <div className="flex">
                  {/* Left: Metadata */}
                  <div className="flex-1 p-4 border-r border-gray-100">
                    <h3 className="font-semibold text-gray-900 text-base truncate flex items-center gap-2">
                      {exp.name}
                      {exp.hasNeedsReview && (
                        <span className="text-xs font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                          Needs Review
                        </span>
                      )}
                    </h3>
                    {exp.scientist && (
                      <p className="text-sm text-gray-500 mt-0.5">
                        {exp.scientist.name}
                      </p>
                    )}

                    <div className="mt-3 space-y-1.5 text-xs text-gray-500">
                      {phenotypers.length > 0 && (
                        <div>
                          <span className="font-medium text-gray-600">
                            Phenotyper:
                          </span>{' '}
                          {phenotypers.join(', ')}
                        </div>
                      )}
                      {earliest && latest && (
                        <div>
                          <span className="font-medium text-gray-600">
                            Date:
                          </span>{' '}
                          {earliest.toLocaleDateString()}
                          {earliest.getTime() !== latest.getTime() &&
                            ` - ${latest.toLocaleDateString()}`}
                        </div>
                      )}
                      <div>
                        <span className="font-medium text-gray-600">
                          Images:
                        </span>{' '}
                        {imageBreakdown}
                      </div>
                      <div>
                        <span className="font-medium text-gray-600">
                          Resolution:
                        </span>{' '}
                        {resolutions.join(', ')} DPI
                        {' | '}
                        <span className="font-medium text-gray-600">
                          Grid:
                        </span>{' '}
                        {gridModes.join(', ')}
                      </div>
                      {isContinuous && session && (
                        <div>
                          <span className="font-medium text-gray-600">
                            Cycles:
                          </span>{' '}
                          {cycleCount}
                          {' | '}
                          <span className="font-medium text-gray-600">
                            Interval:
                          </span>{' '}
                          {session.interval_seconds
                            ? formatDuration(session.interval_seconds)
                            : '-'}
                          {' | '}
                          <span className="font-medium text-gray-600">
                            Set Duration:
                          </span>{' '}
                          {session.duration_seconds
                            ? formatDuration(session.duration_seconds)
                            : '-'}
                          {actualDurationSeconds !== null && (
                            <>
                              {' | '}
                              <span className="font-medium text-gray-600">
                                Actual:
                              </span>{' '}
                              {formatDuration(actualDurationSeconds)}
                            </>
                          )}
                        </div>
                      )}
                      {exp.accession && (
                        <div>
                          <span className="font-medium text-gray-600">
                            Accession:
                          </span>{' '}
                          {exp.accession.name}
                        </div>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => navigate(`/browse-scans/${exp.id}`)}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 transition-colors inline-flex items-center gap-1.5"
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M6.75 7.5a.75.75 0 11-1.5 0 .75.75 0 011.5 0z"
                          />
                        </svg>
                        View Images
                      </button>
                      <select
                        value={String(selectedWave)}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSelectedWaves((prev) => ({
                            ...prev,
                            [exp.id]: val === 'all' ? 'all' : Number(val),
                          }));
                        }}
                        className="px-2 py-1.5 bg-white text-gray-700 rounded text-xs border border-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="all">All Waves</option>
                        {uniqueWaves.map((w) => (
                          <option key={w} value={w}>
                            Wave {w}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={async () => {
                          const waveNum =
                            selectedWave === 'all' ? undefined : selectedWave;
                          const result =
                            await window.electron.graviscan.downloadImages({
                              experimentId: exp.id,
                              experimentName: exp.name,
                              waveNumber: waveNum,
                            });
                          if (result.errors?.[0] === 'Cancelled') return;
                          const waveLabel =
                            waveNum !== undefined ? ` (Wave ${waveNum})` : '';
                          if (result.copied > 0) {
                            alert(
                              `Downloaded ${result.copied} of ${result.total} images${waveLabel}.${result.errors?.length ? `\n${result.errors.length} files could not be copied.` : ''}`
                            );
                          } else if (result.total === 0) {
                            alert(
                              `No image files found to download${waveLabel}.`
                            );
                          } else {
                            alert(
                              `Download failed: ${result.errors?.join(', ') || 'Unknown error'}`
                            );
                          }
                        }}
                        className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-xs font-medium hover:bg-gray-200 transition-colors inline-flex items-center gap-1.5 border border-gray-300"
                        title={
                          selectedWave === 'all'
                            ? 'Download all waves'
                            : `Download Wave ${selectedWave}`
                        }
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                          />
                        </svg>
                        Download{' '}
                        {selectedWave === 'all'
                          ? 'All'
                          : `Wave ${selectedWave}`}
                      </button>
                    </div>
                  </div>

                  {/* Center: Upload progress (Bloom + Box) */}
                  {(() => {
                    const bloomCount = allImages.filter(
                      (img) => img.status === 'uploaded'
                    ).length;
                    const boxCount = allImages.filter(
                      (img) => img.box_status === 'uploaded'
                    ).length;
                    const bloomPct =
                      totalImages > 0
                        ? Math.round((bloomCount / totalImages) * 100)
                        : 0;
                    const boxPct =
                      totalImages > 0
                        ? Math.round((boxCount / totalImages) * 100)
                        : 0;
                    const allBloom =
                      totalImages > 0 && bloomCount === totalImages;
                    const allBox = totalImages > 0 && boxCount === totalImages;

                    return (
                      <div className="w-44 flex-shrink-0 flex flex-col items-center justify-center p-4 border-r border-gray-100 gap-2">
                        {/* Bloom status */}
                        <div className="w-full">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span
                              className={`text-xs font-medium ${allBloom ? 'text-green-600' : 'text-gray-500'}`}
                            >
                              Bloom {bloomCount}/{totalImages}
                            </span>
                            {allBloom && (
                              <svg
                                className="w-3.5 h-3.5 text-green-600"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M4.5 12.75l6 6 9-13.5"
                                />
                              </svg>
                            )}
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full transition-all ${allBloom ? 'bg-green-500' : 'bg-blue-500'}`}
                              style={{ width: `${bloomPct}%` }}
                            />
                          </div>
                        </div>
                        {/* Box status */}
                        <div className="w-full">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span
                              className={`text-xs font-medium ${allBox ? 'text-green-600' : 'text-gray-500'}`}
                            >
                              Box {boxCount}/{totalImages}
                            </span>
                            {allBox && (
                              <svg
                                className="w-3.5 h-3.5 text-green-600"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M4.5 12.75l6 6 9-13.5"
                                />
                              </svg>
                            )}
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full transition-all ${allBox ? 'bg-green-500' : 'bg-amber-500'}`}
                              style={{ width: `${boxPct}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-200">
          <button
            onClick={() => handlePageChange(offset - PAGE_SIZE)}
            disabled={offset === 0}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => handlePageChange(offset + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
