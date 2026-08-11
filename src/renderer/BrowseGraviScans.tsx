import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWaveMetadataLinks } from './hooks/useWaveMetadataLinks';
import { BoxBackupProgress } from '../types/graviscan';

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
  boxProgress?: BoxBackupProgress;
}) {
  const navigate = useNavigate();
  const { links, linkError } = useWaveMetadataLinks(experiment.id);
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
      {linkError && <p className="text-sm text-red-600">{linkError}</p>}
      <button
        onClick={handleDownload}
        disabled={!!linkError}
        title={
          linkError
            ? 'Wave-metadata links failed to load — divergence from the default accession cannot be checked right now.'
            : undefined
        }
      >
        Download
      </button>
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
  const [total, setTotal] = useState(0);
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
    Record<string, BoxBackupProgress>
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
        setTotal(result.data.total);
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
    try {
      const response = await window.electron.gravi.uploadAllScans();
      if (response.success === false) {
        setBackupMessage(`Backup failed: ${response.error}`);
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
          failures.push(
            `Box failed: ${result.boxErrors?.[0] ?? 'unknown error'}`
          );
        }
        // `failures` is always non-empty here: entry into this branch
        // requires !bloomSuccess || !boxSuccess, and each of those exact
        // conditions is what pushes to `failures` above.
        setBackupMessage(
          `${result.uploaded} uploaded, ${result.errors?.length ?? 0} error(s) — ${failures.join('; ')}`
        );
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
      } else {
        setBackupMessage(
          `Uploaded ${result.uploaded} image(s), ${result.skipped} skipped`
        );
      }
    } catch (error) {
      setBackupMessage(
        `Backup failed: ${error instanceof Error ? error.message : 'unknown error'}`
      );
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
        <button
          onClick={() => setOffset((o) => o + PAGE_SIZE)}
          disabled={offset + PAGE_SIZE >= total}
        >
          Next
        </button>
      </div>
    </div>
  );
}
