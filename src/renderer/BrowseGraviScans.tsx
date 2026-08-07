import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWaveMetadataLinks } from './hooks/useWaveMetadataLinks';

interface GraviExperimentRow {
  id: string;
  name: string;
  hasNeedsReview: boolean;
  scientist?: { name: string } | null;
  phenotypers?: { name: string }[];
  accession?: { id: string; name: string } | null;
  graviScans?: unknown[];
  resolution?: number;
  grid_mode?: string;
}

interface UploadProgress {
  totalImages: number;
  completedImages: number;
  failedImages: number;
  currentExperiment?: string;
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
    <button onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}

function ExperimentRow({
  experiment,
  boxProgress,
}: {
  experiment: GraviExperimentRow;
  boxProgress?: UploadProgress;
}) {
  const navigate = useNavigate();
  const { links } = useWaveMetadataLinks(experiment.id);
  const [selectedWave, setSelectedWave] = useState<string>('');
  const [divergedWaves, setDivergedWaves] = useState<number[]>([]);

  const handleDownload = async () => {
    const waveNumber = selectedWave === '' ? undefined : Number(selectedWave);
    // "All Waves" must warn about every diverged wave, not just check the
    // (nonexistent) selected one — a single-wave selection only checks that
    // one wave's link.
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
    await window.electron.gravi.downloadImages({
      experimentId: experiment.id,
      experimentName: experiment.name,
      waveNumber,
    });
  };

  return (
    <div>
      <span>{experiment.name}</span>
      {experiment.hasNeedsReview && <span>Needs Review</span>}
      <span>{experiment.scientist?.name ?? 'unknown'}</span>
      <span>{experiment.accession?.name ?? ''}</span>
      {boxProgress && (
        <span>
          Box {boxProgress.completedImages}/{boxProgress.totalImages}
        </span>
      )}
      <label htmlFor={`wave-select-${experiment.id}`}>Wave</label>
      <select
        id={`wave-select-${experiment.id}`}
        aria-label="Wave"
        value={selectedWave}
        onChange={(e) => setSelectedWave(e.target.value)}
      >
        <option value="">All Waves</option>
        {links.map((l) => (
          <option key={l.wave_number} value={l.wave_number}>
            Wave {l.wave_number}
          </option>
        ))}
      </select>
      <button onClick={handleDownload}>Download</button>
      {divergedWaves.length > 0 && (
        <p>
          {divergedWaves.length > 1
            ? `Waves ${divergedWaves.join(', ')}'s`
            : `Wave ${divergedWaves[0]}'s`}{' '}
          linked metadata differs from the experiment&apos;s default accession —
          the downloaded CSV will reflect the default accession, not{' '}
          {divergedWaves.length > 1 ? 'those waves' : 'this wave'}&apos;s link.
        </p>
      )}
      <button
        onClick={() => navigate(`/graviscan-experiment/${experiment.id}`)}
      >
        View Images
      </button>
    </div>
  );
}

export function BrowseGraviScans() {
  const [experiments, setExperiments] = useState<GraviExperimentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState<Filters>({
    dateFrom: '',
    dateTo: '',
    experimentName: '',
    accession: '',
    uploadStatus: '',
  });

  const [scanActive, setScanActive] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [boxProgress, setBoxProgress] = useState<
    Record<string, UploadProgress>
  >({});

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchExperiments = useCallback(
    async (currentFilters: Filters, currentOffset: number) => {
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
      } else {
        setError(result.error ?? 'Failed to load GraviScan experiments');
      }
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
    const off = window.electron.gravi.onUploadProgress((data: unknown) => {
      const progress = data as UploadProgress;
      if (!progress.currentExperiment) return;
      setBoxProgress((prev) => ({
        ...prev,
        [progress.currentExperiment as string]: progress,
      }));
    });
    return off;
  }, []);

  const handleBackupToBox = async () => {
    setBackingUp(true);
    setBackupMessage(null);
    try {
      const result = await window.electron.gravi.uploadAllScans();
      if (result.errors?.includes('rclone not installed')) {
        setBackupMessage('Box backup unavailable (rclone not installed)');
      } else if (result.failed > 0) {
        setBackupMessage(
          `Box backup completed with ${result.failed} error(s): ${result.errors?.[0] ?? ''}`
        );
      } else {
        setBackupMessage(
          `Uploaded ${result.uploaded} image(s), ${result.skipped} skipped`
        );
      }
    } finally {
      setBackingUp(false);
    }
  };

  if (error) {
    return <p>{error}</p>;
  }

  return (
    <div>
      <h1>Browse GraviScans</h1>

      <div>
        <label htmlFor="filter-date-from">Date From</label>
        <input
          id="filter-date-from"
          type="date"
          value={filters.dateFrom}
          onChange={(e) => updateFilter('dateFrom', e.target.value)}
        />
        <label htmlFor="filter-date-to">Date To</label>
        <input
          id="filter-date-to"
          type="date"
          value={filters.dateTo}
          onChange={(e) => updateFilter('dateTo', e.target.value)}
        />
        <label htmlFor="filter-experiment-name">Experiment Name</label>
        <input
          id="filter-experiment-name"
          aria-label="Experiment Name"
          value={filters.experimentName}
          onChange={(e) => updateFilter('experimentName', e.target.value)}
        />
        <label htmlFor="filter-accession">Accession</label>
        <input
          id="filter-accession"
          aria-label="Accession"
          value={filters.accession}
          onChange={(e) => updateFilter('accession', e.target.value)}
        />
        <label htmlFor="filter-upload-status">Upload Status</label>
        <select
          id="filter-upload-status"
          aria-label="Upload Status"
          value={filters.uploadStatus}
          onChange={(e) => updateFilter('uploadStatus', e.target.value)}
        >
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="uploaded">Uploaded</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <div>
        <BackupToBoxButton
          scanActive={scanActive}
          backingUp={backingUp}
          onClick={handleBackupToBox}
        />
        {backupMessage && <p>{backupMessage}</p>}
      </div>

      {experiments.length === 0 ? (
        <p>No GraviScan data is present</p>
      ) : (
        <div>
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
      )}

      <div>
        <button
          onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          disabled={offset === 0}
        >
          Previous
        </button>
        <button onClick={() => setOffset((o) => o + PAGE_SIZE)}>Next</button>
      </div>
    </div>
  );
}
