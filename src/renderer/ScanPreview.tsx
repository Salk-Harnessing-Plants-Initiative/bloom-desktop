import { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ScanWithRelations } from '../types/database';

// Zoom levels as specified in design.md
const ZOOM_LEVELS = [1, 1.5, 2, 3];

export function ScanPreview() {
  const { scanId } = useParams<{ scanId: string }>();

  // Data state
  const [scan, setScan] = useState<ScanWithRelations | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Image viewer state
  const [currentFrame, setCurrentFrame] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);

  // Fetch scan data
  const fetchScan = useCallback(async () => {
    if (!scanId) return;

    try {
      setIsLoading(true);
      setError(null);

      const result = await window.electron.database.scans.get(scanId);

      if (!result.success) {
        setError(result.error || 'Failed to load scan');
        return;
      }

      if (!result.data) {
        setError('Scan not found');
        return;
      }

      const scanData = result.data as ScanWithRelations;
      // Sort images by frame_number
      scanData.images.sort((a, b) => a.frame_number - b.frame_number);
      setScan(scanData);
    } catch (err) {
      console.error('Error fetching scan:', err);
      setError('An unexpected error occurred while loading scan');
    } finally {
      setIsLoading(false);
    }
  }, [scanId]);

  useEffect(() => {
    fetchScan();
  }, [fetchScan]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!scan || scan.images.length === 0) return;

      switch (e.key) {
        case 'ArrowRight':
          goToNextFrame();
          break;
        case 'ArrowLeft':
          goToPreviousFrame();
          break;
        case 'Home':
          setCurrentFrame(0);
          break;
        case 'End':
          setCurrentFrame(scan.images.length - 1);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [scan]);

  const goToNextFrame = () => {
    if (!scan) return;
    setCurrentFrame((prev) => Math.min(prev + 1, scan.images.length - 1));
  };

  const goToPreviousFrame = () => {
    setCurrentFrame((prev) => Math.max(prev - 1, 0));
  };

  const handleZoomIn = () => {
    const currentIndex = ZOOM_LEVELS.indexOf(zoomLevel);
    if (currentIndex < ZOOM_LEVELS.length - 1) {
      setZoomLevel(ZOOM_LEVELS[currentIndex + 1]);
    }
  };

  const handleZoomOut = () => {
    const currentIndex = ZOOM_LEVELS.indexOf(zoomLevel);
    if (currentIndex > 0) {
      setZoomLevel(ZOOM_LEVELS[currentIndex - 1]);
    }
  };

  const handleResetZoom = () => {
    setZoomLevel(1);
  };

  const formatDate = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="p-6">
        <div className="h-96 flex items-center justify-center">
          <p className="text-sm text-gray-500">Loading scan...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-6">
        <Link
          to="/browse-scans"
          className="text-blue-600 hover:text-blue-800 hover:underline mb-4 inline-block"
        >
          ← Back to Scans
        </Link>
        <div className="h-96 flex items-center justify-center">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  // No scan found
  if (!scan) {
    return (
      <div className="p-6">
        <Link
          to="/browse-scans"
          className="text-blue-600 hover:text-blue-800 hover:underline mb-4 inline-block"
        >
          ← Back to Scans
        </Link>
        <div className="h-96 flex items-center justify-center">
          <p className="text-sm text-gray-500">Scan not found</p>
        </div>
      </div>
    );
  }

  const currentImage = scan.images[currentFrame];
  const totalFrames = scan.images.length;

  return (
    <div className="p-6 h-full flex flex-col">
      {/* Header */}
      <div className="mb-4">
        <Link
          to="/browse-scans"
          className="text-blue-600 hover:text-blue-800 hover:underline mb-2 inline-block"
        >
          ← Back to Scans
        </Link>
        <h1 className="text-2xl font-bold">{scan.plant_id}</h1>
      </div>

      <div className="flex-1 flex gap-6 min-h-0">
        {/* Image Viewer */}
        <div className="flex-1 flex flex-col bg-white border rounded-lg shadow-sm overflow-hidden">
          {/* Toolbar */}
          <div className="p-3 border-b bg-gray-50 flex items-center justify-between">
            {/* Frame navigation */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={goToPreviousFrame}
                disabled={currentFrame === 0 || totalFrames === 0}
                className="px-3 py-1 text-sm border rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Previous frame"
              >
                ← Previous
              </button>
              <span className="text-sm text-gray-600 min-w-[60px] text-center">
                {totalFrames > 0
                  ? `${currentFrame + 1} / ${totalFrames}`
                  : 'No images'}
              </span>
              <button
                type="button"
                onClick={goToNextFrame}
                disabled={currentFrame >= totalFrames - 1 || totalFrames === 0}
                className="px-3 py-1 text-sm border rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Next frame"
              >
                Next →
              </button>
            </div>

            {/* Zoom controls */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleZoomOut}
                disabled={zoomLevel === ZOOM_LEVELS[0]}
                className="px-3 py-1 text-sm border rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Zoom out"
              >
                −
              </button>
              <span className="text-sm text-gray-600 min-w-[50px] text-center">
                {zoomLevel}x
              </span>
              <button
                type="button"
                onClick={handleZoomIn}
                disabled={zoomLevel === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
                className="px-3 py-1 text-sm border rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Zoom in"
              >
                +
              </button>
              <button
                type="button"
                onClick={handleResetZoom}
                className="px-3 py-1 text-sm border rounded-md hover:bg-gray-100"
                title="Reset zoom"
              >
                Fit
              </button>
            </div>
          </div>

          {/* Image display */}
          <div className="flex-1 overflow-auto bg-gray-100 flex items-center justify-center p-4">
            {totalFrames === 0 ? (
              <p className="text-sm text-gray-500">No images</p>
            ) : currentImage ? (
              <div
                style={{
                  transform: `scale(${zoomLevel})`,
                  transformOrigin: 'center center',
                  transition: 'transform 0.2s ease-out',
                }}
              >
                <img
                  src={`file://${currentImage.path}`}
                  alt={`Frame ${currentFrame + 1}`}
                  className="max-w-full max-h-full object-contain"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    if (target.parentElement) {
                      target.parentElement.innerHTML =
                        '<p class="text-sm text-gray-500">Image not found</p>';
                    }
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>

        {/* Metadata Panel */}
        <div className="w-80 bg-white border rounded-lg shadow-sm overflow-auto">
          <div className="p-4">
            <h2 className="text-lg font-semibold mb-4">Scan Details</h2>

            <div className="space-y-4">
              {/* Plant Info */}
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-2">
                  Plant Information
                </h3>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Plant ID</dt>
                    <dd className="font-medium">{scan.plant_id}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Accession</dt>
                    <dd className="font-medium">
                      {scan.accession_name || '-'}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Wave</dt>
                    <dd className="font-medium">{scan.wave_number}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Age (days)</dt>
                    <dd className="font-medium">{scan.plant_age_days}</dd>
                  </div>
                </dl>
              </div>

              {/* Experiment Info */}
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-2">
                  Experiment
                </h3>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Name</dt>
                    <dd className="font-medium">
                      {scan.experiment?.name || '-'}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Species</dt>
                    <dd className="font-medium">
                      {scan.experiment?.species || '-'}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Scientist</dt>
                    <dd className="font-medium">
                      {scan.experiment?.scientist?.name || '-'}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* Capture Info */}
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-2">
                  Capture
                </h3>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Date</dt>
                    <dd className="font-medium">
                      {formatDate(scan.capture_date)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Phenotyper</dt>
                    <dd className="font-medium">
                      {scan.phenotyper?.name || '-'}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Scanner</dt>
                    <dd className="font-medium">{scan.scanner_name || '-'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Total Frames</dt>
                    <dd className="font-medium">{totalFrames}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Rotation</dt>
                    <dd className="font-medium">
                      {scan.seconds_per_rot ? `${scan.seconds_per_rot} sec/rot` : '-'}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* Camera Settings */}
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-2">
                  Camera Settings
                </h3>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Exposure</dt>
                    <dd className="font-medium">{scan.exposure_time}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Gain</dt>
                    <dd className="font-medium">{scan.gain}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Gamma</dt>
                    <dd className="font-medium">{scan.gamma}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Brightness</dt>
                    <dd className="font-medium">{scan.brightness}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Contrast</dt>
                    <dd className="font-medium">{scan.contrast}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
