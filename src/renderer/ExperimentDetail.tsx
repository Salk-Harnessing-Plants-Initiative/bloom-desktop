import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useResizableColumns } from './hooks/useResizableColumns';
import { useWaveMetadataLinks } from './hooks/useWaveMetadataLinks';

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
    return <span>Needs Review</span>;
  }
  if (status === 'verified') {
    return <span>✓</span>;
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

  const handleClick = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !dataUri) {
      const result = await window.electron.gravi.readScanImage(scan.path, {
        full: false,
      });
      if (result.success) {
        setDataUri(result.dataUri ?? null);
      }
    }
  };

  return (
    <div>
      <div
        data-testid={`file-row-${scan.id}`}
        onClick={handleClick}
        style={{ cursor: 'pointer' }}
      >
        <span style={{ width: widths.filename }}>{scan.id}</span>
        <span style={{ width: widths.plate }}>{scan.plate_index}</span>
        <span style={{ width: widths.wave }}>Wave {scan.wave_number}</span>
        <span data-testid={`verification-badge-${scan.id}`}>
          <VerificationBadge status={verificationStatus} />
        </span>
      </div>
      {expanded && (
        <div>
          {dataUri && <img src={dataUri} alt={scan.id} />}
          <span>{formatDate(scan.capture_date)}</span>
          <span>{formatDate(scan.transplant_date)}</span>
          <span>{scan.custom_note}</span>
          <span>{scan.plate_barcode}</span>
          <span>{scan.scanner_id}</span>
          <span>{scan.grid_mode}</span>
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
    const expResult =
      await window.electron.database.experiments.get(experimentId);
    if (!expResult.success) {
      setNotFound(true);
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
  const waves = Array.from(new Set(scans.map((s) => s.wave_number)));
  const visibleScans = scans.filter((s) => {
    if (scannerFilter && s.scanner_id !== scannerFilter) return false;
    if (waveFilter !== '' && s.wave_number !== Number(waveFilter)) return false;
    return true;
  });

  return (
    <div>
      <a href="/browse-graviscans">Back to Browse</a>
      <h1>{experiment.name}</h1>
      <div>
        <span>{experiment.scientist?.name ?? 'unknown'}</span>
        <span>{scans[0]?.resolution}</span>
        <span>{scans[0]?.grid_mode}</span>
        <span>{waves.length > 1 ? 'Multi-wave' : 'Single wave'}</span>
        <span>{scans.length} images</span>
      </div>

      <div>
        <h2>Linked Metadata</h2>
        <ul>
          {links.map((l) => (
            <li key={l.wave_number}>
              Wave {l.wave_number}: {l.accession.name}
              <button
                onClick={() => handleUnlink(l.wave_number, l.accession.name)}
                disabled={unlinkingWave !== null}
              >
                {unlinkingWave === l.wave_number ? 'Unlinking...' : 'Unlink'}
              </button>
            </li>
          ))}
        </ul>
        {linkError && <p>{linkError}</p>}
        <label htmlFor="new-wave-input">New Wave Number</label>
        <input
          id="new-wave-input"
          aria-label="New Wave Number"
          type="number"
          min={0}
          value={newWave}
          onChange={(e) => setNewWave(Number(e.target.value))}
        />
        <label htmlFor="new-metadata-select">Metadata File</label>
        <select
          id="new-metadata-select"
          aria-label="Metadata File"
          value={newAccession}
          onChange={(e) => setNewAccession(e.target.value)}
        >
          <option value="">-- Select a metadata file --</option>
          {metadataOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <button onClick={handleLink} disabled={isLinking}>
          {isLinking ? 'Linking...' : 'Link'}
        </button>
      </div>

      <div>
        {scanners.map((s) => (
          <button key={s} onClick={() => setScannerFilter(s)}>
            {s}
          </button>
        ))}
        {waves.length > 1 &&
          waves.map((w) => (
            <button key={w} onClick={() => setWaveFilter(String(w))}>
              Wave {w}
            </button>
          ))}
      </div>

      <div>
        <span
          data-testid="resize-handle-filename"
          onMouseDown={onResizeStart('filename')}
        >
          Filename
        </span>
        <span
          data-testid="resize-handle-plate"
          onMouseDown={onResizeStart('plate')}
        >
          Plate
        </span>
        {visibleScans.map((scan) => (
          <FileRow
            key={scan.id}
            scan={scan}
            verificationStatus={
              verificationStatusMap[`${scan.scanner_id}:${scan.plate_index}`]
            }
            widths={widths}
          />
        ))}
      </div>
    </div>
  );
}
