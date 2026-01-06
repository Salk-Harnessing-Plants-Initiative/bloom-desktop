import { useEffect, useState } from 'react';
import { AccessionForm } from './components/AccessionForm';
import { AccessionList } from './components/AccessionList';
import { AccessionFileUpload } from './components/AccessionFileUpload';

interface Experiment {
  id: string;
  name: string;
}

interface Accession {
  id: string;
  name: string;
  createdAt: Date | string;
  experiments?: Experiment[];
}

export function Accessions() {
  const [accessions, setAccessions] = useState<Accession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAccessions = async () => {
    try {
      setError(null);
      const result = await window.electron.database.accessions.list();

      if (!result.success) {
        setError(result.error || 'Failed to load accessions');
        return;
      }

      const data = result.data as Accession[];
      // Sort by name alphabetically
      const sorted = data.sort((a, b) => a.name.localeCompare(b.name));
      setAccessions(sorted);
    } catch (err) {
      console.error('Error fetching accessions:', err);
      setError('An unexpected error occurred while loading accessions');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAccessions();
  }, []);

  const handleAccessionCreated = () => {
    // Refresh the list after successful creation
    fetchAccessions();
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Accessions</h1>

      {/* List Section */}
      <div className="mb-8">
        <h2 className="text-xs font-bold mb-2">Current Accessions</h2>

        {isLoading ? (
          <div className="border rounded-md p-4 w-full max-w-2xl flex items-center justify-center min-h-32">
            <p className="text-sm text-gray-500">Loading accessions...</p>
          </div>
        ) : error ? (
          <div className="border rounded-md p-4 w-full max-w-2xl flex items-center justify-center min-h-32 border-red-300 bg-red-50">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        ) : accessions.length === 0 ? (
          <div className="border rounded-md p-4 w-full max-w-2xl flex items-center justify-center min-h-32">
            <p className="text-sm text-gray-500">No accessions yet</p>
          </div>
        ) : (
          <div className="w-full max-w-2xl">
            <AccessionList
              accessions={accessions}
              onUpdate={handleAccessionCreated}
            />
          </div>
        )}
      </div>

      {/* Create Section */}
      <div className="mb-8">
        <h2 className="text-xs font-bold mb-3">Add New Accession</h2>
        <AccessionForm onSuccess={handleAccessionCreated} />
      </div>

      {/* File Upload Section */}
      <div>
        <h2 className="text-xs font-bold mb-3">
          Upload Plant Mappings (Excel)
        </h2>
        <div className="w-full max-w-2xl">
          <AccessionFileUpload onUploadComplete={handleAccessionCreated} />
        </div>
      </div>
    </div>
  );
}
