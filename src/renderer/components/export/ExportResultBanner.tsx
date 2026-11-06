/**
 * Export Scans' result after an export: what was exported, skipped, or failed.
 */

import type { ScansExportFailure } from '../../../types/database';

export type ResultBanner =
  | {
      type: 'success';
      exportedScans: number;
      exportedFiles: number;
      skippedFiles: number;
    }
  | {
      type: 'partial';
      exportedScans: number;
      exportedFiles: number;
      skippedFiles: number;
      failedScans: ScansExportFailure[];
    }
  | { type: 'error'; message: string };

function timestampLabel(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ExportResultBanner({
  banner,
  onDismiss,
}: {
  banner: ResultBanner;
  onDismiss: () => void;
}) {
  return (
    <div
      className={`mb-4 p-4 border rounded-lg ${
        banner.type === 'error'
          ? 'bg-red-50 border-red-200'
          : banner.type === 'partial'
            ? 'bg-yellow-50 border-yellow-200'
            : 'bg-green-50 border-green-200'
      }`}
    >
      {banner.type === 'error' ? (
        <p className="text-sm text-red-600">{banner.message}</p>
      ) : (
        <>
          {banner.exportedScans === 0 && banner.skippedFiles === 0 ? (
            banner.type === 'success' ? (
              // Nothing was exported, skipped, or failed at all — the
              // selection resolved to zero processable scans (e.g. they
              // were deleted elsewhere between page load and export).
              // Without this branch, the default wording below would
              // read as a false "0 scans exported (already present)"
              // success claim with no indication anything is wrong.
              <p className="text-sm text-gray-800">
                No scans were exported — the selected scans may no longer exist.
                Try refreshing the page and re-selecting.
              </p>
            ) : // Partial export where every selected scan failed outright
            // (0 exported, 0 skipped): the failed-scan list below
            // already says everything useful — a "0 scans already
            // exported" summary here would just be confusing noise on
            // top of it.
            null
          ) : (
            <p className="text-sm text-gray-800">
              {banner.exportedFiles === 0 ? (
                // Nothing new was copied this run — every file already
                // existed at the destination. Saying "exported (already
                // present)" here would be self-contradictory (did it
                // export or not?), so this phrasing avoids pairing those
                // two words in the same clause.
                <>
                  {banner.exportedScans} scan
                  {banner.exportedScans === 1 ? '' : 's'} already exported — all{' '}
                  {banner.skippedFiles} file
                  {banner.skippedFiles === 1 ? '' : 's'} already present
                </>
              ) : (
                <>
                  {banner.exportedScans} scan
                  {banner.exportedScans === 1 ? '' : 's'} exported (
                  {banner.exportedFiles} file
                  {banner.exportedFiles === 1 ? '' : 's'}),{' '}
                  {banner.skippedFiles} file
                  {banner.skippedFiles === 1 ? '' : 's'} skipped (already exist)
                </>
              )}
            </p>
          )}
          {banner.type === 'partial' && (
            <div className="mt-2">
              <p className="text-sm font-medium text-red-700">
                {banner.failedScans.length} scan
                {banner.failedScans.length === 1 ? '' : 's'} failed:
              </p>
              <ul className="list-disc list-inside text-sm text-red-600">
                {banner.failedScans.map((f) => (
                  <li key={f.scanId}>
                    {f.experimentName} — {timestampLabel(f.captureDate)}:{' '}
                    {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <button
        type="button"
        onClick={onDismiss}
        className="mt-2 text-xs text-gray-500 hover:text-gray-700 underline"
      >
        Dismiss
      </button>
    </div>
  );
}
