import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type {
  ExperimentWithScans,
  GraviScanWithRelations,
} from '../types/graviscan';
import { formatPlateIndex } from '../types/graviscan';

interface FlatImage {
  path: string;
  filename: string;
  status: string;
  scannerName: string;
  scannerId: string;
  plateIndex: string;
  plateBarcode: string | null;
  captureDate: Date;
  waveNumber: number;
  gridMode: string;
  transplantDate: Date | null;
  customNote: string | null;
}

interface ScannerInfo {
  id: string;
  name: string;
  imageCount: number;
}

// Default column widths in pixels
const COL_DEFAULTS = { icon: 40, filename: 350, plate: 140, wave: 80 };
type ColKey = keyof typeof COL_DEFAULTS;

const resizeHandleStyle: React.CSSProperties = {
  position: 'absolute',
  right: 0,
  top: 0,
  bottom: 0,
  width: 5,
  cursor: 'col-resize',
};

export function ExperimentDetail() {
  const { experimentId } = useParams<{ experimentId: string }>();
  const navigate = useNavigate();

  const [experiment, setExperiment] = useState<ExperimentWithScans | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [selectedScanner, setSelectedScanner] = useState<string | null>(null);
  const [selectedWave, setSelectedWave] = useState<number | null>(null);

  // Expanded row — one image at a time, released on collapse
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [expandedImageData, setExpandedImageData] = useState<string | null>(
    null
  );
  const [expandedImageLoading, setExpandedImageLoading] = useState(false);
  const expandedPathRef = useRef<string | null>(null);

  // Resizable column widths
  const [colWidths, setColWidths] = useState({ ...COL_DEFAULTS });
  const colWidthsRef = useRef(colWidths);
  colWidthsRef.current = colWidths;
  const resizeRef = useRef<{
    col: ColKey;
    startX: number;
    startW: number;
  } | null>(null);

  // Fetch experiment detail
  useEffect(() => {
    if (!experimentId) return;
    setLoading(true);
    window.electron.database.graviscans
      .getExperimentDetail(experimentId)
      .then((result) => {
        if (result.success && result.data) {
          setExperiment(result.data);
        } else {
          setError(result.error || 'Failed to load experiment');
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [experimentId]);

  // Derive scanner list and wave numbers from experiment data
  const scanners: ScannerInfo[] = experiment
    ? (() => {
        const map = new Map<string, ScannerInfo>();
        for (const scan of experiment.scans) {
          const id = scan.scanner?.id || 'unknown';
          const existing = map.get(id);
          if (existing) {
            existing.imageCount += scan.images.length;
          } else {
            let slotLabel = '';
            const firstImagePath = scan.images[0]?.path || scan.path || '';
            const match = firstImagePath.match(/_S(\d+)_/);
            if (match) {
              slotLabel = `Scanner ${match[1]}`;
            }
            const name =
              slotLabel ||
              scan.scanner?.display_name ||
              scan.scanner?.name ||
              'Unknown';
            map.set(id, { id, name, imageCount: scan.images.length });
          }
        }
        return Array.from(map.values()).sort((a, b) =>
          a.name.localeCompare(b.name)
        );
      })()
    : [];

  const waveNumbers: number[] = experiment
    ? [...new Set(experiment.scans.map((s) => s.wave_number))].sort(
        (a, b) => a - b
      )
    : [];

  const hasMultipleWaves = waveNumbers.length > 1;

  const scannerLabelMap = new Map(scanners.map((s) => [s.id, s.name]));

  // Flatten all images with metadata
  const allFlatImages: FlatImage[] = experiment
    ? experiment.scans.flatMap((scan) => {
        const scannerId = scan.scanner?.id || 'unknown';
        return scan.images.map((img) => ({
          path: img.path,
          filename: img.path.split(/[\\/]/).pop() || img.path,
          status: img.status,
          scannerName:
            scannerLabelMap.get(scannerId) ||
            scan.scanner?.display_name ||
            scan.scanner?.name ||
            'Unknown',
          scannerId,
          plateIndex: scan.plate_index,
          plateBarcode: scan.plate_barcode,
          captureDate: scan.capture_date,
          waveNumber: scan.wave_number,
          gridMode: scan.grid_mode,
          transplantDate: scan.transplant_date,
          customNote: scan.custom_note,
        }));
      })
    : [];

  // Apply filters
  const filteredImages = allFlatImages.filter((img) => {
    if (selectedScanner && img.scannerId !== selectedScanner) return false;
    if (selectedWave !== null && img.waveNumber !== selectedWave) return false;
    return true;
  });

  // Wave chip counts (respecting scanner filter)
  const waveCounts = new Map<number, number>();
  if (hasMultipleWaves) {
    for (const img of allFlatImages) {
      if (selectedScanner && img.scannerId !== selectedScanner) continue;
      waveCounts.set(img.waveNumber, (waveCounts.get(img.waveNumber) || 0) + 1);
    }
  }

  // Scanner chip counts (respecting wave filter)
  const scannerCounts = new Map<string, number>();
  for (const img of allFlatImages) {
    if (selectedWave !== null && img.waveNumber !== selectedWave) continue;
    scannerCounts.set(
      img.scannerId,
      (scannerCounts.get(img.scannerId) || 0) + 1
    );
  }

  // Toggle expand/collapse a file row
  const toggleExpand = useCallback(async (imagePath: string) => {
    if (expandedPathRef.current === imagePath) {
      expandedPathRef.current = null;
      setExpandedPath(null);
      setExpandedImageData(null);
      return;
    }

    expandedPathRef.current = imagePath;
    setExpandedPath(imagePath);
    setExpandedImageData(null);
    setExpandedImageLoading(true);

    try {
      const result = await window.electron.graviscan.readScanImage(imagePath);
      if (
        expandedPathRef.current === imagePath &&
        result.success &&
        result.dataUri
      ) {
        setExpandedImageData(result.dataUri);
      }
    } catch {
      // Image load failed
    } finally {
      if (expandedPathRef.current === imagePath) {
        setExpandedImageLoading(false);
      }
    }
  }, []);

  // Column resize via drag
  const onResizeStart = useCallback((col: ColKey, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = {
      col,
      startX: e.clientX,
      startW: colWidthsRef.current[col],
    };

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const diff = ev.clientX - resizeRef.current.startX;
      setColWidths((prev) => ({
        ...prev,
        [resizeRef.current!.col]: Math.max(
          40,
          resizeRef.current!.startW + diff
        ),
      }));
    };

    const onMouseUp = () => {
      resizeRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  // Metadata summary
  const phenotypers = experiment
    ? [
        ...new Set(
          experiment.scans
            .map((s: GraviScanWithRelations) => s.phenotyper?.name)
            .filter(Boolean)
        ),
      ]
    : [];
  const dates = experiment
    ? experiment.scans.map((s) => new Date(s.capture_date).getTime())
    : [];
  const earliest = dates.length ? new Date(Math.min(...dates)) : null;
  const latest = dates.length ? new Date(Math.max(...dates)) : null;
  const resolutions = experiment
    ? [...new Set(experiment.scans.map((s) => s.resolution))]
    : [];
  const gridModes = experiment
    ? [...new Set(experiment.scans.map((s) => s.grid_mode))]
    : [];
  const totalImages = allFlatImages.length;

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto text-center py-12 text-gray-500">
        Loading experiment...
      </div>
    );
  }

  if (error || !experiment) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <button
          onClick={() => navigate('/browse-scans')}
          className="text-blue-600 hover:text-blue-800 text-sm mb-4 inline-flex items-center gap-1"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Browse Scans
        </button>
        <p className="text-red-500">{error || 'Experiment not found'}</p>
      </div>
    );
  }

  const formatDate = (d: Date | null) => {
    if (!d) return '—';
    const dt = new Date(d);
    return `${dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, ${dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <button
            onClick={() => navigate('/browse-scans')}
            className="text-blue-600 hover:text-blue-800 text-sm mb-2 inline-flex items-center gap-1"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Browse Scans
          </button>
          <h1 className="text-2xl font-bold text-gray-900">
            {experiment.name}
          </h1>
        </div>
      </div>

      {/* Metadata summary */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          {experiment.scientist && (
            <div>
              <span className="font-medium text-gray-600">Scientist:</span>{' '}
              <span className="text-gray-900">{experiment.scientist.name}</span>
            </div>
          )}
          {phenotypers.length > 0 && (
            <div>
              <span className="font-medium text-gray-600">Phenotyper:</span>{' '}
              <span className="text-gray-900">{phenotypers.join(', ')}</span>
            </div>
          )}
          {earliest && latest && (
            <div>
              <span className="font-medium text-gray-600">Date:</span>{' '}
              <span className="text-gray-900">
                {earliest.toLocaleDateString()}
                {earliest.getTime() !== latest.getTime() &&
                  ` - ${latest.toLocaleDateString()}`}
              </span>
            </div>
          )}
          <div>
            <span className="font-medium text-gray-600">Images:</span>{' '}
            <span className="text-gray-900">{totalImages}</span>
          </div>
          <div>
            <span className="font-medium text-gray-600">Resolution:</span>{' '}
            <span className="text-gray-900">{resolutions.join(', ')} DPI</span>
          </div>
          <div>
            <span className="font-medium text-gray-600">Grid:</span>{' '}
            <span className="text-gray-900">{gridModes.join(', ')}</span>
          </div>
          <div>
            <span className="font-medium text-gray-600">Mode:</span>{' '}
            <span className="text-gray-900">
              {hasMultipleWaves ? `${waveNumbers.length} waves` : 'Single wave'}
            </span>
          </div>
          {experiment.accession && (
            <div>
              <span className="font-medium text-gray-600">Accession:</span>{' '}
              <span className="text-gray-900">{experiment.accession.name}</span>
            </div>
          )}
        </div>
      </div>

      {/* Scanner filter chips */}
      <div className="flex flex-wrap gap-2 mb-3">
        <button
          onClick={() => setSelectedScanner(null)}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            selectedScanner === null
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          All (
          {
            allFlatImages.filter(
              (img) => selectedWave === null || img.waveNumber === selectedWave
            ).length
          }
          )
        </button>
        {scanners.map((scanner) => (
          <button
            key={scanner.id}
            onClick={() =>
              setSelectedScanner(
                selectedScanner === scanner.id ? null : scanner.id
              )
            }
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selectedScanner === scanner.id
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {scanner.name} ({scannerCounts.get(scanner.id) || 0})
          </button>
        ))}
      </div>

      {/* Wave filter chips (only when multiple waves exist) */}
      {hasMultipleWaves && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setSelectedWave(null)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selectedWave === null
                ? 'bg-purple-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            All waves
          </button>
          {waveNumbers.map((wave) => (
            <button
              key={wave}
              onClick={() =>
                setSelectedWave(selectedWave === wave ? null : wave)
              }
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                selectedWave === wave
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Wave {wave} ({waveCounts.get(wave) || 0})
            </button>
          ))}
        </div>
      )}

      {/* Filtered count */}
      {(selectedScanner || selectedWave !== null) && (
        <p className="text-sm text-gray-500 mb-4">
          Showing {filteredImages.length} of {totalImages} images
        </p>
      )}

      {/* File list table */}
      {filteredImages.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No images match the current filters
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {/* Table header */}
          <div className="flex bg-gray-50 border-b text-xs font-medium text-gray-500 uppercase tracking-wider select-none">
            <div
              style={{ width: colWidths.icon, minWidth: 40 }}
              className="flex-shrink-0 px-2 py-3"
            />
            <div
              style={{ width: colWidths.filename, minWidth: 100 }}
              className="flex-shrink-0 px-3 py-3 relative"
            >
              Filename
              <div
                style={resizeHandleStyle}
                className="hover:bg-blue-300"
                onMouseDown={(e) => onResizeStart('filename', e)}
              />
            </div>
            <div
              style={{ width: colWidths.plate, minWidth: 80 }}
              className="flex-shrink-0 px-3 py-3 relative"
            >
              Plate ID
              <div
                style={resizeHandleStyle}
                className="hover:bg-blue-300"
                onMouseDown={(e) => onResizeStart('plate', e)}
              />
            </div>
            {hasMultipleWaves && (
              <div
                style={{ width: colWidths.wave, minWidth: 50 }}
                className="flex-shrink-0 px-3 py-3 relative"
              >
                Wave
                <div
                  style={resizeHandleStyle}
                  className="hover:bg-blue-300"
                  onMouseDown={(e) => onResizeStart('wave', e)}
                />
              </div>
            )}
          </div>

          {/* Table body — vertically scrollable */}
          <div
            className="overflow-y-auto"
            style={{ maxHeight: 'calc(100vh - 420px)' }}
          >
            {filteredImages.map((img) => (
              <div key={img.path}>
                {/* File row */}
                <div
                  className={`flex border-b cursor-pointer transition-colors ${
                    expandedPath === img.path
                      ? 'bg-blue-50 border-blue-200'
                      : 'hover:bg-gray-50'
                  }`}
                  onClick={() => toggleExpand(img.path)}
                >
                  {/* TIFF icon */}
                  <div
                    style={{ width: colWidths.icon, minWidth: 40 }}
                    className="flex-shrink-0 px-2 py-2.5 flex items-center justify-center"
                  >
                    <svg
                      className="w-5 h-5 text-gray-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                      />
                    </svg>
                  </div>
                  {/* Filename */}
                  <div
                    style={{ width: colWidths.filename, minWidth: 100 }}
                    className="flex-shrink-0 px-3 py-2.5 overflow-x-auto whitespace-nowrap text-sm text-gray-900 font-medium"
                    title={img.filename}
                  >
                    {img.filename}
                  </div>
                  {/* Plate ID */}
                  <div
                    style={{ width: colWidths.plate, minWidth: 80 }}
                    className="flex-shrink-0 px-3 py-2.5 overflow-x-auto whitespace-nowrap text-sm text-gray-600"
                    title={formatPlateIndex(img.plateIndex)}
                  >
                    {formatPlateIndex(img.plateIndex)}
                  </div>
                  {/* Wave number */}
                  {hasMultipleWaves && (
                    <div
                      style={{ width: colWidths.wave, minWidth: 50 }}
                      className="flex-shrink-0 px-3 py-2.5 text-sm text-gray-600"
                    >
                      {img.waveNumber}
                    </div>
                  )}
                </div>

                {/* Expanded detail row */}
                {expandedPath === img.path && (
                  <div className="border-b border-blue-200 bg-blue-50/50 p-5">
                    <div className="flex gap-6">
                      {/* Image preview */}
                      <div className="flex-shrink-0">
                        {expandedImageLoading ? (
                          <div className="w-[300px] h-[225px] bg-gray-200 animate-pulse rounded-lg flex items-center justify-center text-gray-400 text-sm">
                            Loading preview...
                          </div>
                        ) : expandedImageData ? (
                          <img
                            src={expandedImageData}
                            alt={img.filename}
                            className="max-w-[400px] max-h-[300px] rounded-lg border border-gray-200 shadow-sm"
                          />
                        ) : (
                          <div className="w-[300px] h-[225px] bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 text-sm">
                            Failed to load preview
                          </div>
                        )}
                      </div>
                      {/* Metadata */}
                      <div className="text-sm space-y-2 pt-1">
                        <div>
                          <span className="font-medium text-gray-500">
                            Capture Date:
                          </span>{' '}
                          <span className="text-gray-900">
                            {formatDate(img.captureDate)}
                          </span>
                        </div>
                        {img.transplantDate && (
                          <div>
                            <span className="font-medium text-gray-500">
                              Transplant Date:
                            </span>{' '}
                            <span className="text-gray-900">
                              {formatDate(img.transplantDate)}
                            </span>
                          </div>
                        )}
                        {img.customNote && (
                          <div>
                            <span className="font-medium text-gray-500">
                              Note:
                            </span>{' '}
                            <span className="text-gray-900">
                              {img.customNote}
                            </span>
                          </div>
                        )}
                        {img.plateBarcode && (
                          <div>
                            <span className="font-medium text-gray-500">
                              Barcode:
                            </span>{' '}
                            <span className="text-gray-900">
                              {img.plateBarcode}
                            </span>
                          </div>
                        )}
                        <div>
                          <span className="font-medium text-gray-500">
                            Scanner:
                          </span>{' '}
                          <span className="text-gray-900">
                            {img.scannerName}
                          </span>
                        </div>
                        <div>
                          <span className="font-medium text-gray-500">
                            Grid:
                          </span>{' '}
                          <span className="text-gray-900">{img.gridMode}</span>
                        </div>
                        <div>
                          <span className="font-medium text-gray-500">
                            Plate:
                          </span>{' '}
                          <span className="text-gray-900">
                            {formatPlateIndex(img.plateIndex)}
                          </span>
                        </div>
                        {hasMultipleWaves && (
                          <div>
                            <span className="font-medium text-gray-500">
                              Wave:
                            </span>{' '}
                            <span className="text-gray-900">
                              {img.waveNumber}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
