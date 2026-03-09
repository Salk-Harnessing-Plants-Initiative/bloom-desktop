import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { ExperimentWithScans, GraviScanWithRelations } from '../types/graviscan';
import { ImageLightbox } from './components/ImageLightbox';

interface FlatImage {
  path: string;
  status: string;
  scannerName: string;
  scannerId: string;
  plateIndex: string;
  captureDate: Date;
  waveNumber: number;
  gridMode: string;
}

interface ScannerInfo {
  id: string;
  name: string;
  imageCount: number;
}

export function ExperimentDetail() {
  const { experimentId } = useParams<{ experimentId: string }>();
  const navigate = useNavigate();

  const [experiment, setExperiment] = useState<ExperimentWithScans | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [selectedScanner, setSelectedScanner] = useState<string | null>(null); // null = All
  const [selectedWave, setSelectedWave] = useState<number | null>(null); // null = All

  // Image loading
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [fullImages, setFullImages] = useState<Record<string, string>>({});
  const [fullImageLoading, setFullImageLoading] = useState(false);
  const loadingRef = useRef<Set<string>>(new Set());

  // Lightbox
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);


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
  // Extract slot label (S1, S2, ...) from the _S{N}_ pattern in scan image filenames
  const scanners: ScannerInfo[] = experiment
    ? (() => {
        const map = new Map<string, ScannerInfo>();
        for (const scan of experiment.scans) {
          const id = scan.scanner?.id || 'unknown';
          const existing = map.get(id);
          if (existing) {
            existing.imageCount += scan.images.length;
          } else {
            // Extract S{N} label from image filename (e.g., ..._S1_00.tif → S1)
            let slotLabel = '';
            const firstImagePath = scan.images[0]?.path || scan.path || '';
            const match = firstImagePath.match(/_S(\d+)_/);
            if (match) {
              slotLabel = `Scanner ${match[1]}`;
            }
            const name = slotLabel || scan.scanner?.display_name || scan.scanner?.name || 'Unknown';
            map.set(id, { id, name, imageCount: scan.images.length });
          }
        }
        return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
      })()
    : [];

  const waveNumbers: number[] = experiment
    ? [...new Set(experiment.scans.map((s) => s.wave_number))].sort((a, b) => a - b)
    : [];

  const hasMultipleWaves = waveNumbers.length > 1;

  // Build a scanner ID → slot label lookup from derived scanners list
  const scannerLabelMap = new Map(scanners.map((s) => [s.id, s.name]));

  // Flatten all images with metadata
  const allFlatImages: FlatImage[] = experiment
    ? experiment.scans.flatMap((scan) => {
        const scannerId = scan.scanner?.id || 'unknown';
        return scan.images.map((img) => ({
          path: img.path,
          status: img.status,
          scannerName: scannerLabelMap.get(scannerId) || scan.scanner?.display_name || scan.scanner?.name || 'Unknown',
          scannerId,
          plateIndex: scan.plate_index,
          captureDate: scan.capture_date,
          waveNumber: scan.wave_number,
          gridMode: scan.grid_mode,
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
    scannerCounts.set(img.scannerId, (scannerCounts.get(img.scannerId) || 0) + 1);
  }

  // Lazy image loading with IntersectionObserver
  const loadImage = useCallback(
    async (imagePath: string) => {
      if (thumbnails[imagePath] || loadingRef.current.has(imagePath)) return;
      loadingRef.current.add(imagePath);
      try {
        const result = await window.electron.graviscan.readScanImage(imagePath);
        if (result.success && result.dataUri) {
          setThumbnails((prev) => ({ ...prev, [imagePath]: result.dataUri }));
        }
      } catch {
        // Image load failed
      } finally {
        loadingRef.current.delete(imagePath);
      }
    },
    [thumbnails]
  );

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
        // Full image load failed
      } finally {
        setFullImageLoading(false);
      }
    },
    [fullImages]
  );

  // Stable ref to loadImage so the observer doesn't need to be recreated
  const loadImageRef = useRef(loadImage);
  loadImageRef.current = loadImage;

  const observerRef = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const imgPath = (entry.target as HTMLElement).dataset.imagePath;
            if (imgPath) loadImageRef.current(imgPath);
          }
        }
      },
      { rootMargin: '200px' }
    );
    return () => observerRef.current?.disconnect();
  }, []);

  const imageRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (el && observerRef.current) {
        observerRef.current.observe(el);
      }
    },
    []
  );

  // Lightbox caption
  const getLightboxCaption = (img: FlatImage) => {
    const d = new Date(img.captureDate);
    const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    if (hasMultipleWaves) {
      return `${img.scannerName} \u00b7 Plate ${img.plateIndex} \u00b7 Wave ${img.waveNumber} \u00b7 ${date}, ${time}`;
    }
    return `${img.scannerName} \u00b7 Plate ${img.plateIndex} \u00b7 ${date}, ${time}`;
  };

  // Metadata summary
  const phenotypers = experiment
    ? [...new Set(experiment.scans.map((s: GraviScanWithRelations) => s.phenotyper?.name).filter(Boolean))]
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
        <button onClick={() => navigate('/browse-scans')} className="text-blue-600 hover:text-blue-800 text-sm mb-4 inline-flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          Browse Scans
        </button>
        <p className="text-red-500">{error || 'Experiment not found'}</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <button
            onClick={() => navigate('/browse-scans')}
            className="text-blue-600 hover:text-blue-800 text-sm mb-2 inline-flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            Browse Scans
          </button>
          <h1 className="text-2xl font-bold text-gray-900">{experiment.name}</h1>
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
                {earliest.getTime() !== latest.getTime() && ` - ${latest.toLocaleDateString()}`}
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
            <span className="text-gray-900">{hasMultipleWaves ? `${waveNumbers.length} waves` : 'Single wave'}</span>
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
          All ({allFlatImages.filter((img) => selectedWave === null || img.waveNumber === selectedWave).length})
        </button>
        {scanners.map((scanner) => (
          <button
            key={scanner.id}
            onClick={() => setSelectedScanner(selectedScanner === scanner.id ? null : scanner.id)}
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
              onClick={() => setSelectedWave(selectedWave === wave ? null : wave)}
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

      {/* Image grid */}
      {filteredImages.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No images match the current filters
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {filteredImages.map((img, idx) => {
            const thumbSrc = thumbnails[img.path];

            return (
              <div
                key={img.path}
                ref={imageRef}
                data-image-path={img.path}
                className="group cursor-pointer"
                onClick={() => {
                  if (thumbSrc) {
                    setLightboxIndex(idx);
                    loadFullImage(img.path);
                  } else {
                    loadImage(img.path);
                  }
                }}
              >
                <div className="aspect-[4/3] bg-gray-100 rounded-lg overflow-hidden border border-gray-200 group-hover:border-blue-300 group-hover:shadow-md transition-all">
                  {thumbSrc ? (
                    <img
                      src={thumbSrc}
                      alt={`Plate ${img.plateIndex}`}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="flex items-center justify-center w-full h-full text-gray-400 text-xs">
                      <svg className="w-6 h-6 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M6.75 7.5a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                      </svg>
                    </div>
                  )}
                </div>
                <div className="mt-1.5 px-0.5">
                  <p className="text-xs font-medium text-gray-800">Plate {img.plateIndex}</p>
                  <p className="text-[10px] text-gray-500">
                    {img.scannerName}
                    {hasMultipleWaves && ` \u00b7 Wave ${img.waveNumber}`}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    {new Date(img.captureDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })},{' '}
                    {new Date(img.captureDate).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && (() => {
        const img = filteredImages[lightboxIndex];
        const fullSrc = img ? fullImages[img.path] : null;
        const thumbSrc = img ? thumbnails[img.path] : null;
        const src = fullSrc || thumbSrc;
        if (!src || !img) return null;

        return (
          <ImageLightbox
            src={src}
            loading={!fullSrc && fullImageLoading}
            alt={`Plate ${img.plateIndex}`}
            caption={getLightboxCaption(img)}
            onClose={() => setLightboxIndex(null)}
            onPrev={lightboxIndex > 0 ? () => {
              const newIdx = lightboxIndex - 1;
              const prevImg = filteredImages[newIdx];
              if (prevImg?.path) {
                loadImage(prevImg.path);
                loadFullImage(prevImg.path);
              }
              setLightboxIndex(newIdx);
            } : undefined}
            onNext={lightboxIndex < filteredImages.length - 1 ? () => {
              const newIdx = lightboxIndex + 1;
              const nextImg = filteredImages[newIdx];
              if (nextImg?.path) {
                loadImage(nextImg.path);
                loadFullImage(nextImg.path);
              }
              setLightboxIndex(newIdx);
            } : undefined}
          />
        );
      })()}
    </div>
  );
}
