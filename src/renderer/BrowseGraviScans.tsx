import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ExperimentWithScans } from '../types/graviscan';
import { ImageLightbox } from './components/ImageLightbox';

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

function getExperimentUploadStatus(experiment: ExperimentWithScans): {
  label: string;
  color: string;
} {
  const allImages = experiment.scans.flatMap((s) => s.images);
  if (allImages.length === 0) return { label: 'No images', color: 'gray' };
  const statuses = allImages.map((img) => img.status);
  if (statuses.every((s) => s === 'uploaded'))
    return { label: 'Uploaded', color: 'green' };
  if (statuses.some((s) => s === 'failed'))
    return { label: 'Failed', color: 'red' };
  if (statuses.every((s) => s === 'pending'))
    return { label: 'Pending', color: 'gray' };
  return { label: 'Partial', color: 'yellow' };
}

const statusColors: Record<string, string> = {
  green: 'bg-green-100 text-green-800',
  red: 'bg-red-100 text-red-800',
  yellow: 'bg-yellow-100 text-yellow-800',
  gray: 'bg-gray-100 text-gray-600',
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
  const [uploadProgress, setUploadProgress] = useState<{ total: number; completed: number; failed: number } | null>(null);

  // Thumbnail cache: imagePath -> dataUri
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});

  // Full-resolution image cache: imagePath -> dataUri
  const [fullImages, setFullImages] = useState<Record<string, string>>({});
  const [fullImageLoading, setFullImageLoading] = useState(false);

  // Current image index per experiment: expId -> index
  const [galleryIndex, setGalleryIndex] = useState<Record<string, number>>({});

  // Lightbox state
  const [lightbox, setLightbox] = useState<{ expId: string; index: number } | null>(null);

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

  // Upload progress listener
  useEffect(() => {
    const cleanup = window.electron.graviscan.onUploadProgress((progress) => {
      setUploadProgress({ total: progress.total, completed: progress.completed, failed: progress.failed });
    });
    return cleanup;
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

  // Load a single image by path
  const loadImage = useCallback(
    async (imagePath: string) => {
      if (thumbnails[imagePath]) return;
      try {
        const result =
          await window.electron.graviscan.readScanImage(imagePath);
        if (result.success && result.dataUri) {
          setThumbnails((prev) => ({ ...prev, [imagePath]: result.dataUri }));
        }
      } catch {
        // Image load failed
      }
    },
    [thumbnails]
  );

  // Load a full-resolution image for lightbox viewing
  const loadFullImage = useCallback(
    async (imagePath: string) => {
      if (fullImages[imagePath]) return;
      setFullImageLoading(true);
      try {
        const result = await window.electron.graviscan.readScanImage(imagePath, { full: true });
        if (result.success && result.dataUri) {
          setFullImages((prev) => ({ ...prev, [imagePath]: result.dataUri }));
        }
      } catch {
        // Full image load failed — thumbnail will remain as fallback
      } finally {
        setFullImageLoading(false);
      }
    },
    [fullImages]
  );

  // Load the first image of each experiment on data change
  useEffect(() => {
    for (const exp of experiments) {
      const firstImage = exp.scans.flatMap((s) => s.images)[0];
      if (firstImage?.path) loadImage(firstImage.path);
    }
  }, [experiments, loadImage]);

  // Navigate gallery for an experiment
  const navigateGallery = useCallback(
    (expId: string, allImages: { path: string }[], direction: 'prev' | 'next') => {
      const current = galleryIndex[expId] || 0;
      const newIndex =
        direction === 'next'
          ? Math.min(current + 1, allImages.length - 1)
          : Math.max(current - 1, 0);

      setGalleryIndex((prev) => ({ ...prev, [expId]: newIndex }));

      // Load the image at the new index
      const img = allImages[newIndex];
      if (img?.path) loadImage(img.path);
    },
    [galleryIndex, loadImage]
  );

  const handleUploadAll = useCallback(async () => {
    setUploading(true);
    setUploadProgress(null);
    setUploadMessage('Uploading all pending scans...');

    try {
      const result = await window.electron.graviscan.uploadAllScans();

      if (result.uploaded === 0 && result.skipped === 0 && result.failed === 0) {
        setUploadMessage('No pending or failed scans to upload');
      } else if (result.success) {
        setUploadMessage(
          `Uploaded ${result.uploaded} image${result.uploaded !== 1 ? 's' : ''}` +
          (result.skipped > 0 ? `, ${result.skipped} skipped` : '') +
          ' successfully'
        );
      } else {
        setUploadMessage(
          `Upload completed with ${result.failed} error${result.failed !== 1 ? 's' : ''}` +
          (result.uploaded > 0 ? `, ${result.uploaded} uploaded` : '') +
          (result.errors.length > 0 ? `: ${result.errors[0]}` : '')
        );
      }

      fetchExperiments(offset, filters);
    } catch (err) {
      setUploadMessage(`Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setUploading(false);
      setUploadProgress(null);
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
          disabled={true}
          title="Cloud upload is not yet available — coming soon"
          className="px-4 py-2 bg-gray-400 text-white rounded-lg text-sm font-medium cursor-not-allowed opacity-60"
        >
          Upload to Bloom (Coming Soon)
        </button>
      </div>

      {/* Upload message toast */}
      {uploadMessage && (
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
            const status = getExperimentUploadStatus(exp);
            const totalImages = exp.scans.reduce(
              (sum, s) => sum + s.images.length,
              0
            );
            const allImages = exp.scans.flatMap((s) =>
              s.images.map((img) => ({
                ...img,
                scannerName: s.scanner?.display_name || s.scanner?.name || 'Unknown',
                plateIndex: s.plate_index,
                captureDate: s.capture_date,
                transplantDate: s.transplant_date,
                customNote: s.custom_note,
              }))
            );

            // Date range
            const dates = exp.scans.map(
              (s) => new Date(s.capture_date).getTime()
            );
            const earliest = dates.length
              ? new Date(Math.min(...dates))
              : null;
            const latest = dates.length
              ? new Date(Math.max(...dates))
              : null;

            // Aggregate metadata from scans
            const phenotypers = [
              ...new Set(exp.scans.map((s) => s.phenotyper?.name).filter(Boolean)),
            ];
            const resolutions = [
              ...new Set(exp.scans.map((s) => s.resolution)),
            ];
            const gridModes = [
              ...new Set(exp.scans.map((s) => s.grid_mode)),
            ];

            // Derive image breakdown: scanners × plates × cycles
            const uniqueScanners = new Set(exp.scans.map((s) => s.scanner_id));
            const scannerCount = uniqueScanners.size;
            const platesPerScanner = gridModes.includes('4grid') ? 4 : gridModes.includes('2grid') ? 2 : 1;

            // Session info (from first scan that has a session)
            const session = exp.scans.find((s) => s.session)?.session;
            const isContinuous = session && session.scan_mode === 'continuous';
            const cycleCount = isContinuous && session.total_cycles ? session.total_cycles : 1;

            // Build image breakdown string
            const breakdownParts = [`${scannerCount} scanner${scannerCount !== 1 ? 's' : ''}`, `${platesPerScanner} plate${platesPerScanner !== 1 ? 's' : ''}`];
            if (isContinuous) breakdownParts.push(`${cycleCount} cycle${cycleCount !== 1 ? 's' : ''}`);
            const imageBreakdown = `${totalImages} (${breakdownParts.join(' × ')})`;

            // Session duration formatting
            const formatDuration = (seconds: number) => {
              if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
              if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
              return `${seconds}s`;
            };
            const actualDurationSeconds = session?.started_at && session?.completed_at
              ? Math.round((new Date(session.completed_at).getTime() - new Date(session.started_at).getTime()) / 1000)
              : null;

            return (
              <div
                key={exp.id}
                className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden"
              >
                <div className="flex">
                  {/* Left: Metadata */}
                  <div className="flex-1 p-4 border-r border-gray-100">
                    <h3 className="font-semibold text-gray-900 text-base truncate">
                      {exp.name}
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
                          {session.interval_seconds ? formatDuration(session.interval_seconds) : '-'}
                          {' | '}
                          <span className="font-medium text-gray-600">
                            Set Duration:
                          </span>{' '}
                          {session.duration_seconds ? formatDuration(session.duration_seconds) : '-'}
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
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M6.75 7.5a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                        </svg>
                        View Images
                      </button>
                      <button
                        onClick={async () => {
                          const result = await window.electron.graviscan.downloadImages({
                            experimentId: exp.id,
                            experimentName: exp.name,
                          });
                          if (result.errors?.[0] === 'Cancelled') return;
                          if (result.copied > 0) {
                            alert(`Downloaded ${result.copied} of ${result.total} images.${result.errors?.length ? `\n${result.errors.length} files could not be copied.` : ''}`);
                          } else if (result.total === 0) {
                            alert('No image files found to download.');
                          } else {
                            alert(`Download failed: ${result.errors?.join(', ') || 'Unknown error'}`);
                          }
                        }}
                        className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-xs font-medium hover:bg-gray-200 transition-colors inline-flex items-center gap-1.5 border border-gray-300"
                        title="Download all images to a folder"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                        </svg>
                        Download Scans
                      </button>
                    </div>

                  </div>

                  {/* Center: Upload progress */}
                  {(() => {
                    const uploadedCount = allImages.filter((img) => img.status === 'uploaded').length;
                    const pct = totalImages > 0 ? Math.round((uploadedCount / totalImages) * 100) : 0;
                    const allUploaded = totalImages > 0 && uploadedCount === totalImages;

                    return (
                      <div className="w-40 flex-shrink-0 flex flex-col items-center justify-center p-4 border-r border-gray-100">
                        {allUploaded ? (
                          <svg className="w-8 h-8 text-green-600 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75l2.25 2.25L15 11.25" />
                          </svg>
                        ) : (
                          <svg className="w-8 h-8 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 10.5v6m0 0l-3-3m3 3l3-3" />
                          </svg>
                        )}
                        <div className="w-full bg-gray-200 rounded-full h-1.5 mb-1.5">
                          <div
                            className={`h-1.5 rounded-full transition-all ${allUploaded ? 'bg-green-500' : status.color === 'red' ? 'bg-red-400' : 'bg-blue-500'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className={`text-xs font-medium ${allUploaded ? 'text-green-600' : 'text-gray-500'}`}>
                          {uploadedCount}/{totalImages}
                        </span>
                      </div>
                    );
                  })()}

                  {/* Right: Single image with prev/next navigation */}
                  <div className="w-64 flex-shrink-0 flex items-center justify-center p-4">
                    {allImages.length === 0 ? (
                      <div className="text-gray-400 text-sm">No images</div>
                    ) : (() => {
                      const currentIdx = galleryIndex[exp.id] || 0;
                      const currentImg = allImages[currentIdx];
                      const thumbSrc = currentImg ? thumbnails[currentImg.path] : null;

                      return (
                        <div className="flex items-center gap-3">
                          {/* Prev button */}
                          <button
                            onClick={() => navigateGallery(exp.id, allImages, 'prev')}
                            disabled={currentIdx === 0}
                            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full border border-gray-300 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                          </button>

                          {/* Current image */}
                          <div className="text-center">
                            <div className="w-[160px] h-[120px] bg-gray-100 rounded-lg overflow-hidden">
                              {thumbSrc ? (
                                <img
                                  src={thumbSrc}
                                  alt={currentImg ? `${currentImg.scannerName} - ${currentImg.plateIndex}` : 'Scan'}
                                  className="w-full h-full object-cover cursor-pointer hover:opacity-80 transition-opacity"
                                  onClick={() => {
                                    setLightbox({ expId: exp.id, index: currentIdx });
                                    if (currentImg?.path) loadFullImage(currentImg.path);
                                  }}
                                />
                              ) : (
                                <div className="flex items-center justify-center w-full h-full text-gray-400 text-xs">
                                  Loading...
                                </div>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 mt-1.5">
                              {currentIdx + 1}/{allImages.length}
                            </p>
                            {currentImg && (
                              <p className="text-[10px] text-gray-400 mt-0.5">
                                {currentImg.scannerName} · Plate {currentImg.plateIndex}
                              </p>
                            )}
                          </div>

                          {/* Next button */}
                          <button
                            onClick={() => navigateGallery(exp.id, allImages, 'next')}
                            disabled={currentIdx === allImages.length - 1}
                            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full border border-gray-300 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (() => {
        const exp = experiments.find((e) => e.id === lightbox.expId);
        if (!exp) return null;
        const allImgs = exp.scans.flatMap((s) =>
          s.images.map((img) => ({
            ...img,
            scannerName: s.scanner?.display_name || s.scanner?.name || 'Unknown',
            plateIndex: s.plate_index,
            captureDate: s.capture_date,
            transplantDate: s.transplant_date,
            customNote: s.custom_note,
          }))
        );
        const img = allImgs[lightbox.index];
        const fullSrc = img ? fullImages[img.path] : null;
        const thumbSrc = img ? thumbnails[img.path] : null;
        const src = fullSrc || thumbSrc;
        if (!src) return null;

        return (
          <ImageLightbox
            src={src}
            loading={!fullSrc && fullImageLoading}
            alt={`${img.scannerName} - Plate ${img.plateIndex}`}
            caption={`${img.scannerName} · Plate ${img.plateIndex} · ${new Date(img.captureDate).toLocaleDateString()}${img.transplantDate ? ` · Transplant: ${new Date(img.transplantDate).toLocaleDateString()}` : ''}${img.customNote ? ` · ${img.customNote}` : ''}`}
            onClose={() => setLightbox(null)}
            onPrev={lightbox.index > 0 ? () => {
              const newIdx = lightbox.index - 1;
              const prevImg = allImgs[newIdx];
              if (prevImg?.path) {
                loadImage(prevImg.path);
                loadFullImage(prevImg.path);
              }
              setLightbox({ ...lightbox, index: newIdx });
            } : undefined}
            onNext={lightbox.index < allImgs.length - 1 ? () => {
              const newIdx = lightbox.index + 1;
              const nextImg = allImgs[newIdx];
              if (nextImg?.path) {
                loadImage(nextImg.path);
                loadFullImage(nextImg.path);
              }
              setLightbox({ ...lightbox, index: newIdx });
            } : undefined}
          />
        );
      })()}

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
