import { useEffect, useState } from 'react';
import { ScientistForm } from './components/ScientistForm';

interface Scientist {
  id: string;
  name: string;
  email: string;
}

export function Scientists() {
  const [scientists, setScientists] = useState<Scientist[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchScientists = async () => {
    try {
      setError(null);
      const result = await window.electron.database.scientists.list();

      if (!result.success) {
        setError(result.error || 'Failed to load scientists');
        return;
      }

      const data = result.data as Scientist[];
      // Sort by name alphabetically
      const sorted = data.sort((a, b) => a.name.localeCompare(b.name));
      setScientists(sorted);
    } catch (err) {
      console.error('Error fetching scientists:', err);
      setError('An unexpected error occurred while loading scientists');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchScientists();
  }, []);

  const handleScientistCreated = () => {
    // Refresh the list after successful creation
    fetchScientists();
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Scientists</h1>

      {/* List Section */}
      <div className="mb-8">
        <h2 className="text-xs font-bold mb-2">Current Scientists</h2>

        {isLoading ? (
          <div className="h-32 border rounded-md p-4 w-96 flex items-center justify-center">
            <p className="text-sm text-gray-500">Loading scientists...</p>
          </div>
        ) : error ? (
          <div className="h-32 border rounded-md p-4 w-96 flex items-center justify-center border-red-300 bg-red-50">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        ) : scientists.length === 0 ? (
          <div className="h-32 border rounded-md p-4 w-96 flex items-center justify-center">
            <p className="text-sm text-gray-500">No scientists yet</p>
          </div>
        ) : (
          <ul className="h-32 overflow-auto border rounded-md p-2 w-96 text-sm">
            {scientists.map((scientist) => (
              <li key={scientist.id} className="py-1">
                {scientist.name} ({scientist.email})
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Create Section */}
      <div>
        <h2 className="text-xs font-bold mb-3">Add New Scientist</h2>
        <ScientistForm onSuccess={handleScientistCreated} />
      </div>
    </div>
  );
}
