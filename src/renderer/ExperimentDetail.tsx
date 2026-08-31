import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useResizableColumns } from './hooks/useResizableColumns';
import { useWaveMetadataLinks } from './hooks/useWaveMetadataLinks';
import {
  computeDistinctValueSummary,
  computeNameList,
  computeDateRange,
  capForDisplay,
  formatDateRange,
} from './utils/graviExperimentSummary';

/** Last path segment, so the Filename column shows the real TIFF name
 * (e.g. "exp1_st_..._cy1_S1_00.tif") instead of the database row id. */
function basename(filePath: string): string {
  const segments = filePath.split(/[/\\]/);
  return segments[segments.length - 1] || filePath;
}

interface GraviScanRow {
  id: string;
  scanner_id: string;
  plate_index: string;
  wave_number: number;
  resolution: number;
  grid_mode: string;
  capture_date: Date | string;
  transplant_date?: Date | string | null;
  custom_note?: string | null;
  plate_barcode?: string | null;
  path: string;
  phenotyper?: { name: string } | null;
  scanner?: { name: string; display_name?: string | null } | null;
}

/** Falls back to `name` when `display_name` is unset — never the raw
 * `scanner_id`, which is meaningless to a scientist reading the screen. */
function scannerLabel(
  scanner: { name: string; display_name?: string | null } | null | undefined
): string {
  return scanner?.display_name || scanner?.name || 'unknown scanner';
}

/**
 * capture_date/transplant_date arrive as real Date objects (structured-clone
 * preserves Date across ipcRenderer.invoke) even though the IPC envelope's
 * declared type is looser — rendering a bare Date as a JSX child throws.
 * Matches the formatDate() convention in BrowseScans.tsx/ScanPreview.tsx.
 */
function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface Accession {
  id: string;
  name: string;
}

interface ExperimentSummary {
  id: string;
  name: string;
  scientist?: { name: string } | null;
  accession?: Accession | null;
}

function VerificationBadge({ status }: { status?: string }) {
  if (status === 'needs_review') {
    return (
      <span className="text-xs font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
        Needs Review
      </span>
    );
  }
  if (status === 'verified') {
    return <span className="text-green-600">&#10003;</span>;
  }
  return <span />;
}

function FileRow({
  scan,
  verificationStatus,
  widths,
}: {
  scan: GraviScanRow;
  verificationStatus?: string;
  widths: Record<string, number>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [dataUri, setDataUri] = useState<string | null>(null);
  const [imageState, setImageState] = useState<
    'idle' | 'loading' | 'loaded' | 'failed'
  >('idle');

  const handleClick = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !dataUri) {
      setImageState('loading');
      const result = await window.electron.gravi.readScanImage(scan.path, {
        full: false,
      });
      if (result.success && result.dataUri) {
        setDataUri(result.dataUri);
        setImageState('loaded');
      } else {
        setImageState('failed');
      }
    }
  };

  return (
    <div>
      <div
        data-testid={`file-row-${scan.id}`}
        onClick={handleClick}
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-gray-50"
      >
        <span
          className={`text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
        >
          &rsaquo;
        </span>
        <span
          className="truncate"
          style={{ width: widths.filename, flexShrink: 0 }}
          title={basename(scan.path)}
        >
          {basename(scan.path)}
        </span>
        <span
          className="truncate"
          style={{ width: widths.plate, flexShrink: 0 }}
        >
          {scan.plate_index}
        </span>
        <span
          className="truncate"
          style={{ width: widths.wave, flexShrink: 0 }}
        >
          Wave {scan.wave_number}
        </span>
        <span data-testid={`verification-badge-${scan.id}`}>
          <VerificationBadge status={verificationStatus} />
        </span>
      </div>
      {expanded && (
        <div className="px-3 py-3 bg-blue-50 border-t border-blue-100 text-sm">
          {imageState === 'loading' && (
            <p className="text-gray-500 mb-2">Loading preview...</p>
          )}
          {imageState === 'failed' && (
            <p className="text-red-600 mb-2">Failed to load preview</p>
          )}
          {dataUri && (
            <img
              src={dataUri}
              alt={scan.id}
              className="max-w-xs max-h-48 object-contain rounded border border-gray-200 mb-3"
            />
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <div className="font-medium text-gray-600">Capture Date</div>
              <div>{formatDate(scan.capture_date)}</div>
            </div>
            <div>
              <div className="font-medium text-gray-600">Transplant Date</div>
              <div>{formatDate(scan.transplant_date)}</div>
            </div>
            <div>
              <div className="font-medium text-gray-600">Plate Barcode</div>
              <div>{scan.plate_barcode || '—'}</div>
            </div>
            <div>
              <div className="font-medium text-gray-600">Scanner</div>
              <div>{scannerLabel(scan.scanner)}</div>
            </div>
            <div>
              <div className="font-medium text-gray-600">Grid Mode</div>
              <div>{scan.grid_mode}</div>
            </div>
            <div>
              <div className="font-medium text-gray-600">Resolution</div>
              <div>{scan.resolution}</div>
            </div>
            <div>
              <div className="font-medium text-gray-600">Phenotyper</div>
              <div>{scan.phenotyper?.name || '—'}</div>
            </div>
            {scan.custom_note && (
              <div className="col-span-2 md:col-span-4">
                <div className="font-medium text-gray-600">Custom Note</div>
                <div>{scan.custom_note}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ExperimentDetail() {
  const { experimentId } = useParams<{ experimentId: string }>();
  const [experiment, setExperiment] = useState<ExperimentSummary | null>(null);
  const [scans, setScans] = useState<GraviScanRow[]>([]);
  const [verificationStatusMap, setVerificationStatusMap] = useState<
    Record<string, string>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [metadataOptions, setMetadataOptions] = useState<Accession[]>([]);
  const [scannerFilter, setScannerFilter] = useState<string>('');
  const [waveFilter, setWaveFilter] = useState<string>('');

  const { widths, onResizeStart } = useResizableColumns({
    filename: 150,
    plate: 100,
    wave: 100,
  });

  const { links, linkError, link, unlink, suggestedNextWave } =
    useWaveMetadataLinks(experimentId ?? '');

  const [newWave, setNewWave] = useState<number>(0);
  const [newAccession, setNewAccession] = useState<string>('');
  const [isLinking, setIsLinking] = useState(false);
  const [unlinkingWave, setUnlinkingWave] = useState<number | null>(null);

  useEffect(() => {
    setNewWave(suggestedNextWave);
  }, [suggestedNextWave]);

  const fetchAll = useCallback(async () => {
    if (!experimentId) return;
    setIsLoading(true);
    const expResult =
      await window.electron.database.experiments.get(experimentId);
    if (!expResult.success) {
      setNotFound(true);
      setIsLoading(false);
      return;
    }
    setExperiment(expResult.data);

    const detailResult =
      await window.electron.database.graviscans.experimentDetail(experimentId);
    if (detailResult.success) {
      setScans(detailResult.data.scans as unknown as GraviScanRow[]);
      setVerificationStatusMap(detailResult.data.verificationStatusMap);
    } else {
      setError(detailResult.error ?? 'Failed to load experiment detail');
    }
    setIsLoading(false);
  }, [experimentId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    window.electron.database.graviPlateAccessions.listFiles().then((result) => {
      if (result.success) {
        setMetadataOptions((result.data as Accession[]) ?? []);
      }
    });
  }, []);

  const handleUnlink = async (waveNumber: number, accessionName: string) => {
    if (unlinkingWave !== null) return;
    const message =
      waveNumber === 0
        ? `Unlink wave ${waveNumber} from "${accessionName}"? This does not preserve a record of what was linked at scan time. This experiment's default accession was originally set to this same file; unlinking wave 0 does not change that default.`
        : `Unlink wave ${waveNumber} from "${accessionName}"? This does not preserve a record of what was linked at scan time.`;
    if (window.confirm(message)) {
      setUnlinkingWave(waveNumber);
      try {
        await unlink(waveNumber);
      } finally {
        setUnlinkingWave(null);
      }
    }
  };

  const handleLink = async () => {
    if (isLinking) return;
    setIsLinking(true);
    try {
      await link(newWave, newAccession);
    } finally {
      setIsLinking(false);
    }
  };

  if (notFound) {
    return <p>Experiment not found</p>;
  }
  if (error) {
    return <p>{error}</p>;
  }
  if (!experiment) {
    return null;
  }

  const scanners = Array.from(new Set(scans.map((s) => s.scanner_id)));
  const scannerLabelById = new Map(
    scanners.map((id) => [
      id,
      scannerLabel(scans.find((s) => s.scanner_id === id)?.scanner),
    ])
  );
  const waves = Array.from(new Set(scans.map((s) => s.wave_number)));
  const visibleScans = scans.filter((s) => {
    if (scannerFilter && s.scanner_id !== scannerFilter) return false;
    if (waveFilter !== '' && s.wave_number !== Number(waveFilter)) return false;
    return true;
  });

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
  const phenotyperDisplay = capForDisplay(phenotyperNames.values);
  const resolutionDisplay = capForDisplay(resolutionSummary.values);
  const gridModeDisplay = capForDisplay(gridModeSummary.values);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <Link
        to="/browse-graviscans"
        className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
      >
        &lsaquo; Back to Browse
      </Link>
      <h1 className="text-2xl font-bold mt-1 mb-4">{experiment.name}</h1>
      <div className="bg-white rounded-lg shadow-sm border p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
        <div>
          <div className="font-medium text-gray-600">Scientist</div>
          <div>{experiment.scientist?.name ?? 'unknown'}</div>
        </div>
        {phenotyperNames.values.length > 0 && (
          <div>
            <div className="font-medium text-gray-600">Phenotyper(s)</div>
            <div title={phenotyperDisplay.title}>
              {phenotyperDisplay.display}
            </div>
          </div>
        )}
        {dateRange && (
          <div>
            <div className="font-medium text-gray-600">Date Range</div>
            <div>{formatDateRange(dateRange)}</div>
          </div>
        )}
        {resolutionSummary.values.length > 0 && (
          <div>
            <div className="font-medium text-gray-600">Resolution</div>
            <div
              title={resolutionDisplay.title}
              className="flex items-center gap-1"
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
            </div>
          </div>
        )}
        {gridModeSummary.values.length > 0 && (
          <div>
            <div className="font-medium text-gray-600">Grid Mode</div>
            <div
              title={gridModeDisplay.title}
              className="flex items-center gap-1"
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
            </div>
          </div>
        )}
        <div>
          <div className="font-medium text-gray-600">Wave Status</div>
          <div>{waves.length > 1 ? 'Multi-wave' : 'Single wave'}</div>
        </div>
        <div>
          <div className="font-medium text-gray-600">Images</div>
          <div>{scans.length} images</div>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading experiment...</p>
      ) : (
        <>
          <div className="bg-white rounded-lg shadow-sm border p-4 mb-4">
            <h2 className="text-lg font-semibold mb-2">Linked Metadata</h2>
            <ul className="space-y-1 mb-3">
              {links.map((l) => (
                <li
                  key={l.wave_number}
                  className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded"
                >
                  <span>
                    Wave {l.wave_number}: {l.accession.name}
                  </span>
                  <button
                    onClick={() =>
                      handleUnlink(l.wave_number, l.accession.name)
                    }
                    disabled={unlinkingWave !== null}
                    className="text-red-600 hover:bg-red-50 rounded px-2 py-1 text-sm disabled:opacity-50"
                  >
                    {unlinkingWave === l.wave_number
                      ? 'Unlinking...'
                      : 'Unlink'}
                  </button>
                </li>
              ))}
            </ul>
            {linkError && (
              <p className="text-sm text-red-600 mb-2">{linkError}</p>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label
                  htmlFor="new-wave-input"
                  className="block text-xs font-bold mb-1"
                >
                  New Wave Number
                </label>
                <input
                  id="new-wave-input"
                  aria-label="New Wave Number"
                  type="number"
                  min={0}
                  value={newWave}
                  onChange={(e) => setNewWave(Number(e.target.value))}
                  className="p-2 rounded-md bg-white text-sm border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label
                  htmlFor="new-metadata-select"
                  className="block text-xs font-bold mb-1"
                >
                  Metadata File
                </label>
                <select
                  id="new-metadata-select"
                  aria-label="Metadata File"
                  value={newAccession}
                  onChange={(e) => setNewAccession(e.target.value)}
                  className="p-2 rounded-md bg-white text-sm border border-gray-300 focus:outline-none"
                >
                  <option value="">-- Select a metadata file --</option>
                  {metadataOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleLink}
                disabled={isLinking}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm"
              >
                {isLinking ? 'Linking...' : 'Link'}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mb-3">
            {scanners.map((s) => {
              const count = scans.filter(
                (sc) =>
                  sc.scanner_id === s &&
                  (waveFilter === '' || sc.wave_number === Number(waveFilter))
              ).length;
              const active = scannerFilter === s;
              return (
                <button
                  key={s}
                  onClick={() =>
                    setScannerFilter((prev) => (prev === s ? '' : s))
                  }
                  className={`px-3 py-1.5 rounded-full text-sm font-medium ${
                    active
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {scannerLabelById.get(s)} ({count})
                </button>
              );
            })}
            {waves.length > 1 &&
              waves.map((w) => {
                const count = scans.filter(
                  (sc) =>
                    sc.wave_number === w &&
                    (scannerFilter === '' || sc.scanner_id === scannerFilter)
                ).length;
                const active = waveFilter === String(w);
                return (
                  <button
                    key={w}
                    onClick={() =>
                      setWaveFilter((prev) =>
                        prev === String(w) ? '' : String(w)
                      )
                    }
                    className={`px-3 py-1.5 rounded-full text-sm font-medium ${
                      active
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Wave {w} ({count})
                  </button>
                );
              })}
          </div>

          <p className="text-sm text-gray-600 mb-2">
            Showing {visibleScans.length} of {scans.length}
          </p>

          <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
            <div className="bg-gray-50 border-b flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-500 uppercase">
              <span className="w-4" />
              <span
                data-testid="resize-handle-filename"
                onMouseDown={onResizeStart('filename')}
                className="truncate"
                style={{ width: widths.filename, flexShrink: 0 }}
              >
                Filename
              </span>
              <span
                data-testid="resize-handle-plate"
                onMouseDown={onResizeStart('plate')}
                className="truncate"
                style={{ width: widths.plate, flexShrink: 0 }}
              >
                Plate
              </span>
              <span
                className="truncate"
                style={{ width: widths.wave, flexShrink: 0 }}
              >
                Wave
              </span>
            </div>
            {visibleScans.length === 0 ? (
              <p className="text-sm text-gray-500 p-4">
                No images match filters
              </p>
            ) : (
              <div className="divide-y divide-gray-100">
                {visibleScans.map((scan) => (
                  <FileRow
                    key={scan.id}
                    scan={scan}
                    verificationStatus={
                      verificationStatusMap[
                        `${scan.scanner_id}:${scan.plate_index}`
                      ]
                    }
                    widths={widths}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
