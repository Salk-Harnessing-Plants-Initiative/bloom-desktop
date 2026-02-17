/**
 * RecentScansPreview Component
 *
 * Displays a simple list of recent scans (last 5-10 from today).
 * This is NOT the full browsing interface - just a quick preview.
 */

export interface ScanSummary {
  id: string;
  plantQrCode: string;
  timestamp: Date;
  framesCaptured: number;
  success: boolean;
  outputPath?: string;
}

export interface RecentScansPreviewProps {
  /** List of recent scans to display */
  scans: ScanSummary[];
  /** Optional callback to view all scans (future: navigate to BrowseScans page) */
  onViewAll?: () => void;
}

export function RecentScansPreview({
  scans,
  onViewAll,
}: RecentScansPreviewProps) {
  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (scans.length === 0) {
    return (
      <div className="bg-gray-50 rounded-lg p-6 text-center">
        <p className="text-gray-500">No scans yet today</p>
        <p className="text-sm text-gray-400 mt-1">
          Complete a scan to see it here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">
          Recent Scans Today
        </h3>
        {onViewAll && (
          <button
            onClick={onViewAll}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            View All Scans →
          </button>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-200">
        {scans.map((scan) => (
          <div
            key={scan.id}
            className="px-4 py-3 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center space-x-3">
                  <span
                    className="font-medium text-gray-900"
                    data-testid={`recent-scan-plant-${scan.plantQrCode}`}
                  >
                    {scan.plantQrCode}
                  </span>
                  <span className="text-sm text-gray-500">
                    {formatTime(scan.timestamp)}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      scan.success
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {scan.success ? '✓' : '✗'} {scan.framesCaptured} frames
                  </span>
                </div>
                {scan.outputPath && (
                  <p className="text-xs text-gray-400 mt-1 truncate">
                    {scan.outputPath}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {scans.length >= 5 && (
        <p className="text-xs text-gray-500 text-center">
          Showing {scans.length} most recent scans
        </p>
      )}
    </div>
  );
}
