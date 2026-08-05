import { useEffect, useState, useCallback } from 'react';
import { ExperimentForm } from './components/ExperimentForm';
import { useWaveMetadataLinks } from './hooks/useWaveMetadataLinks';

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

function ExperimentWaveLinks({ experimentId }: { experimentId: string }) {
  const { links, unlink } = useWaveMetadataLinks(experimentId);

  const handleUnlink = async (waveNumber: number, accessionName: string) => {
    const message =
      waveNumber === 0
        ? `Unlink wave ${waveNumber} from "${accessionName}"? This does not preserve a record of what was linked at scan time. This experiment's default accession was originally set to this same file; unlinking wave 0 does not change that default.`
        : `Unlink wave ${waveNumber} from "${accessionName}"? This does not preserve a record of what was linked at scan time.`;
    if (window.confirm(message)) {
      await unlink(waveNumber);
    }
  };

  if (links.length === 0) return null;

  return (
    <ul>
      {links.map((l) => (
        <li key={l.wave_number}>
          Wave {l.wave_number}: {l.accession.name}
          <button onClick={() => handleUnlink(l.wave_number, l.accession.name)}>
            Unlink
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Experiments({ mode }: ExperimentsProps = {}) {
  const [experiments, setExperiments] = useState<ExperimentWithScientist[]>([]);
  const [scientists, setScientists] = useState<Scientist[]>([]);
  const [accessions, setAccessions] = useState<Accession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Attach accession state
  const [attachExperimentId, setAttachExperimentId] = useState<string>('');
  const [attachAccessionId, setAttachAccessionId] = useState<string>('');
  const [isAttaching, setIsAttaching] = useState(false);
  const [attachSuccess, setAttachSuccess] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);

  // Wave-scoped metadata-link state (graviscan branch of the attach panel)
  const [graviAccessions, setGraviAccessions] = useState<Accession[]>([]);
  const [waveNumber, setWaveNumber] = useState<number>(0);
  const attachExperiment = experiments.find((e) => e.id === attachExperimentId);
  const isGraviscanAttach = attachExperiment?.experiment_type === 'graviscan';
  const { link, linkError, suggestedNextWave } = useWaveMetadataLinks(
    attachExperimentId || 'none'
  );

  useEffect(() => {
    setWaveNumber(suggestedNextWave);
  }, [suggestedNextWave]);

  useEffect(() => {
    window.electron.database.graviPlateAccessions.listFiles().then((result) => {
      if (result.success) {
        setGraviAccessions((result.data as Accession[]) ?? []);
      }
    });
  }, []);

  const fetchExperiments = useCallback(async () => {
    try {
      setError(null);
      const result = await window.electron.database.experiments.list();

      if (!result.success) {
        setError(result.error || 'Failed to load experiments');
        return;
      }

      const data = result.data as ExperimentWithScientist[];
      // Sort by name alphabetically
      const sorted = data.sort((a, b) => a.name.localeCompare(b.name));
      setExperiments(sorted);

      // Set default attach experiment if available (only if not already set)
      if (sorted.length > 0) {
        setAttachExperimentId((prev) => (prev === '' ? sorted[0].id : prev));
      }
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
        const data = result.data as Accession[];
        setAccessions(data);
        // Set default attach accession if available (only if not already set)
        if (data.length > 0) {
          setAttachAccessionId((prev) => (prev === '' ? data[0].id : prev));
        }
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

  const handleExperimentCreated = () => {
    // Refresh the list after successful creation
    fetchExperiments();
  };

  const handleAttachAccession = async () => {
    if (!attachExperimentId) {
      return;
    }

    setIsAttaching(true);
    setAttachSuccess(null);
    setAttachError(null);

    try {
      if (isGraviscanAttach) {
        if (!attachAccessionId) return;
        await link(waveNumber, attachAccessionId);
        setAttachSuccess('Metadata file successfully linked.');
        return;
      }

      if (!attachAccessionId) return;
      const result = await window.electron.database.experiments.attachAccession(
        attachExperimentId,
        attachAccessionId
      );

      if (result.success) {
        setAttachSuccess('Accession successfully attached.');
        fetchExperiments();
      } else {
        setAttachError(result.error || 'Failed to attach accession');
      }
    } catch (err) {
      console.error('Error attaching accession:', err);
      setAttachError('An unexpected error occurred');
    } finally {
      setIsAttaching(false);
    }
  };

  const getExperimentDisplay = (
    experiment: ExperimentWithScientist
  ): string => {
    const scientistName = experiment.scientist?.name || 'unknown';
    return `${experiment.species} - ${experiment.name} (${scientistName})`;
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Experiments</h1>

      {/* List Section */}
      <div className="mb-8">
        <h2 className="text-xs font-bold mb-2">Experiments</h2>

        {isLoading ? (
          <div className="h-64 border rounded-md p-4 max-w-full mr-10 flex items-center justify-center">
            <p className="text-sm text-gray-500">Loading experiments...</p>
          </div>
        ) : error ? (
          <div className="h-64 border rounded-md p-4 max-w-full mr-10 flex items-center justify-center border-red-300 bg-red-50">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        ) : experiments.length === 0 ? (
          <div className="h-64 border rounded-md p-4 max-w-full mr-10 flex items-center justify-center">
            <p className="text-sm text-gray-500">No experiments yet</p>
          </div>
        ) : (
          <ul className="experiments-list h-64 overflow-auto border rounded-md max-w-full mr-10 text-sm">
            {experiments.map((experiment) => (
              <li key={experiment.id} className="mb-2 p-2">
                <div className="flex justify-between items-center">
                  <span>{getExperimentDisplay(experiment)}</span>
                </div>
                {experiment.experiment_type === 'graviscan' && (
                  <ExperimentWaveLinks experimentId={experiment.id} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Create Section */}
      <div className="mb-8">
        <h2 className="text-xs font-bold mb-3">Create New Experiment</h2>
        <ExperimentForm
          scientists={scientists}
          accessions={accessions}
          onSuccess={handleExperimentCreated}
          mode={mode}
        />
      </div>

      {/* Attach Accession Section */}
      <div>
        <h2 className="text-xs font-bold mb-3">
          Attach Accession File to Existing Experiment
        </h2>
        <div className="border rounded text-lg p-4 w-96">
          <div className="mb-4">
            <label
              htmlFor="attach-experiment-select"
              className="text-xs font-bold block mb-1"
            >
              Select Experiment:
            </label>
            <select
              id="attach-experiment-select"
              className="p-2 rounded-md bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none w-full border border-gray-300"
              value={attachExperimentId}
              onChange={(e) => setAttachExperimentId(e.target.value)}
              disabled={experiments.length === 0}
            >
              {experiments.length === 0 ? (
                <option value="">No experiments available</option>
              ) : (
                experiments.map((exp) => (
                  <option key={exp.id} value={exp.id}>
                    {getExperimentDisplay(exp)}
                  </option>
                ))
              )}
            </select>
          </div>

          {isGraviscanAttach ? (
            <div className="mb-4">
              <label htmlFor="wave-number-attach-input">
                Wave Number to Link
              </label>
              <input
                id="wave-number-attach-input"
                aria-label="Wave Number to Link"
                type="number"
                min={0}
                value={waveNumber}
                onChange={(e) => setWaveNumber(Number(e.target.value))}
              />
              <label htmlFor="attach-gravi-accession-select">
                Metadata File
              </label>
              <select
                id="attach-gravi-accession-select"
                aria-label="Metadata File"
                value={attachAccessionId}
                onChange={(e) => setAttachAccessionId(e.target.value)}
              >
                <option value="">-- Select a metadata file --</option>
                {graviAccessions.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
              {linkError && <p className="text-sm text-red-600">{linkError}</p>}
            </div>
          ) : (
            <div className="mb-4">
              <label
                htmlFor="attach-accession-select"
                className="text-xs font-bold block mb-1"
              >
                Select Accession File:
              </label>
              <select
                id="attach-accession-select"
                className="p-2 rounded-md bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none w-full border border-gray-300"
                value={attachAccessionId}
                onChange={(e) => setAttachAccessionId(e.target.value)}
                disabled={accessions.length === 0}
              >
                {accessions.length === 0 ? (
                  <option value="">No accessions available</option>
                ) : (
                  accessions.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} - {acc.id}
                    </option>
                  ))
                )}
              </select>
            </div>
          )}

          <div className="flex justify-center">
            <button
              type="button"
              className="block p-2 rounded-md bg-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleAttachAccession}
              disabled={
                isAttaching || !attachExperimentId || !attachAccessionId
              }
            >
              {isAttaching
                ? 'Attaching...'
                : isGraviscanAttach
                  ? 'Link'
                  : 'Attach Accession'}
            </button>
          </div>

          <div className="mt-2 text-center">
            {isAttaching && (
              <p className="text-sm text-gray-500 animate-pulse">
                Attaching accession...
              </p>
            )}
            {attachError && (
              <p className="text-sm text-red-600">{attachError}</p>
            )}
            {attachSuccess && (
              <p className="text-sm text-green-600">{attachSuccess}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
