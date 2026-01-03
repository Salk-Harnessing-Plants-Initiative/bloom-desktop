import { useEffect, useState, useCallback } from 'react';

interface Experiment {
  id: string;
  name: string;
  species: string;
}

interface ExperimentChooserProps {
  /** Callback when experiment selection changes */
  onExperimentChange: (experimentId: string | null) => void;
  /** Currently selected experiment ID (controlled) */
  value?: string | null;
  /** Whether the chooser is disabled */
  disabled?: boolean;
}

/**
 * ExperimentChooser Component
 *
 * Dropdown for selecting experiments in CaptureScan.
 * - Polls for experiments every 10 seconds
 * - Shows amber border when unselected, gray when selected
 * - Fires callback on selection change
 */
export function ExperimentChooser({
  onExperimentChange,
  value = null,
  disabled = false,
}: ExperimentChooserProps) {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchExperiments = useCallback(async () => {
    try {
      const result = await window.electron.database.experiments.list();
      if (result.success) {
        const data = result.data as Experiment[];
        // Sort by name alphabetically
        const sorted = data.sort((a, b) => a.name.localeCompare(b.name));
        setExperiments(sorted);
      }
    } catch (err) {
      console.error('Error fetching experiments:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial fetch
    fetchExperiments();

    // Poll every 10 seconds
    const intervalId = setInterval(fetchExperiments, 10000);

    // Cleanup on unmount
    return () => clearInterval(intervalId);
  }, [fetchExperiments]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedValue = e.target.value;
    onExperimentChange(selectedValue || null);
  };

  // Determine border color based on selection
  const borderClass = value ? 'border-gray-300' : 'border-amber-300';

  return (
    <select
      className={`experiment-chooser p-2 rounded-md bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full border-2 ${borderClass}`}
      value={value || ''}
      onChange={handleChange}
      disabled={disabled || isLoading}
    >
      <option value="">
        {isLoading ? 'Loading experiments...' : 'Choose an experiment'}
      </option>
      {experiments.map((experiment) => (
        <option key={experiment.id} value={experiment.id}>
          {experiment.name}
        </option>
      ))}
    </select>
  );
}