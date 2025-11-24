import { useEffect, useState } from 'react';
import { PhenotyperForm } from './components/PhenotyperForm';

interface Phenotyper {
  id: string;
  name: string;
  email: string;
}

export function Phenotypers() {
  const [phenotypers, setPhenotypers] = useState<Phenotyper[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPhenotypers = async () => {
    try {
      setError(null);
      const result = await window.electron.database.phenotypers.list();

      if (!result.success) {
        setError(result.error || 'Failed to load phenotypers');
        return;
      }

      const data = result.data as Phenotyper[];
      // Sort by name alphabetically
      const sorted = data.sort((a, b) => a.name.localeCompare(b.name));
      setPhenotypers(sorted);
    } catch (err) {
      console.error('Error fetching phenotypers:', err);
      setError('An unexpected error occurred while loading phenotypers');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPhenotypers();
  }, []);

  const handlePhenotyperCreated = () => {
    // Refresh the list after successful creation
    fetchPhenotypers();
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Phenotypers</h1>

      {/* List Section */}
      <div className="mb-8">
        <h2 className="text-xs font-bold mb-2">Current Phenotypers</h2>

        {isLoading ? (
          <div className="h-32 border rounded-md p-4 w-96 flex items-center justify-center">
            <p className="text-sm text-gray-500">Loading phenotypers...</p>
          </div>
        ) : error ? (
          <div className="h-32 border rounded-md p-4 w-96 flex items-center justify-center border-red-300 bg-red-50">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        ) : phenotypers.length === 0 ? (
          <div className="h-32 border rounded-md p-4 w-96 flex items-center justify-center">
            <p className="text-sm text-gray-500">No phenotypers yet</p>
          </div>
        ) : (
          <ul className="h-32 overflow-auto border rounded-md p-2 w-96 text-sm">
            {phenotypers.map((phenotyper) => (
              <li key={phenotyper.id} className="py-1">
                {phenotyper.name} ({phenotyper.email})
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Create Section */}
      <div>
        <h2 className="text-xs font-bold mb-3">Add New Phenotyper</h2>
        <PhenotyperForm onSuccess={handlePhenotyperCreated} />
      </div>
    </div>
  );
}
