import { useEffect, useState } from 'react';
import { AccessionForm } from './components/AccessionForm';
import { AccessionList } from './components/AccessionList';
import { AccessionFileUpload } from './components/AccessionFileUpload';
import { GraviMetadataUpload } from './components/GraviMetadataUpload';
import { GraviMetadataList } from './components/GraviMetadataList';

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

type MetadataTab = 'cylscan' | 'graviscan';

export function Metadata() {
  const [activeTab, setActiveTab] = useState<MetadataTab>(
    APP_MODE === 'graviscan' ? 'graviscan' : 'cylscan'
  );
  const [accessions, setAccessions] = useState<Accession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [graviRefreshTrigger, setGraviRefreshTrigger] = useState(0);

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
    fetchAccessions();
  };

  const handleGraviUploadComplete = () => {
    setGraviRefreshTrigger((prev) => prev + 1);
  };

  const tabs: { key: MetadataTab; label: string }[] = [
    { key: 'cylscan', label: 'CylScan' },
    { key: 'graviscan', label: 'GraviScan' },
  ];

  // Single-mode: render CylScan content directly without tabs
  if (APP_MODE === 'cylinderscan') {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Accessions</h1>

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

        <div className="mb-8">
          <h2 className="text-xs font-bold mb-3">Add New Accession</h2>
          <AccessionForm onSuccess={handleAccessionCreated} />
        </div>

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

  // Single-mode: render GraviScan content directly without tabs
  if (APP_MODE === 'graviscan') {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Metadata</h1>

        <div className="mb-8">
          <h2 className="text-xs font-bold mb-2">
            Uploaded GraviScan Metadata
          </h2>
          <GraviMetadataList refreshTrigger={graviRefreshTrigger} />
        </div>

        <div>
          <h2 className="text-xs font-bold mb-3">
            Upload Plate Metadata (Excel)
          </h2>
          <div className="w-full max-w-2xl">
            <GraviMetadataUpload onUploadComplete={handleGraviUploadComplete} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Accessions</h1>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex -mb-px space-x-8">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* CylScan Tab */}
      {activeTab === 'cylscan' && (
        <div>
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
      )}

      {/* GraviScan Tab */}
      {activeTab === 'graviscan' && (
        <div>
          {/* Uploaded Metadata Files */}
          <div className="mb-8">
            <h2 className="text-xs font-bold mb-2">
              Uploaded GraviScan Metadata
            </h2>
            <GraviMetadataList refreshTrigger={graviRefreshTrigger} />
          </div>

          {/* Upload Section */}
          <div>
            <h2 className="text-xs font-bold mb-3">
              Upload Plate Metadata (Excel)
            </h2>
            <div className="w-full max-w-2xl">
              <GraviMetadataUpload
                onUploadComplete={handleGraviUploadComplete}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
