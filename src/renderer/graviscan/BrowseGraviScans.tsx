/**
 * BrowseGraviScans page
 *
 * Lists GraviScan records grouped by session, with experiment/date filters,
 * thumbnail previews, empty state, and cancelled session indicators.
 * Follows the BrowseScans.tsx pattern.
 */

import { useEffect, useState, useCallback } from 'react';

// ─── Types ──────────────────────────────────────────────────

interface GraviScanSession {
  id: string;
  scan_mode: string;
  started_at: string;
  cancelled: boolean;
}

interface GraviScanRecord {
  id: string;
  experiment_id: string;
  phenotyper_id: string;
  scanner_id: string;
  session_id: string | null;
  wave_number: number;
  plate_barcode: string | null;
  plate_index: string;
  grid_mode: string;
  resolution: number;
  path: string;
  capture_date: string;
  deleted: boolean;
  experiment?: { id: string; name: string; species: string };
  phenotyper?: { id: string; name: string };
  scanner?: { id: string; name: string };
  session?: GraviScanSession | null;
  images: Array<{ id: string; path: string; status: string }>;
}

interface ExperimentOption {
  id: string;
  name: string;
  species: string;
}

interface SessionGroup {
  sessionId: string;
  session: GraviScanSession | null;
  scans: GraviScanRecord[];
}

// ─── Component ──────────────────────────────────────────────

export function BrowseGraviScans() {
  // Data state
  const [scans, setScans] = useState<GraviScanRecord[]>([]);
  const [experiments, setExperiments] = useState<ExperimentOption[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string | null>>(
    {}
  );

  // Filter state
  const [experimentId, setExperimentId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch experiments ─────────────────────────────────────

  const fetchExperiments = useCallback(async () => {
    try {
      const result = await window.electron.database.experiments.list();
      if (result.success && result.data) {
        const data = result.data as ExperimentOption[];
        setExperiments(data.sort((a, b) => a.name.localeCompare(b.name)));
      }
    } catch (err) {
      console.error('[BrowseGraviScans] Failed to load experiments:', err);
    }
  }, []);

  // ── Fetch scans ───────────────────────────────────────────

  const fetchScans = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const filters: { experiment_id?: string } = {};
      if (experimentId) {
        filters.experiment_id = experimentId;
      }

      const result = await window.electron.database.graviscans.list(filters);

      if (!result.success) {
        setError(result.error || 'Failed to load scans');
        return;
      }

      let data = result.data as GraviScanRecord[];

      // Client-side: filter out soft-deleted scans (DB should do this, but be safe)
      data = data.filter((s) => !s.deleted);

      // Client-side date filtering
      if (dateFrom) {
        const from = new Date(dateFrom);
        data = data.filter((s) => new Date(s.capture_date) >= from);
      }
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        data = data.filter((s) => new Date(s.capture_date) <= to);
      }

      setScans(data);

      // Load thumbnails for first image of each scan
      const thumbs: Record<string, string | null> = {};
      for (const scan of data) {
        if (scan.images.length > 0) {
          try {
            const imgResult = await window.electron.gravi.readScanImage(
              scan.images[0].path
            );
            thumbs[scan.id] =
              imgResult.success && imgResult.data ? imgResult.data : null;
          } catch {
            thumbs[scan.id] = null;
          }
        } else {
          thumbs[scan.id] = null;
        }
      }
      setThumbnails(thumbs);
    } catch (err) {
      console.error('[BrowseGraviScans] Failed to load scans:', err);
      setError('An unexpected error occurred while loading scans');
    } finally {
      setIsLoading(false);
    }
  }, [experimentId, dateFrom, dateTo]);

  useEffect(() => {
    fetchExperiments();
  }, [fetchExperiments]);

  useEffect(() => {
    fetchScans();
  }, [fetchScans]);

  // ── Group scans by session ────────────────────────────────

  const sessionGroups: SessionGroup[] = (() => {
    const groupMap = new Map<string, SessionGroup>();

    for (const scan of scans) {
      const key = scan.session_id || `no-session-${scan.id}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          sessionId: key,
          session: scan.session || null,
          scans: [],
        });
      }
      groupMap.get(key)!.scans.push(scan);
    }

    return Array.from(groupMap.values()).sort((a, b) => {
      const aDate = a.scans[0]?.capture_date || '';
      const bDate = b.scans[0]?.capture_date || '';
      return bDate.localeCompare(aDate);
    });
  })();

  // ── Helpers ───────────────────────────────────────────────

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleClearFilters = () => {
    setExperimentId('');
    setDateFrom('');
    setDateTo('');
  };

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Browse GraviScans</h1>

      {/* Filters */}
      <div className="mb-6 p-4 bg-white border rounded-lg shadow-sm">
        <div className="flex flex-wrap gap-4 items-end">
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

          <button
            type="button"
            onClick={handleClearFilters}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors"
          >
            Clear Filters
          </button>
        </div>
      </div>

      {/* Results summary */}
      <div className="mb-4">
        <p className="text-sm text-gray-600">
          {isLoading
            ? 'Loading...'
            : `${scans.length} scan(s) in ${sessionGroups.length} session(s)`}
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="h-96 flex items-center justify-center">
          <p className="text-sm text-gray-500">Loading scans...</p>
        </div>
      ) : scans.length === 0 ? (
        <div className="h-96 flex flex-col items-center justify-center bg-white border rounded-lg shadow-sm">
          <p className="text-sm text-gray-500 mb-2">No scans found</p>
          <p className="text-xs text-gray-400">
            Go to the GraviScan page to capture scans, or adjust your filters
            above.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {sessionGroups.map((group) => (
            <div
              key={group.sessionId}
              className="bg-white border rounded-lg shadow-sm overflow-hidden"
            >
              {/* Session header */}
              <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-semibold text-gray-700">
                    {group.session
                      ? `Session ${group.sessionId.slice(0, 8)}`
                      : 'Ungrouped Scan'}
                  </h2>
                  {group.session && (
                    <>
                      <span className="text-xs text-gray-500">
                        {group.session.scan_mode}
                      </span>
                      <span className="text-xs text-gray-400">
                        {formatDate(group.session.started_at)}
                      </span>
                    </>
                  )}
                  {group.session?.cancelled && (
                    <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full">
                      Cancelled
                    </span>
                  )}
                </div>
                <span className="text-xs text-gray-500">
                  {group.scans.length} scan(s)
                </span>
              </div>

              {/* Scan cards grid */}
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {group.scans.map((scan) => (
                  <div
                    key={scan.id}
                    data-testid="graviscan-card"
                    className="border rounded-md overflow-hidden hover:shadow-md transition-shadow"
                  >
                    {/* Thumbnail */}
                    <div className="aspect-[4/3] bg-gray-100 flex items-center justify-center">
                      {thumbnails[scan.id] ? (
                        <img
                          src={thumbnails[scan.id]!}
                          alt={`Scan ${scan.plate_barcode || scan.plate_index}`}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-xs text-gray-400">
                          No preview
                        </span>
                      )}
                    </div>

                    {/* Info */}
                    <div className="p-2 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium truncate">
                          {scan.plate_barcode || `Plate ${scan.plate_index}`}
                        </span>
                        <span className="text-xs text-gray-400">
                          Wave {scan.wave_number}
                        </span>
                      </div>
                      {scan.experiment && (
                        <p className="text-xs text-gray-500 truncate">
                          {scan.experiment.species} - {scan.experiment.name}
                        </p>
                      )}
                      <p className="text-xs text-gray-400">
                        {formatDate(scan.capture_date)}
                      </p>
                      {scan.scanner && (
                        <p className="text-xs text-gray-400">
                          {scan.scanner.name}
                        </p>
                      )}
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-400">
                          {scan.images.length} image(s)
                        </span>
                        <span className="text-xs text-gray-400">
                          {scan.resolution} DPI
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
