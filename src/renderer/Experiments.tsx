import { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ExperimentForm } from './components/ExperimentForm';
import { ExperimentWaveLinks } from './components/ExperimentWaveLinks';
import { CylinderWaveDates } from './components/CylinderWaveDates';
import { AttachAccessionSection } from './components/AttachAccessionSection';
import type { ExperimentLatestScan } from '../types/experiment-recency';
import { orderByRecentScan } from './utils/experiment-order';
import { matchesExperimentSearch } from './utils/experiment-search';
import { SearchIcon } from '../components/SearchIcon';

interface Scientist {
  id: string;
  name: string;
  email: string;
}

interface Accession {
  id: string;
  name: string;
}

interface ExperimentWithScientist {
  id: string;
  name: string;
  species: string;
  experiment_type?: string;
  scientist?: Scientist | null;
  accession?: Accession | null;
}

interface ExperimentsProps {
  mode?: string;
}

/** When each experiment was last scanned; none if that can't be loaded. */
async function loadLatestScans(): Promise<ExperimentLatestScan[]> {
  try {
    const latest = await window.electron.database.experiments.latestScans();
    if (latest.success && latest.data) return latest.data;
    console.error('[Experiments] Could not load scan times:', latest.error);
  } catch (err) {
    console.error(
      '[Experiments] Could not load scan times:',
      err instanceof Error ? err.message : 'Unknown error'
    );
  }
  return [];
}

export function Experiments({ mode }: ExperimentsProps = {}) {
  const [experiments, setExperiments] = useState<ExperimentWithScientist[]>([]);
  // CylinderScan experiments whose wave dates (and their change history) are shown.
  const [datesShown, setDatesShown] = useState<ReadonlySet<string>>(new Set());
  const [scientists, setScientists] = useState<Scientist[]>([]);
  const [accessions, setAccessions] = useState<Accession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Narrows the list only; the Attach picker still offers every experiment.
  // "?search=<text>" starts it filled in (linked from the Accessions page).
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('search') ?? '');
  const [error, setError] = useState<string | null>(null);

  const fetchExperiments = useCallback(async () => {
    try {
      setError(null);
      // Unscanned (likely new) experiments first, then the most recently scanned.
      // Without the scan times the list is still usable, by name.
      const [result, latestScans] = await Promise.all([
        window.electron.database.experiments.list(),
        loadLatestScans(),
      ]);

      if (!result.success) {
        setError(result.error || 'Failed to load experiments');
        return;
      }

      const data = result.data as ExperimentWithScientist[];
      setExperiments(orderByRecentScan(data, latestScans));
    } catch (err) {
      console.error('Error fetching experiments:', err);
      setError('An unexpected error occurred while loading experiments');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchScientists = useCallback(async () => {
    try {
      const result = await window.electron.database.scientists.list();
      if (result.success) {
        setScientists(result.data as Scientist[]);
      }
    } catch (err) {
      console.error('Error fetching scientists:', err);
    }
  }, []);

  const fetchAccessions = useCallback(async () => {
    try {
      const result = await window.electron.database.accessions.list();
      if (result.success) {
        setAccessions(result.data as Accession[]);
      }
    } catch (err) {
      console.error('Error fetching accessions:', err);
    }
  }, []);

  useEffect(() => {
    fetchExperiments();
    fetchScientists();
    fetchAccessions();
  }, [fetchExperiments, fetchScientists, fetchAccessions]);

  const toggleDates = (experimentId: string) =>
    setDatesShown((shown) => {
      const next = new Set(shown);
      if (!next.delete(experimentId)) next.add(experimentId);
      return next;
    });

  const getExperimentDisplay = (
    experiment: ExperimentWithScientist
  ): string => {
    const scientistName = experiment.scientist?.name || 'unknown';
    return `${experiment.species} - ${experiment.name} (${scientistName})`;
  };

  const shown = experiments.filter((e) => matchesExperimentSearch(e, search));

  return (
    <div className="flex min-h-full flex-col p-6">
      <h1 className="text-2xl font-bold mb-6">Experiments</h1>

      {/* The page fills the window: the forms keep their height at the bottom and
          the list takes the rest, growing with the window and scrolling. */}
      <div className="mb-8 flex min-h-64 flex-1 basis-0 flex-col">
        <div className="mb-2 mr-10 flex flex-wrap items-center gap-3">
          <h2 className="text-xs font-bold">Experiments</h2>
          <div className="relative w-full max-w-md">
            <SearchIcon />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, species, scientist or accession file"
              aria-label="Search experiments"
              className="w-full rounded-md border border-gray-300 py-1.5 pl-9 pr-3 text-sm"
            />
          </div>
          {search.trim() && !isLoading && !error && (
            <span className="text-xs text-gray-600" data-testid="search-count">
              {shown.length} of {experiments.length}
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="min-h-64 flex-1 border rounded-md p-4 max-w-full mr-10 flex items-center justify-center">
            <p className="text-sm text-gray-500">Loading experiments...</p>
          </div>
        ) : error ? (
          <div className="min-h-64 flex-1 border rounded-md p-4 max-w-full mr-10 flex items-center justify-center border-red-300 bg-red-50">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        ) : shown.length === 0 ? (
          <div className="min-h-64 flex-1 border rounded-md p-4 max-w-full mr-10 flex items-center justify-center">
            <p className="text-sm text-gray-500">
              {experiments.length === 0
                ? 'No experiments yet'
                : 'No experiments match this search'}
            </p>
          </div>
        ) : (
          <ul className="experiments-list min-h-0 flex-1 overflow-auto border rounded-md max-w-full mr-10 text-sm">
            {shown.map((experiment) => (
              <li key={experiment.id} className="mb-2 p-2">
                <div className="flex justify-between items-center">
                  <span>{getExperimentDisplay(experiment)}</span>
                </div>
                {experiment.experiment_type === 'graviscan' ? (
                  <ExperimentWaveLinks experimentId={experiment.id} />
                ) : (
                  <>
                    <p
                      className="flex flex-wrap items-baseline gap-x-3 text-xs text-gray-600"
                      data-testid={`accession-file-${experiment.id}`}
                    >
                      <span>
                        Accession file:{' '}
                        {!experiment.accession ? (
                          <span className="italic">none</span>
                        ) : mode === 'cylinderscan' ? (
                          // The Accessions page exists only in CylinderScan mode.
                          <Link
                            to={`/accessions?open=${encodeURIComponent(experiment.accession.id)}`}
                            className="text-lime-700 underline hover:no-underline"
                          >
                            {experiment.accession.name}
                          </Link>
                        ) : (
                          experiment.accession.name
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleDates(experiment.id)}
                        aria-expanded={datesShown.has(experiment.id)}
                        className="text-lime-700 underline hover:no-underline"
                      >
                        {datesShown.has(experiment.id)
                          ? 'Hide wave dates'
                          : 'Wave dates'}
                      </button>
                    </p>
                    {datesShown.has(experiment.id) && (
                      <CylinderWaveDates
                        experimentId={experiment.id}
                        startOpen
                      />
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Create and Attach in two equal columns; they stack when the window is narrow. */}
      <div className="mr-10 grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Create Section */}
        <div className="flex flex-col">
          <h2 className="text-xs font-bold mb-3">Create New Experiment</h2>
          <ExperimentForm
            scientists={scientists}
            accessions={accessions}
            onSuccess={fetchExperiments}
            mode={mode}
          />
        </div>

        <AttachAccessionSection
          experiments={experiments}
          accessions={accessions}
          describe={getExperimentDisplay}
          onAttached={fetchExperiments}
        />
      </div>
    </div>
  );
}
