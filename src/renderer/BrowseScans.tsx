import { useEffect, useState, useCallback } from 'react';
import type {
  ScanWithRelations,
  PaginatedScansResponse,
  PaginatedScanFilters,
  ExperimentWithRelations,
  Image as ImageRecord,
} from '../types/database';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export function BrowseScans() {
  // Data state
  const [scans, setScans] = useState<ScanWithRelations[]>([]);
  const [experiments, setExperiments] = useState<ExperimentWithRelations[]>([]);
  const [total, setTotal] = useState(0);

  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Filter state
  const [experimentId, setExperimentId] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteInProgress, setDeleteInProgress] = useState<string | null>(null);

  const totalPages = Math.ceil(total / pageSize);

  const fetchScans = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const filters: PaginatedScanFilters = {
        page,
        pageSize,
      };

      if (experimentId) {
        filters.experimentId = experimentId;
      }
      if (dateFrom) {
        filters.dateFrom = dateFrom;
      }
      if (dateTo) {
        filters.dateTo = dateTo;
      }

      const result = await window.electron.database.scans.list(filters);

      if (!result.success) {
        setError(result.error || 'Failed to load scans');
        return;
      }

      const data = result.data as PaginatedScansResponse;
      setScans(data.scans);
      setTotal(data.total);
    } catch (err) {
      console.error('Error fetching scans:', err);
      setError('An unexpected error occurred while loading scans');
    } finally {
      setIsLoading(false);
    }
  }, [page, pageSize, experimentId, dateFrom, dateTo]);

  const fetchExperiments = useCallback(async () => {
    try {
      const result = await window.electron.database.experiments.list();
      if (result.success) {
        const data = result.data as ExperimentWithRelations[];
        // Sort by name
        const sorted = data.sort((a, b) => a.name.localeCompare(b.name));
        setExperiments(sorted);
      }
    } catch (err) {
      console.error('Error fetching experiments:', err);
    }
  }, []);

  useEffect(() => {
    fetchExperiments();
  }, [fetchExperiments]);

  useEffect(() => {
    fetchScans();
  }, [fetchScans]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [experimentId, dateFrom, dateTo, pageSize]);

  const handleDelete = async (scanId: string) => {
    if (
      !window.confirm(
        'Are you sure you want to delete this scan? This action cannot be undone.'
      )
    ) {
      return;
    }

    setDeleteInProgress(scanId);
    try {
      const result = await window.electron.database.scans.delete(scanId);
      if (result.success) {
        // Refresh the list
        fetchScans();
      } else {
        setError(result.error || 'Failed to delete scan');
      }
    } catch (err) {
      console.error('Error deleting scan:', err);
      setError('An unexpected error occurred while deleting scan');
    } finally {
      setDeleteInProgress(null);
    }
  };

  const handleClearFilters = () => {
    setExperimentId('');
    setDateFrom('');
    setDateTo('');
  };

  const formatDate = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getUploadStatus = (images: ImageRecord[]) => {
    if (images.length === 0) return { text: 'No images', color: 'text-gray-400' };

    const uploaded = images.filter((img) => img.status === 'uploaded').length;
    const failed = images.filter((img) => img.status === 'failed').length;
    const pending = images.filter(
      (img) => img.status === 'pending' || img.status === 'uploading'
    ).length;

    if (failed > 0) {
      return { text: `${failed} failed`, color: 'text-red-600' };
    }
    if (pending > 0) {
      return { text: `${uploaded}/${images.length} uploaded`, color: 'text-yellow-600' };
    }
    if (uploaded === images.length) {
      return { text: 'All uploaded', color: 'text-green-600' };
    }
    return { text: `${uploaded}/${images.length}`, color: 'text-gray-600' };
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Browse Scans</h1>

      {/* Filters Section */}
      <div className="mb-6 p-4 bg-white border rounded-lg shadow-sm">
        <div className="flex flex-wrap gap-4 items-end">
          {/* Experiment Filter */}
          <div className="flex-1 min-w-[200px]">
            <label
              htmlFor="experiment-filter"
              className="block text-xs font-bold mb-1"
            >
              Experiment
            </label>
            <select
              id="experiment-filter"
              className="w-full p-2 rounded-md bg-white text-sm border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={experimentId}
              onChange={(e) => setExperimentId(e.target.value)}
            >
              <option value="">All Experiments</option>
              {experiments.map((exp) => (
                <option key={exp.id} value={exp.id}>
                  {exp.species} - {exp.name}
                </option>
              ))}
            </select>
          </div>

          {/* Date From Filter */}
          <div className="min-w-[180px]">
            <label htmlFor="date-from" className="block text-xs font-bold mb-1">
              From Date
            </label>
            <input
              id="date-from"
              type="date"
              className="w-full p-2 rounded-md bg-white text-sm border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>

          {/* Date To Filter */}
          <div className="min-w-[180px]">
            <label htmlFor="date-to" className="block text-xs font-bold mb-1">
              To Date
            </label>
            <input
              id="date-to"
              type="date"
              className="w-full p-2 rounded-md bg-white text-sm border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>

          {/* Clear Filters Button */}
          <button
            type="button"
            onClick={handleClearFilters}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors"
          >
            Clear Filters
          </button>
        </div>
      </div>

      {/* Results Summary */}
      <div className="mb-4 flex justify-between items-center">
        <p className="text-sm text-gray-600">
          {isLoading
            ? 'Loading...'
            : `Showing ${scans.length} of ${total} scans`}
        </p>
        <div className="flex items-center gap-2">
          <label htmlFor="page-size" className="text-sm text-gray-600">
            Per page:
          </label>
          <select
            id="page-size"
            className="p-1 rounded-md bg-white text-sm border border-gray-300 focus:outline-none"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Table */}
      <div className="bg-white border rounded-lg shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="h-96 flex items-center justify-center">
            <p className="text-sm text-gray-500">Loading scans...</p>
          </div>
        ) : scans.length === 0 ? (
          <div className="h-96 flex items-center justify-center">
            <p className="text-sm text-gray-500">No scans found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-700">
                  Plant ID
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">
                  Capture Date
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">
                  Experiment
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">
                  Phenotyper
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">
                  Wave
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">
                  Age (days)
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">
                  Images
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">
                  Upload Status
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {scans.map((scan) => {
                const uploadStatus = getUploadStatus(scan.images);
                return (
                  <tr key={scan.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{scan.plant_id}</td>
                    <td className="px-4 py-3">
                      {formatDate(scan.capture_date)}
                    </td>
                    <td className="px-4 py-3">
                      {scan.experiment
                        ? `${scan.experiment.species} - ${scan.experiment.name}`
                        : '-'}
                    </td>
                    <td className="px-4 py-3">
                      {scan.phenotyper?.name || '-'}
                    </td>
                    <td className="px-4 py-3">{scan.wave_number}</td>
                    <td className="px-4 py-3">{scan.plant_age_days}</td>
                    <td className="px-4 py-3">{scan.images.length}</td>
                    <td className={`px-4 py-3 ${uploadStatus.color}`}>
                      {uploadStatus.text}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleDelete(scan.id)}
                        disabled={deleteInProgress === scan.id}
                        className="text-red-600 hover:text-red-800 disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Delete scan"
                      >
                        {deleteInProgress === scan.id ? (
                          'Deleting...'
                        ) : (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={1.5}
                            stroke="currentColor"
                            className="w-5 h-5"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                            />
                          </svg>
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination Controls */}
      {!isLoading && totalPages > 1 && (
        <div className="mt-4 flex justify-between items-center">
          <div className="text-sm text-gray-600">
            Page {page} of {totalPages}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage(1)}
              disabled={page === 1}
              className="px-3 py-1 text-sm border rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              First
            </button>
            <button
              type="button"
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
              className="px-3 py-1 text-sm border rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage(page + 1)}
              disabled={page === totalPages}
              className="px-3 py-1 text-sm border rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
            <button
              type="button"
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages}
              className="px-3 py-1 text-sm border rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Last
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
