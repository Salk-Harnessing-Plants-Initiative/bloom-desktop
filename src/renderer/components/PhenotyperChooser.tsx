import { useEffect, useState, useCallback } from 'react';

interface Phenotyper {
  id: string;
  name: string;
  email: string;
}

interface PhenotyperChooserProps {
  /** Callback when phenotyper selection changes */
  onPhenotyperChange: (phenotyperId: string | null) => void;
  /** Currently selected phenotyper ID (controlled) */
  value?: string | null;
  /** Whether the chooser is disabled */
  disabled?: boolean;
  /** ID for the select element (for label association) */
  id?: string;
}

/**
 * PhenotyperChooser Component
 *
 * Dropdown for selecting phenotypers in CaptureScan.
 * - Polls for phenotypers every 10 seconds
 * - Shows amber border when unselected, gray when selected
 * - Fires callback on selection change
 */
export function PhenotyperChooser({
  onPhenotyperChange,
  value = null,
  disabled = false,
  id,
}: PhenotyperChooserProps) {
  const [phenotypers, setPhenotypers] = useState<Phenotyper[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchPhenotypers = useCallback(async () => {
    try {
      const result = await window.electron.database.phenotypers.list();
      if (result.success) {
        const data = result.data as Phenotyper[];
        // Sort by name alphabetically
        const sorted = data.sort((a, b) => a.name.localeCompare(b.name));
        setPhenotypers(sorted);
      }
    } catch (err) {
      console.error('Error fetching phenotypers:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (intervalId !== null) return;
      // Ensure we have fresh data when polling starts
      fetchPhenotypers();
      intervalId = setInterval(fetchPhenotypers, 10000);
    };

    const stopPolling = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibilityChange = () => {
      if (typeof document === 'undefined') {
        // In non-browser environments, fall back to always polling
        if (intervalId === null) {
          startPolling();
        }
        return;
      }

      if (document.visibilityState === 'visible') {
        startPolling();
      } else {
        stopPolling();
      }
    };

    // Initialize polling based on current visibility
    handleVisibilityChange();

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    // Cleanup on unmount
    return () => {
      stopPolling();
      if (typeof document !== 'undefined') {
        document.removeEventListener(
          'visibilitychange',
          handleVisibilityChange
        );
      }
    };
  }, [fetchPhenotypers]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedValue = e.target.value;
    onPhenotyperChange(selectedValue || null);
  };

  // Determine border color based on selection
  const borderClass = value ? 'border-gray-300' : 'border-amber-300';

  return (
    <select
      id={id}
      className={`phenotyper-chooser p-2 rounded-md bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full border-2 ${borderClass}`}
      value={value || ''}
      onChange={handleChange}
      disabled={disabled || isLoading}
    >
      <option value="">
        {isLoading ? 'Loading phenotypers...' : 'Choose a phenotyper'}
      </option>
      {phenotypers.map((phenotyper) => (
        <option key={phenotyper.id} value={phenotyper.id}>
          {phenotyper.name}
        </option>
      ))}
    </select>
  );
}
