/**
 * The Experiments page's Attach panel: attach a corrected accession file to an
 * experiment that already exists, or, for a GraviScan experiment, link a metadata file
 * to one of its waves. Nothing is chosen at first, so a click can't attach a file to
 * an experiment the user didn't pick.
 */

import { useEffect, useState } from 'react';
import { useWaveMetadataLinks } from '../hooks/useWaveMetadataLinks';

interface Accession {
  id: string;
  name: string;
}

export interface AttachableExperiment {
  id: string;
  experiment_type?: string;
}

interface AttachAccessionSectionProps<T extends AttachableExperiment> {
  experiments: T[];
  accessions: Accession[];
  /** How an experiment reads in the picker. */
  describe: (experiment: T) => string;
  /** Called after an accession file is attached, so the list can reload. */
  onAttached: () => void;
}

const SELECT_CLASS =
  'p-2 rounded-md bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none w-full border border-gray-300';

export function AttachAccessionSection<T extends AttachableExperiment>({
  experiments,
  accessions,
  describe,
  onAttached,
}: AttachAccessionSectionProps<T>) {
  const [experimentId, setExperimentId] = useState('');
  const [accessionId, setAccessionId] = useState('');
  const [isAttaching, setIsAttaching] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // GraviScan experiments link a metadata file to a wave instead.
  const [graviAccessions, setGraviAccessions] = useState<Accession[]>([]);
  const [waveNumber, setWaveNumber] = useState<number>(0);
  const isGraviscan =
    experiments.find((e) => e.id === experimentId)?.experiment_type ===
    'graviscan';
  const { link, linkError, suggestedNextWave } = useWaveMetadataLinks(
    experimentId || 'none'
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

  const chooseExperiment = (id: string) => {
    setExperimentId(id);
    // The two kinds of file differ, so a choice made for one kind is dropped.
    setAccessionId('');
  };

  const handleAttach = async () => {
    if (!experimentId || !accessionId) return;
    setIsAttaching(true);
    setSuccess(null);
    setError(null);
    try {
      if (isGraviscan) {
        if (await link(waveNumber, accessionId)) {
          setSuccess('Metadata file successfully linked.');
        }
        return;
      }
      const result = await window.electron.database.experiments.attachAccession(
        experimentId,
        accessionId
      );
      if (result.success) {
        setSuccess('Accession successfully attached.');
        onAttached();
      } else {
        setError(result.error || 'Failed to attach accession');
      }
    } catch (err) {
      console.error(
        '[Experiments] Error attaching accession:',
        err instanceof Error ? err.message : 'Unknown error'
      );
      setError('An unexpected error occurred');
    } finally {
      setIsAttaching(false);
    }
  };

  return (
    <div className="flex flex-col">
      <h2 className="text-xs font-bold mb-1">
        Attach Accession File to Existing Experiment
      </h2>
      <p className="mb-3 text-xs text-gray-600" data-testid="attach-note">
        {isGraviscan
          ? 'Use this to link a metadata file to a wave of this GraviScan experiment.'
          : 'Use this to add a corrected accession file to an experiment that already exists, for example after its plants have been scanned.'}
      </p>
      <div className="border rounded text-lg p-4 flex-1">
        <div className="mb-4">
          <label
            htmlFor="attach-experiment-select"
            className="text-xs font-bold block mb-1"
          >
            Select Experiment:
          </label>
          <select
            id="attach-experiment-select"
            className={SELECT_CLASS}
            value={experimentId}
            onChange={(e) => chooseExperiment(e.target.value)}
            disabled={experiments.length === 0}
          >
            {experiments.length === 0 ? (
              <option value="">No experiments available</option>
            ) : (
              <>
                <option value="">-- Select an experiment --</option>
                {experiments.map((exp) => (
                  <option key={exp.id} value={exp.id}>
                    {describe(exp)}
                  </option>
                ))}
              </>
            )}
          </select>
        </div>

        {isGraviscan ? (
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
            <label htmlFor="attach-gravi-accession-select">Metadata File</label>
            <select
              id="attach-gravi-accession-select"
              aria-label="Metadata File"
              value={accessionId}
              onChange={(e) => setAccessionId(e.target.value)}
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
              className={SELECT_CLASS}
              value={accessionId}
              onChange={(e) => setAccessionId(e.target.value)}
              disabled={accessions.length === 0}
            >
              {accessions.length === 0 ? (
                <option value="">No accessions available</option>
              ) : (
                <>
                  <option value="">-- Select an accession file --</option>
                  {accessions.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} - {acc.id}
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>
        )}

        <div className="flex justify-center">
          <button
            type="button"
            className="block p-2 rounded-md bg-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleAttach}
            disabled={isAttaching || !experimentId || !accessionId}
          >
            {isAttaching
              ? 'Attaching...'
              : isGraviscan
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
          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm text-green-600">{success}</p>}
        </div>
      </div>
    </div>
  );
}
