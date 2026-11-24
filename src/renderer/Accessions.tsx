import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AccessionList } from './components/AccessionList';
import { AccessionFileUpload } from './components/AccessionFileUpload';
import { useAccessionSearch } from './hooks/useAccessionSearch';
import { SearchIcon } from '../components/SearchIcon';

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

const BOX =
  'min-h-64 flex-1 border rounded-md bg-white p-4 flex items-center justify-center';

/** Each section sits in its own gray box. */
const SECTION = 'mr-10 rounded-lg border border-gray-300 bg-gray-100 p-4';

/** Newest uploaded first; files created at the same moment by name. */
function newestFirst(a: Accession, b: Accession): number {
  return (
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
    a.name.localeCompare(b.name)
  );
}

export function Accessions() {
  const [accessions, setAccessions] = useState<Accession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const { text, plantMatches, searchingPlants, ...plants } =
    useAccessionSearch(search);
  // "?open=<id>": the file to open, when linked from the Experiments page.
  const [searchParams] = useSearchParams();
  const openId = searchParams.get('open');

  const fetchAccessions = async () => {
    try {
      setError(null);
      const result = await window.electron.database.accessions.list();

      if (!result.success) {
        setError(result.error || 'Failed to load accessions');
        return;
      }

      setAccessions([...(result.data as Accession[])].sort(newestFirst));
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

  // A file matches by its name here, or by its plants in the main process.
  const shown =
    text === ''
      ? accessions
      : accessions.filter(
          (a) =>
            a.name.toLowerCase().includes(text.toLowerCase()) ||
            plantMatches.has(a.id)
        );

  return (
    // The page fills the window: Upload keeps its height at the bottom and Browse
    // takes the rest, its list growing with the window and scrolling.
    <div className="flex min-h-full flex-col p-6">
      <h1 className="text-2xl font-bold mb-6">Accessions</h1>

      <section
        className={`${SECTION} mb-6 flex min-h-64 flex-1 basis-0 flex-col`}
        data-testid="browse-section"
      >
        <div className="mb-1 flex flex-wrap items-center gap-3">
          <h2 className="text-xs font-bold">Browse Accession Files</h2>
          <div className="relative w-full max-w-md">
            <SearchIcon />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by file name, plant barcode or accession"
              aria-label="Search accession files"
              className="w-full rounded-md border border-gray-300 py-1.5 pl-9 pr-3 text-sm"
            />
          </div>
          {text !== '' && !isLoading && !error && (
            <span className="text-xs text-gray-600" data-testid="search-count">
              {shown.length} of {accessions.length} files
              {searchingPlants && ' · searching plants…'}
            </span>
          )}
        </div>
        <p className="mb-2 text-xs text-gray-600">
          You can edit your files here: rename a file, change a plant&apos;s
          accession, or delete a file.
        </p>

        {plants.error && (
          <p className="mb-2 text-sm text-amber-700" role="status">
            Plant barcodes and accessions couldn&apos;t be searched:{' '}
            {plants.error}. File names are still searched.
          </p>
        )}

        {/* Linked from the Experiments page to a file that has since been deleted. */}
        {!isLoading &&
          !error &&
          openId &&
          !accessions.some((a) => a.id === openId) && (
            <p className="mb-2 text-sm text-amber-700" role="status">
              That accession file was not found. It may have been deleted.
            </p>
          )}

        {isLoading ? (
          <div className={BOX}>
            <p className="text-sm text-gray-500">Loading accessions...</p>
          </div>
        ) : error ? (
          <div className={`${BOX} border-red-300 bg-red-50`}>
            <p className="text-sm text-red-600">{error}</p>
          </div>
        ) : shown.length === 0 ? (
          <div className={BOX}>
            <p className="text-sm text-gray-500">
              {accessions.length === 0
                ? 'No accession files yet. Upload one below.'
                : searchingPlants
                  ? 'Searching plants…'
                  : 'No accession files match this search'}
            </p>
          </div>
        ) : (
          <div
            className="min-h-0 flex-1 overflow-auto"
            data-testid="accession-files"
          >
            <AccessionList
              accessions={shown}
              onUpdate={fetchAccessions}
              openId={openId}
              matchingPlants={text === '' ? undefined : plantMatches}
            />
          </div>
        )}
      </section>

      <section className={SECTION} data-testid="upload-section">
        <h2 className="text-xs font-bold mb-3">Upload Accession File</h2>
        <AccessionFileUpload onUploadComplete={fetchAccessions} />
      </section>
    </div>
  );
}
